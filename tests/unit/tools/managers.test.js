// #37 Phase 2: read-only parsers for every manager (plan plans/adm-tools-tui.md).
//
// Assumptions encoded by these tests (stated before RED, 2026-11-12):
// - Each parser is PURE: (raw output string) => [{ id, name, version, binPath }]
//   or null. null = "not parseable" (caller warns + group stays empty); []
//   = manager present with zero packages (NOT a warning). \r\n tolerated.
// - brew: `brew list --json=v2` — { formulae: [{ name, versions.stable,
//   linked_keg }], casks: [{ name, version }] }. binPath = linked_keg path
//   when the formula has one (brew DOES provide it), null for casks.
// - npm parser (Phase 1, lives in inventory.js) gets its fixture test here
//   too so the AC matrix "one fixture per manager" is complete in one place.
const {
  parseBrewList,
  parsePipList,
  parseCargoInstallList,
  parseDpkgQuery,
  parseRpmQa,
  parsePacmanQ,
  parseZypperSearch,
  parseApkInfo,
  parseWingetList,
  parseChocoList,
  parseScoopList,
  goBinEntries,
  parseNpmList,
} = require('../../../src/tools/managers');

describe('parseBrewList (brew list --json=v2)', () => {
  test('parses formulae with stable version + linked_keg path and casks with plain version', () => {
    const raw = JSON.stringify({
      formulae: [
        {
          name: 'bat',
          versions: { stable: '0.24.0' },
          linked_keg: { path: '/opt/homebrew/Cellar/bat/0.24.0' },
          installed: [{ version: '0.24.0' }],
        },
        {
          name: 'ripgrep',
          versions: { stable: '14.1.0' },
          linked_keg: null,
        },
      ],
      casks: [{ name: 'visual-studio-code', version: '1.85.1' }],
    });

    expect(parseBrewList(raw)).toEqual([
      { id: 'bat', name: 'bat', version: '0.24.0', binPath: '/opt/homebrew/Cellar/bat/0.24.0' },
      { id: 'ripgrep', name: 'ripgrep', version: '14.1.0', binPath: null },
      { id: 'visual-studio-code', name: 'visual-studio-code', version: '1.85.1', binPath: null },
    ]);
  });

  test('empty formulae+casks is a valid empty list (no warning path)', () => {
    expect(parseBrewList('{"formulae":[],"casks":[]}')).toEqual([]);
  });

  test('garbage output is not parseable → null (caller warns)', () => {
    expect(parseBrewList('<html>brew failed</html>')).toBeNull();
  });
});

describe('parsePipList (pip3 list --format=json)', () => {
  test('parses the JSON array of {name, version} objects', () => {
    const raw = '[{"name":"pip","version":"23.3.1"},{"name":"requests","version":"2.31.0"}]';
    expect(parsePipList(raw)).toEqual([
      { id: 'pip', name: 'pip', version: '23.3.1', binPath: null },
      { id: 'requests', name: 'requests', version: '2.31.0', binPath: null },
    ]);
  });

  test('empty package list is valid ([])', () => {
    expect(parsePipList('[]')).toEqual([]);
  });

  test('garbage output → null', () => {
    expect(parsePipList('ERROR: no such option')).toBeNull();
  });
});

describe('parseCargoInstallList (cargo install --list)', () => {
  test('parses "crate vX.Y.Z:" lines (binary names below are not entries)', () => {
    const raw = [
      'bat v0.24.0:',
      '    bat',
      'ripgrep v14.1.0:',
      '    rg',
      'fd-find v9.0.0:',
      '    fd',
    ].join('\r\n');
    expect(parseCargoInstallList(raw)).toEqual([
      { id: 'bat', name: 'bat', version: '0.24.0', binPath: null },
      { id: 'ripgrep', name: 'ripgrep', version: '14.1.0', binPath: null },
      { id: 'fd-find', name: 'fd-find', version: '9.0.0', binPath: null },
    ]);
  });

  test('parses --path/--git installs: "crate vV (source):" — real Windows output shape', () => {
    const raw = [
      'umux v1.0.2 (C:\\Users\\panad\\Documents\\umux\\src-tauri\\cli):',
      '    umux.exe',
      'tool v2.0.0 (git+https://github.com/x/y#abc123):',
      '    tool',
    ].join('\r\n');
    expect(parseCargoInstallList(raw)).toEqual([
      { id: 'umux', name: 'umux', version: '1.0.2', binPath: null },
      { id: 'tool', name: 'tool', version: '2.0.0', binPath: null },
    ]);
  });

  test('no crates installed is a valid empty list', () => {
    expect(parseCargoInstallList('')).toEqual([]);
  });

  test('non-empty output with no crate lines → null', () => {
    expect(parseCargoInstallList('error: could not find toolchain')).toBeNull();
  });
});

