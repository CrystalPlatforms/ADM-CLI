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
const { scanInventory, findOnPath } = require('../../../src/tools/inventory');

// #37 Phase 2 probing runs real manager commands by default — tests that only
// exercise merge/progress behavior stub exec so nothing spawns on the host.
const noExec = (cmd, opts, cb) => cb(new Error('spawn ENOENT'), '');
const goBin = () => path.join(os.tmpdir(), 'adm-no-such-go-bin');

describe('findOnPath (owner fix: Windows app-execution aliases)', () => {
  test('a stat EACCES alias (winget.exe reparse point) still resolves — ACCESS is the authority', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-alias-'));
    const alias = path.join(dir, 'winget.exe');
    fs.writeFileSync(alias, '');
    const eacces = () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; };
    const aliasFs = {
      accessSync: p => { if (!String(p).endsWith('winget.exe')) throw new Error('ENOENT'); },
      statSync: p => { if (String(p).endsWith('winget.exe')) eacces(); return { isFile: () => true }; },
    };
    expect(findOnPath('winget', { env: { PATH: dir }, platform: 'win32', statSync: aliasFs.statSync, accessSync: aliasFs.accessSync })).toBe(alias);
  });

  test('a DIRECTORY sharing the tool name is rejected (stat works, isFile false)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-alias2-'));
    fs.mkdirSync(path.join(dir, 'git'));
    const allDirsFs = { accessSync: () => {}, statSync: () => ({ isFile: () => false }) };
    expect(findOnPath('git', { env: { PATH: dir }, platform: 'linux', statSync: allDirsFs.statSync, accessSync: allDirsFs.accessSync })).toBeNull();
  });
});

