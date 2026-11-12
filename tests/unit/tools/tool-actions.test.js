// #39 Phase 4: tool-actions — the terminal-neutral action layer.
//
// Assumptions encoded by these tests (stated before RED, 2026-11-12):
// - buildActionPlan(action, entry, info, { includeConfigCache }) is the
//   DRY-RUN generator: update = exactly ONE command step per manager
//   (13 managers, texts frozen in issue #39 — only apt carries sudo);
//   remove = the analogous uninstall/y command, EXCEPT go which has no
//   uninstall and deletes its binary instead (deletePath step).
// - The remove dialog's "config and cache" checkbox appends deletePath steps
//   for info.configPaths + info.cachePaths (deduplicated, existing paths only
//   — tool-info guarantees existence; here we trust the bundle shape).
// - Unknown manager / missing id / go-without-binary → null (callers are
//   flag-gated upstream; null = "nothing to execute").
// - runActionPlan executes steps SEQUENTIALLY; a command failure stops the
//   plan and reports sudoFailure (isSudoFailure pattern-matches stderr/
//   stdout/message: lock files, sudo prompts, OS denials); deletePath uses
//   fs.rmSync(recursive, force) — a missing path is NOT a failure.
// - refreshEntryAfterUpdate: light probe of ONE manager merges the fresh
//   version/binPath into the stored entry and marks entry.updated = true;
//   a failed probe keeps old values but still marks updated (the action
//   itself succeeded); a missing entry → { refreshed: false }.
// - applyActionToResult(result, id, 'remove') drops the entry from
//   result.entries AND from its group — no rescan.
// - buildRevealCommand per platform: `open -R "<p>"` (darwin),
//   `explorer /select,"<p>"` (win32), `xdg-open "<folder>"` (linux — a FILE
//   target resolves to its parent, xdg-open only opens folders); unknown
//   platform / empty target → null.
// - What is NOT tested here: the TUI dialog/sudo state machine (tools-tui
//   tests) and real child_process execution.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildActionPlan,
  runActionPlan,
  applyActionToResult,
  refreshEntryAfterUpdate,
  buildRevealCommand,
  isSudoFailure,
} = require('../../../src/tools/tool-actions');

const entry = (id, manager, binPath) => ({ id, name: id, version: '1.0.0', binPath: binPath || null, source: manager === 'go' ? 'adm' : manager, manager, installedAt: null });

const flush = () => new Promise(r => setImmediate(r));

describe('buildActionPlan — update matrix (13 managers, dry-run)', () => {
  const cases = {
    brew: 'brew upgrade htop',
    npm: 'npm update -g htop',
    pip: 'pip3 install -U htop',
    cargo: 'cargo install --force htop',
    go: 'go install htop@latest',
    dpkg: 'sudo apt install --only-upgrade htop',
    rpm: 'dnf upgrade htop',
    pacman: 'pacman -S htop',
    zypper: 'zypper update htop',
    apk: 'apk upgrade htop',
    winget: 'winget upgrade --id htop --exact --accept-source-agreements --accept-package-agreements --disable-interactivity',
    choco: 'choco upgrade htop --yes',
    scoop: 'scoop update htop',
  };
  for (const [manager, command] of Object.entries(cases)) {
    test(`${manager} → ${command}`, () => {
      const plan = buildActionPlan('update', entry('htop', manager), null);
      expect(plan).toEqual([{ type: 'command', command, label: expect.any(String) }]);
    });
  }

  test('unknown manager → null (nothing to execute)', () => {
    expect(buildActionPlan('update', entry('htop', 'apt'), null)).toBeNull();
    expect(buildActionPlan('update', entry('htop', null), null)).toBeNull();
    expect(buildActionPlan('update', null, null)).toBeNull();
  });
});

