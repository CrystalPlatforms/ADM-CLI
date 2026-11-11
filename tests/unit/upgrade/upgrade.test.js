const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  runUpgrade,
  detectChannel,
  admHomeDir,
  compareVersions,
  targetFor,
  assetName,
  parseSha256,
  swapBundle,
} = require('../../../src/upgrade');

// Self-update suite (#32) — runs against a FAKE releases server (fixture),
// never against production. The fixture serves a release index, a bundle
// (adm/app v9.9.9 + adm/runtime) and its sha256; a "bad" variant serves a
// tampered bundle + wrong checksum.

let server;
let baseUrl;
let root; // fixture + homes root

const REAL_HASH = crypto.randomBytes(32).toString('hex'); // replaced in beforeAll
let latestTag = 'v9.9.9';

function buildFixture() {
  const fixture = path.join(root, 'fixture');
  fs.mkdirSync(path.join(fixture, 'adm', 'app', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'adm', 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'adm', 'app', 'package.json'),
    JSON.stringify({ name: 'adm', version: '9.9.9' }));
  fs.writeFileSync(path.join(fixture, 'adm', 'app', 'bin', 'adm'), '#!/bin/sh\necho fake\n');
  fs.writeFileSync(path.join(fixture, 'adm', 'runtime', 'node.txt'), 'fake runtime');
  // GNU tar rejects "C:\…" argument paths — pack by relative name (as the
  // bundle builder does), then hash the result.
  const name = 'adm-v9.9.9-linux-x64.tar.gz';
  execFileSync('tar', ['czf', name, 'adm'], { cwd: fixture });
  const bundle = path.join(fixture, name);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex');
  fs.writeFileSync(`${bundle}.sha256`, `${hash}  ${name}\n`);
  return { bundle, hash };
}

function startServer(fixture) {
  const s = http.createServer((req, res) => {
    if (req.url === '/api/repos/x/releases/latest') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tag_name: latestTag }));
      return;
    }
    // happy path: real bundle + matching checksum
    if (req.url === '/download/v9.9.9/adm-v9.9.9-linux-x64.tar.gz') {
      res.writeHead(200);
      fs.createReadStream(fixture.bundle).pipe(res);
      return;
    }
    if (req.url === '/download/v9.9.9/adm-v9.9.9-linux-x64.tar.gz.sha256') {
      res.writeHead(200);
      res.end(`${fixture.hash}  adm-v9.9.9-linux-x64.tar.gz\n`);
      return;
    }
    // tampered variant: garbage bundle + wrong checksum → sha256 abort
    if (req.url === '/download-bad/v9.9.9/adm-v9.9.9-linux-x64.tar.gz') {
      res.writeHead(200);
      res.end('tampered-content-not-a-bundle');
      return;
    }
    if (req.url === '/download-bad/v9.9.9/adm-v9.9.9-linux-x64.tar.gz.sha256') {
      res.writeHead(200);
      res.end(`${'0'.repeat(64)}  adm-v9.9.9-linux-x64.tar.gz\n`);
      return;
    }
    // API outage variant
    if (req.url === '/api/dead/releases/latest') {
      res.writeHead(500);
      res.end('boom');
      return;
    }
    res.writeHead(404);
    res.end('nope');
  });
  return new Promise(resolve => {
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

// A fake OLD bundle install (0.2.3) inside a temp HOME.
function fakeOldInstall() {
  const home = fs.mkdtempSync(path.join(root, 'home-'));
  const admHome = path.join(home, '.adm');
  fs.mkdirSync(path.join(admHome, 'app'), { recursive: true });
  fs.mkdirSync(path.join(admHome, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(admHome, 'app', 'package.json'), JSON.stringify({ version: '0.2.3' }));
  fs.writeFileSync(path.join(admHome, 'runtime', 'node.txt'), 'old runtime');
  return { home, admHome };
}

// Spinner stub — terminal messages (succeed/fail/info) are part of the
// observable output, so they land in the same sink as log().
function stubSpinner(sink) {
  const api = {
    start() { return api; },
    text() { return api; },
    succeed(m) { if (m) sink.push(m); return api; },
    fail(m) { if (m) sink.push(m); return api; },
    info(m) { if (m) sink.push(m); return api; },
    stop() { return api; },
  };
  return api;
}

function makeDeps({ admHome, home, downloadBase = '/download', api = '/api/repos/x', log, err }) {
  const out = [];
  return {
    env: { ADM_CHANNEL: 'bundle', ADM_HOME: admHome },
    home,
    platform: 'linux',
    arch: 'x64',
    version: '0.2.3',
    apiBase: `${baseUrl}${api}`,
    downloadBase: `${baseUrl}${downloadBase}`,
    configDir: path.join(root, 'cfg'), // upgrade reports persist here
    spinnerFactory: () => stubSpinner(out),
    log: s => out.push(s),
    err: err || (() => {}),
    out, // captured stdout (log + spinner terminal messages)
  };
}

// fs proxy that fails the Nth renameSync call (rollback simulation).
function fsFailingRenameAt(n) {
  let calls = 0;
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'renameSync') {
        return (...a) => {
          calls++;
          if (calls === n) throw new Error('EBUSY simulated');
          return fs.renameSync(...a);
        };
      }
      const v = fs[prop];
      return typeof v === 'function' ? v.bind(fs) : v;
    },
  });
}

