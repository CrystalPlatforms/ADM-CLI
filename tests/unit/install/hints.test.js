const { hintFor, NPM_PREFIX_FIX } = require('../../../src/install/hints');

// AC (#29): EACCES failure → hint with a ready-to-copy command.
describe('hint catalog', () => {
  test('EACCES on npm install → copyable prefix-repair command', () => {
    const hint = hintFor('npm ERR! Error: EACCES: permission denied, access /usr/lib/node_modules', {
      method: 'npm', command: 'npm install -g typescript@latest', rcFile: '.bashrc', platform: 'linux',
    });
    expect(hint).toContain(NPM_PREFIX_FIX);
    expect(hint).toContain('mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global');
    expect(hint).toContain('.bashrc');
  });

  test("EACCES on sudo'd manager install → tells to run it manually", () => {
    const hint = hintFor('sudo: a password is required', {
      method: 'apt', command: 'sudo apt-get install -y jq', platform: 'linux',
    });
    expect(hint).toContain('sudo apt-get install -y jq');
    expect(hint.toLowerCase()).toContain('manually');
  });

  test('generic EACCES → suggests the elevated command', () => {
    const hint = hintFor('EACCES: permission denied', {
      command: 'brew install jq', platform: 'darwin',
    });
    expect(hint).toContain('sudo brew install jq');
  });

  test('brew not found → Homebrew install command', () => {
    const hint = hintFor('sh: brew: command not found', {
      command: 'brew install jq', platform: 'linux',
    });
    expect(hint).toContain('Homebrew');
    expect(hint).toContain('raw.githubusercontent.com/Homebrew/install');
  });

  test('pip missing → python3 -m pip fallback command', () => {
    const hint = hintFor('sh: pip: command not found', {
      method: 'pip', command: 'pip install --upgrade black', platform: 'linux',
    });
    expect(hint).toContain('python3 -m pip install --upgrade black');
  });

  test('npm missing → points at ADM_TOOLS=node', () => {
    const hint = hintFor('sh: npm: command not found', {
      method: 'npm', command: 'npm install -g typescript@latest', platform: 'linux',
    });
    expect(hint).toContain('ADM_TOOLS=node');
  });

  test('package missing from manager repos → search hint with the exact CLI', () => {
    const hint = hintFor('No package found matching input criteria.', {
      method: 'winget', manager: 'winget', command: 'winget install --id tmux --exact', platform: 'win32',
    });
    expect(hint).toContain('not in the winget repositories');
    expect(hint).toContain('winget search <term>');
    expect(hint).toContain('winget install --id tmux --exact');
  });

  test('apt "Unable to locate package" gets the same treatment', () => {
    const hint = hintFor("E: Unable to locate package tmux", {
      method: 'apt', manager: 'apt', command: 'sudo apt-get install -y tmux', platform: 'linux',
    });
    expect(hint).toContain('apt-cache search <term>');
  });

  test('generic failure → run the command manually (always non-empty)', () => {
    const hint = hintFor('some weird failure', { command: 'cargo install delta', platform: 'linux' });
    expect(hint.length).toBeGreaterThan(0);
    expect(hint).toContain('cargo install delta');
  });

  test('never returns an empty hint, even with no error text', () => {
    const hint = hintFor('', { command: 'x' });
    expect(hint.length).toBeGreaterThan(0);
  });
});