describe('buildActionPlan — remove matrix (13 managers, dry-run)', () => {
  const cases = {
    brew: 'brew uninstall htop',
    npm: 'npm uninstall -g htop',
    pip: 'pip3 uninstall -y htop',
    cargo: 'cargo uninstall htop',
    dpkg: 'sudo apt remove -y htop',
    rpm: 'dnf remove -y htop',
    pacman: 'pacman -R htop',
    zypper: 'zypper remove -y htop',
    apk: 'apk del htop',
    winget: 'winget uninstall --id htop --exact --accept-source-agreements --disable-interactivity',
    choco: 'choco uninstall -y htop',
    scoop: 'scoop uninstall htop',
  };
  for (const [manager, command] of Object.entries(cases)) {
    test(`${manager} → ${command}`, () => {
      const plan = buildActionPlan('remove', entry('htop', manager), null);
      expect(plan).toEqual([{ type: 'command', command, label: expect.any(String) }]);
    });
  }

  test('go deletes the binary (no uninstall command exists)', () => {
    const e = entry('htop', 'go', '/usr/local/bin/htop');
    const plan = buildActionPlan('remove', e, null);
    expect(plan).toEqual([{ type: 'deletePath', path: '/usr/local/bin/htop', label: expect.any(String) }]);
  });

  test('cargo remove carries a binPath fallback for corrupt metadata', () => {
    const e = entry('umux', 'cargo', 'C:\\Users\\u\\.cargo\\bin\\umux.exe');
    const plan = buildActionPlan('remove', e, null);
    expect(plan[0].command).toBe('cargo uninstall umux');
    expect(plan[0].fallbackSteps).toEqual([
      { type: 'deletePath', path: 'C:\\Users\\u\\.cargo\\bin\\umux.exe', label: expect.any(String) },
    ]);
    // no binPath → no explicit fallback (the error text still names the file)
    expect(buildActionPlan('remove', entry('umux', 'cargo'), null)[0].fallbackSteps).toBeUndefined();
  });

  test('go without a binary → null; unknown action → null', () => {
    expect(buildActionPlan('remove', entry('htop', 'go'), null)).toBeNull();
    expect(buildActionPlan('reinstall', entry('htop', 'npm'), null)).toBeNull();
  });
});

describe('buildActionPlan — system-manager package resolution', () => {
  test('winget resolves through the catalog mapping: git → Git.Git', () => {
    expect(buildActionPlan('update', entry('git', 'winget'), null))
      .toEqual([{ type: 'command', command: 'winget upgrade --id Git.Git --exact --accept-source-agreements --accept-package-agreements --disable-interactivity', label: expect.any(String) }]);
    expect(buildActionPlan('remove', entry('git', 'winget'), null))
      .toEqual([{ type: 'command', command: 'winget uninstall --id Git.Git --exact --accept-source-agreements --disable-interactivity', label: expect.any(String) }]);
  });

  test('unmapped ids keep the raw id (identity default)', () => {
    expect(buildActionPlan('update', entry('htop', 'winget'), null)[0].command).toBe('winget upgrade --id htop --exact --accept-source-agreements --accept-package-agreements --disable-interactivity');
    expect(buildActionPlan('update', entry('jq', 'brew'), null)[0].command).toBe('brew upgrade jq');
  });
});

describe('buildActionPlan — "config and cache" checkbox', () => {
  test('checkbox ON appends deletePath steps for tool-info config+cache paths (deduped)', () => {
    const info = {
      configPaths: ['/home/u/.config/htop'],
      cachePaths: ['/home/u/.cache/htop'],
      docsPaths: ['/usr/share/doc/htop'], // docs are NOT part of the checkbox
      flags: {},
    };
    const plan = buildActionPlan('remove', entry('htop', 'npm'), info, { includeConfigCache: true });
    expect(plan).toEqual([
      { type: 'command', command: 'npm uninstall -g htop', label: expect.any(String) },
      { type: 'deletePath', path: '/home/u/.config/htop', label: expect.any(String) },
      { type: 'deletePath', path: '/home/u/.cache/htop', label: expect.any(String) },
    ]);
  });

  test('checkbox OFF (default) never appends cleanup steps; empty paths add nothing', () => {
    const info = { configPaths: [], cachePaths: [], flags: {} };
    expect(buildActionPlan('remove', entry('htop', 'npm'), info, { includeConfigCache: true })).toHaveLength(1);
    expect(buildActionPlan('remove', entry('htop', 'npm'), info)).toHaveLength(1);
    expect(buildActionPlan('remove', entry('htop', 'npm'), null, { includeConfigCache: true })).toHaveLength(1);
  });
});

