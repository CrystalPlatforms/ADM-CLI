const {
  managerCandidates,
  selectManager,
  probeManagers,
  ECOSYSTEM_BINS,
} = require('../../../src/platform/manager-probe');
const { binaryAvailable } = require('../../../src/pkg/managers');
const { detectEnvironment } = require('../../../src/platform');

// #43 AC: "macierz dostępności (mock PATH) — brew/winget/choco/scoop/apt/
// dnf/pacman/zypper/apk obecny/brak → poprawna kolejność natywności i wybór
// per platforma".

// Fake fs for the PATH walk: exactly the given absolute paths "exist".
function fakeFs(existing) {
  const set = new Set(existing);
  return {
    statSync: p => { if (!set.has(String(p))) throw new Error('ENOENT'); },
    accessSync: () => {},
  };
}

// Builds a PATH-style env where each listed manager's binary exists.
// Linux binaries: apt-get, dnf, pacman, zypper, apk; win uses .exe suffixes.
const BIN_NAMES = {
  brew: 'brew', apt: 'apt-get', dnf: 'dnf', pacman: 'pacman',
  zypper: 'zypper', apk: 'apk', winget: 'winget', choco: 'choco', scoop: 'scoop',
};

function envWith(managers, { platform = 'linux' } = {}) {
  const sep = platform === 'win32' ? ';' : ':';
  const exts = platform === 'win32' ? ['', '.exe'] : [''];
  const dirs = [];
  const existing = [];
  managers.forEach((m, i) => {
    const dir = `/opt/bin${i}`;
    dirs.push(dir);
    for (const ext of exts) existing.push(`${dir}/${BIN_NAMES[m]}${ext}`);
  });
  return { env: { PATH: dirs.join(sep) }, ...fakeFs(existing) };
}

describe('managerCandidates — native priority per platform (#43)', () => {
  test('macOS: brew only', () => {
    expect(managerCandidates('darwin')).toEqual(['brew']);
  });

  test('Windows: winget → choco → scoop', () => {
    expect(managerCandidates('win32')).toEqual(['winget', 'choco', 'scoop']);
  });

  test('Linux without a distro match: apt → dnf → pacman → zypper → apk', () => {
    expect(managerCandidates('linux')).toEqual(['apt', 'dnf', 'pacman', 'zypper', 'apk']);
  });

  test('Linux: the distro manager (from os-release) leads, the rest keep the fixed order', () => {
    expect(managerCandidates('linux', 'apk')).toEqual(['apk', 'apt', 'dnf', 'pacman', 'zypper']);
    expect(managerCandidates('linux', 'dnf')).toEqual(['dnf', 'apt', 'pacman', 'zypper', 'apk']);
  });

  test('unknown platform → no candidates', () => {
    expect(managerCandidates('sunos')).toEqual([]);
  });
});

describe('selectManager — availability matrix (pure)', () => {
  test('macOS: brew present → brew; brew missing → none', () => {
    expect(selectManager({ platform: 'darwin', distroManager: 'brew', availability: { brew: true } })).toBe('brew');
    expect(selectManager({ platform: 'darwin', distroManager: 'brew', availability: { brew: false } })).toBe('none');
  });

  test('Windows: first available in winget → choco → scoop order wins', () => {
    expect(selectManager({ platform: 'win32', distroManager: 'winget', availability: { winget: true, choco: true } })).toBe('winget');
    expect(selectManager({ platform: 'win32', distroManager: 'winget', availability: { winget: false, choco: true, scoop: true } })).toBe('choco');
    expect(selectManager({ platform: 'win32', distroManager: 'winget', availability: { winget: false, choco: false, scoop: true } })).toBe('scoop');
    expect(selectManager({ platform: 'win32', distroManager: 'winget', availability: {} })).toBe('none');
  });

  test('Linux: the distro manager wins when available; otherwise the fixed native order applies', () => {
    expect(selectManager({ platform: 'linux', distroManager: 'apt', availability: { apt: true, dnf: true } })).toBe('apt');
    // ubuntu without apt but with dnf → dnf (next in native order)
    expect(selectManager({ platform: 'linux', distroManager: 'apt', availability: { apt: false, dnf: true } })).toBe('dnf');
    // alpine: apk first
    expect(selectManager({ platform: 'linux', distroManager: 'apk', availability: { apt: true, apk: true } })).toBe('apk');
    // pacman only
    expect(selectManager({ platform: 'linux', distroManager: 'apt', availability: { pacman: true } })).toBe('pacman');
    // nothing available → none
    expect(selectManager({ platform: 'linux', distroManager: 'zypper', availability: { apt: false } })).toBe('none');
  });
});

