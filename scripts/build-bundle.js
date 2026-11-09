#!/usr/bin/env node
// Builds a portable ADM bundle (#31): the app (bin/, src/, node_modules/) plus
// a private Node runtime, packed as a per-platform tar.gz + sha256 file.
//
//   node scripts/build-bundle.js --target linux-x64 [--node-version 20.18.1] [--out dist]
//   node scripts/build-bundle.js --all                       (all 5 targets)
//
// Targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64.
// All targets build on any host (we only pack — we never run the runtime).
// Layout inside the bundle:
//   adm/app/…        (bin, src, node_modules, package.json)
//   adm/runtime/…    (private Node: bin/node or node.exe)
//   adm/launcher.sh  (unix launcher body → installed to ~/.local/bin/adm)
//   adm/adm.cmd      (windows launcher body → installed to %LOCALAPPDATA%\adm)

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const NODE_VERSION_DEFAULT = '20.18.1';

const TARGETS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];

function nodeDist(target, version) {
  const [os, arch] = target.split('-');
  if (os === 'win32') return `node-v${version}-win-${arch}.zip`;
  return `node-v${version}-${os}-${arch}.tar.gz`;
}

// Streamed sha256 through Node crypto — no sha256sum CLI dependency
// (Windows has none).
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function download(url, dest, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      execFileSync('curl', ['-fsSL', '--retry', '2', '-o', dest, url], { stdio: 'inherit' });
      const size = fs.statSync(dest).size;
      if (size > 1024 * 1024) return; // runtime archives are always multi-MB
      throw new Error(`downloaded file is only ${size} bytes`);
    } catch (e) {
      if (i === attempts) throw new Error(`download failed (${url}): ${e.message}`);
      console.warn(`download attempt ${i} failed (${e.message}) — retrying…`);
    }
  }
}

// Gunzip via Node zlib — the Windows tar/gzip CLI pairing is unreliable
// ("unexpected end of file"); plain `tar xf` works everywhere.
function gunzip(archive, outTar) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(archive);
    const output = fs.createWriteStream(outTar);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    input.pipe(require('zlib').createGunzip()).pipe(output);
  });
}

// Extracts a runtime archive into dest, flattening the top-level
// node-vX.Y.Z-os-arch dir so that dest IS the runtime dir.
async function extractRuntime(archive, dest, target) {
  fs.mkdirSync(dest, { recursive: true });
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${dest}'`], { stdio: 'inherit' });
    } else {
      execFileSync('python3', ['-m', 'zipfile', '-e', archive, dest], { stdio: 'inherit' });
    }
  } else {
    // GNU tar (Git Bash) treats "C:\…" as a remote host ("Cannot connect to
    // C:") — keep the tar file INSIDE dest and extract by relative name.
    const plainTar = path.join(dest, 'runtime.tar');
    await gunzip(archive, plainTar);
    execFileSync('tar', ['xf', 'runtime.tar'], { cwd: dest, stdio: 'inherit' });
    fs.rmSync(plainTar, { force: true });
  }
  // Flatten the single top-level directory (node-v…-linux-x64/…).
  const entries = fs.readdirSync(dest);
  const top = entries.find(e => e.startsWith('node-v'));
  if (top) {
    const inner = path.join(dest, top);
    for (const name of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, name), path.join(dest, name));
    }
    fs.rmdirSync(inner);
  }
}

function copyApp(staging, { version }) {
  const app = path.join(staging, 'app');
  fs.mkdirSync(app, { recursive: true });
  for (const item of ['bin', 'src', 'package.json', 'package-lock.json']) {
    const src = path.join(REPO, item);
    const dest = path.join(app, item);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  // Production dependencies only — bundled with the app.
  // Windows: npm is npm.cmd — Node ≥20.12 requires shell:true for .cmd,
  // so the command is passed as a single string on every platform.
  execFileSync('npm ci --omit=dev --omit=optional --no-audit --no-fund', {
    cwd: app, stdio: 'inherit', shell: true,
  });
  const pkgPath = path.join(app, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

const LAUNCHER_SH = `#!/bin/sh
# ADM launcher — runs adm under the bundled private Node.
exec "$HOME/.adm/runtime/bin/node" "$HOME/.adm/app/bin/adm" "$@"
`;

const LAUNCHER_CMD = `@echo off
REM ADM launcher — runs adm under the bundled private Node.
"%LOCALAPPDATA%\\adm\\runtime\\node.exe" "%LOCALAPPDATA%\\adm\\app\\bin\\adm" %*
`;

function writeLaunchers(staging, target) {
  if (target === 'win32-x64') {
    fs.writeFileSync(path.join(staging, 'adm.cmd'), LAUNCHER_CMD.replace(/\n/g, '\r\n'), 'utf8');
  } else {
    fs.writeFileSync(path.join(staging, 'launcher.sh'), LAUNCHER_SH, { encoding: 'utf8', mode: 0o755 });
  }
}

function pack(staging, outDir, bundleName) {
  const dest = path.join(outDir, bundleName);
  // staging IS the adm/ dir — tar from its parent, relative names only
  // (GNU tar rejects "C:\…" argument paths).
  execFileSync('tar', ['czf', bundleName, 'adm'], { cwd: path.dirname(staging), stdio: 'inherit' });
  try {
    fs.renameSync(path.join(path.dirname(staging), bundleName), dest);
  } catch {
    fs.copyFileSync(path.join(path.dirname(staging), bundleName), dest);
    fs.rmSync(path.join(path.dirname(staging), bundleName), { force: true });
  }
  return dest;
}

async function buildTarget(target, { outDir, nodeVersion }) {
  const { version } = require(path.join(REPO, 'package.json'));
  const [os, arch] = target.split('-');
  console.log(`\n=== building adm-v${version}-${target} (node ${nodeVersion}) ===`);

  const workDir = fs.mkdtempSync(path.join(require('os').tmpdir(), `adm-bundle-${os}-${arch}-`));
  const staging = path.join(workDir, 'adm');
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  try {
    // 1. app (code + prod deps)
    copyApp(staging, { version });

    // 2. private Node runtime
    const distName = nodeDist(target, nodeVersion);
    const archive = path.join(workDir, distName);
    download(`https://nodejs.org/dist/v${nodeVersion}/${distName}`, archive);
    await extractRuntime(archive, path.join(staging, 'runtime'), target);

    // 3. launchers
    writeLaunchers(staging, target);

    // 4. pack + sha256
    const bundleName = `adm-v${version}-${target}.tar.gz`;
    const bundlePath = pack(staging, outDir, bundleName);
    const hash = await sha256File(bundlePath);
    fs.writeFileSync(`${bundlePath}.sha256`, `${hash}  ${bundleName}\n`, 'utf8');
    console.log(`built ${bundlePath}\n  sha256: ${hash}`);
    return { target, bundleName, hash };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const outDir = path.resolve(get('out', 'dist'));
  const nodeVersion = get('node-version', process.env.ADM_NODE_VERSION || NODE_VERSION_DEFAULT);
  const targets = args.includes('--all') ? TARGETS : [get('target')];

  if (!targets[0] || targets.some(t => !TARGETS.includes(t))) {
    console.error(`Usage: node scripts/build-bundle.js --target <${TARGETS.join('|')}> [--all] [--node-version V] [--out dist]`);
    process.exit(1);
  }

  const results = [];
  for (const target of targets) {
    results.push(await buildTarget(target, { outDir, nodeVersion }));
  }
  console.log(`\nDone: ${results.length} bundle(s) in ${outDir}`);
}

main().catch(e => {
  console.error(`bundle build failed: ${e.message}`);
  process.exit(2);
});