describe('dpkg-query / rpm -qa (tab-separated name<TAB>version fixtures)', () => {
  test('parseDpkgQuery parses ${Package}\\t${Version} lines', () => {
    const raw = 'bash\t5.2.15-2\ncurl\t7.88.1-10+deb12u5\ngit\t2.39.2-1';
    expect(parseDpkgQuery(raw)).toEqual([
      { id: 'bash', name: 'bash', version: '5.2.15-2', binPath: null },
      { id: 'curl', name: 'curl', version: '7.88.1-10+deb12u5', binPath: null },
      { id: 'git', name: 'git', version: '2.39.2-1', binPath: null },
    ]);
  });

  test('parseRpmQa parses NAME\\tVERSION-RELEASE lines', () => {
    const raw = 'bash\t5.2.15-2.fc38\ncoreutils\t9.3-4.fc38';
    expect(parseRpmQa(raw)).toEqual([
      { id: 'bash', name: 'bash', version: '5.2.15-2.fc38', binPath: null },
      { id: 'coreutils', name: 'coreutils', version: '9.3-4.fc38', binPath: null },
    ]);
  });

  test('empty system output is valid; garbage → null', () => {
    expect(parseDpkgQuery('')).toEqual([]);
    expect(parseDpkgQuery('no package databases found')).toBeNull();
    expect(parseRpmQa('')).toEqual([]);
    expect(parseRpmQa('error: cannot open Packages database')).toBeNull();
  });
});

describe('parsePacmanQ (pacman -Q: "name version" per line)', () => {
  test('parses space-separated name/version pairs', () => {
    const raw = 'bash 5.2.15-3\ncoreutils 9.3-1\npacman 6.0.2-1';
    expect(parsePacmanQ(raw)).toEqual([
      { id: 'bash', name: 'bash', version: '5.2.15-3', binPath: null },
      { id: 'coreutils', name: 'coreutils', version: '9.3-1', binPath: null },
      { id: 'pacman', name: 'pacman', version: '6.0.2-1', binPath: null },
    ]);
  });

  test('empty is valid; garbage → null', () => {
    expect(parsePacmanQ('')).toEqual([]);
    expect(parsePacmanQ('error: package databases corrupted')).toBeNull();
  });
});

describe('parseZypperSearch (zypper search --installed-only table)', () => {
  test('parses installed rows (i) from the pipe-delimited table', () => {
    const raw = [
      'S | Name        | Version | Release | Arch    | Repository',
      '--+-------------+---------+---------+---------+-----------',
      'i | bash        | 5.2.15  | 2.1     | x86_64  | openSUSE',
      'i | zypper      | 1.14.66 | 0       | x86_64  | openSUSE',
    ].join('\r\n');
    expect(parseZypperSearch(raw)).toEqual([
      { id: 'bash', name: 'bash', version: '5.2.15', binPath: null },
      { id: 'zypper', name: 'zypper', version: '1.14.66', binPath: null },
    ]);
  });

  test('empty is valid; garbage → null', () => {
    expect(parseZypperSearch('')).toEqual([]);
    expect(parseZypperSearch("Repository 'main' is unavailable")).toBeNull();
  });
});

describe('parseApkInfo (apk info -v: name-version per line)', () => {
  test('splits at the last hyphen followed by a digit (names may contain hyphens)', () => {
    const raw = 'bash-5.2.15-r0\ncurl-8.1.2-r0\nzsh-syntax-highlighting-0.7.1-r0';
    expect(parseApkInfo(raw)).toEqual([
      { id: 'bash', name: 'bash', version: '5.2.15-r0', binPath: null },
      { id: 'curl', name: 'curl', version: '8.1.2-r0', binPath: null },
      { id: 'zsh-syntax-highlighting', name: 'zsh-syntax-highlighting', version: '0.7.1-r0', binPath: null },
    ]);
  });

  test('empty is valid; non-empty with no version-looking lines → null', () => {
    expect(parseApkInfo('')).toEqual([]);
    expect(parseApkInfo('WARNING: apk not configured')).toBeNull();
  });
});

