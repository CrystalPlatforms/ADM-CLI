const fs = require('fs');
const os = require('os');
const path = require('path');
const { upsertRcEntry, cleanRcEntry, RC_ENTRIES } = require('../../../src/install/shell-paths');

// AC (#29): bash → .bashrc, zsh → .zshrc; double run = zero duplicates;
// old adm markers cleaned.
describe('shell-paths upsertRcEntry', () => {
  let home;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-rc-'));
  });

  const rcPath = (home, rc) => path.join(home, rc);
  const run = (opts) => upsertRcEntry({ home, entry: 'npm-global', ...opts });

  test('bash → .bashrc', () => {
    const res = run({ rcFile: '.bashrc' });
    expect(res.changed).toBe(true);
    const content = fs.readFileSync(rcPath(home, '.bashrc'), 'utf8');
    expect(content).toContain('# adm-cli npm path');
    expect(content).toContain('export PATH="$HOME/.npm-global/bin:$PATH"');
  });

  test('zsh → .zshrc', () => {
    const res = run({ rcFile: '.zshrc' });
    expect(res.changed).toBe(true);
    const content = fs.readFileSync(rcPath(home, '.zshrc'), 'utf8');
    expect(content).toContain('# adm-cli npm path');
    expect(content).toContain('export PATH="$HOME/.npm-global/bin:$PATH"');
  });

  test('double run = zero duplicates (idempotency)', () => {
    run({ rcFile: '.bashrc' });
    const second = run({ rcFile: '.bashrc' });
    expect(second.changed).toBe(false);
    const content = fs.readFileSync(rcPath(home, '.bashrc'), 'utf8');
    expect(content.split('# adm-cli npm path').length - 1).toBe(1);
    expect(content.split('export PATH="$HOME/.npm-global/bin:$PATH"').length - 1).toBe(1);
  });

  test('cleans old adm markers on the way', () => {
    fs.writeFileSync(rcPath(home, '.bashrc'), [
      '# old setup',
      '# adm-cli',
      'export PATH="$HOME/.local/bin:$PATH"',
      'export PATH="$HOME/keep-me:$PATH"',
      'adm completion --source somewhere',
      '# adm-cli npm path',
      'export PATH="$HOME/.npm-global/bin:$PATH"',
      '',
    ].join('\n'), 'utf8');
    run({ rcFile: '.bashrc' });
    const content = fs.readFileSync(rcPath(home, '.bashrc'), 'utf8');
    expect(content).not.toContain('adm completion');
    expect(content.split('# adm-cli').length - 1).toBe(1); // only the fresh marker
    expect(content).toContain('export PATH="$HOME/keep-me:$PATH"'); // user lines survive
    expect(content).toContain('# old setup'); // non-ADM lines are never touched
    // the stale launcher entry line was ADM-managed → cleaned with its marker
    expect(content).not.toContain('.local/bin');
  });

  test('launcher entry writes to the same rc with its own marker', () => {
    const res = upsertRcEntry({ home, rcFile: '.zshrc', entry: 'launcher' });
    expect(res.changed).toBe(true);
    const content = fs.readFileSync(rcPath(home, '.zshrc'), 'utf8');
    expect(content).toContain('export PATH="$HOME/.local/bin:$PATH"');
  });

  test('unknown shell (rcFile null) → no-op with reason', () => {
    const res = run({ rcFile: null });
    expect(res.changed).toBe(false);
    expect(res.reason).toBe('no-rc-file');
  });

  test('preserves unrelated rc content', () => {
    const original = ['# my setup', 'export EDITOR=vim', ''].join('\n');
    fs.writeFileSync(rcPath(home, '.bashrc'), original, 'utf8');
    run({ rcFile: '.bashrc' });
    const content = fs.readFileSync(rcPath(home, '.bashrc'), 'utf8');
    expect(content).toContain('export EDITOR=vim');
    expect(content).toContain('# my setup');
  });

  test('rc entry definitions carry marker + line', () => {
    expect(RC_ENTRIES['npm-global'].line).toContain('.npm-global/bin');
    expect(RC_ENTRIES.launcher.line).toContain('.local/bin');
  });
});

describe('shell-paths cleanRcEntry', () => {
  test('removes all adm marker lines', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-rc-clean-'));
    const p = path.join(home, '.bashrc');
    fs.writeFileSync(p, ['# adm-cli', 'export PATH="$HOME/.local/bin:$PATH"', 'echo hi'].join('\n'), 'utf8');
    const res = cleanRcEntry({ rcFile: p, home });
    expect(res.changed).toBe(true);
    const content = fs.readFileSync(p, 'utf8');
    expect(content).not.toContain('adm-cli');
    expect(content).toContain('echo hi');
    // marker line removed, its export line stays (surgical clean — uninstall
    // handles the paired line)
    expect(content).toContain('export PATH');
  });
});
