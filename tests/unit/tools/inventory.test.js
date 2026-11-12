// #36 Phase 1 (tracer): inventory merges 3 sources — registry (~/.adm/installed.json)
// + `npm ls -g --json` + catalog-driven PATH scan (v0.3 detection).
//
// Assumptions encoded by these tests (confirmed with the owner, 2026-11-12):
// - Merge key is the tool `id` (npm package name == catalog id). Binary-name
//   mapping (typescript→tsc etc.) is Phase 2+, NOT tested here.
// - Attribution priority: registry ('adm') > manager ('npm') > PATH-only
//   ('other' — the "poza menedżerem" group). A PATH-only tool never claims a
//   manager it can't prove.
// - A merged entry carries: version from npm, binPath from the PATH scan,
//   method/installedAt from the registry — later sources only fill blanks,
//   never override source attribution.
// - scanInventory returns ALL 8 groups in a fixed order, entries sorted by id
//   inside each group.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanInventory } = require('../../../src/tools/inventory');

describe('scanInventory', () => {
  test('merges registry + npm + PATH hit for the same tool into ONE entry attributed to the registry', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-path-'));
    fs.writeFileSync(path.join(binDir, 'typescript'), '#!/bin/sh\n');

    const res = await scanInventory({
      registry: [{ id: 'typescript', name: 'TypeScript', method: 'npm', installedAt: '2026-01-01T00:00:00.000Z' }],
      npmJson: JSON.stringify({ dependencies: { typescript: { version: '5.4.5' } } }),
      catalog: [{ id: 'typescript', name: 'TypeScript' }],
      env: { PATH: binDir },
      // no platform injection: tmpdir paths follow the host OS, so the PATH
      // walk must use the same platform it splits/joins paths for
    });

    const merged = res.entries.filter(e => e.id === 'typescript');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'typescript',
      name: 'TypeScript',
      version: '5.4.5',
      binPath: path.join(binDir, 'typescript'),
      source: 'adm',
      manager: 'npm',
      installedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(res.groups.find(g => g.id === 'adm').entries.map(e => e.id)).toEqual(['typescript']);
    expect(res.groups.find(g => g.id === 'npm').entries).toHaveLength(0);
  });

  test('npm + PATH hit for the same tool merge into ONE entry attributed to npm', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-path-'));
    fs.writeFileSync(path.join(binDir, 'eslint'), '#!/bin/sh\n');

    const res = await scanInventory({
      registry: [],
      npmJson: JSON.stringify({ dependencies: { eslint: { version: '9.0.0' } } }),
      catalog: [{ id: 'eslint', name: 'ESLint' }],
      env: { PATH: binDir },
    });

    const merged = res.entries.filter(e => e.id === 'eslint');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'eslint',
      name: 'ESLint',
      version: '9.0.0',
      binPath: path.join(binDir, 'eslint'),
      source: 'npm',
      manager: 'npm',
      installedAt: null,
    });
    expect(res.groups.find(g => g.id === 'npm').entries.map(e => e.id)).toEqual(['eslint']);
    expect(res.groups.find(g => g.id === 'other').entries).toHaveLength(0);
  });

  test('a tool found only by the PATH scan lands in "other" (no manager can be proven)', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-path-'));
    fs.writeFileSync(path.join(binDir, 'fzf'), '#!/bin/sh\n');

    const res = await scanInventory({
      registry: [],
      npmJson: JSON.stringify({ dependencies: {} }),
      catalog: [{ id: 'fzf', name: 'fzf' }],
      env: { PATH: binDir },
    });

    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({
      id: 'fzf',
      name: 'fzf',
      version: null,
      binPath: path.join(binDir, 'fzf'),
      source: 'other',
      manager: null,
      installedAt: null,
    });
    expect(res.groups.find(g => g.id === 'other').entries.map(e => e.id)).toEqual(['fzf']);
  });

  test('failing npm exec → empty npm group + warning, never a crash', async () => {
    const res = await scanInventory({
      registry: [],
      catalog: [],
      execFunc: (cmd, opts, cb) => cb(new Error('spawn npm ENOENT'), ''),
    });

    const npmGroup = res.groups.find(g => g.id === 'npm');
    expect(npmGroup.entries).toHaveLength(0);
    expect(npmGroup.warning).toBeTruthy();
  });

  test('successful npm exec (production wiring) feeds the npm group', async () => {
    const res = await scanInventory({
      registry: [],
      catalog: [],
      execFunc: (cmd, opts, cb) => cb(null, JSON.stringify({ dependencies: { nodemon: { version: '3.1.0' } } })),
    });

    expect(res.groups.find(g => g.id === 'npm').entries.map(e => e.id)).toEqual(['nodemon']);
    expect(res.entries.find(e => e.id === 'nodemon').version).toBe('3.1.0');
  });

  test('unparseable npm output → empty npm group + warning, other groups unaffected', async () => {
    const res = await scanInventory({
      registry: [],
      npmJson: 'not json at all',
      catalog: [],
    });

    const npmGroup = res.groups.find(g => g.id === 'npm');
    expect(npmGroup.entries).toHaveLength(0);
    expect(npmGroup.warning).toBeTruthy();
    expect(res.groups.find(g => g.id === 'adm').warning).toBeNull();
  });

  test('missing registry file → empty ADM group + warning, never a crash', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-empty-'));

    const res = await scanInventory({
      configDir: emptyDir,
      npmJson: JSON.stringify({ dependencies: {} }),
      catalog: [],
    });

    const admGroup = res.groups.find(g => g.id === 'adm');
    expect(admGroup.entries).toHaveLength(0);
    expect(admGroup.warning).toBeTruthy();
  });

  test('every result carries all 8 groups in the fixed display order', async () => {
    const res = await scanInventory({ registry: [], npmJson: '{}', catalog: [] });

    expect(res.groups.map(g => g.id)).toEqual([
      'adm', 'npm', 'brew', 'pip', 'cargo', 'go', 'system', 'other',
    ]);
    expect(res.groups.every(g => Array.isArray(g.entries) && (g.warning === null || typeof g.warning === 'string'))).toBe(true);
  });

  test('scan reports monotonic progress ending at done === total', async () => {
    const events = [];
    const res = await scanInventory({
      registry: [{ id: 'typescript', name: 'TypeScript', method: 'npm', installedAt: '2026-01-01T00:00:00.000Z' }],
      npmJson: JSON.stringify({ dependencies: { typescript: { version: '5.4.5' } } }),
      catalog: [{ id: 'fzf', name: 'fzf' }, { id: 'bat', name: 'bat' }],
      env: { PATH: '' },
      onProgress: (done, total) => events.push([done, total]),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1][0]).toBe(events[events.length - 1][1]);
    const dones = events.map(e => e[0]);
    expect(dones).toEqual([...dones].sort((a, b) => a - b)); // monotonic
  });
});
