const fs = require('fs');
const os = require('os');
const path = require('path');
const { runWizard } = require('../../../src/setup/wizard');

// Wizard consent flows (#43 Homebrew question + #44 ecosystem engine).
// All I/O stubbed: checkbox/confirm/spinner/execFunc injected, the one-shot
// availability probe injected (deterministic on any dev machine).

const HOMEBREW_INSTALL = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

const DARWIN_NO_BREW = { os: 'darwin', distro: null, distroVersion: null, manager: 'none', arch: 'arm64', isWSL: false, shell: 'zsh', rcFile: '.zshrc' };
const DARWIN_BREW = { os: 'darwin', distro: null, distroVersion: null, manager: 'brew', arch: 'arm64', isWSL: false, shell: 'zsh', rcFile: '.zshrc' };

function fakeCheckbox(answers) {
  const prompts = [];
  return Object.assign(async opts => {
    prompts.push(opts);
    return answers[opts.name] || [];
  }, { prompts });
}
const fakePrompt = () => Object.assign(async qs => {
  const out = {};
  for (const q of qs) out[q.name] = q.default;
  return out;
}, { questions: [] });
const fakeSpinner = () => ({ start() {}, succeed() {}, fail() {}, info() {}, stop() {} });
const makeCfg = () => fs.mkdtempSync(path.join(os.tmpdir(), 'adm-consent-'));

// Fake installer: `installed` grows as installs succeed, so status probes
// reflect the state mid-run. Anything not matching a probe is a success.
function fakeExec({ installed = [] } = {}) {
  const state = { installed };
  const calls = [];
  const execFunc = (command, opts, cb) => {
    calls.push(command);
    const probe = command.match(/(?:command -v|where) (\S+)/);
    if (probe) {
      return state.installed.includes(probe[1])
        ? cb(null, '/usr/bin/x', '')
        : cb({ code: 1 }, '', '');
    }
    if (/brew --version/.test(command)) {
      return state.installed.includes('brew') ? cb(null, 'Homebrew 4.x', '') : cb({ code: 1 }, '', '');
    }
    if (/nvm which current/.test(command)) {
      return cb(null, '/home/dev/.nvm/versions/node/v20/bin/node\n', '');
    }
    if (/npm config get prefix/.test(command)) {
      return cb(null, '/home/dev/.npm-global\n', '');
    }
    // install commands succeed and add their binary to the fake state
    if (/brew install (\S+)/.test(command)) state.installed.push(RegExp.$1);
    if (/nvm-sh\/nvm\/.*install\.sh/.test(command)) state.installed.push('node', 'npm');
    if (/npm install -g (\S+)/.test(command)) state.installed.push(RegExp.$1);
    cb(null, 'ok', '');
  };
  return Object.assign(execFunc, { calls, state });
}

function runConsentWizard({ categories, tools, answers, probe, env, execFunc, configDir, log }) {
  const confirms = [];
  return runWizard({
    log: log || (s => {}),
    prompt: fakePrompt(),
    checkbox: fakeCheckbox({ categories, tools }),
    confirm: async opts => { confirms.push(opts.message); return answers.confirm; },
    spinnerFactory: fakeSpinner,
    execFunc,
    configDir,
    env,
    probeManagers: probe,
  }).then(code => ({ code, confirms }));
}

describe('wizard — macOS without brew (#43)', () => {
  test('ONE Homebrew question BEFORE any install; consent → Homebrew first, then brew', async () => {
    const log = [];
    const exec = fakeExec();
    const { code, confirms } = await runConsentWizard({
      categories: ['universal'],
      tools: ['git'],
      answers: { confirm: true },
      probe: () => ({ brew: false, npm: false }),
      env: DARWIN_NO_BREW,
      execFunc: exec,
      configDir: makeCfg(),
      log: s => log.push(s),
    });
    expect(code).toBe(0);
    // exactly ONE question, asked BEFORE anything ran
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain('Install Homebrew first?');
    const installCalls = exec.calls.filter(c => !/^command -v|^where /.test(c) && !/^brew --version/.test(c));
    expect(installCalls.length).toBeGreaterThan(0);
    expect(installCalls[0]).toContain('Homebrew/install/HEAD/install.sh');
    expect(installCalls.some(c => /^brew install git$/.test(c))).toBe(true);
    // report: both installed, Homebrew listed first
    const text = log.join('\n');
    const hbIdx = text.indexOf('Homebrew — installed');
    const gitIdx = text.indexOf('Git — installed');
    expect(hbIdx).toBeGreaterThan(-1);
    expect(gitIdx).toBeGreaterThan(-1);
    expect(hbIdx).toBeLessThan(gitIdx);
  });

  test('declined → the system tool is ✗ failed with the official installer as hint', async () => {
    const log = [];
    const exec = fakeExec();
    const { code, confirms } = await runConsentWizard({
      categories: ['universal'],
      tools: ['git'],
      answers: { confirm: false },
      probe: () => ({ brew: false, npm: false }),
      env: DARWIN_NO_BREW,
      execFunc: exec,
      configDir: makeCfg(),
      log: s => log.push(s),
    });
    expect(code).toBe(0);
    expect(confirms).toHaveLength(1);
    const text = log.join('\n');
    expect(text).toContain('✗ Git — failed');
    expect(text).toContain('declined');
    expect(text).toContain(HOMEBREW_INSTALL);
    // nothing was installed behind the user's back
    const installCalls = exec.calls.filter(c => /install/.test(c));
    expect(installCalls).toHaveLength(0);
  });
});

