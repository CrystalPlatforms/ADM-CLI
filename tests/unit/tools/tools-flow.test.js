// #40 Phase 5: CI integration — a FICTITIOUS tool through the whole flow.
//
// Assumptions encoded by this test (stated before RED, 2026-11-12):
// - The fake tool is REAL on disk (a script on the injected PATH + a registry
//   entry with method 'go' + a fake cache dir) but the flow uses ZERO shell
//   commands: a 'go'-managed remove is a deletePath step, so the test is
//   fully portable across ubuntu/macos/windows (it runs inside the existing
//   CI npm-test matrix).
// - Flow: scanInventory finds the tool (registry attribution → ADM group,
//   the go bin scan fills binPath) → getToolInfo fills the panel bundle
//   (size, cache locations, flags — canReveal false on a headless PATH) →
//   buildActionPlan('remove', { includeConfigCache: true }) produces only
//   deletePath steps → runActionPlan deletes the files → applyActionToResult
//   drops the entry and buildView no longer renders it.
// - What is NOT tested here: real package-manager installs (out of scope)
//   and the TUI skin (covered by tools-tui.test.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanInventory } = require('../../../src/tools/inventory');
const { getToolInfo } = require('../../../src/tools/tool-info');
const { buildActionPlan, runActionPlan, applyActionToResult } = require('../../../src/tools/tool-actions');
const { buildPanel, buildView } = require('../../../src/tools/tools-tui');

describe('fictitious tool — full flow (scan → panel → remove → refresh)', () => {
  test('the fake tool is found, the panel fills, remove deletes it, the row refreshes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-flow-home-'));
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-flow-bin-'));
    const binPath = path.join(binDir, 'adm-fake-tool');
    fs.writeFileSync(binPath, '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(path.join(binDir, 'neighbor-tool'), '#!/bin/sh\nexit 0\n'); // keeps the list non-empty
    // manager-binary stub (own dir — NOT on the go-scan bin dir): capability
    // flags gate on the manager binary being reachable (canUpdate needs go;
    // canRemove of a go entry is a plain delete and needs no binary)
    const mgrDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-flow-mgr-'));
    fs.writeFileSync(path.join(mgrDir, 'go'), '#!/bin/sh\n');
    const cacheDir = path.join(home, '.cache', 'adm-fake-tool');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'cache.bin'), Buffer.alloc(64));

    const result = await scanInventory({
      registry: [{ id: 'adm-fake-tool', name: 'Fake Tool', method: 'go', installedAt: '2026-11-12T00:00:00.000Z' }],
      catalog: [{ id: 'adm-fake-tool', name: 'Fake Tool' }],
      env: { PATH: mgrDir },
      goBinDir: binDir,
      execFunc: (_cmd, _opts, cb) => cb(null, ''),
    });

    // 1. the scan finds it — registry attribution wins (ADM group), the go
    //    bin scan fills binPath
    const entry = result.entries.find(t => t.id === 'adm-fake-tool');
    expect(entry).toBeDefined();
    expect(entry.source).toBe('adm');
    expect(entry.manager).toBe('go');
    expect(entry.binPath).toBe(binPath);

    // 2. the panel fills: real size of the script, the cache location, flags
    const info = getToolInfo(entry, { platform: 'linux', home, env: { PATH: mgrDir } });
    expect(info.size).toBe(fs.statSync(binPath).size);
    expect(info.cachePaths).toEqual([cacheDir]);
    expect(info.flags).toEqual({ canUpdate: true, canRemove: true, hasCache: true, canReveal: false });
    const panel = buildPanel(info, { width: 40 }).join('\n');
    expect(panel).toContain('Fake Tool');
    expect(panel).toContain('B'); // a real size label, never "—"

    // 3. remove — a go-managed tool has no uninstall command: the plan is
    //    deletePath steps only (binary + checkbox config/cache cleanup),
    //    executed against the REAL fs with zero shell commands
    const plan = buildActionPlan('remove', entry, info, { includeConfigCache: true });
    expect(plan.every(s => s.type === 'deletePath')).toBe(true);
    const res = await runActionPlan(plan);
    expect(res).toEqual({ ok: true });
    expect(fs.existsSync(binPath)).toBe(false);
    expect(fs.existsSync(cacheDir)).toBe(false);

    // 4. the row refreshes: the entry is gone from the merged result and the
    //    view no longer renders it — no rescan
    expect(applyActionToResult(result, 'adm-fake-tool', 'remove')).toBe(true);
    expect(result.entries.find(t => t.id === 'adm-fake-tool')).toBeUndefined();
    const view = buildView(result, 0, new Set());
    const rendered = view.rows.join('\n');
    expect(rendered).not.toContain('Fake Tool');
    expect(rendered).not.toContain('adm-fake-tool');
    expect(rendered).toContain('neighbor-tool'); // the rest of the list survives
  });
});
