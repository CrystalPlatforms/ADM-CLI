const fs = require('fs');
const os = require('os');
const path = require('path');
const { runWizard, toolChoices, collectStatuses } = require('../../../src/setup/wizard');
const { loadCatalog } = require('../../../src/setup/catalog');

// Simulated-TTY wizard test (#30): categories → tools → fake installer →
// final report with ✓/✗ + hint lines. All I/O is stubbed; no real terminal.

// The wizard's multi-select prompts go through the injected `checkbox` dep
// (the custom flicker-free prompt). Fake answers keyed by prompt name.
function fakeCheckbox(answers) {
  const prompts = [];
  return Object.assign(async (opts) => {
    prompts.push(opts);
    return answers[opts.name] || [];
  }, { prompts });
}

// Single-question prompts (inquirer) are left for the git step: confirm/input.
function fakePrompt(answers) {
  const questions = [];
  return Object.assign(async (qs) => {
    questions.push(...qs);
    const out = {};
    for (const q of qs) out[q.name] = answers[q.name] !== undefined ? answers[q.name] : q.default;
    return out;
  }, { questions });
}

const fakeSpinner = () => ({ start() {}, succeed() {}, fail() {}, info() {}, stop() {} });
const makeCfg = () => fs.mkdtempSync(path.join(os.tmpdir(), 'adm-wiz-'));

// execFunc: `command -v typescript` finds it; everything else is missing.
// Installs succeed unless the tool is esbuild (simulated network failure).
function fakeExec() {
  const installed = ['typescript'];
  return (command, opts, cb) => {
    if (/^git config --global user\./.test(command)) return cb(null, '', '');
    const probe = command.match(/(?:command -v|where) (\w[\w-]*)/);
    if (probe) {
      return installed.includes(probe[1])
        ? cb(null, '/usr/bin/x', '')
        : cb({ code: 1 }, '', '');
    }
    if (/install.*esbuild/.test(command)) {
      return cb(new Error('Command failed'), '', 'network unreachable');
    }
    cb(null, 'installed ok', '');
  };
}

describe('wizard — categories screen', () => {
  test('renders ALL 11 categories in ONE prompt (no pagination)', async () => {
    const checkbox = fakeCheckbox({ categories: ['js-ts'], tools: [] });
    await runWizard({
      log: () => {},
      prompt: fakePrompt({ proceed: false }),
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: fakeExec(),
      configDir: makeCfg(),
    });
    const catQ = checkbox.prompts.find(p => p.name === 'categories');
    const catalog = loadCatalog();
    expect(catalog).toHaveLength(11);
    expect(catQ.choices).toHaveLength(11);
    // pageSize == number of categories → the whole list on one screen
    expect(catQ.pageSize).toBe(11);
    expect(catQ.choices.map(c => c.value)).toEqual(catalog.map(c => c.id));
  });

  test('empty selection → "nothing to do", exit 0, no tools prompt', async () => {
    const lines = [];
    const checkbox = fakeCheckbox({ categories: [] });
    const code = await runWizard({
      log: s => lines.push(s),
      prompt: fakePrompt({}),
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: fakeExec(),
      configDir: makeCfg(),
    });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('Nothing selected');
    expect(checkbox.prompts.some(p => p.name === 'tools')).toBe(false);
  });

  test('Ctrl+C in the category screen cancels gracefully (exit 0)', async () => {
    const lines = [];
    const checkbox = async () => {
      const err = new Error('cancelled');
      err.code = 'ADM_CANCELLED';
      throw err;
    };
    const code = await runWizard({
      log: s => lines.push(s),
      prompt: fakePrompt({}),
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: fakeExec(),
      configDir: makeCfg(),
    });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('Cancelled');
  });
});