describe('isSudoFailure', () => {
  test.each([
    [{ stderr: 'sudo: a password is required' }, true],
    [{ stderr: 'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)' }, true],
    [{ stdout: 'error: unable to lock database' }, true],
    [{ message: 'Command failed: operation not permitted' }, true],
    [{ stderr: 'npm ERR! code E404\nnot found' }, false],
    [{ stderr: '', stdout: '', message: 'Command failed' }, false],
    [null, false],
  ])('classifies %# correctly', (err, expected) => {
    expect(isSudoFailure(err)).toBe(expected);
  });
});

describe('runActionPlan', () => {
  test('executes command steps SEQUENTIALLY with the exact generated commands', async () => {
    const seen = [];
    const execFunc = (cmd, _o, cb) => { seen.push(cmd); cb(null, '', ''); };
    const steps = buildActionPlan('remove', entry('htop', 'npm'), null);
    const res = await runActionPlan(steps, { execFunc });
    expect(res).toEqual({ ok: true });
    expect(seen).toEqual(['npm uninstall -g htop']);
  });

  test('a command failure stops the plan — later steps never run', async () => {
    const seen = [];
    const execFunc = (cmd, _o, cb) => {
      seen.push(cmd);
      if (cmd === 'sudo apt remove -y htop') cb({ message: 'boom', stderr: 'E: unable to lock' }, '', 'E: unable to lock');
      else cb(null, '', '');
    };
    const info = { configPaths: ['/x'], cachePaths: [], flags: {} };
    const steps = buildActionPlan('remove', entry('htop', 'dpkg'), info, { includeConfigCache: true });
    const res = await runActionPlan(steps, { execFunc });
    expect(res.ok).toBe(false);
    expect(seen).toEqual(['sudo apt remove -y htop']); // deletePath after it never ran
    expect(res.sudoFailure).toBe(true);
    expect(res.command).toBe('sudo apt remove -y htop');
    expect(res.stderr).toContain('unable to lock');
  });

  test('a non-sudo failure reports sudoFailure false', async () => {
    const execFunc = (_cmd, _o, cb) => cb({ message: 'npm ERR! enoent' }, '', 'npm ERR! enoent');
    const res = await runActionPlan([{ type: 'command', command: 'npm uninstall -g x', label: 'l' }], { execFunc });
    expect(res.ok).toBe(false);
    expect(res.sudoFailure).toBe(false);
  });

  test('a TOLERANT step (reveal) counts a non-zero exit as success', async () => {
    const execFunc = (_cmd, _o, cb) => cb({ message: 'Command failed: explorer … exit 1', stderr: '' }, '', '');
    const plain = await runActionPlan([{ type: 'command', command: 'x', label: 'l' }], { execFunc });
    expect(plain.ok).toBe(false);
    const tolerant = await runActionPlan([{ type: 'command', command: 'x', label: 'l', tolerant: true }], { execFunc });
    expect(tolerant).toEqual({ ok: true });
  });

  test('onStep reports each step right before it runs (live command display)', async () => {
    const seen = [];
    const steps = [
      { type: 'command', command: 'npm uninstall -g x', label: 'l1' },
      { type: 'deletePath', path: '/x', label: 'l2' },
    ];
    await runActionPlan(steps, {
      execFunc: (_c, _o, cb) => cb(null, '', ''),
      onStep: step => seen.push(step.command || `clean ${step.path}`),
    });
    expect(seen).toEqual(['npm uninstall -g x', 'clean /x']);
  });

  test('corrupt-metadata remove (cargo): the error-named binary is deleted, the plan continues', async () => {
    const BIN = 'C:\\Users\\u\\.cargo\\bin\\umux.exe';
    const stderr = `error: corrupt metadata, \`${BIN}\` does not exist when it should`;
    const seen = [];
    const execFunc = (cmd, _o, cb) => {
      seen.push(cmd);
      cb({ message: `Command failed: ${cmd}\n${stderr}`, stderr }, '', stderr);
    };
    const res = await runActionPlan([
      { type: 'command', command: 'cargo uninstall umux', label: 'l', fallbackSteps: [{ type: 'deletePath', path: 'C:\\fallback', label: 'lf' }] },
    ], { execFunc });
    expect(res).toEqual({ ok: true });          // NOT a failure — cleanup completed the removal
    expect(seen).toEqual(['cargo uninstall umux']); // uninstall failed, fallback was a deletePath (no exec)
  });

  test('corrupt metadata WITHOUT explicit fallbackSteps still extracts the path from the error', async () => {
    const BIN = 'C:\\Users\\u\\.cargo\\bin\\umux.exe';
    const stderr = `error: corrupt metadata, \`${BIN}\` does not exist when it should`;
    const deleted = [];
    const steps = [{ type: 'command', command: 'cargo uninstall umux', label: 'l' }];
    const res = await runActionPlan(steps, {
      execFunc: (_cmd, _o, cb) => cb({ message: `Command failed: cargo uninstall umux\n${stderr}`, stderr }, '', stderr),
      fs: { rmSync: p => deleted.push(p) },
    });
    expect(res).toEqual({ ok: true });
    expect(deleted).toEqual([BIN]);
  });

  test('winget "no upgrade found" (already latest, non-zero exit) is a benign NO-OP', async () => {
    const stderr = 'No available upgrade found.\nNo newer package versions are available from the configured sources.';
    const res = await runActionPlan(
      [{ type: 'command', command: 'winget upgrade --id GitHub.cli --exact', label: 'l' }],
      { execFunc: (_cmd, _o, cb) => cb({ message: `Command failed: winget upgrade\n${stderr}`, stderr }, '', stderr) },
    );
    expect(res).toEqual({ ok: true, noop: 'already-latest' });
  });

  test('a package NOT owned by the manager (bundled install) falls back to the ADM-known binary', async () => {
    // Git LFS bundled with Git for Windows never registers in winget — but
    // ADM owns it: the plan deletes the binary the scan found
    const deleted = [];
    const stdout = 'No installed package found matching input criteria.';
    const res = await runActionPlan(
      [{
        type: 'command', command: 'winget uninstall --id GitHub.GitLFS --exact', label: 'l',
        binPathFallback: [{ type: 'deletePath', path: 'C:\\Program Files\\Git\\bin\\git-lfs.exe', label: 'lf' }],
      }],
      {
        execFunc: (_cmd, _o, cb) => cb({ message: 'Command failed: winget uninstall' }, stdout, ''),
        fs: { rmSync: p => deleted.push(p) },
      },
    );
    expect(res).toEqual({ ok: true });
    expect(deleted).toEqual(['C:\\Program Files\\Git\\bin\\git-lfs.exe']);
  });

  test('NOT owned AND no known binary → an honest "not-managed" no-op (no fake removal)', async () => {
    const stdout = 'No installed package found matching input criteria.';
    const res = await runActionPlan(
      [{ type: 'command', command: 'winget uninstall --id GitHub.GitLFS --exact', label: 'l' }],
      { execFunc: (_cmd, _o, cb) => cb({ message: 'Command failed: winget uninstall' }, stdout, '') },
    );
    expect(res).toEqual({ ok: true, noop: 'not-managed' });
  });

  test('a deletePath EPERM (protected location) → blocked with the REAL delete command', async () => {
    const eperm = () => { const e = new Error("EPERM: operation not permitted, unlink 'C:\\x'"); e.code = 'EPERM'; throw e; };
    const res = await runActionPlan(
      [{ type: 'deletePath', path: 'C:\\Program Files\\Git\\bin\\git-lfs.exe', label: 'l' }],
      { fs: { rmSync: eperm } },
    );
    expect(res.ok).toBe(false);
    expect(res.sudoFailure).toBe(true);   // blocked path upstream (rights problem)
    // a real copyable command — never a raw path
    expect(res.command).toBe(process.platform === 'win32'
      ? "powershell -NoProfile -Command \"Remove-Item -Force 'C:\\Program Files\\Git\\bin\\git-lfs.exe'\""
      : 'rm -f "C:\\Program Files\\Git\\bin\\git-lfs.exe"');
  });

  test('buildActionPlan: a remove step carries the binary fallback for ADM-owned tools', () => {
    const plan = buildActionPlan('remove', entry('git-lfs', 'winget', 'C:\\Program Files\\Git\\bin\\git-lfs.exe'), null);
    expect(plan[0].command).toBe('winget uninstall --id GitHub.GitLFS --exact --accept-source-agreements --disable-interactivity');
    expect(plan[0].binPathFallback).toEqual([
      { type: 'deletePath', path: 'C:\\Program Files\\Git\\bin\\git-lfs.exe', label: expect.any(String) },
    ]);
  });

  test('winget elevation (UAC) errors classify as sudoFailure → blocked frame upstream', () => {
    expect(isSudoFailure({ stderr: 'Failed in attempting to elevate.' })).toBe(true);
    expect(isSudoFailure({ stderr: 'This command requires administrator rights to run.' })).toBe(true);
  });

  test('sudo detection reads STDOUT too — exec does not attach it to the error object', () => {
    // elevation text printed on stdout with an EMPTY stderr still blocks
    expect(isSudoFailure({ message: 'Command failed: winget uninstall', stdout: 'Failed in attempting to elevate.', stderr: '' })).toBe(true);
    expect(isSudoFailure({ message: 'Command failed: winget uninstall', stdout: '', stderr: '' })).toBe(false);
  });

  test('an unrelated failure does NOT trigger the fallback', async () => {
    const res = await runActionPlan([
      { type: 'command', command: 'cargo uninstall umux', label: 'l', fallbackSteps: [{ type: 'deletePath', path: 'C:\\fallback', label: 'lf' }] },
    ], { execFunc: (_cmd, _o, cb) => cb({ message: 'cargo: command not found', stderr: 'not found' }, '', 'not found') });
    expect(res.ok).toBe(false);
  });

  test('deletePath steps remove real files and directories (force: missing path is fine)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-ta-del-'));
    const dir = path.join(root, 'cache');
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nested', 'f'), 'x');
    const gone = path.join(root, 'never-existed');
    const res = await runActionPlan([
      { type: 'deletePath', path: dir, label: 'l1' },
      { type: 'deletePath', path: gone, label: 'l2' },
    ]);
    expect(res).toEqual({ ok: true });
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('applyActionToResult (auto-refresh after remove)', () => {
  const result = () => ({
    entries: [
      { id: 'a', source: 'adm' }, { id: 'b', source: 'npm' },
    ],
    groups: [
      { id: 'adm', entries: [{ id: 'a' }] },
      { id: 'npm', entries: [{ id: 'b' }] },
    ],
  });

  test('drops the entry from entries AND its group — no rescan', () => {
    const r = result();
    expect(applyActionToResult(r, 'a', 'remove')).toBe(true);
    expect(r.entries.map(e => e.id)).toEqual(['b']);
    expect(r.groups.find(g => g.id === 'adm').entries).toEqual([]);
  });

  test('removing an unknown id is a no-op returning false; other actions do nothing', () => {
    const r = result();
    expect(applyActionToResult(r, 'zz', 'remove')).toBe(false);
    expect(applyActionToResult(r, 'a', 'update')).toBe(false);
    expect(r.entries).toHaveLength(2);
  });
});

describe('refreshEntryAfterUpdate (auto-refresh after update)', () => {
  test('merges the fresh version from the probe and marks the entry updated', async () => {
    const r = {
      entries: [{ id: 'eslint', name: 'eslint', version: '9.0.0', binPath: '/bin/eslint', manager: 'npm' }],
      groups: [],
    };
    const probe = async key => ({ ok: true, entries: [{ id: 'eslint', version: '9.9.9', binPath: '/bin/eslint' }] });
    const res = await refreshEntryAfterUpdate(r, 'eslint', 'npm', { probe });
    expect(res).toEqual({ refreshed: true, version: '9.9.9' });
    expect(r.entries[0]).toMatchObject({ version: '9.9.9', updated: true });
  });

  test('a failed probe keeps the old values but still marks updated (action succeeded)', async () => {
    const r = {
      entries: [{ id: 'eslint', version: '9.0.0', binPath: '/bin/eslint', manager: 'npm' }],
      groups: [],
    };
    const res = await refreshEntryAfterUpdate(r, 'eslint', 'npm', { probe: async () => ({ ok: false, entries: [] }) });
    expect(res).toEqual({ refreshed: true, version: '9.0.0' });
    expect(r.entries[0]).toMatchObject({ version: '9.0.0', updated: true });
  });

  test('a missing entry (e.g. removed concurrently) → refreshed false', async () => {
    const r = { entries: [], groups: [] };
    const res = await refreshEntryAfterUpdate(r, 'ghost', 'npm', { probe: async () => ({ ok: true, entries: [] }) });
    expect(res).toEqual({ refreshed: false });
  });
});

describe('buildRevealCommand (Phase 5, ×3 platforms)', () => {
  // everything "exists" — the pure command matrix without fs involvement
  const alwaysExists = { statSync: () => ({ isFile: () => false }) };

  test('darwin selects the item in Finder', () => {
    expect(buildRevealCommand('darwin', '/opt/htop/bin/htop', { fs: alwaysExists }))
      .toBe('open -R "/opt/htop/bin/htop"');
  });

  test('win32 selects the item in Explorer', () => {
    expect(buildRevealCommand('win32', 'C:\\Tools\\htop.exe', { fs: alwaysExists }))
      .toBe('explorer /select,"C:\\Tools\\htop.exe"');
  });

  test('win32 normalizes POSIX separators and resolves to the nearest EXISTING ancestor', () => {
    // separator normalization: registry paths can carry forward slashes
    const alwaysExists = { statSync: () => ({ isFile: () => false }) };
    expect(buildRevealCommand('win32', 'C:/Tools/htop.exe', { fs: alwaysExists }))
      .toBe('explorer /select,"C:\\Tools\\htop.exe"');

    // a recorded path that no longer exists resolves UP to the existing dir —
    // revealing a missing path lands the user in a random default folder
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-ta-rev2-'));
    const gone = path.join(root, 'removed-dir', 'htop');
    const cmd = buildRevealCommand('win32', gone);
    expect(cmd).toBe(`explorer /select,"${root}"`);
    const existing = path.join(root, 'real.exe');
    fs.writeFileSync(existing, 'x');
    expect(buildRevealCommand('win32', existing)).toBe(`explorer /select,"${existing}"`);
  });

  test('linux opens the FOLDER: a file target resolves to its parent directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-ta-rev-'));
    const file = path.join(root, 'htop');
    fs.writeFileSync(file, 'x');
    expect(buildRevealCommand('linux', file)).toBe(`xdg-open "${root}"`);
    expect(buildRevealCommand('linux', root)).toBe(`xdg-open "${root}"`); // directory stays itself
  });

  test('unknown platform / empty target → null', () => {
    expect(buildRevealCommand('sunos', '/x')).toBeNull();
    expect(buildRevealCommand('linux', '')).toBeNull();
    expect(buildRevealCommand('linux', null)).toBeNull();
  });
});