// fs proxy whose rmSync always throws (Windows: backup pinned by the running
// runtime → keptBackups contract).
function fsFailingRm() {
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'rmSync') return () => { throw new Error('EBUSY simulated'); };
      const v = fs[prop];
      return typeof v === 'function' ? v.bind(fs) : v;
    },
  });
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-upgrade-test-'));
  fs.mkdirSync(path.join(root, 'cfg'), { recursive: true }); // config dir for report persistence
  const fixture = buildFixture();
  server = await startServer(fixture);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── pure helpers ────────────────────────────────────────────────────────

describe('compareVersions', () => {
  test('numeric per-segment compare', () => {
    expect(compareVersions('0.4.0', '0.3.0')).toBeGreaterThan(0);
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0);
    expect(compareVersions('0.2.9', '0.2.10')).toBeLessThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('v0.4.0', '0.3.9')).toBeGreaterThan(0);
  });
});

describe('targetFor / assetName / parseSha256', () => {
  test('known targets pass, unknown throw', () => {
    expect(targetFor('linux', 'x64')).toBe('linux-x64');
    expect(targetFor('darwin', 'arm64')).toBe('darwin-arm64');
    expect(targetFor('win32', 'x64')).toBe('win32-x64');
    expect(() => targetFor('sunos', 'x64')).toThrow(/no bundle available/);
  });
  test('asset follows adm-v<version>-<target>.tar.gz', () => {
    expect(assetName('9.9.9', 'linux-x64')).toBe('adm-v9.9.9-linux-x64.tar.gz');
  });
  test('parseSha256 reads the first token of a checksum file', () => {
    const h = 'a'.repeat(64);
    expect(parseSha256(`${h}  file.tar.gz\n`)).toBe(h);
    expect(parseSha256('nothex')).toBeNull();
  });
});

describe('detectChannel', () => {
  test('bundle marker (admHome/app/package.json) → bundle', () => {
    const { admHome } = fakeOldInstall();
    const d = detectChannel({ env: {}, home: path.dirname(admHome), platform: 'linux', admHome });
    expect(d.channel).toBe('bundle');
  });
  test('no marker → npm (the safe default)', () => {
    const home = fs.mkdtempSync(path.join(root, 'npm-home-'));
    const d = detectChannel({ env: {}, home, platform: 'linux' });
    expect(d.channel).toBe('npm');
  });
  test('ADM_CHANNEL overrides detection', () => {
    const home = fs.mkdtempSync(path.join(root, 'ch-home-'));
    expect(detectChannel({ env: { ADM_CHANNEL: 'npm' }, home }).channel).toBe('npm');
    expect(detectChannel({ env: { ADM_CHANNEL: 'bundle' }, home }).channel).toBe('bundle');
  });
  test('admHomeDir: unix ~/.adm, win32 %LOCALAPPDATA%/adm, ADM_HOME wins', () => {
    expect(admHomeDir({ home: '/h', platform: 'linux', env: {} })).toBe(path.join('/h', '.adm'));
    expect(admHomeDir({ home: '/h', platform: 'win32', env: { LOCALAPPDATA: '/la' } }))
      .toBe(path.join('/la', 'adm'));
    expect(admHomeDir({ home: '/h', platform: 'linux', env: { ADM_HOME: '/custom' } })).toBe('/custom');
  });
});

