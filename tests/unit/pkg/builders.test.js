const { buildToolPlan, withFallbackRoute, pipCommand, ALL_METHODS } = require('../../../src/pkg/builders');
const { SUPPORTED_MANAGERS } = require('../../../src/pkg/managers');

const ENVS = {
  linux: { os: 'linux', distro: 'ubuntu', distroVersion: '22.04', manager: 'apt', arch: 'x64', isWSL: false, shell: 'bash', rcFile: '.bashrc' },
  darwin: { os: 'darwin', distro: null, distroVersion: null, manager: 'brew', arch: 'arm64', isWSL: false, shell: 'zsh', rcFile: '.zshrc' },
  win: { os: 'win32', distro: null, distroVersion: null, manager: 'winget', arch: 'x64', isWSL: false, shell: 'powershell', rcFile: null },
  fedora: { os: 'linux', distro: 'fedora', distroVersion: '39', manager: 'dnf', arch: 'x64', isWSL: false, shell: 'bash', rcFile: '.bashrc' },
  arch: { os: 'linux', distro: 'arch', distroVersion: null, manager: 'pacman', arch: 'x64', isWSL: false, shell: 'bash', rcFile: '.bashrc' },
  opensuse: { os: 'linux', distro: 'opensuse-leap', distroVersion: '15.5', manager: 'zypper', arch: 'x64', isWSL: false, shell: 'bash', rcFile: '.bashrc' },
  alpine: { os: 'linux', distro: 'alpine', distroVersion: '3.19', manager: 'apk', arch: 'x64', isWSL: false, shell: 'bash', rcFile: '.bashrc' },
  choco: { os: 'win32', distro: null, distroVersion: null, manager: 'choco', arch: 'x64', isWSL: false, shell: 'powershell', rcFile: null },
  scoop: { os: 'win32', distro: null, distroVersion: null, manager: 'scoop', arch: 'x64', isWSL: false, shell: 'powershell', rcFile: null },
};

