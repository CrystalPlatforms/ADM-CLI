const { runInstall } = require('../../../src/install/run');
const { readRegistry } = require('../../../src/setup/registry');

// Real install through the ADM_TOOLS surface (router: no ADM_DRY_RUN).
describe('runInstall', () => {
  const collect = (handlers = []) => {
    const calls = [];
    const execFunc = (command, opts, cb) => {
      calls.push({ command, shell: opts.shell });
      for (const h of handlers) {
        if (h.match.test(command)) return cb(h.err, h.stdout || '', h.stderr || '');
      }
      cb(null, '', '');
    };
    return { execFunc, calls };
  };

  test('unknown tool id → exit 1, message enumerates the valid set', async () => {
    const out = [];
    const code = await runInstall('nonesuch', { log: () => {}, err: s => out.push(s) });
    expect(code).toBe(1);
    const msg = out.join('\n');
    expect(msg).toContain('Unknown tool id in ADM_TOOLS: nonesuch');
    expect(msg).toContain('Valid tool ids:');
    expect(msg).toContain('typescript');
  });

  test('real run: installs a tool, appends the registry entry, exits 0', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-reg-'));
    const { execFunc } = collect([
      { match: /command -v typescript/, err: { code: 1 }, stdout: '', stderr: '' },
      { match: /npm install -g typescript/, err: null, stdout: 'added 1 package' },
      { match: /npm config get prefix/, err: null, stdout: '/home/dev/.npm-global\n' },
    ]);
    const out = [];
    const code = await runInstall('typescript', {
      log: s => out.push(s),
      err: () => {},
      execFunc,
      platform: 'linux',
      configDir,
      env: { PATH: '/usr/bin:/bin' }, // keep the refresh off the test process
      fs: { accessSync: p => { if (String(p).includes('.npm-global')) return; throw new Error('missing'); } },
    });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('✓ TypeScript — installed');
    // Registry (v0.4.0 groundwork) received the entry:
    const reg = readRegistry({ configDir });
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ id: 'typescript', name: 'TypeScript', method: 'npm' });
    expect(reg[0].installedAt).toBeTruthy();
  });

  test('rerun: everything already installed → all skipped, exit 0 (idempotency)', async () => {
    const { execFunc, calls } = collect([
      { match: /command -v/, err: null, stdout: '/usr/bin/tool\n' },
    ]);
    const out = [];
    const code = await runInstall('typescript', {
      log: s => out.push(s),
      err: () => {},
      execFunc,
      platform: 'linux',
      configDir: '/tmp/adm-run-test-unused',
    });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('skipped');
    expect(out.join('\n')).toContain('Done: 0 installed, 1 skipped, 0 failed.');
    // No install command was executed — only the status probes.
    expect(calls.every(c => c.command.startsWith('command -v'))).toBe(true);
  });

  test('failure → exit 2 with hint in the report', async () => {
    const { execFunc } = collect([
      { match: /command -v/, err: { code: 1 }, stdout: '', stderr: '' },
      { match: /npm install -g/, err: new Error('Command failed'), stderr: 'some fatal error' },
    ]);
    const out = [];
    const code = await runInstall('typescript', {
      log: s => out.push(s),
      err: () => {},
      execFunc,
      platform: 'linux',
      npmPrefixRepair: false,
    });
    expect(code).toBe(2);
    const text = out.join('\n');
    expect(text).toContain('✗ TypeScript — failed');
    expect(text).toContain('hint:');
    expect(text).toContain('Done: 0 installed, 0 skipped, 1 failed.');
  });
});
