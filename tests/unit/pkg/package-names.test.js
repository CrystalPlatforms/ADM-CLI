const { loadCatalog } = require('../../../src/setup/catalog');
const { resolvePackageName, PACKAGE_NAMES } = require('../../../src/pkg/package-names');
const { SUPPORTED_MANAGERS } = require('../../../src/pkg/managers');

const catalog = loadCatalog();
const allTools = catalog.flatMap(c => c.tools);

describe('package-name mapping — completeness (threshold: 0)', () => {
  test('every catalog tool resolves for every supported manager', () => {
    const gaps = [];
    for (const tool of allTools) {
      for (const manager of SUPPORTED_MANAGERS) {
        const resolved = resolvePackageName(tool.id, manager);
        if (!resolved || (resolved.name === undefined && resolved.manual === undefined)) {
          gaps.push(`${tool.id} × ${manager}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  test('every brew-method tool has a resolved name or explicit manual per manager', () => {
    const brewTools = allTools.filter(t => t.installMethod === 'brew');
    expect(brewTools.length).toBeGreaterThan(50); // sanity: the table is exercised
    const gaps = [];
    for (const tool of brewTools) {
      for (const manager of SUPPORTED_MANAGERS) {
        const r = resolvePackageName(tool.id, manager);
        if (!r.name && !r.manual) gaps.push(`${tool.id} × ${manager}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  test('manual entries always carry a reason', () => {
    for (const [id, perManager] of Object.entries(PACKAGE_NAMES)) {
      for (const [manager, value] of Object.entries(perManager)) {
        if (value && typeof value === 'object') {
          expect({ id, manager, reason: value.manual }).toEqual(
            expect.objectContaining({ reason: expect.any(String) }),
          );
        }
      }
    }
  });
});

describe('resolvePackageName — known renames', () => {
  test('docker maps to distro-specific package names', () => {
    expect(resolvePackageName('docker', 'apt')).toEqual({ name: 'docker.io' });
    expect(resolvePackageName('docker', 'dnf')).toEqual({ name: 'moby-engine' });
    expect(resolvePackageName('docker', 'pacman')).toEqual({ name: 'docker' });
  });

  test('identity default: package name equals tool id', () => {
    expect(resolvePackageName('jq', 'zypper')).toEqual({ name: 'jq' });
    expect(resolvePackageName('some-unknown-tool', 'apk')).toEqual({ name: 'some-unknown-tool' });
  });

  test('explicit manual wins with a readable reason', () => {
    const r = resolvePackageName('ollama', 'apt');
    expect(r.manual).toContain('ollama.com/install.sh');
    expect(resolvePackageName('jdk', 'pacman')).toEqual({ name: 'jdk-openjdk' });
    expect(resolvePackageName('python3', 'pacman')).toEqual({ name: 'python' });
  });
});