describe('swapBundle — atomic swap contract', () => {
  test('replaces app + runtime and cleans the backups', () => {
    const { admHome } = fakeOldInstall();
    const unpackDir = fs.mkdtempSync(path.join(root, 'unpack-'));
    fs.mkdirSync(path.join(unpackDir, 'adm'), { recursive: true });
    fs.cpSync(path.join(root, 'fixture', 'adm'), path.join(unpackDir, 'adm'), { recursive: true });
    const { keptBackups } = swapBundle({ admHome, unpackDir, stamp: 123 });
    expect(keptBackups).toEqual([]);
    const pkg = JSON.parse(fs.readFileSync(path.join(admHome, 'app', 'package.json'), 'utf8'));
    expect(pkg.version).toBe('9.9.9');
    expect(fs.readFileSync(path.join(admHome, 'runtime', 'node.txt'), 'utf8')).toBe('fake runtime');
    expect(fs.readdirSync(admHome).filter(e => e.includes('.bak-'))).toEqual([]);
  });

  test('rollback: a failed move restores the old version (AC)', () => {
    const { admHome } = fakeOldInstall();
    const unpackDir = fs.mkdtempSync(path.join(root, 'unpack2-'));
    fs.mkdirSync(path.join(unpackDir, 'adm'), { recursive: true });
    fs.cpSync(path.join(root, 'fixture', 'adm'), path.join(unpackDir, 'adm'), { recursive: true });
    // fail the runtime backup rename (2nd rename call): the swap must roll
    // the app backup back and rethrow
    expect(() => swapBundle({ admHome, unpackDir, stamp: 456, fsMod: fsFailingRenameAt(2) }))
      .toThrow(/previous version was restored/);
    const pkg = JSON.parse(fs.readFileSync(path.join(admHome, 'app', 'package.json'), 'utf8'));
    expect(pkg.version).toBe('0.2.3'); // OLD content intact
    expect(fs.readFileSync(path.join(admHome, 'runtime', 'node.txt'), 'utf8')).toBe('old runtime');
    expect(fs.readdirSync(admHome).filter(e => e.includes('.bak-'))).toEqual([]);
  });

  test('a backup that cannot be removed is reported back (Windows contract)', () => {
    const { admHome } = fakeOldInstall();
    const unpackDir = fs.mkdtempSync(path.join(root, 'unpack3-'));
    fs.mkdirSync(path.join(unpackDir, 'adm'), { recursive: true });
    fs.cpSync(path.join(root, 'fixture', 'adm'), path.join(unpackDir, 'adm'), { recursive: true });
    const { keptBackups } = swapBundle({ admHome, unpackDir, stamp: 789, fsMod: fsFailingRm() });
    expect(keptBackups.length).toBe(2); // app.bak-789 + runtime.bak-789
    const pkg = JSON.parse(fs.readFileSync(path.join(admHome, 'app', 'package.json'), 'utf8'));
    expect(pkg.version).toBe('9.9.9'); // swap still succeeded
  });
});

// ── the command (#32 acceptance criteria) ───────────────────────────────

