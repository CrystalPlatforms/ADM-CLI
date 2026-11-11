const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// #31 installer.sh contract tests. They run the real POSIX script against a
// fixture bundle (fake app + fake runtime node). Skipped on Windows hosts —
// CI covers them in the Node-less debian container (installer-nodeless job).
const INSTALLER = path.join(__dirname, '..', '..', '..', 'scripts', 'installer.sh');

function hasSh() {
  try {
    return spawnSync('sh', ['-c', 'true'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
}
const shAvailable = hasSh();
const d = shAvailable && process.platform !== 'win32' ? describe : describe.skip;

// Builds a minimal fixture bundle: adm/app/bin/adm + adm/runtime/bin/node.
function makeBundle(dir) {
  const staging = path.join(dir, 'adm', 'app');
  fs.mkdirSync(path.join(staging, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'adm', 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'bin', 'adm'), 'console.log("fixture");\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'adm', 'runtime', 'bin', 'node'), '#!/bin/sh\necho fake-node\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'adm', 'launcher.sh'), '#!/bin/sh\nexec fake\n', 'utf8');
  const bundle = path.join(dir, 'fixture.tar.gz');
  const tar = spawnSync('tar', ['czf', bundle, '-C', dir, 'adm'], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`fixture tar failed: ${tar.stderr}`);
  const sha = spawnSync('sha256sum', [bundle], { encoding: 'utf8' });
  if (sha.status !== 0) throw new Error('sha256sum unavailable in test host');
  return { bundle, hash: sha.stdout.trim().split(/\s+/)[0] };
}

function runInstaller(env) {
  return spawnSync('sh', [INSTALLER], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ...env },
  });
}

d('installer.sh', () => {
  let work;
  let fixture;
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-inst-'));
    fixture = makeBundle(work);
  });

  test('--dry-run prints the plan without changing anything', () => {
    const home = path.join(work, 'home');
    fs.mkdirSync(home);
    const r = runInstaller({
      HOME: home,
      ADM_BUNDLE: fixture.bundle,
      ADM_BUNDLE_SHA256: fixture.hash,
      ADM_DRY_RUN: '1', // the flag the test name promises
      SHELL: '', // SHELL unset → the rc default is ~/.profile
    });
    // dry-run with a local bundle still verifies the checksum (read-only),
    // then prints the plan and exits 0.
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PLAN]');
    expect(r.stdout).toContain('Dry run complete');
    expect(r.stdout).toContain('.local/bin');
    expect(fs.existsSync(path.join(home, '.adm'))).toBe(false);
  });

  test('real install → launcher written, rc has one marker', () => {
    const home = path.join(work, 'home');
    fs.mkdirSync(home);
    const r = runInstaller({
      HOME: home,
      ADM_BUNDLE: fixture.bundle,
      ADM_BUNDLE_SHA256: fixture.hash,
      SHELL: '', // SHELL unset → the rc default is ~/.profile (CI runners set bash!)
    });
    expect(r.status).toBe(0);
    // unpacked to ~/.adm/{app,runtime}
    expect(fs.existsSync(path.join(home, '.adm', 'app', 'bin', 'adm'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.adm', 'runtime', 'bin', 'node'))).toBe(true);
    // launcher in ~/.local/bin
    const launcher = path.join(home, '.local', 'bin', 'adm');
    expect(fs.existsSync(launcher)).toBe(true);
    const launcherBody = fs.readFileSync(launcher, 'utf8');
    expect(launcherBody).toContain(`${path.join(home, '.adm')}/runtime/bin/node`);
    // one PATH entry in the rc (SHELL unset → .profile)
    const rc = fs.readFileSync(path.join(home, '.profile'), 'utf8');
    expect(rc).toContain('# adm-cli');
    expect(rc).toContain('export PATH="$HOME/.local/bin:$PATH"');
  });

  test('AC: double install → zero duplicates (idempotent rc)', () => {
    const home = path.join(work, 'home');
    fs.mkdirSync(home);
    const env = { HOME: home, ADM_BUNDLE: fixture.bundle, ADM_BUNDLE_SHA256: fixture.hash, SHELL: '' };
    expect(runInstaller(env).status).toBe(0);
    const r2 = runInstaller(env);
    expect(r2.status).toBe(0);
    const rc = fs.readFileSync(path.join(home, '.profile'), 'utf8');
    const markers = rc.split('\n').filter(l => l.includes('# adm-cli')).length;
    const entries = rc.split('\n').filter(l => l.includes('.local/bin')).length;
    expect(markers).toBe(1);
    expect(entries).toBe(1);
  });

  test('AC: tamper fixture (wrong sha256) → aborts, writes NOTHING', () => {
    const home = path.join(work, 'home');
    fs.mkdirSync(home);
    const r = runInstaller({
      HOME: home,
      ADM_BUNDLE: fixture.bundle,
      ADM_BUNDLE_SHA256: '0'.repeat(64), // wrong hash
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('checksum mismatch');
    expect(r.stderr).toContain('Nothing was written');
    // nothing touched: no ~/.adm, no launcher, no rc
    expect(fs.existsSync(path.join(home, '.adm'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.local'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.profile'))).toBe(false);
  });

  test('missing bundle → clean error', () => {
    const home = path.join(work, 'home');
    fs.mkdirSync(home);
    const r = runInstaller({ HOME: home, ADM_BUNDLE: path.join(work, 'nope.tar.gz') });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('ADM_BUNDLE not found');
  });
});