describe('builder matrix — every method generates the expected command', () => {
  test.each([
    ['npm', { id: 'typescript', installMethod: 'npm' }, 'linux', 'npm install -g typescript@latest'],
    ['node', { id: 'npm', installMethod: 'node' }, 'linux', 'npm install -g npm@latest'],
    ['nvm', { id: 'node', installMethod: 'nvm' }, 'linux', 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | sh'],
    ['cargo', { id: 'ripgrep', installMethod: 'cargo' }, 'linux', 'cargo install ripgrep'],
    ['go', { id: 'lazygit', installMethod: 'go' }, 'linux', 'go install github.com/jesseduffield/lazygit@latest'],
    ['gem', { id: 'rubocop', installMethod: 'gem' }, 'linux', 'gem install rubocop'],
    ['composer', { id: 'phpstan', installMethod: 'composer' }, 'linux', 'composer global require phpstan'],
    ['dotnet', { id: 'dotnet-ef', installMethod: 'dotnet' }, 'linux', 'dotnet tool install -g dotnet-ef'],
    ['rustup', { id: 'clippy', installMethod: 'rustup' }, 'linux', 'rustup component add clippy'],
    ['brew', { id: 'jq', installMethod: 'brew' }, 'darwin', 'brew install jq'],
    ['apt', { id: 'docker', installMethod: 'brew' }, 'linux', 'sudo apt-get install -y docker.io'],
    ['dnf', { id: 'imagemagick', installMethod: 'brew' }, 'fedora', 'sudo dnf install -y ImageMagick'],
    ['pacman', { id: 'python3', installMethod: 'brew' }, 'arch', 'sudo pacman -S --noconfirm python'],
    ['zypper', { id: 'jq', installMethod: 'brew' }, 'opensuse', 'sudo zypper install -y jq'],
    ['apk', { id: 'git', installMethod: 'brew' }, 'alpine', 'sudo apk add git'],
    ['winget', { id: 'dotnet', installMethod: 'brew' }, 'win', 'winget install --id Microsoft.DotNet.SDK.8 --exact --accept-source-agreements --accept-package-agreements'],
    ['choco', { id: 'dotnet', installMethod: 'brew' }, 'choco', 'choco install dotnet-sdk --yes'],
    ['scoop', { id: 'dotnet', installMethod: 'brew' }, 'scoop', 'scoop install dotnet-sdk'],
  ])('method %s on %s → %s', (method, tool, envKey, expected) => {
    const plan = buildToolPlan(tool, ENVS[envKey]);
    expect(plan.status).toBe('planned');
    expect(plan.command).toBe(expected);
  });

  test('link method produces a link status, not a command', () => {
    const plan = buildToolPlan({ id: 'copilot-ext', installMethod: 'link' }, ENVS.linux);
    expect(plan.status).toBe('link');
    expect(plan.url).toBeTruthy();
  });

  test('ALL_METHODS covers every install method used in the catalog plus managers', () => {
    const { loadCatalog } = require('../../../src/setup/catalog');
    const catalogMethods = loadCatalog().flatMap(c => c.tools.map(t => t.installMethod));
    for (const m of catalogMethods) {
      expect(ALL_METHODS).toContain(m);
    }
    for (const m of SUPPORTED_MANAGERS) {
      expect(ALL_METHODS).toContain(m);
    }
  });
});

describe('pip fallback', () => {
  test('no pip → python3 -m pip', () => {
    expect(pipCommand('poetry', {})).toBe('python3 -m pip install --upgrade poetry');
  });

  test('pip3 available → pip3', () => {
    expect(pipCommand('poetry', { pip3: true })).toBe('pip3 install --upgrade poetry');
  });

  test('pip available → pip', () => {
    expect(pipCommand('poetry', { pip: true })).toBe('pip install --upgrade poetry');
  });

  test('buildToolPlan defaults to python3 -m pip (safe without probing)', () => {
    const plan = buildToolPlan({ id: 'poetry', installMethod: 'pip' }, ENVS.linux);
    expect(plan.command).toBe('python3 -m pip install --upgrade poetry');
  });

  test('Windows fallback is python -m pip — python3.exe is a Store alias stub', () => {
    expect(pipCommand('aider-chat', {}, 'win32')).toBe('python -m pip install --upgrade aider-chat');
    // explicit availability still wins
    expect(pipCommand('aider-chat', { pip: true }, 'win32')).toBe('pip install --upgrade aider-chat');
    const plan = buildToolPlan({ id: 'aider-chat', installMethod: 'pip' }, ENVS.win);
    expect(plan.command).toBe('python -m pip install --upgrade aider-chat');
  });
});

describe('manual and missing-manager handling', () => {
  test('tool absent from the detected manager → manual with reason', () => {
    const plan = buildToolPlan({ id: 'k9s', installMethod: 'brew' }, ENVS.linux);
    expect(plan.status).toBe('manual');
    expect(plan.reason).toContain('k9s/releases');
  });

  test('no package manager at all → manual', () => {
    const noManager = { ...ENVS.linux, manager: 'none' };
    const plan = buildToolPlan({ id: 'jq', installMethod: 'brew' }, noManager);
    expect(plan.status).toBe('manual');
    expect(plan.reason).toContain('no supported package manager');
    expect(plan.managerMissing).toBe(true);
  });

  test('darwin without brew → manual flagged requiresManager: brew (#43)', () => {
    const noBrew = { ...ENVS.darwin, manager: 'none' };
    const plan = buildToolPlan({ id: 'jq', installMethod: 'brew' }, noBrew);
    expect(plan.status).toBe('manual');
    expect(plan.requiresManager).toBe('brew');
    expect(plan.reason).toContain('Homebrew');
  });

  test('planned entries carry a status source', () => {
    const plan = buildToolPlan({ id: 'vitest', installMethod: 'npm' }, ENVS.linux);
    expect(plan.statusSource).toBe('command -v vitest');
  });

  test('scoped npm tools check the unscoped binary name', () => {
    const plan = buildToolPlan({ id: '@anthropic-ai/claude-code', installMethod: 'npm' }, ENVS.linux);
    expect(plan.statusSource).toBe('command -v claude');
  });

  test('typescript probes tsc — the binary npm actually creates (HITL fix)', () => {
    const plan = buildToolPlan({ id: 'typescript', installMethod: 'npm' }, ENVS.linux);
    expect(plan.statusSource).toBe('command -v tsc');
  });

  test('cargo renames: delta → git-delta crate, status checks delta', () => {
    const plan = buildToolPlan({ id: 'delta', installMethod: 'cargo' }, ENVS.linux);
    expect(plan.command).toBe('cargo install git-delta');
    expect(plan.statusSource).toBe('command -v delta');
  });
});

describe('nvm method — Windows route (HITL fix, 0.3.0)', () => {
  test('win32 + winget → Node.js LTS via winget (no `sh` pipe)', () => {
    const plan = buildToolPlan({ id: 'node', installMethod: 'nvm' }, ENVS.win);
    expect(plan.status).toBe('planned');
    expect(plan.command).toContain('winget install --id OpenJS.NodeJS.LTS');
    expect(plan.statusSource).toBe('command -v node');
  });

  test('win32 + choco/scoop → nodejs-lts', () => {
    expect(buildToolPlan({ id: 'node', installMethod: 'nvm' }, ENVS.choco).command).toContain('nodejs-lts');
    expect(buildToolPlan({ id: 'node', installMethod: 'nvm' }, ENVS.scoop).command).toContain('nodejs-lts');
  });

  test('win32 without a supported manager → manual with nodejs.org guidance', () => {
    const plan = buildToolPlan({ id: 'node', installMethod: 'nvm' }, { ...ENVS.win, manager: 'none' });
    expect(plan.status).toBe('manual');
    expect(plan.reason).toContain('https://nodejs.org');
  });

  test('POSIX keeps the nvm install script', () => {
    const plan = buildToolPlan({ id: 'node', installMethod: 'nvm' }, ENVS.linux);
    expect(plan.command).toContain('nvm-sh/nvm');
  });
});

describe('withFallbackRoute — retry route for manual tools (#34)', () => {
  test('manual + script installer known for the platform → planned script route', () => {
    const entry = withFallbackRoute(
      { id: 'helm', status: 'manual', reason: 'no package manager detected' },
      ENVS.linux,
    );
    expect(entry.status).toBe('planned');
    expect(entry.retryFallback).toBe(true);
    expect(entry.method).toBe('script');
    expect(entry.command).toContain('get-helm-3');
  });

  test('manual + no script installer anywhere → stays manual (failed + hint)', () => {
    const entry = withFallbackRoute(
      { id: 'dry-rb', status: 'manual', reason: 'dry-rb is a family of gems' },
      ENVS.linux,
    );
    expect(entry.status).toBe('manual');
    expect(entry.retryFallback).toBeUndefined();
    expect(entry.reason).toBe('dry-rb is a family of gems');
  });

  test('script manual for the os-arch pair (no script for win32) → stays manual', () => {
    const entry = withFallbackRoute(
      { id: 'helm', status: 'manual', reason: 'on Windows install helm via winget' },
      ENVS.win,
    );
    expect(entry.status).toBe('manual');
  });

  test('planned entries pass through untouched', () => {
    const entry = { id: 'typescript', status: 'planned', command: 'npm install -g typescript@latest' };
    expect(withFallbackRoute(entry, ENVS.linux)).toBe(entry);
  });
});