describe('runUpgrade — bundle channel', () => {
  test('older → newer: swap works and the new install reports the new version', async () => {
    const { admHome, home } = fakeOldInstall();
    const deps = makeDeps({ admHome, home });
    const code = await runUpgrade([], deps);
    expect(code).toBe(0);
    // this package.json is exactly what `adm -v` reads in the new install
    const pkg = JSON.parse(fs.readFileSync(path.join(admHome, 'app', 'package.json'), 'utf8'));
    expect(pkg.version).toBe('9.9.9');
    expect(fs.readFileSync(path.join(admHome, 'runtime', 'node.txt'), 'utf8')).toBe('fake runtime');
    expect(deps.out.join('\n')).toContain('9.9.9');
    // the upgrade report was persisted to the global cache (owner decision)
    const reports = path.join(root, 'cfg', 'reports');
    const files = fs.readdirSync(reports).filter(f => f.startsWith('report-'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(reports, files[files.length - 1]), 'utf8'))
      .toContain('0.2.3 → v9.9.9 · success');
  });

  test('asset with a bad sha256 → abort, old version intact, exit 2', async () => {
    const { admHome, home } = fakeOldInstall();
    const errs = [];
    const code = await runUpgrade([], makeDeps({ admHome, home, downloadBase: '/download-bad', err: s => errs.push(s) }));
    expect(code).toBe(2);
    const pkg = JSON.parse(fs.readFileSync(path.join(admHome, 'app', 'package.json'), 'utf8'));
    expect(pkg.version).toBe('0.2.3'); // untouched
    expect(fs.readFileSync(path.join(admHome, 'runtime', 'node.txt'), 'utf8')).toBe('old runtime');
    expect(errs.join('\n')).toContain('sha256 mismatch');
    expect(errs.join('\n')).toContain('Nothing was changed');
  });

  test('--check: newer exists → message, exit 0 (idempotency contract)', async () => {
    const { admHome, home } = fakeOldInstall();
    const deps = makeDeps({ admHome, home });
    const code = await runUpgrade(['--check'], deps);
    expect(code).toBe(0);
    expect(deps.out.join('\n')).toContain('A newer version is available');
    expect(deps.out.join('\n')).toContain('9.9.9');
    // read-only: the fake old install is untouched
    const pkg = JSON.parse(fs.readFileSync(path.join(admHome, 'app', 'package.json'), 'utf8'));
    expect(pkg.version).toBe('0.2.3');
  });

  test('--check: same version → "already up to date", exit 0', async () => {
    const { admHome, home } = fakeOldInstall();
    latestTag = 'v0.2.3';
    const deps = makeDeps({ admHome, home });
    const code = await runUpgrade(['--check'], deps);
    expect(code).toBe(0);
    expect(deps.out.join('\n')).toContain('up to date');
    latestTag = 'v9.9.9';
  });

  test('--dry-run prints the plan (asset, url, sha256, target) and changes nothing', async () => {
    const { admHome, home } = fakeOldInstall();
    const deps = makeDeps({ admHome, home });
    const code = await runUpgrade(['--dry-run'], deps);
    expect(code).toBe(0);
    const text = deps.out.join('\n');
    expect(text).toContain('adm-v9.9.9-linux-x64.tar.gz');
    expect(text).toContain(`${baseUrl}/download/v9.9.9/adm-v9.9.9-linux-x64.tar.gz`);
    expect(text).toContain('sha256');
    expect(text).toContain(admHome);
    const pkg = JSON.parse(fs.readFileSync(path.join(admHome, 'app', 'package.json'), 'utf8'));
    expect(pkg.version).toBe('0.2.3'); // nothing was changed
  });

  test('release API outage → exit 2 with an actionable message', async () => {
    const { admHome, home } = fakeOldInstall();
    const errs = [];
    const code = await runUpgrade([], makeDeps({ admHome, home, api: '/api/dead', err: s => errs.push(s) }));
    expect(code).toBe(2);
    expect(errs.join('\n')).toContain('cannot resolve the latest release');
  });

  test('unknown flag → usage error, exit 1 (valid flags enumerated)', async () => {
    const { admHome, home } = fakeOldInstall();
    const errs = [];
    const code = await runUpgrade(['--bogus'], makeDeps({ admHome, home, err: s => errs.push(s) }));
    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('--check');
    expect(errs.join('\n')).toContain('--dry-run');
  });
});

describe('runUpgrade — npm channel', () => {
  test('prints the npm update command instead of swapping', async () => {
    const out = [];
    const code = await runUpgrade([], {
      env: { ADM_CHANNEL: 'npm' },
      home: fs.mkdtempSync(path.join(root, 'npmch-')),
      platform: 'linux',
      log: s => out.push(s),
      err: () => {},
    });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('npm update -g @crystalplatforms/adm');
  });
});