describe('probeManagers — mocked PATH walk (real availability check)', () => {
  test('a manager whose binary is on the mock PATH is available', () => {
    const probe = envWith(['apt', 'dnf']);
    const availability = probeManagers({ platform: 'linux', ...probe });
    expect(availability.apt).toBe(true);
    expect(availability.dnf).toBe(true);
    expect(availability.pacman).toBe(false);
    expect(availability.zypper).toBe(false);
    expect(availability.apk).toBe(false);
  });

  test('empty PATH → nothing available', () => {
    const availability = probeManagers({
      platform: 'linux',
      env: { PATH: '' },
    });
    expect(availability).toEqual({ apt: false, dnf: false, pacman: false, zypper: false, apk: false, npm: false, pip: false, cargo: false, go: false, gem: false, composer: false, dotnet: false });
  });

  test('macOS with brew on the mock PATH; Windows with scoop.exe', () => {
    const mac = envWith(['brew'], { platform: 'darwin' });
    expect(probeManagers({ platform: 'darwin', ...mac })).toEqual({ brew: true, npm: false, pip: false, cargo: false, go: false, gem: false, composer: false, dotnet: false });

    const win = envWith(['scoop'], { platform: 'win32' });
    const winAvail = probeManagers({ platform: 'win32', ...win });
    expect(winAvail.winget).toBe(false);
    expect(winAvail.choco).toBe(false);
    expect(winAvail.scoop).toBe(true);
  });

  test('ecosystem bins ride in the same one-shot snapshot (#44)', () => {
    const existing = ['/opt/bin/npm', '/opt/bin/pip3', '/opt/bin/cargo', '/opt/bin/go', '/opt/bin/gem', '/opt/bin/composer', '/opt/bin/dotnet'];
    const availability = probeManagers({
      platform: 'linux',
      env: { PATH: '/opt/bin' },
      ...fakeFs(existing),
    });
    expect(availability.npm).toBe(true);
    expect(availability.pip).toBe(true); // pip3 counts
    expect(availability.cargo).toBe(true);
    expect(availability.go).toBe(true);
    expect(availability.gem).toBe(true);
    expect(availability.composer).toBe(true);
    expect(availability.dotnet).toBe(true);
    expect(binaryAvailable('npm', { env: { PATH: '/opt/bin' }, ...fakeFs(existing) })).toBe(true);
    expect(ECOSYSTEM_BINS.pip).toContain('pip3');
  });

  test('ecosystems: false → system managers only', () => {
    const availability = probeManagers({ platform: 'darwin', env: { PATH: '' }, ecosystems: false });
    expect(availability).toEqual({ brew: false });
  });
});

describe('detectEnvironment + managerAvailability — real detection replaces assumptions', () => {
  test('macOS without brew → manager "none" (was: assumed brew)', () => {
    const env = detectEnvironment({ platform: 'darwin', env: {}, managerAvailability: { brew: false } });
    expect(env.manager).toBe('none');
  });

  test('Windows: scoop-only machine → manager "scoop" (was: assumed winget)', () => {
    const env = detectEnvironment({ platform: 'win32', env: {}, managerAvailability: { winget: false, choco: false, scoop: true } });
    expect(env.manager).toBe('scoop');
  });

  test('linux distro map stays when the probed manager is available', () => {
    const env = detectEnvironment({
      platform: 'linux', arch: 'x64', env: {},
      osRelease: 'ID=ubuntu\nVERSION_ID="22.04"\n',
      managerAvailability: { apt: true, dnf: false, pacman: false, zypper: false, apk: false, npm: false, pip: false, cargo: false, go: false, gem: false, composer: false, dotnet: false },
      readFile: () => { throw new Error('no'); },
      readParentName: () => null, readPpid: () => null, ppid: 1,
    });
    expect(env.manager).toBe('apt');
  });

  test('linux ubuntu without apt (but with apk) → apk; without anything → none', () => {
    const base = {
      platform: 'linux', arch: 'x64', env: {},
      osRelease: 'ID=ubuntu\nVERSION_ID="22.04"\n',
      readFile: () => { throw new Error('no'); },
      readParentName: () => null, readPpid: () => null, ppid: 1,
    };
    expect(detectEnvironment({ ...base, managerAvailability: { apt: false, dnf: false, pacman: false, zypper: false, apk: true } }).manager).toBe('apk');
    expect(detectEnvironment({ ...base, managerAvailability: { apt: false, dnf: false, pacman: false, zypper: false, apk: false } }).manager).toBe('none');
  });

  test('no availability map → legacy assumption intact (brew/winget)', () => {
    expect(detectEnvironment({ platform: 'darwin', env: {} }).manager).toBe('brew');
    expect(detectEnvironment({ platform: 'win32', env: {} }).manager).toBe('winget');
  });
});