describe('scanInventory', () => {
  test('merges registry + npm + PATH hit for the same tool into ONE entry attributed to the registry', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-path-'));
    fs.writeFileSync(path.join(binDir, 'typescript'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(binDir, 'npm'), '#!/bin/sh\n'); // registry method must be reachable

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

  test('failing npm exec → empty npm group, silent (missing manager is normal), never a crash', async () => {
    const res = await scanInventory({
      registry: [],
      catalog: [],
      execFunc: (cmd, opts, cb) => cb(new Error('spawn npm ENOENT'), ''),
    });

    const npmGroup = res.groups.find(g => g.id === 'npm');
    expect(npmGroup.entries).toHaveLength(0);
    expect(npmGroup.warning).toBeNull(); // owner fix: missing manager is not noise
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
    fs.writeFileSync(path.join(binDir, 'npm'), '#!/bin/sh\n'); // registry method must be reachable

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

  // ---- registry healing (owner fix: 'brew' recorded on machines without brew) ----

  test('a registry method whose manager is ABSENT loses attribution (never lies about brew)', async () => {
    const res = await scanInventory({
      registry: [
        { id: 'git', name: 'Git', method: 'brew', installedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'gh', name: 'GitHub CLI', method: 'brew', installedAt: '2026-01-01T00:00:00.000Z' },
      ],
      npmJson: JSON.stringify({ dependencies: {} }),
      catalog: [],
      env: { PATH: '' }, // nothing reachable — brew cannot claim these
      execFunc: noExec,
      goBinDir: goBin(),
    });

    for (const id of ['git', 'gh']) {
      const e = res.entries.find(x => x.id === id);
      expect(e).toMatchObject({ source: 'adm', manager: null, installedAt: '2026-01-01T00:00:00.000Z' });
    }
  });

  test('a registry method whose manager IS reachable keeps attribution', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-heal-'));
    fs.writeFileSync(path.join(binDir, 'npm'), '#!/bin/sh\n');
    const res = await scanInventory({
      registry: [{ id: 'typescript', name: 'TypeScript', method: 'npm', installedAt: null }],
      npmJson: JSON.stringify({ dependencies: {} }),
      catalog: [],
      env: { PATH: binDir },
      execFunc: noExec,
      goBinDir: goBin(),
    });
    expect(res.entries.find(e => e.id === 'typescript')).toMatchObject({ source: 'adm', manager: 'npm' });
  });

  test('a broken registry method falls back to the DETECTED system manager (winget on Windows)', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-heal2-'));
    fs.writeFileSync(path.join(binDir, 'winget'), '#!/bin/sh\n'); // winget reachable, brew not
    const res = await scanInventory({
      platform: 'win32',
      registry: [{ id: 'git', name: 'Git', method: 'brew', installedAt: '2026-01-01T00:00:00.000Z' }],
      catalog: [],
      env: { PATH: binDir },
      execFunc: noExec, // all probes fail → missing → silent; healing is PATH-based
      goBinDir: goBin(),
    });
    // u/r stay ACTIVE: the tool is attributed to the manager that really
    // owns it on this machine (the wizard installed it via winget)
    expect(res.entries.find(e => e.id === 'git')).toMatchObject({ source: 'adm', manager: 'winget' });
  });

  test('the manager probe fills ADM entries through PACKAGE ids (git → Git.Git) — no duplicate rows', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-heal3-'));
    fs.writeFileSync(path.join(binDir, 'winget'), '#!/bin/sh\n');
    const res = await scanInventory({
      platform: 'win32',
      registry: [
        { id: 'git', name: 'Git', method: 'brew', installedAt: null },
        { id: 'gh', name: 'GitHub CLI', method: 'brew', installedAt: null },
      ],
      wingetOut: [
        'Nazwa            Id            Wersja',
        '------------------------------',
        'Git              Git.Git       2.43.0',
        'GitHub CLI       GitHub.cli    2.63.0',
      ].join('\n'),
      catalog: [],
      env: { PATH: binDir },
      execFunc: noExec,
      goBinDir: goBin(),
    });

    // ONE entry per tool — the winget PACKAGE row merged into the registry id
    const git = res.entries.filter(e => e.id === 'git' || e.id === 'Git.Git');
    expect(git).toHaveLength(1);
    expect(git[0]).toMatchObject({ source: 'adm', manager: 'winget', version: '2.43.0' });
    const gh = res.entries.filter(e => e.id === 'gh' || e.id === 'GitHub.cli');
    expect(gh).toHaveLength(1);
    expect(gh[0]).toMatchObject({ source: 'adm', manager: 'winget', version: '2.63.0' });
    expect(res.groups.find(g => g.id === 'adm').entries.map(e => e.id)).toEqual(['gh', 'git']);
    expect(res.groups.find(g => g.id === 'system').entries).toHaveLength(0);
  });

  // ---- #37: resilience — broken input / missing manager per group ×8 ----
  // For EVERY group: its source failing leaves the group EMPTY and the scan
  // RESOLVES — never crashes. Owner policy: a MISSING manager stays SILENT
  // (empty groups without warnings are hidden), only BROKEN output warns.

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

  test('×8 [npm]: npm missing → empty group, silent', async () => {
    const res = await scanInventory({ registry: [], catalog: [], execFunc: failingExec, goBinDir: goBin() });
    expect(res.groups.find(g => g.id === 'npm')).toMatchObject({ entries: [], warning: null });
  });

  test('×8 [brew]: brew missing → empty group, silent (on a brew platform)', async () => {
    const res = await scanInventory({
      registry: [], catalog: [], platform: 'darwin', execFunc: failingExec, goBinDir: goBin(),
    });
    expect(res.groups.find(g => g.id === 'brew')).toMatchObject({ entries: [], warning: null });
  });

  test('×8 [pip]: pip3 missing → empty group, silent', async () => {
    const res = await scanInventory({ registry: [], catalog: [], execFunc: failingExec, goBinDir: goBin() });
    expect(res.groups.find(g => g.id === 'pip')).toMatchObject({ entries: [], warning: null });
  });

  test('×8 [cargo]: cargo missing → empty group, silent', async () => {
    const res = await scanInventory({ registry: [], catalog: [], execFunc: failingExec, goBinDir: goBin() });
    expect(res.groups.find(g => g.id === 'cargo')).toMatchObject({ entries: [], warning: null });
  });

  test('×8 [go]: ~/go/bin missing → empty group, silent', async () => {
    const res = await scanInventory({ registry: [], catalog: [], execFunc: failingExec, goBinDir: goBin() });
    expect(res.groups.find(g => g.id === 'go')).toMatchObject({ entries: [], warning: null });
  });

  test('×8 [system]: all Windows managers missing → empty group, silent', async () => {
    const res = await scanInventory({
      registry: [], catalog: [], platform: 'win32', execFunc: failingExec, goBinDir: goBin(),
    });
    expect(res.groups.find(g => g.id === 'system')).toMatchObject({ entries: [], warning: null });
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
