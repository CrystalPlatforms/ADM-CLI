const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// #31: Homebrew formula template generation — the repo ships a formula file
// pointing at the portable Release bundles.
const GEN = path.join(__dirname, '..', '..', '..', 'scripts', 'homebrew', 'gen-formula.js');
const { version } = require('../../../package.json');

describe('gen-formula', () => {
  test('generates the formula with real sha256 values from dist/', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-dist-'));
    const out = path.join(dist, 'adm.rb');
    fs.writeFileSync(path.join(dist, `adm-v${version}-darwin-arm64.tar.gz.sha256`), 'a'.repeat(64) + `  adm-v${version}-darwin-arm64.tar.gz\n`, 'utf8');
    fs.writeFileSync(path.join(dist, `adm-v${version}-darwin-x64.tar.gz.sha256`), 'b'.repeat(64) + `  adm-v${version}-darwin-x64.tar.gz\n`, 'utf8');

    const r = spawnSync(process.execPath, [GEN, '--dist', dist, '--out', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);

    const formula = fs.readFileSync(out, 'utf8');
    expect(formula).toContain(`version "${version}"`);
    // release URLs interpolate the version in Ruby: v#{version}
    expect(formula).toContain('adm-v#{version}-darwin-arm64.tar.gz');
    expect(formula).toContain('adm-v#{version}-darwin-x64.tar.gz');
    expect(formula).toContain('a'.repeat(64));
    expect(formula).toContain('b'.repeat(64));
    expect(formula).not.toContain('PENDING');
    // runs adm under the bundled private Node (no depends_on "node")
    expect(formula).toContain('runtime/bin/node');
    expect(formula).not.toContain('depends_on "node"');
  });

  test('without sha256 files → PENDING placeholders (formula template still valid)', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-dist2-'));
    const out = path.join(dist, 'adm.rb');
    const r = spawnSync(process.execPath, [GEN, '--dist', dist, '--out', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const formula = fs.readFileSync(out, 'utf8');
    expect(formula).toContain('PENDING_UPLOAD');
    // and the committed template exists in the repo (AC: observable file)
    const committed = path.join(__dirname, '..', '..', '..', 'scripts', 'homebrew', 'adm.rb');
    expect(fs.existsSync(committed)).toBe(true);
    expect(fs.readFileSync(committed, 'utf8')).toContain('class Adm < Formula');
  });
});

describe('build-bundle CLI guard', () => {
  const BUILD = path.join(__dirname, '..', '..', '..', 'scripts', 'build-bundle.js');

  test('missing --target → usage error, exit 1 (no network touched)', () => {
    const r = spawnSync(process.execPath, [BUILD], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--target');
    expect(r.stderr).toContain('win32-x64');
  });

  test('unknown target → usage error', () => {
    const r = spawnSync(process.execPath, [BUILD, '--target', 'sunos-sparc'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
  });
});