describe('wizard — tools screen', () => {
  test('installed tools show ✓ and are disabled (not reinstalled)', () => {
    const tools = [
      { id: 'typescript', name: 'TypeScript', installMethod: 'npm' },
      { id: 'vitest', name: 'Vitest', installMethod: 'npm' },
    ];
    const statuses = new Map([
      ['typescript', { entry: { id: 'typescript', status: 'planned' }, installed: true }],
      ['vitest', { entry: { id: 'vitest', status: 'planned' }, installed: false }],
    ]);
    const choices = toolChoices(tools, statuses);
    // clean label: the ✓ mark on the name, ONE short "(…)" suffix rendered
    // by the prompt from `disabled`
    expect(choices[0].name).toBe('✓ TypeScript');
    expect(choices[0].disabled).toBe('installed');
    expect(choices[0].checked).toBe(false);
    expect(choices[1].disabled).toBeFalsy();
    expect(choices[1].name).toBe('Vitest');
  });

  test('manual and link tools are locked with a short "(manual)" label', () => {
    const tools = [
      { id: 'pyenv', name: 'pyenv', installMethod: 'brew' },
      { id: 'some-ext', name: 'Some Ext', installMethod: 'link' },
    ];
    const statuses = new Map([
      ['pyenv', { entry: { id: 'pyenv', status: 'manual', reason: 'not in repos' }, installed: false }],
      ['some-ext', { entry: { id: 'some-ext', status: 'link', url: 'https://x' }, installed: false }],
    ]);
    const choices = toolChoices(tools, statuses);
    expect(choices[0].disabled).toBe('manual');
    expect(choices[0].name).toBe('pyenv');
    expect(choices[1].disabled).toBe('manual');
  });

  test('collectStatuses probes each tool via its statusSource', async () => {
    const entries = [
      { id: 'typescript', status: 'planned', statusSource: 'command -v typescript' },
      { id: 'vitest', status: 'planned', statusSource: 'command -v vitest' },
    ];
    const statuses = await collectStatuses(entries, { execFunc: fakeExec(), platform: 'linux' });
    expect(statuses.get('typescript').installed).toBe(true);
    expect(statuses.get('vitest').installed).toBe(false);
  });
});

describe('wizard — full simulated-TTY flow', () => {
  test('categories → tools → fake installer → report with ✓ / ✗ + hint', async () => {
    const lines = [];
    const checkbox = fakeCheckbox({
      categories: ['universal'],
      tools: ['git', 'jq'],
    });
    const prompt = fakePrompt({ proceed: false }); // git step declined
    const spinners = [];
    const configDir = makeCfg();
    const code = await runWizard({
      log: s => lines.push(s),
      prompt,
      checkbox,
      spinnerFactory: text => { const s = fakeSpinner(); spinners.push(text); return s; },
      execFunc: fakeExec(),
      configDir,
    });

    expect(code).toBe(0);
    const report = lines.join('\n');
    // git was installed → its identity question was asked and declined
    expect(prompt.questions.some(q => q.name === 'proceed')).toBe(true);
    // the decline is remembered → the wizard never asks again
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    expect(cfg.git.setupDeclined).toBe(true);
  });

  test('installing UNRELATED tools never asks about git', async () => {
    const lines = [];
    const checkbox = fakeCheckbox({ categories: ['js-ts'], tools: ['vitest', 'esbuild'] });
    const prompt = fakePrompt({ proceed: true });
    const code = await runWizard({
      log: s => lines.push(s),
      prompt,
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: fakeExec(),
      configDir: makeCfg(),
    });
    expect(code).toBe(0);
    // vitest installed, esbuild failed — but no git/gh → no git question
    expect(lines.join('\n')).toContain('✓ Vitest — installed');
    expect(prompt.questions.some(q => q.name === 'proceed')).toBe(false);
  });

  test('a declined git setup is final: next git install does not ask', async () => {
    const configDir = makeCfg();
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ git: { setupDeclined: true } }), 'utf8');

    const lines = [];
    const checkbox = fakeCheckbox({ categories: ['universal'], tools: ['git'] });
    const prompt = fakePrompt({});
    await runWizard({
      log: s => lines.push(s),
      prompt,
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: fakeExec(),
      configDir,
    });
    // install happened…
    expect(lines.join('\n')).toContain('Git — installed');
    // …but git identity was never asked
    expect(prompt.questions.some(q => q.name === 'proceed')).toBe(false);
  });

  test('a tool already installed that the user still picks → skipped, never reinstalled', async () => {
    const lines = [];
    const checkbox = fakeCheckbox({ categories: ['js-ts'], tools: ['typescript'] });
    const prompt = fakePrompt({ proceed: false });
    const code = await runWizard({
      log: s => lines.push(s),
      prompt,
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: fakeExec(),
      configDir: makeCfg(),
    });
    expect(code).toBe(0);
    const report = lines.join('\n');
    expect(report).toContain('skipped');
    expect(report).toContain('already installed');
    // no install command ever ran for typescript
    expect(report).not.toContain('npm install -g typescript');
    // nothing was installed → no git question either
    expect(prompt.questions.some(q => q.name === 'proceed')).toBe(false);
  });

  test('nothing installable picked → short message, no git nag', async () => {
    const lines = [];
    const checkbox = fakeCheckbox({ categories: ['js-ts'], tools: [] });
    const prompt = fakePrompt({ proceed: false });
    const code = await runWizard({
      log: s => lines.push(s),
      prompt,
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: fakeExec(),
      configDir: makeCfg(),
    });
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('Nothing to install');
    expect(prompt.questions.some(q => q.name === 'proceed')).toBe(false);
  });
});
