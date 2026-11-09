const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendInstalled, readRegistry, registryFile } = require('../../../src/setup/registry');

// AC (#30): a real install appends { id, name, method, installedAt } to
// ~/.adm/installed.json — no duplicate ids (replaced, timestamp updated).
describe('registry (installed.json)', () => {
  let configDir;
  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-reg-'));
  });

  test('append creates the file with the frozen entry shape', () => {
    appendInstalled({ id: 'typescript', name: 'TypeScript', method: 'npm' }, { configDir });
    const items = readRegistry({ configDir });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'typescript', name: 'TypeScript', method: 'npm' });
    expect(new Date(items[0].installedAt).toISOString()).toBe(items[0].installedAt);
  });

  test('same id → replaced, not duplicated', () => {
    appendInstalled({ id: 'fzf', name: 'fzf', method: 'go' }, { configDir, now: '2026-01-01T00:00:00.000Z' });
    appendInstalled({ id: 'fzf', name: 'fzf', method: 'go' }, { configDir, now: '2026-06-01T00:00:00.000Z' });
    const items = readRegistry({ configDir });
    expect(items).toHaveLength(1);
    expect(items[0].installedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  test('missing file reads as empty array', () => {
    expect(readRegistry({ configDir })).toEqual([]);
  });

  test('corrupt file reads as empty array (install never breaks on it)', () => {
    fs.writeFileSync(registryFile({ configDir }), 'not json at all', 'utf8');
    expect(readRegistry({ configDir })).toEqual([]);
  });

  test('default location honors ADM_CONFIG_DIR', () => {
    const old = process.env.ADM_CONFIG_DIR;
    process.env.ADM_CONFIG_DIR = configDir;
    try {
      expect(registryFile()).toBe(path.join(configDir, 'installed.json'));
    } finally {
      if (old === undefined) delete process.env.ADM_CONFIG_DIR; else process.env.ADM_CONFIG_DIR = old;
    }
  });
});
