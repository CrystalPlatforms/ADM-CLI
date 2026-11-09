const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { COMMANDS } = require('../../src/commands');

const BIN = path.join(__dirname, '..', '..', 'bin', 'adm');
const NODE = process.execPath;

function runAdm(args, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-e2e-'));
  const started = Date.now();
  const result = spawnSync(NODE, [BIN, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: path.join(__dirname, '..', '..'),
    stdin: opts.stdin === 'pipe' ? 'pipe' : 'ignore',
    input: opts.input,
    env: { ...process.env, ADM_CONFIG_DIR: tmp, ...(opts.env || {}) },
  });
  return { ...result, durationMs: Date.now() - started };
}

describe('adm -v', () => {
  test('prints the version and exits 0', () => {
    const r = runAdm(['-v']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('adm help — anti-drift', () => {
  test('Commands section prints exactly the COMMANDS table entries', () => {
    const r = runAdm(['help']);
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n');
    const start = lines.indexOf('Commands:');
    const end = lines.findIndex((l, i) => i > start && l.trim() === '');
    const commandLines = lines.slice(start + 1, end);
    expect(commandLines.length).toBe(COMMANDS.length);
    COMMANDS.forEach((cmd, i) => {
      const flags = cmd.flags ? ` [${cmd.flags.join('|')}]` : '';
      expect(commandLines[i]).toContain(cmd.name + flags);
      expect(commandLines[i]).toContain(cmd.summary);
    });
  });
});

describe('adm unknown-cmd', () => {
  test('enumerates the valid set, suggests closest match, exits 1', () => {
    const r = runAdm(['uninstal']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown command: uninstal');
    expect(r.stderr).toContain('Did you mean: uninstall?');
    for (const cmd of COMMANDS) {
      expect(r.stderr).toContain(cmd.name);
    }
  });
});

describe('adm without TTY (stdin closed)', () => {
  test('exits 1 within 2s with a message about automation modes', () => {
    const r = runAdm([], { stdin: 'pipe' });
    expect(r.status).toBe(1);
    expect(r.durationMs).toBeLessThan(2000);
    expect(r.stderr).toContain('ADM_TOOLS');
    expect(r.stderr).toContain('terminal');
  });
});

describe('adm config', () => {
  test('text view shows config and paths, exits 0', () => {
    const r = runAdm(['config']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Config dir');
    expect(r.stdout).toContain('Config file');
    expect(r.stdout).toContain('Environment');
    expect(r.stdout).toContain('OS:');
  });

  test('--json emits parseable JSON with a frozen key set', () => {
    const r = runAdm(['config', '--json']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout); // throws on mixed stdout
    const expectedKeys = [
      'version', 'configDir', 'configFile', 'os', 'distro', 'distroVersion',
      'manager', 'arch', 'isWSL', 'shell', 'rcFile',
    ].sort();
    expect(Object.keys(parsed).sort()).toEqual(expectedKeys);
    expect(['darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'sunos', 'aix', 'android']).toContain(parsed.os);
    expect(['x64', 'arm64', 'arm', 'ia32', 'mips', 'ppc', 's390', 'riscv64', 'loong64']).toContain(parsed.arch);
    expect(typeof parsed.isWSL).toBe('boolean');
  });
});

describe('adm dotfiles sync', () => {
  test('--help prints usage and does not crash', () => {
    const r = runAdm(['dotfiles', 'sync', '--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: adm dotfiles sync');
  });

  test('without a repo URL exits 1 with usage guidance', () => {
    const r = runAdm(['dotfiles', 'sync']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--repo');
  });
});

describe('install planning (ADM_TOOLS)', () => {
  test('ADM_DRY_RUN=1 ADM_TOOLS=typescript,node prints a plan, exits 0', () => {
    const r = runAdm([], {
      env: { ADM_DRY_RUN: '1', ADM_TOOLS: 'typescript,node' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('dry run');
    expect(r.stdout).toContain('typescript');
    expect(r.stdout).toContain('npm install -g typescript@latest');
    expect(r.stdout).toContain('node');
  });

  test('unknown ADM_TOOLS id exits 1 with closest matches and the valid id set', () => {
    const r = runAdm([], { env: { ADM_TOOLS: 'nonesuch' } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown tool id in ADM_TOOLS: nonesuch');
    expect(r.stderr).toContain('Valid tool ids:');
    expect(r.stderr).toContain('typescript'); // valid set is enumerated
  });
});

describe('adm uninstall — idempotency through the full CLI', () => {
  test('first run removes, second run says "already removed"; legacy cleanup must not resurrect the dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-e2e-un-'));
    const configDir = path.join(tmp, '.adm');
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'config.json'), '{}');

    const run = () => spawnSync(NODE, [BIN, 'uninstall'], {
      encoding: 'utf8', timeout: 15000,
      cwd: path.join(__dirname, '..', '..'),
      stdin: 'ignore',
      env: { ...process.env, ADM_CONFIG_DIR: configDir },
    });

    const r1 = run();
    expect(r1.status).toBe(0);
    expect(r1.stdout).toContain(`Removed ${configDir}`);
    expect(fs.existsSync(configDir)).toBe(false);

    const r2 = run();
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain('already removed');
    expect(fs.existsSync(configDir)).toBe(false);
  });
});