describe('wizard — ecosystem consent (#44)', () => {
  const NPM_MISSING = () => ({ brew: true, npm: false });

  test('unchecked pick + consent → ONE question, Node installs BEFORE yarn', async () => {
    const log = [];
    const exec = fakeExec();
    const { code, confirms } = await runConsentWizard({
      categories: ['js-ts'],
      tools: ['yarn'],
      answers: { confirm: true },
      probe: NPM_MISSING,
      env: DARWIN_BREW,
      execFunc: exec,
      configDir: makeCfg(),
      log: s => log.push(s),
    });
    expect(code).toBe(0);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain('Yarn requires npm (Node.js)');
    const nvmIdx = exec.calls.findIndex(c => /nvm-sh\/nvm\/.*install\.sh/.test(c));
    const yarnIdx = exec.calls.findIndex(c => /npm install -g yarn@latest/.test(c));
    expect(nvmIdx).toBeGreaterThan(-1);
    expect(yarnIdx).toBeGreaterThan(nvmIdx);
    const text = log.join('\n');
    expect(text).toContain('Node.js — installed');
    expect(text).toContain('Yarn — installed');
  });

  test('declined → yarn ✗ with reason + hint, nothing installs', async () => {
    const log = [];
    const exec = fakeExec();
    const { confirms } = await runConsentWizard({
      categories: ['js-ts'],
      tools: ['yarn'],
      answers: { confirm: false },
      probe: NPM_MISSING,
      env: DARWIN_BREW,
      execFunc: exec,
      configDir: makeCfg(),
      log: s => log.push(s),
    });
    expect(confirms).toHaveLength(1);
    const text = log.join('\n');
    expect(text).toContain('✗ Yarn — failed');
    expect(text).toContain('declined');
    expect(text).toContain('run: ADM_TOOLS=node adm');
    expect(exec.calls.some(c => /install/.test(c))).toBe(false);
  });

  test('second tool on the same manager: NO second question (typescript + yarn)', async () => {
    const exec = fakeExec();
    const { confirms } = await runConsentWizard({
      categories: ['js-ts'],
      tools: ['yarn', 'typescript'],
      answers: { confirm: true },
      probe: NPM_MISSING,
      env: DARWIN_BREW,
      execFunc: exec,
      configDir: makeCfg(),
    });
    expect(confirms).toHaveLength(1);
    // provider injected ONCE — a single nvm install serves both tools
    expect(exec.calls.filter(c => /nvm-sh\/nvm\/.*install\.sh/.test(c))).toHaveLength(1);
  });

  test('provider picked in the wizard = consent up-front: zero questions, Node before yarn', async () => {
    const log = [];
    const exec = fakeExec();
    const { confirms } = await runConsentWizard({
      categories: ['js-ts'],
      tools: ['yarn', 'node'],
      answers: { confirm: false }, // would fail the test if asked
      probe: NPM_MISSING,
      env: DARWIN_BREW,
      execFunc: exec,
      configDir: makeCfg(),
      log: s => log.push(s),
    });
    expect(confirms).toHaveLength(0);
    const nvmIdx = exec.calls.findIndex(c => /nvm-sh\/nvm\/.*install\.sh/.test(c));
    const yarnIdx = exec.calls.findIndex(c => /npm install -g yarn@latest/.test(c));
    expect(yarnIdx).toBeGreaterThan(nvmIdx);
    const text = log.join('\n');
    expect(text).toContain('Node.js — installed');
    expect(text).toContain('Yarn — installed');
  });

  test('consents are per-run: nothing about them lands in the config dir', async () => {
    const configDir = makeCfg();
    const exec = fakeExec();
    await runConsentWizard({
      categories: ['js-ts'],
      tools: ['yarn'],
      answers: { confirm: true },
      probe: NPM_MISSING,
      env: DARWIN_BREW,
      execFunc: exec,
      configDir,
    });
    const files = [];
    const walk = dir => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(configDir);
    const everything = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    expect(everything).not.toMatch(/consent|approved|declined|asked/i);
    // the registry holds only real installs, in the plain shape
    const registry = JSON.parse(fs.readFileSync(path.join(configDir, 'installed.json'), 'utf8'));
    expect(registry).toEqual([
      expect.objectContaining({ id: 'node', method: 'nvm' }),
      expect.objectContaining({ id: 'yarn', method: 'npm' }),
    ]);
  });
});
