const { execFileSync } = require('child_process');
const path = require('path');
const { nodeCheck, NODE_MAJOR_MIN } = require('../../src/engines');
const { getVersion } = require('../../src/commands/version');

// Friendly engines gate (#33, story 4): Node < 20 → enumerated repair
// instructions, exit 1. bin/adm calls nodeCheck(process.versions) BEFORE
// requiring the rest of src/, so old Node gets this message instead of an
// opaque SyntaxError. The < 20 path is simulated via the fake `versions`
// argument (the real runtime cannot be downgraded inside a test).

describe('nodeCheck — simulated Node < 20 (AC)', () => {
  test('Node 18 → not ok, friendly message enumerates every repair route', () => {
    const c = nodeCheck({ node: '18.17.0' });
    expect(c.ok).toBe(false);
    const msg = c.message;
    expect(msg).toContain('Node.js 20');
    expect(msg).toContain('v18.17.0');
    // enumerated fixes:
    expect(msg).toContain('https://nodejs.org');
    expect(msg).toContain('nvm install');
    expect(msg).toContain('fnm install');
    expect(msg).toContain('winget install OpenJS.NodeJS.LTS');
    // and the Node-free bundle escape hatch (the "no Node needed" story):
    expect(msg).toContain('installer.sh | sh');
    expect(msg).toContain('install.ps1 | iex');
  });

  test('Node 19 → not ok', () => {
    expect(nodeCheck({ node: '19.9.0' }).ok).toBe(false);
  });

  test('missing version info → treated as not ok', () => {
    expect(nodeCheck({}).ok).toBe(false);
    expect(nodeCheck(undefined).ok).toBe(false);
  });
});

describe('nodeCheck — Node ≥ 20 passes', () => {
  test('Node 20 → ok, empty message', () => {
    const c = nodeCheck({ node: '20.18.1' });
    expect(c.ok).toBe(true);
    expect(c.message).toBe('');
  });

  test('Node 22 → ok', () => {
    expect(nodeCheck({ node: '22.11.0' }).ok).toBe(true);
  });

  test('the required major matches the published engines range', () => {
    const engines = require('../../package.json').engines.node;
    expect(engines).toBe(`>=${NODE_MAJOR_MIN}.0.0`);
  });
});

describe('bin/adm — real entry point', () => {
  test('on the CI runtime (≥ 20) it starts and prints the version', () => {
    const out = execFileSync(process.execPath,
      [path.join(__dirname, '..', '..', 'bin', 'adm'), '-v'],
      { encoding: 'utf8' });
    expect(out.trim()).toBe(getVersion());
  });
});
