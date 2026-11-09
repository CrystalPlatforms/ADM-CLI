const { installEntry, executeInstall, refreshProcessPath, shExec, defaultShell, probeCommand } = require('../../../src/install/executor');

// execFunc stub: records the shell option for every command, answers by matcher.
function makeExec(handlers = []) {
  const calls = [];
  const execFunc = (command, opts, cb) => {
    calls.push({ command, shell: opts.shell });
    for (const h of handlers) {
      if (h.match.test(command)) { return cb(h.err, h.stdout || '', h.stderr || ''); }
    }
    cb(null, '', '');
  };
  return { execFunc, calls };
}

const NPM_ENTRY = {
  id: 'typescript', name: 'TypeScript', category: 'js-ts', method: 'npm',
  status: 'planned', command: 'npm install -g typescript@latest',
  statusSource: 'command -v typescript',
};

describe('executor.installEntry', () => {
  test('commands run through POSIX sh — the shell option is exactly "sh"', async () => {
    const { execFunc, calls } = makeExec();
    await installEntry(NPM_ENTRY, { execFunc, platform: 'linux', npmPrefixRepair: false });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.shell).toBe('sh');           // story 13: POSIX sh…
      expect(c.shell).not.toContain('/bin/bash'); // …never a bash hardcode
    }
  });

  test('already-installed tool → skipped (statusSource probe exits 0)', async () => {
    const { execFunc } = makeExec([
      { match: /command -v typescript/, err: null, stdout: '/usr/bin/typescript\n' },
    ]);
    const res = await installEntry(NPM_ENTRY, { execFunc, platform: 'linux' });
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('already installed');
  });

  test('successful install → installed + bin dir refreshed into process PATH', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-bin-'));
    const { execFunc } = makeExec([
      { match: /command -v typescript/, err: { code: 1 }, stdout: '', stderr: '' },
      { match: /npm install -g/, err: null, stdout: 'added 1 package' },
      { match: /npm config get prefix/, err: null, stdout: `${binDir}${path.sep}prefix\n` },
    ]);
    // Create the prefix bin dir so resolveBinDirs accepts it.
    const prefixBin = path.join(binDir, 'prefix', 'bin');
    fs.mkdirSync(prefixBin, { recursive: true });

    const env = { PATH: '/usr/bin:/bin' };
    const [res] = (await executeInstall([NPM_ENTRY], {
      execFunc, platform: 'linux', npmPrefixRepair: false, env, home: binDir, fs,
    })).results;
    const norm = s => String(s).replace(/\\/g, '/');
    expect(res.status).toBe('installed');
    // AC: the process PATH contains the tool's bin directory after install…
    expect(norm(env.PATH)).toContain(norm(prefixBin));
    // …with the new dirs FIRST (later installs see the new binary).
    expect(norm(env.PATH).startsWith(norm(prefixBin))).toBe(true);
    expect(res.binDirs.map(norm)).toContain(norm(prefixBin));
  });

  test('npm EACCES → prefix repair + one retry → installed', async () => {
    let npmInstallRuns = 0;
    const execRetry = (command, opts, cb) => {
      if (/command -v/.test(command)) return cb({ code: 1 }, '', ''); // not installed
      if (/npm install -g/.test(command)) {
        npmInstallRuns++;
        if (npmInstallRuns === 1) {
          return cb(new Error('Command failed'), '', 'npm ERR! code EACCES\nnpm ERR! permission denied');
        }
        return cb(null, 'added 1 package', '');
      }
      cb(null, '', '');
    };
    const repair = async () => ({ repaired: true, prefix: '/home/dev/.npm-global' });
    const res = await installEntry(NPM_ENTRY, { execFunc: execRetry, platform: 'linux', repairNpmPrefix: repair });
    expect(npmInstallRuns).toBe(2); // exactly ONE retry
    expect(res.status).toBe('installed');
    expect(res.note).toContain('~/.npm-global');
  });

  test('npm EACCES that survives the repair → failed + copyable hint', async () => {
    const execFail = (command, opts, cb) => {
      if (/command -v/.test(command)) return cb({ code: 1 }, '', '');
      if (/npm install -g/.test(command)) {
        return cb(new Error('Command failed'), '', 'npm ERR! code EACCES\nnpm ERR! permission denied');
      }
      cb(null, '', '');
    };
    const repair = async () => ({ repaired: true, prefix: '/home/dev/.npm-global' });
    const res = await installEntry(NPM_ENTRY, { execFunc: execFail, platform: 'linux', repairNpmPrefix: repair });
    expect(res.status).toBe('failed');
    expect(res.error).toContain('EACCES');
    expect(res.hint).toContain('npm config set prefix ~/.npm-global'); // ready-to-copy
  });

  test('plain failure → failed result with a hint that names the command', async () => {
    const { execFunc } = makeExec([
      { match: /command -v/, err: { code: 1 }, stdout: '', stderr: '' },
      { match: /npm install -g/, err: new Error('Command failed: npm'), stderr: 'network unreachable' },
    ]);
    const res = await installEntry(NPM_ENTRY, { execFunc, platform: 'linux', npmPrefixRepair: false });
    expect(res.status).toBe('failed');
    expect(res.command).toBe('npm install -g typescript@latest');
    expect(res.hint).toContain('npm install -g typescript@latest');
  });

  test('manual entry → failed with the reason as the hint', async () => {
    const res = await installEntry(
      { id: 'pyenv', name: 'pyenv', category: 'python', method: 'brew', status: 'manual', reason: 'pyenv is not in Debian/Ubuntu repos — install via script' },
      { execFunc: () => {} },
    );
    expect(res.status).toBe('failed');
    expect(res.hint).toContain('install via script');
  });

  test('link entry → skipped with the url', async () => {
    const res = await installEntry(
      { id: 'vscode-ext', name: 'VS Code ext', category: 'universal', method: 'link', status: 'link', url: 'https://example.com' },
      { execFunc: () => {} },
    );
    expect(res.status).toBe('skipped');
    expect(res.url).toBe('https://example.com');
  });
});

