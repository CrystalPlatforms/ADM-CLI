const fs = require('fs');
const os = require('os');
const path = require('path');
const { runInstall } = require('../../../src/install/run');

// Non-interactive consent (#44): ADM_TOOLS runs never ask. A tool whose
// ecosystem manager is missing gets ✗ with a reason + hint while the REST
// installs normally; a provider listed in ADM_TOOLS consents the run.

function fakeExec({ installed = [] } = {}) {
  const state = { installed };
  const calls = [];
  const execFunc = (command, opts, cb) => {
    calls.push(command);
    const probe = command.match(/(?:command -v|where) (\S+)/);
    if (probe) {
      return state.installed.includes(probe[1])
        ? cb(null, '/usr/bin/x', '')
        : cb({ code: 1 }, '', '');
    }
    if (/nvm which current/.test(command)) return cb(null, '/home/dev/.nvm/versions/node/v20/bin/node\n', '');
    if (/npm config get prefix/.test(command)) return cb(null, '/home/dev/.npm-global\n', '');
    if (/brew install (\S+)/.test(command)) state.installed.push(RegExp.$1);
    if (/nvm-sh\/nvm\/.*install\.sh/.test(command)) state.installed.push('node', 'npm');
    if (/npm install -g (\S+)/.test(command)) state.installed.push(RegExp.$1);
    cb(null, 'ok', '');
  };
  return Object.assign(execFunc, { calls });
}

describe('runInstall — non-interactive consent (#44)', () => {
  test('tracer: git,yarn without npm → git installs, yarn ✗ with reason + hint, exit 2', async () => {
    const out = [];
    const exec = fakeExec();
    const code = await runInstall('git,yarn', {
      log: s => out.push(s),
      err: () => {},
      execFunc: exec,
      platform: 'darwin',
      probeManagers: () => ({ brew: true, npm: false }),
      configDir: '/tmp/adm-run-consent-unused',
      env: { PATH: '/usr/bin:/bin' },
    });
    expect(code).toBe(2);
    const text = out.join('\n');
    expect(text).toContain('✓ Git — installed');
    expect(text).toMatch(/✗ Yarn — failed/);
    expect(text).toContain('requires npm (Node.js), which is not installed');
    expect(text).toContain('hint:');
    expect(text).toContain('run: ADM_TOOLS=node adm');
    expect(text).toContain('Done: 1 installed, 0 skipped, 1 failed.');
    // the blocked tool never executed an install command
    expect(exec.calls.some(c => /yarn/.test(c))).toBe(false);
  });

  test('listed provider consents: node,yarn → Node installs BEFORE yarn, exit 0', async () => {
    const out = [];
    const exec = fakeExec();
    const code = await runInstall('node,yarn', {
      log: s => out.push(s),
      err: () => {},
      execFunc: exec,
      platform: 'darwin',
      probeManagers: () => ({ brew: true, npm: false }),
      configDir: '/tmp/adm-run-consent-unused',
      env: { PATH: '/usr/bin:/bin' },
    });
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('✓ Node.js — installed');
    expect(text).toContain('✓ Yarn — installed');
    expect(text).toContain('Done: 2 installed, 0 skipped, 0 failed.');
    const nvmIdx = exec.calls.findIndex(c => /nvm-sh\/nvm\/.*install\.sh/.test(c));
    const yarnIdx = exec.calls.findIndex(c => /npm install -g yarn@latest/.test(c));
    expect(nvmIdx).toBeGreaterThan(-1);
    expect(yarnIdx).toBeGreaterThan(nvmIdx);
  });

  test('consents leave NO trace in the config dir (per-run only)', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-consent-run-'));
    const exec = fakeExec();
    await runInstall('git,yarn', {
      log: () => {},
      err: () => {},
      execFunc: exec,
      platform: 'darwin',
      probeManagers: () => ({ brew: true, npm: false }),
      configDir,
      env: { PATH: '/usr/bin:/bin' },
    });
    const files = [];
    const walk = dir => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(configDir);
    const everything = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    // the skip REASON may appear in the human report — what must not appear
    // is any recorded CONSENT (no approvals, no asked/declined markers)
    expect(everything).not.toMatch(/consent|approved|declined|asked/i);
    // the registry holds just the real install
    const registry = JSON.parse(fs.readFileSync(path.join(configDir, 'installed.json'), 'utf8'));
    expect(registry).toEqual([expect.objectContaining({ id: 'git', method: 'brew' })]);
  });
});
