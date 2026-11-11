// Self-update (#32): `adm upgrade` / `adm update` swaps the portable bundle
// in ~/.adm (app + private runtime) for the latest GitHub Release.
//
//   adm upgrade --check    read-only: is a newer release available? (exit 0 both ways)
//   adm upgrade --dry-run  print the plan (asset, url, sha256, target) — no changes
//   adm upgrade            download → verify sha256 → atomic swap with rollback
//   adm update             alias of `adm upgrade`
//
// Install-channel detection:
//   bundle (~/.adm/app/package.json exists) → self-swap (this module)
//   npm (everything else)                   → print the `npm update -g` command
//
// Atomic swap (AC): download to a tmp dir → verify sha256 BEFORE touching the
// install → back up the old app/runtime (rename) → move the new ones in → on
// ANY failure rename the backups back (rollback) → old install intact, exit 2.
//
// All I/O is injectable (fetchFn, fs, execFileFn, home, env, apiBase,
// downloadBase, spinnerFactory) so the whole flow runs against a fixture
// "releases server" in tests — never against production.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { getVersion } = require('../commands/version');
const { loader } = require('../setup/loader');
const { saveReport } = require('../reports');

const REPO = 'CrystalPlatforms/ADM-CLI';
const NPM_PACKAGE = '@crystalplatforms/adm';
const API_BASE = `https://api.github.com/repos/${REPO}`;
const DOWNLOAD_BASE = `https://github.com/${REPO}/releases/download`;
const USER_AGENT = 'adm-cli';

// ── channel + paths ────────────────────────────────────────────────────

// The bundle lives in ~/.adm (unix) or %LOCALAPPDATA%\adm (win32).
// ADM_HOME overrides both (same var the installers honor).
function admHomeDir({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  if (env.ADM_HOME) return env.ADM_HOME;
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'adm');
  return path.join(home, '.adm');
}

// Detects how this ADM was installed. Explicit ADM_CHANNEL wins (tests /
// edge cases), then the on-disk layout: the bundle markers is
// <admHome>/app/package.json — npm installs never create that.
function detectChannel(opts = {}) {
  const env = opts.env || process.env;
  const admHome = opts.admHome || admHomeDir(opts);
  const fsMod = opts.fs || fs;

  if (env.ADM_CHANNEL === 'npm') return { channel: 'npm', admHome };
  if (env.ADM_CHANNEL === 'bundle') return { channel: 'bundle', admHome };

  const appPkg = path.join(admHome, 'app', 'package.json');
  try {
    fsMod.accessSync(appPkg);
    return { channel: 'bundle', admHome };
  } catch {
    return { channel: 'npm', admHome };
  }
}

// ── versions ────────────────────────────────────────────────────────────

// Numeric semver compare for x.y.z release tags ("v" prefix tolerated).
// Returns <0 / 0 / >0. Non-numeric segments compare as strings (safe
// fallback); missing segments count as 0 ("1.2" < "1.2.1").
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.');
  const pb = String(b).replace(/^v/, '').split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] || '0';
    const sb = pb[i] || '0';
    const na = /^\d+$/.test(sa) ? Number(sa) : NaN;
    const nb = /^\d+$/.test(sb) ? Number(sb) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

// Latest release version from the GitHub API (tag_name, "v" stripped).
// Throws on any non-200 / malformed payload.
async function fetchLatestVersion({ apiBase = API_BASE, fetchFn } = {}) {
  const res = await fetchFn(`${apiBase}/releases/latest`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30 * 1000),
  });
  if (!res.ok) throw new Error(`cannot resolve the latest release (HTTP ${res.status})`);
  const data = await res.json();
  const tag = data && data.tag_name;
  if (!tag) throw new Error('release payload has no tag_name');
  return String(tag).replace(/^v/, '');
}

// The platform bundle target: linux-x64, linux-arm64, darwin-x64,
// darwin-arm64, win32-x64. Throws for unsupported combos — self-update never
// guesses.
function targetFor(platform = process.platform, arch = process.arch) {
  const t = `${platform}-${arch}`;
  const KNOWN = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];
  if (!KNOWN.includes(t)) {
    throw new Error(`no bundle available for ${t} — update manually: https://github.com/${REPO}/releases`);
  }
  return t;
}

function assetName(version, target) {
  return `adm-v${version}-${target}.tar.gz`;
}

// ── download + verify ───────────────────────────────────────────────────