describe('executor.executeInstall', () => {
  test('runs sequentially, fires onStart/onProgress/onInstalled per tool', async () => {
    const events = [];
    const exec = (command, opts, cb) => {
      if (/command -v/.test(command)) return cb({ code: 1 }, '', '');
      cb(null, 'ok', '');
    };
    const entries = [
      { ...NPM_ENTRY, id: 'a', name: 'Tool A' },
      { ...NPM_ENTRY, id: 'b', name: 'Tool B' },
    ];
    const outcome = await executeInstall(entries, {
      execFunc: exec, platform: 'linux', npmPrefixRepair: false, fs: { accessSync: () => { throw new Error('none'); } },
      onStart: ({ tool }) => events.push(['start', tool.id]),
      onProgress: ({ tool, result }) => events.push(['progress', tool.id, result.status]),
      onInstalled: async (e) => events.push(['installed', e.id]),
    });
    expect(outcome.installed).toBe(2);
    expect(outcome.failed).toBe(0);
    expect(events).toEqual([
      ['start', 'a'], ['installed', 'a'], ['progress', 'a', 'installed'],
      ['start', 'b'], ['installed', 'b'], ['progress', 'b', 'installed'],
    ]);
  });

  test('mixed outcomes are counted (installed/skipped/failed)', async () => {
    const exec = (command, opts, cb) => {
      if (/command -v a/.test(command) || /command -v c/.test(command)) return cb({ code: 1 }, '', '');
      if (/command -v b/.test(command)) return cb(null, '/usr/bin/b', ''); // installed → skipped
      if (/install -g b/.test(command)) return cb(null, 'ok', '');
      if (/install -g c/.test(command)) return cb(new Error('Command failed'), '', 'boom');
      cb(null, '', '');
    };
    const entries = [
      { ...NPM_ENTRY, id: 'a', name: 'A', statusSource: 'command -v a', command: 'npm install -g a@latest' },
      { ...NPM_ENTRY, id: 'b', name: 'B', statusSource: 'command -v b', command: 'npm install -g b@latest' },
      { ...NPM_ENTRY, id: 'c', name: 'C', statusSource: 'command -v c', command: 'npm install -g c@latest' },
    ];
    const outcome = await executeInstall(entries, {
      execFunc: exec, platform: 'linux', npmPrefixRepair: false,
      fs: { accessSync: () => { throw new Error('none'); } },
    });
    expect(outcome.installed).toBe(1);
    expect(outcome.skipped).toBe(1);
    expect(outcome.failed).toBe(1);
  });
});

