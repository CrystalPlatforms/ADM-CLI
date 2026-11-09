const { detectShell, rcFileFor, shellFromParentChain } = require('../../../src/platform/shell');

describe('shell detection — parent process chain', () => {
  test('bash parent → shell "bash", rc ".bashrc"', () => {
    const shell = detectShell({
      platform: 'linux',
      env: { SHELL: '/usr/bin/zsh' }, // ignored: chain wins
      readParentName: pid => (pid === 100 ? 'bash' : null),
      readPpid: () => null,
      ppid: 100,
    });
    expect(shell).toBe('bash');
    expect(rcFileFor(shell)).toBe('.bashrc');
  });

  test('zsh parent → shell "zsh", rc ".zshrc"', () => {
    const shell = detectShell({
      platform: 'linux',
      env: {},
      readParentName: pid => (pid === 200 ? 'zsh' : null),
      readPpid: () => null,
      ppid: 200,
    });
    expect(shell).toBe('zsh');
    expect(rcFileFor(shell)).toBe('.zshrc');
  });

  test('walks up the chain past non-shell wrappers', () => {
    // ppid 300 is "python3 script.py" wrapper, 301 its parent "zsh"
    const shell = detectShell({
      platform: 'linux',
      env: {},
      readParentName: pid => (pid === 300 ? 'python3' : pid === 301 ? 'zsh' : null),
      readPpid: pid => (pid === 300 ? 301 : null),
      ppid: 300,
    });
    expect(shell).toBe('zsh');
  });

  test('falls back to $SHELL when the chain yields nothing', () => {
    const shell = detectShell({
      platform: 'linux',
      env: { SHELL: '/bin/bash' },
      readParentName: () => null,
      readPpid: () => null,
      ppid: 1, // init — stops walking
    });
    expect(shell).toBe('bash');
  });

  test('unknown shell when nothing matches', () => {
    const shell = detectShell({
      platform: 'linux',
      env: {},
      readParentName: () => null,
      readPpid: () => null,
      ppid: 1,
    });
    expect(shell).toBe('unknown');
    expect(rcFileFor(shell)).toBeNull();
  });

  test('darwin uses ps-based parent name lookup', () => {
    const shell = detectShell({
      platform: 'darwin',
      env: {},
      readParentName: pid => (pid === 400 ? '/bin/zsh' : null),
      readPpid: null,
      ppid: 400,
    });
    expect(shell).toBe('zsh');
  });

  test('windows: MSYSTEM → bash (git-bash), PSModulePath → powershell', () => {
    expect(detectShell({ platform: 'win32', env: { MSYSTEM: 'MINGW64' } })).toBe('bash');
    expect(detectShell({ platform: 'win32', env: { PSModulePath: 'C:\\x' } })).toBe('powershell');
    expect(detectShell({ platform: 'win32', env: {} })).toBe('cmd');
  });
});

describe('shellFromParentChain — direct unit', () => {
  test('returns null after max depth without a shell', () => {
    expect(shellFromParentChain(1, () => 'python3', () => ({}).x, 3)).toBeNull();
  });
});

describe('rcFileFor', () => {
  test('maps shells to their rc files', () => {
    expect(rcFileFor('bash')).toBe('.bashrc');
    expect(rcFileFor('zsh')).toBe('.zshrc');
    expect(rcFileFor('sh')).toBe('.profile');
    expect(rcFileFor('fish')).toBe('.config/fish/config.fish');
    expect(rcFileFor('powershell')).toBeNull();
    expect(rcFileFor('nonexistent-shell')).toBeNull();
  });
});
