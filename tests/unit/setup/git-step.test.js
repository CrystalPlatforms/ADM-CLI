const fs = require('fs');
const os = require('os');
const path = require('path');
const { runGitStep, gitSetCommand } = require('../../../src/setup/git-step');

// AC (#30): the git step runs `git config --global user.name/user.email`
// (mocked exec) and stores the values in ~/.adm/config.json.
describe('wizard git step', () => {
  let configDir;
  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-git-'));
  });

  const mockExec = (existing = {}) => {
    const calls = [];
    const execFunc = (command, opts, cb) => {
      calls.push(command);
      const m = command.match(/^git config --global (user\.\w+)$/);
      if (m) {
        if (existing[m[1]] !== undefined) return cb(null, `${existing[m[1]]}\n`, '');
        return cb(new Error('not set'), '', '');
      }
      cb(null, '', '');
    };
    return { execFunc, calls };
  };

  const promptWith = (answers) => async (questions) => {
    const out = {};
    for (const q of questions) out[q.name] = answers[q.name];
    return out;
  };

  test('both values already set → "existing", no prompts, no writes', async () => {
    const { execFunc, calls } = mockExec({ 'user.name': 'Dev', 'user.email': 'dev@example.com' });
    const res = await runGitStep({
      execFunc,
      prompt: async () => { throw new Error('must not prompt'); },
      configDir,
    });
    expect(res.status).toBe('existing');
    expect(res.name).toBe('Dev');
    expect(res.email).toBe('dev@example.com');
    expect(calls.every(c => c.startsWith('git config --global user.'))).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'config.json'))).toBe(false);
  });

  test('empty git config → prompts, runs git config --global for both keys, stores in config.json', async () => {
    const { execFunc, calls } = mockExec({});
    const res = await runGitStep({
      execFunc,
      prompt: promptWith({ proceed: true, name: 'Nowy Dev', email: 'nowy@example.com' }),
      configDir,
    });
    expect(res.status).toBe('configured');
    expect(res.name).toBe('Nowy Dev');
    // AC: the exact commands ran (mocked exec)
    expect(calls).toContain(gitSetCommand('user.name', 'Nowy Dev'));
    expect(calls).toContain(gitSetCommand('user.email', 'nowy@example.com'));
    expect(calls.some(c => c.includes('git config --global user.name "Nowy Dev"'))).toBe(true);
    // AC: values stored in ~/.adm/config.json
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    expect(cfg.git).toEqual({ name: 'Nowy Dev', email: 'nowy@example.com' });
  });

  test('defaults come from the current partial git config', async () => {
    const { execFunc } = mockExec({ 'user.name': 'Stara Nazwa' });
    let asked;
    await runGitStep({
      execFunc,
      prompt: async (questions) => {
        asked = questions.map(q => ({ name: q.name, default: q.default }));
        return { proceed: true, name: 'Final', email: 'f@example.com' };
      },
      configDir,
    });
    const nameQ = asked.find(q => q.name === 'name');
    expect(nameQ.default).toBe('Stara Nazwa');
  });

  test('user declines → skipped AND remembered (never asked again)', async () => {
    const { execFunc } = mockExec({});
    const res = await runGitStep({
      execFunc,
      prompt: promptWith({ proceed: false }),
      configDir,
    });
    expect(res.status).toBe('skipped');
    // decline persisted in config.json
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    expect(cfg.git.setupDeclined).toBe(true);

    // a second run does not prompt at all
    let prompted = false;
    const res2 = await runGitStep({
      execFunc,
      prompt: async () => { prompted = true; return { proceed: true }; },
      configDir,
    });
    expect(res2.status).toBe('declined-before');
    expect(prompted).toBe(false);
  });

  test('decline preserves unrelated config.json keys', async () => {
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ other: { keep: true } }), 'utf8');
    const { execFunc } = mockExec({});
    await runGitStep({
      execFunc,
      prompt: promptWith({ proceed: false }),
      configDir,
    });
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    expect(cfg.other).toEqual({ keep: true });
    expect(cfg.git.setupDeclined).toBe(true);
  });

  test('gitSetCommand escapes double quotes', () => {
    expect(gitSetCommand('user.name', 'O"Neil')).toBe('git config --global user.name "O\\"Neil"');
  });
});