describe('executor.refreshProcessPath', () => {
  test('prepends new dirs, dedups, keeps existing order', () => {
    const env = { PATH: '/usr/bin:/bin' };
    const added = refreshProcessPath(['/new/bin', '/usr/bin'], { env, platform: 'linux' });
    expect(added).toEqual(['/new/bin']);
    expect(env.PATH).toBe('/new/bin:/usr/bin:/bin');
    const added2 = refreshProcessPath(['/new/bin', '/other'], { env, platform: 'linux' });
    expect(added2).toEqual(['/other']);
    expect(env.PATH).toBe('/other:/new/bin:/usr/bin:/bin');
  });

  test('windows uses Path + ";"', () => {
    const env = { Path: 'C:\\Windows' };
    refreshProcessPath(['C:\\adm\\bin'], { env, platform: 'win32' });
    expect(env.Path).toBe('C:\\adm\\bin;C:\\Windows');
  });
});

describe('executor.shExec contract', () => {
  test('resolves non-zero exits as code + stderr (never throws)', async () => {
    const res = await shExec('exit 3', { execFunc: (cmd, o, cb) => cb(Object.assign(new Error('failed'), { code: 3 }), '', 'boom') });
    expect(res.code).toBe(3);
    expect(res.stderr).toBe('boom');
  });

  test('Windows: default shell is cmd (true), not sh — no sh.exe requirement', async () => {
    const calls = [];
    const execFunc = (command, opts, cb) => { calls.push(opts.shell); cb(null, '', ''); };
    await installEntry(
      { id: 'curl', name: 'curl', category: 'universal', method: 'winget', status: 'planned', command: 'winget install --id curl --exact', statusSource: 'command -v curl' },
      { execFunc, platform: 'win32' },
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const shell of calls) {
      expect(shell).toBe(true); // cmd.exe via shell:true
      expect(shell).not.toBe('sh');
    }
  });

  test('Windows: status probe translates "command -v x" to "where x"', async () => {
    expect(probeCommand('command -v curl', 'win32')).toBe('where curl');
    expect(probeCommand('command -v rg', 'linux')).toBe('command -v rg');
    expect(defaultShell('win32')).toBe(true);
    expect(defaultShell('linux')).toBe('sh');
    const probes = [];
    const execFunc = (command, opts, cb) => {
      if (/^where /.test(command)) { probes.push(command); return cb(null, 'C:\\Windows\\System32\\curl.exe', ''); }
      probes.push(command);
      cb(null, '', '');
    };
    const ok = await installEntry(
      { id: 'curl', name: 'curl', category: 'universal', method: 'winget', status: 'planned', command: 'winget install --id curl', statusSource: 'command -v curl' },
      { execFunc, platform: 'win32' },
    );
    expect(probes[0]).toBe('where curl'); // probe used `where`, found it…
    expect(ok.status).toBe('skipped');    // …so nothing was (re)installed
    expect(probes.some(c => c.startsWith('command -v'))).toBe(false);
  });
});
