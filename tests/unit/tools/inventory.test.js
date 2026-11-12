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

// #37 Phase 2 probing runs real manager commands by default — tests that only
// exercise merge/progress behavior stub exec so nothing spawns on the host.
const noExec = (cmd, opts, cb) => cb(new Error('spawn ENOENT'), '');
const goBin = () => path.join(os.tmpdir(), 'adm-no-such-go-bin');

describe('scanInventory', () => {
  test('merges registry + npm + PATH hit for the same tool into ONE entry attributed to the registry', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-path-'));
    fs.writeFileSync(path.join(binDir, 'typescript'), '#!/bin/sh\n');

    const res = await scanInventory({
      registry: [{ id: 'typescript', name: 'TypeScript', method: 'npm', installedAt: '2026-01-01T00:00:00.000Z' }],
      npmJson: JSON.stringify({ dependencies: { typescript: { version: '5.4.5' } } }),
      catalog: [{ id: 'typescript', name: 'TypeScript' }],
      env: { PATH: binDir },
      execFunc: noExec,
      goBinDir: goBin(),
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
      execFunc: noExec,
      goBinDir: goBin(),
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
      execFunc: noExec,
      goBinDir: goBin(),
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
      execFunc: noExec,
      goBinDir: goBin(),
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
      execFunc: noExec,
      goBinDir: goBin(),
    });

    const admGroup = res.groups.find(g => g.id === 'adm');
    expect(admGroup.entries).toHaveLength(0);
    expect(admGroup.warning).toBeTruthy();
  });

  test('every result carries all 8 groups in the fixed display order', async () => {
    const res = await scanInventory({ registry: [], npmJson: '{}', catalog: [], execFunc: noExec, goBinDir: goBin() });

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
      execFunc: noExec,
      goBinDir: goBin(),
      onProgress: (done, total) => events.push([done, total]),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1][0]).toBe(events[events.length - 1][1]);
    const dones = events.map(e => e[0]);
    expect(dones).toEqual([...dones].sort((a, b) => a - b)); // monotonic
  });

  // ---- #37 Phase 2: platform-gated manager probes ----

  test('probes Windows managers only: winget/choco/scoop feed "system", Linux managers never run', async () => {
    const cmds = [];
    const res = await scanInventory({
      platform: 'win32',
      registry: [],
      catalog: [],
      execFunc: (cmd, o, cb) => { cmds.push(cmd); cb(null, ''); },
      goBinDir: goBin(),
      wingetOut: 'Nazwa        Id        Wersja\n----------------------------\nGit         Git.Git   2.43.0',
    });

    const firsts = cmds.map(c => c.split(' ')[0]);
    expect(firsts).toEqual(expect.arrayContaining(['npm', 'pip3', 'cargo']));
    for (const banned of ['brew', 'dpkg-query', 'rpm', 'pacman', 'zypper', 'apk']) {
      expect(firsts).not.toContain(banned);
    }
    const system = res.groups.find(g => g.id === 'system');
    expect(system.entries.map(e => e.id)).toEqual(['Git.Git']);
    expect(system.entries[0].manager).toBe('winget');
    expect(system.warning).toBeNull();
  });

  test('probes Linux system managers only; winget never runs', async () => {
    const cmds = [];
    const res = await scanInventory({
      platform: 'linux',
      registry: [],
      catalog: [],
      execFunc: (cmd, o, cb) => { cmds.push(cmd); cb(null, ''); },
      goBinDir: goBin(),
      dpkgOut: 'bash\t5.2.15-2\ncurl\t7.88.1-10',
    });

    const firsts = cmds.map(c => c.split(' ')[0]);
    // dpkg is raw-injected (no exec) — the other four Linux managers ARE probed
    expect(firsts).toEqual(expect.arrayContaining(['rpm', 'pacman', 'zypper', 'apk']));
    for (const banned of ['winget', 'choco', 'scoop']) {
      expect(firsts).not.toContain(banned);
    }
    const system = res.groups.find(g => g.id === 'system');
    expect(system.entries.map(e => e.id)).toEqual(['bash', 'curl']);
    expect(system.entries[0].manager).toBe('dpkg');
    // rpm/pacman/zypper/apk answered (empty) — no warning noise next to a working dpkg
    expect(system.warning).toBeNull();
  });

  test('on macOS no system manager is probed → system group empty without warning', async () => {
    const cmds = [];
    const res = await scanInventory({
      platform: 'darwin',
      registry: [],
      catalog: [],
      execFunc: (cmd, o, cb) => { cmds.push(cmd); cb(null, ''); },
      goBinDir: goBin(),
    });

    const firsts = cmds.map(c => c.split(' ')[0]);
    expect(firsts).toEqual(expect.arrayContaining(['brew', 'npm', 'pip3', 'cargo']));
    expect(res.groups.find(g => g.id === 'system')).toMatchObject({ entries: [], warning: null });
  });

  // ---- #37: full merge — registry > manager > catalog ----

  test('5+ three-way collisions (catalog + manager + registry) → ONE entry each, registry wins', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-collide-'));
    const ids = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    for (const id of ids) fs.writeFileSync(path.join(binDir, id), '#!/bin/sh\n');

    const res = await scanInventory({
      registry: ids.map(id => ({ id, name: `${id}-display`, method: 'npm', installedAt: '2026-02-02T00:00:00.000Z' })),
      npmJson: JSON.stringify({ dependencies: Object.fromEntries(ids.map(id => [id, { version: '1.2.3' }])) }),
      catalog: ids.map(id => ({ id, name: `${id}-display` })),
      env: { PATH: binDir },
      execFunc: noExec,
      goBinDir: goBin(),
    });

    expect(res.entries).toHaveLength(5); // no duplicates
    for (const id of ids) {
      const hits = res.entries.filter(e => e.id === id);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        source: 'adm',          // registry > manager > catalog
        manager: 'npm',         // manager fills the method blank
        version: '1.2.3',       // manager fills the version blank
        binPath: path.join(binDir, id), // catalog fills the path blank
        installedAt: '2026-02-02T00:00:00.000Z',
      });
    }
    expect(res.groups.find(g => g.id === 'adm').entries.map(e => e.id)).toEqual(ids);
    for (const other of ['npm', 'other']) {
      expect(res.groups.find(g => g.id === other).entries).toHaveLength(0);
    }
  });

  test('manager attribution follows the fixed probe order when a tool is seen by two managers', async () => {
    // 'omega' is reported by both npm and dpkg — npm comes first in MANAGER_SOURCES
    const res = await scanInventory({
      registry: [],
      npmJson: JSON.stringify({ dependencies: { omega: { version: '9.9.9' } } }),
      dpkgOut: 'omega\t1.0.0-1',
      catalog: [],
      execFunc: noExec,
      goBinDir: goBin(),
    });

    const hits = res.entries.filter(e => e.id === 'omega');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: 'npm', manager: 'npm', version: '9.9.9' });
    expect(res.groups.find(g => g.id === 'system').entries).toHaveLength(0);
  });

  // ---- #37: resilience — broken input / missing manager per group ×8 ----
  // For EVERY group: its source failing (corrupt output, missing manager)
  // leaves the group EMPTY + warned and the scan RESOLVES — never crashes.

  const failingExec = (cmd, opts, cb) => cb(new Error('spawn ENOENT'), '');

  test('×8 [adm]: corrupt registry file → empty group + warning', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-corrupt-'));
    fs.writeFileSync(path.join(dir, 'installed.json'), '{not json at all');

    const res = await scanInventory({
      configDir: dir,
      catalog: [],
      execFunc: failingExec,
      goBinDir: goBin(),
    });
    expect(res.groups.find(g => g.id === 'adm')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'adm').warning).toBeTruthy();
  });

  test('×8 [npm]: npm missing → empty group + warning', async () => {
    const res = await scanInventory({ registry: [], catalog: [], execFunc: failingExec, goBinDir: goBin() });
    expect(res.groups.find(g => g.id === 'npm')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'npm').warning).toBeTruthy();
  });

  test('×8 [brew]: brew missing → empty group + warning (on a brew platform)', async () => {
    const res = await scanInventory({
      registry: [], catalog: [], platform: 'darwin', execFunc: failingExec, goBinDir: goBin(),
    });
    expect(res.groups.find(g => g.id === 'brew')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'brew').warning).toBeTruthy();
  });

  test('×8 [pip]: pip3 missing → empty group + warning', async () => {
    const res = await scanInventory({ registry: [], catalog: [], execFunc: failingExec, goBinDir: goBin() });
    expect(res.groups.find(g => g.id === 'pip')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'pip').warning).toBeTruthy();
  });

  test('×8 [cargo]: cargo missing → empty group + warning', async () => {
    const res = await scanInventory({ registry: [], catalog: [], execFunc: failingExec, goBinDir: goBin() });
    expect(res.groups.find(g => g.id === 'cargo')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'cargo').warning).toBeTruthy();
  });

  test('×8 [go]: ~/go/bin missing → empty group + warning', async () => {
    const res = await scanInventory({ registry: [], catalog: [], execFunc: failingExec, goBinDir: goBin() });
    expect(res.groups.find(g => g.id === 'go')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'go').warning).toBeTruthy();
  });

  test('×8 [system]: all Windows managers missing → empty group + warning', async () => {
    const res = await scanInventory({
      registry: [], catalog: [], platform: 'win32', execFunc: failingExec, goBinDir: goBin(),
    });
    expect(res.groups.find(g => g.id === 'system')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'system').warning).toBeTruthy();
  });

  test('×8 [system]: broken dpkg output + missing siblings → empty group + warning, no crash', async () => {
    const res = await scanInventory({
      registry: [], catalog: [], platform: 'linux',
      execFunc: failingExec,
      goBinDir: goBin(),
      dpkgOut: '<html>dpkg exploded</html>',
    });
    expect(res.groups.find(g => g.id === 'system')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'system').warning).toBeTruthy();
  });

  test('×8 [other]: unreadable catalog → empty group + warning, no crash', async () => {
    const res = await scanInventory({
      registry: [],
      catalogLoader: () => { throw new Error('catalog.json corrupt'); },
      execFunc: failingExec,
      goBinDir: goBin(),
    });
    expect(res.groups.find(g => g.id === 'other')).toMatchObject({ entries: [] });
    expect(res.groups.find(g => g.id === 'other').warning).toBeTruthy();
  });

  // ---- #37: full-scan performance + progress monotonicity ----

  test('280 catalog entries + manager fixtures with mocked exec scan in < 5 s; progress grows monotonically', async () => {
    const catalog = [];
    for (let i = 1; i <= 280; i += 1) catalog.push({ id: `cat${i}`, name: `Cat ${i}` });
    const dpkgRows = [];
    for (let i = 1; i <= 300; i += 1) dpkgRows.push(`pkg${i}\t1.0.${i}-1`);
    const events = [];
    const started = Date.now();

    const res = await scanInventory({
      platform: 'win32',
      registry: [],
      catalog,
      env: { PATH: '' },
      // mocked exec resolves for every probed manager with fixture-sized data
      execFunc: (cmd, o, cb) => cb(null, dpkgRows.join('\r\n')),
      goBinDir: goBin(),
      onProgress: (done, total) => events.push([done, total]),
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5000);
    expect(events.length).toBeGreaterThan(0);
    const dones = events.map(e => e[0]);
    expect(dones).toEqual([...dones].sort((a, b) => a - b)); // strictly non-decreasing
    expect(events[events.length - 1][0]).toBe(events[events.length - 1][1]);
    expect(events[events.length - 1][1]).toBe(288); // 1 registry + 7 win32 probes + 280 catalog
    expect(res.entries.filter(e => e.source === 'system')).toHaveLength(300);
  });
});
