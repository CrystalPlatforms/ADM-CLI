// #38 Phase 3: tool-info — the terminal-neutral side panel data module.
//
// Assumptions encoded by these tests (stated before RED, 2026-11-12):
// - getToolInfo(entry, opts) is ONE deep call returning the COMPLETE bundle:
//   { version, binPath, method, size, sizeLabel, configPaths, cachePaths,
//     docsPaths, flags: { canUpdate, canRemove, hasCache, canReveal } }.
//   version/binPath/method pass through from the inventory entry (method =
//   entry.manager); size is computed HERE, never in the scan (scanInventory
//   does not import tool-info — structural laziness guarantee).
// - size: binPath is a FILE → its byte size; a DIRECTORY (brew keg) →
//   recursive walk. Missing/unreadable binPath → size null (panel shows "—").
// - config/cache/docs: conventional per-platform locations, ONLY paths that
//   actually exist (checked at tool-info time, injectable home/fs).
//   linux: ~/.config/<id>, ~/.cache/<id>, /usr/share/doc/<id>.
//   win32: %APPDATA%/<id>, %LOCALAPPDATA%/<id>/cache, %ProgramData%/<id>/docs.
//   darwin: ~/Library/Application Support/<id>, ~/Library/Caches/<id>,
//           /usr/local/share/doc/<id>.
// - Flags are the ONLY truth for dimming the u/r/f/c shortcuts (Phase 4 will
//   execute them): known manager → canUpdate/canRemove; found cache →
//   hasCache; binPath + platform opener (explorer/open/xdg-open on PATH) →
//   canReveal. Unknown manager ('other', or registry entry without method)
//   → canUpdate/canRemove false.
// - What is NOT tested here: the real reveal commands (Phase 5), executing
//   actions (Phase 4), per-manager npm node_modules size resolution.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getToolInfo } = require('../../../src/tools/tool-info');

const mktmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('getToolInfo (fixture directory tree)', () => {
  test('returns the COMPLETE bundle for a fictitious tool: version/path/method/size/config/cache/docs/flags', () => {
    const home = mktmp('adm-ti-home-');
    const root = mktmp('adm-ti-tree-');
    // binPath as a DIRECTORY (brew-keg style) → the size walks the whole tree
    fs.mkdirSync(path.join(root, 'mytool', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mytool', 'mytool'), Buffer.alloc(120));
    fs.writeFileSync(path.join(root, 'mytool', 'lib', 'core.so'), Buffer.alloc(50));
    fs.mkdirSync(path.join(home, '.config', 'mytool'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'mytool', 'rc'), 'x');
    fs.mkdirSync(path.join(home, '.cache', 'mytool'), { recursive: true });

    const entry = {
      id: 'mytool', name: 'MyTool', version: '1.2.3',
      binPath: path.join(root, 'mytool'),
      source: 'other', manager: 'cargo', installedAt: null,
    };
    const info = getToolInfo(entry, { platform: 'linux', home, env: {} });

    expect(info).toMatchObject({
      version: '1.2.3',
      binPath: path.join(root, 'mytool'),
      method: 'cargo',
      size: 170,                       // directory walk: 120 + 50
      sizeLabel: '170 B',
      configPaths: [path.join(home, '.config', 'mytool')],
      cachePaths: [path.join(home, '.cache', 'mytool')],
      docsPaths: [],                   // /usr/share/doc/mytool absent on the fixture host
    });
    expect(info.flags).toEqual({
      canUpdate: true,                 // known manager (cargo)
      canRemove: true,
      hasCache: true,                  // cache dir found
      canReveal: false,                // no xdg-open on the fixture PATH
    });
  });

  test('a FILE binPath sizes as the file itself (no walk)', () => {
    const home = mktmp('adm-ti-home2-');
    const bin = path.join(home, 'tool.bin');
    fs.writeFileSync(bin, Buffer.alloc(7));

    const info = getToolInfo(
      { id: 't', name: 't', version: null, binPath: bin, source: 'go', manager: 'go', installedAt: null },
      { platform: 'linux', home, env: {} },
    );
    expect(info.size).toBe(7);
    expect(info.sizeLabel).toBe('7 B');
  });

  test('every data gap becomes null/[] and ALL flags go false (panel will show "—")', () => {
    const home = mktmp('adm-ti-empty-');
    const info = getToolInfo(
      { id: 'ghost', name: 'ghost', version: null, binPath: null, source: 'other', manager: null, installedAt: null },
      { platform: 'linux', home, env: {} },
    );
    expect(info).toMatchObject({
      version: null, binPath: null, method: null,
      size: null, sizeLabel: null,
      configPaths: [], cachePaths: [], docsPaths: [],
    });
    expect(info.flags).toEqual({ canUpdate: false, canRemove: false, hasCache: false, canReveal: false });
  });
});

describe('docs locations that actually exist (owner fix: docs was ALWAYS "—" on Windows)', () => {
  test('npm-managed tool → docs live in the package dir inside node_modules (win32 layout)', () => {
    const home = mktmp('adm-ti-npmdocs-');
    const pkgDir = path.join(home, 'npm', 'node_modules', 'typescript');
    fs.mkdirSync(pkgDir, { recursive: true });

    const info = getToolInfo(
      { id: 'typescript', name: 'TypeScript', version: null, binPath: path.join(home, 'npm', 'tsc.cmd'), source: 'npm', manager: 'npm', installedAt: null },
      { platform: 'win32', home, env: {} },
    );
    expect(info.docsPaths).toEqual([pkgDir]);
  });

  test('npm-managed tool on unix → docs in prefix/lib/node_modules', () => {
    const home = mktmp('adm-ti-npmdocs2-');
    const pkgDir = path.join(home, 'usr', 'local', 'lib', 'node_modules', 'eslint');
    fs.mkdirSync(pkgDir, { recursive: true });

    const info = getToolInfo(
      { id: 'eslint', name: 'eslint', version: null, binPath: path.join(home, 'usr', 'local', 'bin', 'eslint'), source: 'npm', manager: 'npm', installedAt: null },
      { platform: 'linux', home, env: {} },
    );
    expect(info.docsPaths).toEqual([pkgDir]);
  });

  test('chocolatey/scoop layout and %ProgramData%\\<id> count as docs candidates on win32', () => {
    const home = mktmp('adm-ti-choco-');
    const progData = mktmp('adm-ti-pd-');
    fs.mkdirSync(path.join(progData, 'chocolatey', 'lib', 'git'), { recursive: true });

    const info = getToolInfo(
      { id: 'git', name: 'Git', version: null, binPath: null, source: 'system', manager: 'choco', installedAt: null },
      { platform: 'win32', home, env: { ProgramData: progData } },
    );
    expect(info.docsPaths).toEqual([path.join(progData, 'chocolatey', 'lib', 'git')]);
  });

  test('no docs anywhere → still [] (panel shows "—")', () => {
    const home = mktmp('adm-ti-nodocs-');
    const info = getToolInfo(
      { id: 'ghost', name: 'ghost', version: null, binPath: null, source: 'other', manager: null, installedAt: null },
      { platform: 'win32', home, env: {} },
    );
    expect(info.docsPaths).toEqual([]);
  });
});

describe('capability flags matrix', () => {
  const entryWith = over => ({
    id: 'x', name: 'x', version: null, binPath: null, source: 'other', manager: null, installedAt: null,
    ...over,
  });
  const opts = over => ({ platform: 'linux', home: mktmp('adm-ti-flag-'), env: {}, ...over });

  test('known manager → canUpdate + canRemove; unknown → both false', () => {
    expect(getToolInfo(entryWith({ manager: 'npm' }), opts()).flags.canUpdate).toBe(true);
    expect(getToolInfo(entryWith({ manager: 'dpkg' }), opts()).flags.canRemove).toBe(true);
    expect(getToolInfo(entryWith({ manager: null }), opts()).flags.canUpdate).toBe(false);
    expect(getToolInfo(entryWith({ manager: null }), opts()).flags.canRemove).toBe(false);
  });

  test('canReveal needs BOTH a binPath and the platform opener', () => {
    // win32: explorer.exe is the opener — stub fs confirms presence
    const winFs = { existsSync: p => String(p).includes('explorer.exe') };
    expect(getToolInfo(
      entryWith({ binPath: 'C:\\tools\\x.exe' }),
      { platform: 'win32', home: mktmp('adm-ti-rv-'), env: {}, fs: winFs },
    ).flags.canReveal).toBe(true);
    expect(getToolInfo(
      entryWith({ binPath: null }),
      { platform: 'win32', home: mktmp('adm-ti-rv2-'), env: {}, fs: winFs },
    ).flags.canReveal).toBe(false);

    // linux: xdg-open must sit on the (injected) PATH
    const binDir = mktmp('adm-ti-xdg-');
    fs.writeFileSync(path.join(binDir, 'xdg-open'), '#!/bin/sh\n');
    expect(getToolInfo(
      entryWith({ binPath: '/usr/bin/x' }),
      { platform: 'linux', home: mktmp('adm-ti-rv3-'), env: { PATH: binDir } },
    ).flags.canReveal).toBe(true);
    expect(getToolInfo(
      entryWith({ binPath: '/usr/bin/x' }),
      { platform: 'linux', home: mktmp('adm-ti-rv4-'), env: { PATH: '' } },
    ).flags.canReveal).toBe(false);
  });
});
