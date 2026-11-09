const fs = require('fs');
const os = require('os');
const path = require('path');
const { runUninstall } = require('../../../src/commands/uninstall');

function makeHomeFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-home-'));
  return { home, logs: [], errs: [] };
}

describe('runUninstall — idempotency contract', () => {
  test('first run removes ~/.adm, second run says already removed; both exit 0', async () => {
    const f = makeHomeFixture();
    const configDir = path.join(f.home, '.adm');
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'config.json'), '{}');

    const code1 = await runUninstall({
      configDir, home: f.home,
      log: s => f.logs.push(s), err: s => f.errs.push(s),
    });
    expect(code1).toBe(0);
    expect(fs.existsSync(configDir)).toBe(false);
    expect(f.logs.join('\n')).toContain(`Removed ${configDir}`);

    const code2 = await runUninstall({
      configDir, home: f.home,
      log: s => f.logs.push(s), err: s => f.errs.push(s),
    });
    expect(code2).toBe(0);
    expect(f.logs.join('\n')).toContain('already removed');
  });

  test('removes ADM PATH marker lines from rc files only', async () => {
    const f = makeHomeFixture();
    const bashrc = path.join(f.home, '.bashrc');
    fs.writeFileSync(bashrc, [
      'export EDITOR=vim',
      'export PATH="/x:$PATH"  # adm-cli npm path',
      'alias ll="ls -la"',
    ].join('\n'));

    const code = await runUninstall({
      configDir: path.join(f.home, '.adm'), home: f.home,
      log: s => f.logs.push(s), err: s => f.errs.push(s),
    });
    expect(code).toBe(0);

    const content = fs.readFileSync(bashrc, 'utf8');
    expect(content).toContain('export EDITOR=vim');
    expect(content).toContain('alias ll');
    expect(content).not.toContain('adm-cli');
    expect(f.logs.join('\n')).toContain('.bashrc');
  });

  test('rc files with no ADM lines are left untouched', async () => {
    const f = makeHomeFixture();
    const zshrc = path.join(f.home, '.zshrc');
    const original = 'export PATH="/usr/local/bin:$PATH"\n';
    fs.writeFileSync(zshrc, original);

    const code = await runUninstall({
      configDir: path.join(f.home, '.adm'), home: f.home,
      log: s => f.logs.push(s), err: s => f.errs.push(s),
    });
    expect(code).toBe(0);
    expect(fs.readFileSync(zshrc, 'utf8')).toBe(original);
  });
});
