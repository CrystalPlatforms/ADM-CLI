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

// execFunc: `command -v tsc` (the TypeScript binary — see NPM_BINS) finds it;
// everything else is missing. Installs succeed unless the tool is esbuild
// (simulated network failure).
function fakeExec() {
  const installed = ['tsc'];
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
  test('installed tools show ✓ and STAY selectable (pick = reinstall, #34)', () => {
    const tools = [
      { id: 'typescript', name: 'TypeScript', installMethod: 'npm' },
      { id: 'vitest', name: 'Vitest', installMethod: 'npm' },
    ];
    const statuses = new Map([
      ['typescript', { entry: { id: 'typescript', status: 'planned' }, installed: true }],
      ['vitest', { entry: { id: 'vitest', status: 'planned' }, installed: false }],
    ]);
    const choices = toolChoices(tools, statuses);
    // ✓ mark stays (it tells the user the tool is present), but nothing is
    // disabled anymore — picking it triggers a reinstall
    expect(choices[0].name).toBe('✓ TypeScript');
    expect(choices[0].disabled).toBeFalsy();
    expect(choices[0].checked).toBe(false);
    expect(choices[1].disabled).toBeFalsy();
    expect(choices[1].name).toBe('Vitest');
  });

  test('manual and link tools are selectable too — retry, not lock (#34)', () => {
    const tools = [
      { id: 'pyenv', name: 'pyenv', installMethod: 'brew' },
      { id: 'some-ext', name: 'Some Ext', installMethod: 'link' },
    ];
    const statuses = new Map([
      ['pyenv', { entry: { id: 'pyenv', status: 'manual', reason: 'not in repos' }, installed: false }],
      ['some-ext', { entry: { id: 'some-ext', status: 'link', url: 'https://x' }, installed: false }],
    ]);
    const choices = toolChoices(tools, statuses);
    // labels stay minimal (#34): no extra annotation text
    expect(choices[0].name).toBe('pyenv');
    expect(choices[0].disabled).toBeFalsy();
    expect(choices[1].name).toBe('Some Ext');
    expect(choices[1].disabled).toBeFalsy();
  });

  test('collectStatuses probes each tool via its statusSource', async () => {
    const entries = [
      { id: 'typescript', status: 'planned', statusSource: 'command -v tsc' },
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

  test('a tool already installed that the user still picks → REINSTALLED (#34)', async () => {
    const lines = [];
    const configDir = makeCfg();
    const checkbox = fakeCheckbox({ categories: ['js-ts'], tools: ['typescript'] });
    const prompt = fakePrompt({ proceed: false });
    const code = await runWizard({
      log: s => lines.push(s),
      prompt,
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: fakeExec(),
      configDir,
    });
    expect(code).toBe(0);
    const report = lines.join('\n');
    // the install command RAN (forced) and the report says `reinstalled`
    expect(report).toContain('✓ TypeScript — reinstalled');
    // the registry got the (refreshed) entry
    const registry = JSON.parse(fs.readFileSync(path.join(configDir, 'installed.json'), 'utf8'));
    expect(registry.find(e => e.id === 'typescript')).toBeTruthy();
    // a reinstall is not a fresh install → still no git identity question
    expect(prompt.questions.some(q => q.name === 'proceed')).toBe(false);
  });

  test('a manual pick with no fallback → manual guidance, NOT a failure (owner decision)', async () => {
    const lines = [];
    const checkbox = fakeCheckbox({ categories: ['ruby'], tools: ['dry-rb'] });
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
    // dry-rb has no manager route and no script route → `manual` status with
    // the guidance as the hint — an info line, not a ✗ failure
    expect(report).toContain('i dry-rb — manual');
    expect(report).toContain('dry-rb is a family of gems');
    expect(report).not.toContain('✗ dry-rb');
  });

  test('picking Node.js on Windows ASKS; declining → manual guidance, nothing executed', async () => {
    const lines = [];
    const commands = [];
    const exec = (command, opts, cb) => {
      commands.push(command);
      if (/^git config --global user\./.test(command)) return cb(null, '', '');
      const probe = command.match(/(?:command -v|where) (\w[\w.-]*)/);
      if (probe) return cb({ code: 1 }, '', '');
      cb(null, 'installed ok', '');
    };
    const checkbox = fakeCheckbox({ categories: ['js-ts'], tools: ['node'] });
    const prompt = fakePrompt({ proceed: false }); // nodeRuntime → default false
    const code = await runWizard({
      log: s => lines.push(s),
      prompt,
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: exec,
      configDir: makeCfg(),
      env: { os: 'win32', distro: null, distroVersion: null, manager: 'winget', arch: 'x64', isWSL: false, shell: 'powershell', rcFile: null },
    });
    expect(code).toBe(0);
    // the question was asked as a confirm
    const q = prompt.questions.find(x => x.name === 'nodeRuntime');
    expect(q.type).toBe('confirm');
    const report = lines.join('\n');
    expect(report).toContain('i Node.js — manual');
    expect(report).toContain('winget install --id OpenJS.NodeJS.LTS');
    // the dangerous install command never ran — no Restart Manager kill
    expect(commands.some(c => /winget install|nvm-sh\/nvm/.test(c))).toBe(false);
  });

  test('picking Node.js on Windows + confirming → the install really runs', async () => {
    const lines = [];
    const commands = [];
    const exec = (command, opts, cb) => {
      commands.push(command);
      if (/^git config --global user\./.test(command)) return cb(null, '', '');
      const probe = command.match(/(?:command -v|where) (\w[\w.-]*)/);
      if (probe) return cb({ code: 1 }, '', '');
      cb(null, 'installed ok', '');
    };
    const checkbox = fakeCheckbox({ categories: ['js-ts'], tools: ['node'] });
    const prompt = fakePrompt({ nodeRuntime: true });
    const code = await runWizard({
      log: s => lines.push(s),
      prompt,
      checkbox,
      spinnerFactory: fakeSpinner,
      execFunc: exec,
      configDir: makeCfg(),
      env: { os: 'win32', distro: null, distroVersion: null, manager: 'winget', arch: 'x64', isWSL: false, shell: 'powershell', rcFile: null },
    });
    expect(code).toBe(0);
    // confirmed → the winget install actually executed
    expect(commands.some(c => c.includes('winget install --id OpenJS.NodeJS.LTS'))).toBe(true);
    expect(lines.join('\n')).toContain('✓ Node.js — installed');
  });

  test('picking a link-only extension → manual guidance with the URL', async () => {
    const lines = [];
    const checkbox = fakeCheckbox({ categories: ['artificial-intelligence'], tools: ['copilot-ext'] });
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
    expect(report).toMatch(/i .+ — manual/);
    expect(report).toMatch(/install from: https?:\/\//);
    expect(report).not.toContain('— failed');
  });

  test('nothing picked → short message, no git nag', async () => {
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
    expect(text).toContain('Nothing selected');
    expect(prompt.questions.some(q => q.name === 'proceed')).toBe(false);
  });
});