describe('parseWingetList (winget list --accept-source-agreements)', () => {
  test('parses rows below the dashes separator; header is locale-proof (skipped)', () => {
    // Polish winget headers differ — the dashes line is the stable landmark.
    const raw = [
      'Nazwa             Id                      Wersja     Dostępne',
      '------------------------------------------------------------------',
      'Git               Git.Git                 2.43.0',
      'Node.js LTS       OpenJS.NodeJS.LTS       20.11.0    20.11.1',
    ].join('\r\n');
    expect(parseWingetList(raw)).toEqual([
      { id: 'Git.Git', name: 'Git', version: '2.43.0', binPath: null },
      { id: 'OpenJS.NodeJS.LTS', name: 'Node.js LTS', version: '20.11.0', binPath: null },
    ]);
  });

  test('empty list (header only) is valid', () => {
    const raw = 'Nazwa  Id  Wersja\n-------  --  ------';
    expect(parseWingetList(raw)).toEqual([]);
  });

  test('garbage (no table) → null', () => {
    expect(parseWingetList('An unexpected error occurred')).toBeNull();
  });
});

describe('parseChocoList (choco list)', () => {
  test('parses package rows, skipping banner/summary/header lines', () => {
    const raw = [
      'Chocolatey v2.2.2',
      'Name        Version',
      'git         2.43.0',
      'nodejs      20.11.0',
      '2/2 packages installed.',
    ].join('\r\n');
    expect(parseChocoList(raw)).toEqual([
      { id: 'git', name: 'git', version: '2.43.0', binPath: null },
      { id: 'nodejs', name: 'nodejs', version: '20.11.0', binPath: null },
    ]);
  });

  test('empty is valid; garbage → null', () => {
    expect(parseChocoList('Chocolatey v2.2.2\n0/0 packages installed.')).toEqual([]);
    expect(parseChocoList('choco : The term is not recognized')).toBeNull();
  });
});

describe('parseScoopList (scoop list — PowerShell table)', () => {
  test('parses rows below the dashes separator', () => {
    const raw = [
      'Name     Version   Source Info',
      '----     -------   ------ ----',
      'git      2.43.0',
      'nodejs   20.11.0',
    ].join('\r\n');
    expect(parseScoopList(raw)).toEqual([
      { id: 'git', name: 'git', version: '2.43.0', binPath: null },
      { id: 'nodejs', name: 'nodejs', version: '20.11.0', binPath: null },
    ]);
  });

  test('empty is valid; garbage → null', () => {
    expect(parseScoopList('Name  Version\n----  -------')).toEqual([]);
    expect(parseScoopList('scoop : command not found')).toBeNull();
  });
});

describe('goBinEntries (fs scan of ~/go/bin)', () => {
  test('lists regular files as entries with full binPath; .exe stripped on win32; dotfiles/dirs skipped', () => {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-gobin-'));
    fs.writeFileSync(path.join(bin, 'gopls'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(bin, '.DS_Store'), 'junk');
    fs.mkdirSync(path.join(bin, 'subdir'));

    const entries = goBinEntries(bin, { platform: 'linux' });
    expect(entries).toEqual([
      { id: 'gopls', name: 'gopls', version: null, binPath: path.join(bin, 'gopls') },
    ]);

    fs.writeFileSync(path.join(bin, 'gopls.exe'), 'MZ');
    const onWin = goBinEntries(bin, { platform: 'win32' });
    expect(onWin.map(e => e.id).sort()).toEqual(['gopls', 'gopls']); // .exe stripped from ids
    expect(onWin.every(e => !e.id.includes('.'))).toBe(true);
    expect(onWin.some(e => e.binPath.endsWith('.exe'))).toBe(true); // full path kept
  });

  test('missing directory is reported (ok:false semantics at the caller) — null here', () => {
    expect(goBinEntries(require('path').join(require('os').tmpdir(), 'adm-no-such-go-bin'), {})).toBeNull();
  });
});

describe('parseNpmList (npm ls -g --json — Phase 1 parser, fixture re-tested here)', () => {
  test('parses the dependencies map into entries', () => {
    const raw = JSON.stringify({ dependencies: { typescript: { version: '5.4.5' } } });
    expect(parseNpmList(raw)).toEqual([
      { id: 'typescript', name: 'typescript', version: '5.4.5' },
    ]);
    expect(parseNpmList('not json')).toBeNull();
  });
});
