const { detectEnvironment, normalizeArch } = require('../../../src/platform');

const OS_RELEASE = {
  ubuntu: 'ID=ubuntu\nVERSION_ID="22.04"\nID_LIKE=debian\n',
  fedora: 'ID=fedora\nVERSION_ID=39\n',
  arch: 'ID=arch\n',
  'opensuse-leap': 'ID="opensuse-leap"\nVERSION_ID="15.5"\nID_LIKE="suse opensuse"\n',
  alpine: 'ID=alpine\nVERSION_ID=3.19.1\n',
  mint: 'ID=linuxmint\nVERSION_ID=21\nID_LIKE="debian ubuntu"\n',
};

function fakeReadFile(osReleaseContent) {
  return file => {
    if (file === '/etc/os-release') return osReleaseContent;
    if (file === '/proc/version') return 'Linux version 5.15.0-generic';
    throw Object.assign(new Error('not found'), { code: 'ENOENT' });
  };
}

function detectLinux(osReleaseKey, extra = {}) {
  return detectEnvironment({
    platform: 'linux',
    arch: 'x64',
    env: {},
    osRelease: OS_RELEASE[osReleaseKey],
    readFile: fakeReadFile(OS_RELEASE[osReleaseKey]),
    readParentName: () => null,
    readPpid: () => null,
    ppid: 1,
    ...extra,
  });
}

describe('detectEnvironment — distro → package manager (fixtures)', () => {
  test.each([
    ['ubuntu', 'ubuntu', '22.04', 'apt'],
    ['fedora', 'fedora', '39', 'dnf'],
    ['arch', 'arch', null, 'pacman'],
    ['opensuse-leap', 'opensuse-leap', '15.5', 'zypper'],
    ['alpine', 'alpine', '3.19.1', 'apk'],
  ])('%s → %s (%s)', (fixture, distro, version, manager) => {
    const env = detectLinux(fixture);
    expect(env.distro).toBe(distro);
    expect(env.distroVersion).toBe(version);
    expect(env.manager).toBe(manager);
    expect(env.os).toBe('linux');
  });

  test('unknown distro falls back to ID_LIKE (linuxmint → apt via debian/ubuntu)', () => {
    const env = detectLinux('mint');
    expect(env.manager).toBe('apt');
  });

  test('totally unknown distro → manager "none"', () => {
    const env = detectEnvironment({
      platform: 'linux', arch: 'x64', env: {},
      osRelease: 'ID=weirddistro\n',
      readFile: fakeReadFile(''), readParentName: () => null, readPpid: () => null, ppid: 1,
    });
    expect(env.manager).toBe('none');
  });
});

describe('detectEnvironment — WSL', () => {
  test('WSL_DISTRO_NAME env → isWSL true, stays linux', () => {
    const env = detectLinux('ubuntu', { env: { WSL_DISTRO_NAME: 'Ubuntu' } });
    expect(env.isWSL).toBe(true);
    expect(env.os).toBe('linux');
  });

  test('WSL_INTEROP env → isWSL true', () => {
    const env = detectLinux('ubuntu', { env: { WSL_INTEROP: '/run/WSL/1_interop' } });
    expect(env.isWSL).toBe(true);
  });

  test('microsoft in /proc/version → isWSL true', () => {
    const env = detectEnvironment({
      platform: 'linux', arch: 'x64', env: {},
      osRelease: OS_RELEASE.ubuntu,
      readFile: file => file === '/etc/os-release' ? OS_RELEASE.ubuntu : 'Linux version 5.15.153-microsoft-standard-WSL2',
      readParentName: () => null, readPpid: () => null, ppid: 1,
    });
    expect(env.isWSL).toBe(true);
  });

  test('plain linux → isWSL false', () => {
    expect(detectLinux('ubuntu').isWSL).toBe(false);
  });

  test('WSL markers are ignored off linux', () => {
    const env = detectEnvironment({
      platform: 'darwin', arch: 'arm64', env: { WSL_DISTRO_NAME: 'Ubuntu' },
      readFile: () => { throw Object.assign(new Error(), { code: 'ENOENT' }); },
      readParentName: () => null, readPpid: () => null, ppid: 1,
    });
    expect(env.isWSL).toBe(false);
  });
});

describe('detectEnvironment — non-linux platforms', () => {
  test('darwin → manager brew, no distro', () => {
    const env = detectEnvironment({
      platform: 'darwin', arch: 'arm64', env: {},
      readFile: () => { throw new Error('x'); },
      readParentName: () => null, readPpid: () => null, ppid: 1,
    });
    expect(env.os).toBe('darwin');
    expect(env.distro).toBeNull();
    expect(env.manager).toBe('brew');
  });

  test('win32 → manager winget', () => {
    const env = detectEnvironment({
      platform: 'win32', arch: 'x64', env: { MSYSTEM: 'MINGW64' },
      readFile: () => { throw new Error('x'); },
    });
    expect(env.manager).toBe('winget');
    expect(env.shell).toBe('bash'); // git-bash on windows
    expect(env.rcFile).toBe('.bashrc');
  });
});

describe('detectEnvironment — architecture', () => {
  test.each([
    ['x64', 'x64'],
    ['arm64', 'arm64'],
    ['ia32', 'x64'],
  ])('process.arch %s → %s', (input, expected) => {
    const env = detectEnvironment({
      platform: 'linux', arch: input, env: {},
      osRelease: OS_RELEASE.alpine,
      readFile: fakeReadFile(''), readParentName: () => null, readPpid: () => null, ppid: 1,
    });
    expect(env.arch).toBe(expected);
  });

  test('normalizeArch unit', () => {
    expect(normalizeArch('x64')).toBe('x64');
    expect(normalizeArch('arm64')).toBe('arm64');
    expect(normalizeArch('ia32')).toBe('x64');
  });
});