// Streams url to dest, reporting { received, total } through onProgress.
async function downloadFile(url, dest, { fetchFn = global.fetch, onProgress, timeoutMs = 15 * 60 * 1000 } = {}) {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status}): ${url}`);
  if (!res.body) throw new Error(`download failed (empty body): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const out = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => {
    const reader = Readable.fromWeb(res.body);
    reader.on('error', reject);
    reader.on('data', chunk => {
      received += chunk.length;
      if (onProgress) onProgress({ received, total });
    });
    out.on('error', reject);
    out.on('finish', resolve);
    reader.pipe(out);
  });
  return dest;
}

// Same streaming hash as scripts/build-bundle.js — no sha256sum CLI (Windows
// has none).
function sha256File(file, fsMod = fs) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsMod.createReadStream
      ? fsMod.createReadStream(file)
      : require('fs').createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Parses "<hash>  <name>" checksum files (first token wins).
function parseSha256(text) {
  const line = String(text).trim().split('\n')[0].trim();
  const m = line.match(/^([0-9a-fA-F]{64})\b/);
  return m ? m[1].toLowerCase() : null;
}

// ── unpack ──────────────────────────────────────────────────────────────

// Gunzip via Node zlib, then `tar xf <relative-name>` from inside the unpack
// dir — the exact pairing proven by scripts/build-bundle.js on every
// platform (GNU tar rejects "C:\…" argument paths as remote hosts).
function unpackBundle(archive, unpackDir, { execFileFn } = {}) {
  const execFile = execFileFn || require('child_process').execFile;
  const tarFile = path.join(unpackDir, 'bundle.tar');
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(archive);
    const output = fs.createWriteStream(tarFile);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', () => {
      execFile('tar', ['xf', 'bundle.tar'], { cwd: unpackDir }, err => {
        if (err) reject(new Error(`unpack failed: ${err.message}`));
        else resolve(unpackDir);
      });
    });
    input.pipe(require('zlib').createGunzip()).pipe(output);
  });
}

// The bundle must contain adm/app (with package.json) + adm/runtime —
// anything else aborts the swap BEFORE the old install is touched.
function verifyUnpackedLayout(unpackDir, fsMod = fs) {
  const appPkg = path.join(unpackDir, 'adm', 'app', 'package.json');
  const runtime = path.join(unpackDir, 'adm', 'runtime');
  try {
    fsMod.accessSync(appPkg);
    fsMod.accessSync(runtime);
  } catch {
    throw new Error('bundle layout unexpected (adm/app + adm/runtime missing) — aborting');
  }
}

// ── atomic swap with rollback ───────────────────────────────────────────

