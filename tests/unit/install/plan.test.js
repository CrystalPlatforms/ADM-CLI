const { runPlan } = require('../../../src/install/plan');
const { loadCatalog } = require('../../../src/setup/catalog');

// Dry-run plan ACs (#43 + #44): the plan is computed against an INJECTED
// one-shot availability probe, so the runs are deterministic on any machine.
const HOMEBREW_URL = 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh';

function planOutput(toolsSpec, { probe, platform = 'darwin', envPath } = {}) {
  const out = [];
  const code = runPlan(toolsSpec, {
    log: s => out.push(s),
    err: () => {},
    platform,
    env: envPath,
    probeManagers: probe || (() => ({ brew: true, npm: true })),
  });
  return { code, text: out.join('\n') };
}

describe('runPlan — one-shot manager probe (#43)', () => {
  test('probe availability executes ONCE per run, never per tool', () => {
    let calls = 0;
    const probe = () => { calls += 1; return { brew: true, npm: true }; };
    planOutput('git,jq,ripgrep', { probe });
    expect(calls).toBe(1);
  });

  test('detection drives the plan: scoop-only Windows plans through scoop', () => {
    const { text } = planOutput('git', {
      platform: 'win32',
      probe: () => ({ winget: false, choco: false, scoop: true, npm: true }),
    });
    expect(text).toContain('git (universal) — planned');
    expect(text).toContain('scoop install git');
  });

  test('no manager at all → "none" in the environment line', () => {
    const { text } = planOutput('typescript', { probe: () => ({ npm: false }) });
    expect(text).toContain('Packages:  none');
  });
});

describe('runPlan — Homebrew in the catalog (#43)', () => {
  test('universal category carries the homebrew tool', () => {
    const universal = loadCatalog().find(c => c.id === 'universal');
    const homebrew = universal.tools.find(t => t.id === 'homebrew');
    expect(homebrew).toMatchObject({ id: 'homebrew', name: 'Homebrew', installMethod: 'script' });
  });

  test('ADM_TOOLS=homebrew dry-run shows the OFFICIAL script URL, installs nothing', () => {
    const { code, text } = planOutput('homebrew', { probe: () => ({ brew: false, npm: false }) });
    expect(code).toBe(0);
    expect(text).toContain('homebrew (universal) — planned');
    expect(text).toContain(HOMEBREW_URL);
    expect(text).toContain('brew --version');
    expect(text).toContain('dry run, nothing was installed');
  });
});

describe('runPlan — macOS without brew (#43)', () => {
  test('system tools get the "requires Homebrew" block with the official installer', () => {
    const { text } = planOutput('git,jq', { probe: () => ({ brew: false, npm: false }) });
    expect(text).toContain('Homebrew is not installed');
    expect(text).toContain('ADM_TOOLS=homebrew adm');
    expect(text).toContain(HOMEBREW_URL);
    expect(text).toContain('git (universal) — manual');
    expect(text).toContain('why:      requires Homebrew, which is not installed');
  });

  test('ecosystem tools are NOT blocked by the missing brew', () => {
    const { text } = planOutput('typescript', { probe: () => ({ brew: false, npm: true }) });
    expect(text).toContain('typescript (js-ts) — planned');
    expect(text).not.toContain('requires Homebrew');
  });
});

describe('runPlan — distro without a recognized manager (#43)', () => {
  test('ONE clean notice at the top, manual entries below, no traceback', () => {
    const { code, text } = planOutput('git,typescript', {
      platform: 'linux',
      envPath: { PATH: '' },
      probe: () => ({ apt: false, dnf: false, pacman: false, zypper: false, apk: false, npm: true }),
    });
    expect(code).toBe(0);
    expect(text).toContain('No supported package manager was detected');
    expect(text).toContain('apt, dnf, pacman, zypper, apk (Linux)');
    expect(text).toContain('git (universal) — manual');
    // ecosystem tool is unaffected
    expect(text).toContain('typescript (js-ts) — planned');
    // exactly ONE notice block, not one per tool
    expect(text.match(/No supported package manager was detected/g)).toHaveLength(1);
  });
});

describe('runPlan — ecosystem consent in non-interactive mode (#44)', () => {
  test('tracer: ADM_TOOLS="git,yarn" without npm → git planned, yarn ✗ with reason + hint', () => {
    const { code, text } = planOutput('git,yarn', { probe: () => ({ brew: true, npm: false }) });
    expect(code).toBe(0);
    expect(text).toContain('git (universal) — planned');
    expect(text).toContain('brew install git');
    expect(text).toMatch(/yarn \(js-ts\) — ✗ requires npm \(Node\.js\), which is not installed/);
    expect(text).toContain('hint:     run: ADM_TOOLS=node adm');
    // the plan total reflects the block
    expect(text).toContain('(+1 blocked)');
  });

  test('listing the provider consents the run: node,yarn → both planned', () => {
    const { text } = planOutput('node,yarn', { probe: () => ({ brew: true, npm: false }) });
    expect(text).toContain('node (js-ts) — planned');
    expect(text).toContain('yarn (js-ts) — planned');
    expect(text).not.toContain('blocked');
  });

  test('no npm → every npm-dependent tool blocked with its own reason', () => {
    const { text } = planOutput('yarn,typescript,snyk', { probe: () => ({ brew: true, npm: false }) });
    expect(text.match(/requires npm \(Node\.js\), which is not installed/g)).toHaveLength(3);
  });

  test('pip tools keep working without npm (per-manager blocking)', () => {
    const { text } = planOutput('poetry', { probe: () => ({ brew: true, npm: false, pip: true }) });
    expect(text).toContain('poetry (python) — planned');
    expect(text).not.toContain('blocked');
  });
});

describe('runPlan — plan ordering (#44)', () => {
  test('manager install precedes dependents: node before yarn/typescript', () => {
    const { text } = planOutput('yarn,node,typescript', { probe: () => ({ brew: true, npm: true }) });
    const nodeIdx = text.indexOf('node (js-ts) — planned');
    const yarnIdx = text.indexOf('yarn (js-ts) — planned');
    const tsIdx = text.indexOf('typescript (js-ts) — planned');
    expect(nodeIdx).toBeGreaterThan(-1);
    expect(nodeIdx).toBeLessThan(yarnIdx);
    expect(nodeIdx).toBeLessThan(tsIdx);
  });

  test('listed provider (node) stays first even when picked after its dependents', () => {
    const { text } = planOutput('yarn,typescript,node', { probe: () => ({ brew: true, npm: false }) });
    const nodeIdx = text.indexOf('node (js-ts) — planned');
    const yarnIdx = text.indexOf('yarn (js-ts) — planned');
    expect(nodeIdx).toBeGreaterThan(-1);
    expect(nodeIdx).toBeLessThan(yarnIdx);
  });
});