// rename with a cross-device fallback (tmp dirs may live on another mount —
// EXDEV): copy recursively, then remove the source.
function moveDir(src, dest, fsMod) {
  try {
    fsMod.renameSync(src, dest);
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      fsMod.cpSync(src, dest, { recursive: true });
      fsMod.rmSync(src, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
}

const BACKUP_APP = /^app\.bak-\d+$/;
const BACKUP_RUNTIME = /^runtime\.bak-\d+$/;

// Best-effort removal of leftovers from a previous upgrade (on Windows the
// running node.exe can keep a backup alive — the next upgrade clears it).
function cleanStaleBackups(admHome, fsMod) {
  for (const entry of fsMod.readdirSync(admHome)) {
    if (BACKUP_APP.test(entry) || BACKUP_RUNTIME.test(entry)) {
      try { fsMod.rmSync(path.join(admHome, entry), { recursive: true, force: true }); } catch { /* keep */ }
    }
  }
}

// Swaps the unpacked bundle into admHome:
//   1. rename old app → app.bak-<stamp>, old runtime → runtime.bak-<stamp>
//      (only the parts that exist)
//   2. move the new app/runtime in
//   3. any failure → remove partial new dirs, rename backups back (rollback)
//   4. success → remove backups (best-effort; a Windows backup pinned by the
//      running runtime is reported back as keptBackups)
function swapBundle({ admHome, unpackDir, fsMod = fs, stamp }) {
  const newApp = path.join(unpackDir, 'adm', 'app');
  const newRuntime = path.join(unpackDir, 'adm', 'runtime');
  const backups = []; // { from, to, exists }
  const done = []; // destinations already populated — removed on rollback

  const backup = name => {
    const from = path.join(admHome, name);
    try {
      fsMod.accessSync(from);
    } catch {
      return; // nothing to back up (first install state)
    }
    const to = path.join(admHome, `${name}.bak-${stamp}`);
    fsMod.renameSync(from, to);
    backups.push({ from, to });
  };

  try {
    cleanStaleBackups(admHome, fsMod);
    backup('app');
    backup('runtime');
    fsMod.mkdirSync(admHome, { recursive: true });
    moveDir(newApp, path.join(admHome, 'app'), fsMod);
    done.push(path.join(admHome, 'app'));
    moveDir(newRuntime, path.join(admHome, 'runtime'), fsMod);
    done.push(path.join(admHome, 'runtime'));
  } catch (e) {
    // ── rollback: old install must come back intact (AC) ─────────────
    for (const d of done) {
      try { fsMod.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    for (const b of backups) {
      try { fsMod.renameSync(b.to, b.from); } catch { /* reported below */ }
    }
    const err = new Error(`swap failed: ${e.message} — the previous version was restored`);
    err.rolledBack = true;
    throw err;
  }

  // Success: drop the backups. On Windows the running runtime can pin the
  // backup — keep it and say so.
  const keptBackups = [];
  for (const b of backups) {
    try {
      fsMod.rmSync(b.to, { recursive: true, force: true });
    } catch {
      keptBackups.push(b.to);
    }
  }
  return { keptBackups };
}

// ── the command ─────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} kB`;
}

async function runUpgrade(argv = [], deps = {}) {
  const baseLog = deps.log || (s => process.stdout.write(s + '\n'));
  const baseErr = deps.err || (s => process.stderr.write(s + '\n'));
  // tee: everything the upgrade prints is collected for the persisted report
  const output = [];
  const log = s => { output.push(s); baseLog(s); };
  const err = s => { output.push(s); baseErr(s); };
  const fsMod = deps.fs || fs;
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const home = deps.home || os.homedir();
  const fetchFn = deps.fetchFn || global.fetch;
  const spinnerFactory = deps.spinnerFactory || (t => loader(t));
  const currentVersion = deps.version || getVersion();
  const apiBase = deps.apiBase || API_BASE;
  const downloadBase = deps.downloadBase || DOWNLOAD_BASE;

  // Persist the upgrade report to the global cache (owner decision).
  // Only REAL upgrade attempts are persisted — `--check`, npm-channel hints
  // and `--dry-run` are status queries, not reports.
  const persistReport = status => {
    if (!deps.configDir) return; // explicit config dir required from callers/tests
    const body = [
      `ADM upgrade report — ${new Date().toISOString()}`,
      `ADM ${currentVersion} → v${latest || '?'} · ${status}`,
      '',
      output.join('\n'),
    ].join('\n') + '\n';
    const saved = saveReport('upgrade', body, { configDir: deps.configDir });
    if (saved.error) baseErr(`⚠ ${saved.error}`);
  };

  // ── flags ────────────────────────────────────────────────────────────
  const check = argv.includes('--check');
  const dryRun = argv.includes('--dry-run');
  const bad = argv.filter(f => f !== '--check' && f !== '--dry-run');
  if (bad.length > 0) {
    err([
      `Unknown flag for "upgrade": ${bad.join(', ')}`,
      '',
      'Valid flags:',
      '  --check     only check whether a newer version exists (no changes)',
      '  --dry-run   print the upgrade plan without changing anything',
    ].join('\n'));
    return 1;
  }

  // ── channel ──────────────────────────────────────────────────────────
  const { channel, admHome } = detectChannel({ env, home, platform, fs: fsMod, admHome: deps.admHome });
  if (channel === 'npm') {
    log('ADM was installed via npm — npm handles the update.');
    log('');
    log(`  npm update -g ${NPM_PACKAGE}`);
    log('');
    return 0;
  }

  // ── resolve the latest release (short spinner) ───────────────────────
  let latest;
  let spin = spinnerFactory('Checking the latest release...');
  spin.start();
  try {
    latest = await fetchLatestVersion({ apiBase, fetchFn });
  } catch (e) {
    spin.fail('Could not resolve the latest release');
    err(`ADM failed: ${e.message}`);
    persistReport('failed (cannot resolve latest release)');
    return 2;
  }

  const cmp = compareVersions(latest, currentVersion);
  if (cmp <= 0) {
    spin.info(cmp === 0
      ? `ADM is up to date (${currentVersion}).`
      : `ADM ${currentVersion} is newer than the latest release (v${latest}) — nothing to do.`);
    return 0;
  }

  let target;
  try {
    target = targetFor(platform, deps.arch || process.arch);
  } catch (e) {
    spin.fail('No bundle for this platform');
    err(`ADM failed: ${e.message}`);
    return 2;
  }
  const asset = assetName(latest, target);
  const url = `${downloadBase}/v${latest}/${asset}`;
  const shaUrl = `${url}.sha256`;

  // ── --check: read-only answer, exit 0 both ways (AC) ─────────────────
  if (check) {
    spin.succeed(`A newer version is available: v${latest} (installed: ${currentVersion}).`);
    log('');
    log('Run: adm upgrade');
    return 0;
  }

  // ── --dry-run: the plan (asset, url, sha256, target), no changes (AC) ─
  if (dryRun) {
    let sha = null;
    try {
      const tmp = fsMod.mkdtempSync(path.join(require('os').tmpdir(), 'adm-upgrade-'));
      const shaFile = path.join(tmp, `${asset}.sha256`);
      await downloadFile(shaUrl, shaFile, { fetchFn, timeoutMs: 30 * 1000 });
      sha = parseSha256(fsMod.readFileSync(shaFile, 'utf8'));
      fsMod.rmSync(tmp, { recursive: true, force: true });
    } catch { /* sha optional in the plan */ }
    spin.succeed('Upgrade plan (dry run — nothing was changed):');
    log('');
    log(`  version:  ${latest} (installed: ${currentVersion})`);
    log(`  asset:    ${asset}`);
    log(`  url:      ${url}`);
    log(`  sha256:   ${sha || '(unavailable)'}`);
    log(`  target:   ${admHome} (app + runtime swap)`);
    return 0;
  }

  // ── real upgrade: download → verify → swap (rollback on failure) ─────
  const tmp = fsMod.mkdtempSync(path.join(require('os').tmpdir(), 'adm-upgrade-'));
  try {
    const bundlePath = path.join(tmp, asset);
    let lastPct = -1;
    await downloadFile(url, bundlePath, {
      fetchFn,
      onProgress: ({ received, total }) => {
        if (!total) {
          spin.text(`Downloading ${asset} (${fmtBytes(received)})`);
          return;
        }
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          spin.text(`Downloading ${asset} (${pct}%)`);
        }
      },
    });

    // sha256 BEFORE anything is written to the install (AC: bad checksum →
    // abort, old version intact).
    spin.text('Verifying sha256...');
    const shaFile = path.join(tmp, `${asset}.sha256`);
    await downloadFile(shaUrl, shaFile, { fetchFn, timeoutMs: 30 * 1000 });
    const expected = parseSha256(fsMod.readFileSync(shaFile, 'utf8'));
    const actual = await sha256File(bundlePath, fsMod);
    if (!expected || expected !== actual) {
      spin.fail('Checksum mismatch');
      err([
        `ADM failed: sha256 mismatch for ${asset} — the bundle is corrupted or tampered with.`,
        'Nothing was changed; your current install is intact.',
        `  expected: ${expected || '(missing checksum file)'}`,
        `  actual:   ${actual}`,
      ].join('\n'));
      return 2;
    }
    spin.succeed('Checksum verified');

    spin.text('Unpacking...');
    await unpackBundle(bundlePath, tmp, { execFileFn: deps.execFileFn });
    verifyUnpackedLayout(tmp, fsMod);

    spin.text('Swapping in the new version...');
    const { keptBackups } = swapBundle({ admHome, unpackDir: tmp, fsMod, stamp: deps.stamp || Date.now() });

    spin.succeed(`ADM updated to v${latest} — run \`adm -v\` to confirm.`);
    if (keptBackups.length > 0) {
      log(`  note: the previous runtime was still running — its backup stays at ${keptBackups.join(', ')}`);
      log('  (it is removed automatically by the next upgrade, or delete it manually)');
    }
    persistReport(`success (${currentVersion} → ${latest})`);
    return 0;
  } catch (e) {
    if (spin) spin.fail(e.rolledBack ? 'Upgrade failed — your previous version was restored' : 'Upgrade failed');
    err(`ADM failed: ${e.message}`);
    persistReport(e.rolledBack ? 'failed (rolled back)' : 'failed');
    return 2;
  } finally {
    try { fsMod.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = {
  runUpgrade,
  detectChannel,
  admHomeDir,
  compareVersions,
  fetchLatestVersion,
  targetFor,
  assetName,
  downloadFile,
  sha256File,
  parseSha256,
  unpackBundle,
  verifyUnpackedLayout,
  swapBundle,
  moveDir,
  REPO,
  NPM_PACKAGE,
};
