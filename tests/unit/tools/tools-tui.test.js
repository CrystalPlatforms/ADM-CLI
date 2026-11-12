// #36 Phase 1 (tracer): the `adm tools` TUI — skin over scanInventory.
//
// Assumptions encoded by these tests (confirmed with the owner, 2026-11-12):
// - The TUI receives `scan`: (onProgress) => Promise<{ entries, groups }> —
//   the same scanInventory contract tested in inventory.test.js. The skin is
//   ONLY a renderer; all merge/warning logic lives in the neutral module.
// - Scan screen: current dots_12 frame (FRAMES from setup/loader.js, reuse —
//   attribution lives there) + "Scanning <done>/<total>…" counter. The frame
//   animation runs ONLY while scanning (owner fix: a repaint loop on the
//   static list made real terminals jitter).
// - After the scan resolves, the grouped list replaces the scan screen.
// - Selection: ↑/↓ move over headers AND tool rows (headers are selectable
//   so Enter has a target); the selected row renders red+bold with a '>'
//   marker — same style as the adm wizard (setup/prompts.js chalk.red.bold).
// - Enter/Space on a group header collapses/expands it; hidden rows are
//   skipped by ↑/↓ (plan Phase 2 AC pulled in on owner demand).
// - VIEWPORT (owner fix, scroll chaos): the list renders a WINDOW of rows
//   that starts at the TOP after the scan and follows the selection — the
//   terminal never scrolls to the bottom of a taller-than-screen list. A dim
//   hint line stays pinned below the window.
// - EMPTY GROUPS (owner decision): a group with no entries and no warning is
//   hidden; groups WITH a warning always render (the ⚠ explains why they're
//   empty).
// - RENDERER CONTRACT (owner fix, ConPTY): every frame is ONE atomic write —
//   absolute home (\x1b[H) + per-line clear (\x1b[K) + clear-to-end (\x1b[J),
//   inside the alternate screen buffer. ink's erase-lines repaints get
//   garbled by ConPTY exactly when the whole frame content shifts, so ADM
//   paints this screen like the rest of ADM (loader/wizard pattern).
// - `q` (and Ctrl+C) calls onExit AND stops the app — the runner maps a
//   clean exit to code 0.
//
// Rendering is fully synchronous per keypress — tests assert the LAST frame
// without sleeps. stdout/stdin are fakes (system boundaries — the only
// mocks here). Colors are OFF under jest except the red-selection test.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const { EventEmitter } = require('events');
const { createToolsApp, runToolsTui, buildView, buildPanel } = require('../../../src/tools/tools-tui');
const { scanInventory } = require('../../../src/tools/inventory');
const { FRAMES } = require('../../../src/setup/loader');

const strip = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const flush = () => new Promise(r => setImmediate(r));

// last complete frame = last atomic write (starts at \x1b[H)
function screenText(stdout) {
  const chunks = stdout.writes;
  return strip(chunks[chunks.length - 1] || '');
}
const linesOf = frame => frame.split('\n').map(l => l.split('│')[0].replace(/^>\s/, '').trim()).filter(Boolean);

// real inventory module behind the injected scan fn — the TUI contract is
// "whatever scanInventory returns", so tests go through the public interface.
// #37: the remaining manager probes are stubbed with SILENT SUCCESS (empty
// output → empty groups, no warnings) so the scan resolves synchronously and
// the frames stay the Phase 1 shape (ADM + npm + other only).
const scanFixtures = onProgress => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-path-'));
  fs.writeFileSync(path.join(binDir, 'fzf'), '#!/bin/sh\n'); // PATH-only hit → 'other'
  fs.writeFileSync(path.join(binDir, 'npm'), '#!/bin/sh\n'); // registry method stays reachable (healing keeps 'npm')
  const goBin = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-gobin-'));
  return scanInventory({
    registry: [{ id: 'typescript', name: 'TypeScript', method: 'npm', installedAt: '2026-01-01T00:00:00.000Z' }],
    npmJson: JSON.stringify({ dependencies: { eslint: { version: '9.0.0' } } }),
    catalog: [{ id: 'fzf', name: 'fzf' }],
    env: { PATH: binDir },
    execFunc: (cmd, _o, cb) => cb(null, ''),
    goBinDir: goBin,
    onProgress,
  });
};

function fakeStdout() {
  const writes = [];
  const stdout = new Writable({ write(c, _e, cb) { writes.push(String(c)); cb(); } });
  stdout.rows = 30;
  stdout.columns = 100;
  stdout.isTTY = true;
  stdout.writes = writes;
  return stdout;
}

function fakeStdin() {
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.setEncoding = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  return {
    stdin,
    press: s => stdin.emit('data', s),
  };
}

describe('tools TUI (skin)', () => {
  let app;
  afterEach(() => { if (app) { app.stop(); app = null; } });

  const mount = (props = {}) => {
    const stdout = fakeStdout();
    const inDev = fakeStdin();
    let exited = false;
    app = createToolsApp({
      scan: scanFixtures,
      stdout,
      stdin: inDev.stdin,
      onExit: () => { exited = true; },
      ...props,
    });
    app.run();
    return { stdout, inDev, exited: () => exited };
  };

  // #38: frames are TWO columns (list │ panel) — helpers look at the LIST side
  const rawLines = stdout => screenText(stdout).split('\n').map(l => l.split('│')[0].replace(/\s+$/, '')).filter(l => l.trim());

  test('scan screen animates dots_12 frames with a Scanning counter, then the list replaces it', async () => {
    let fireProgress, fireDone;
    const scan = onProgress => new Promise(resolve => {
      fireProgress = () => onProgress(45, 280);
      fireDone = () => resolve({ entries: [], groups: [] });
    });
    const t = mount({ scan });
    await flush(); // the scan promise starts on the next microtask

    let frame = screenText(t.stdout);
    expect(frame).toContain(FRAMES[0]);
    expect(frame).toContain('Scanning');

    fireProgress();
    frame = screenText(t.stdout);
    expect(frame).toContain('Scanning 45/280…');
    // the hint belongs to the LIST screen — never during scanning
    expect(frame).not.toContain('q quit');

    t.inDev.press('\x1b[B'); // a key mid-scan must not crash the scan screen
    await flush();

    fireDone();
    await flush();
    frame = screenText(t.stdout);
    expect(frame).not.toMatch(/scanning/i);
  });

  test('dots_12 animation advances while scanning (real timer cadence)', async () => {
    const scan = () => new Promise(() => {}); // never resolves — scan screen forever
    const t = mount({ scan });

    expect(screenText(t.stdout)).toContain(FRAMES[0]);
    await new Promise(r => setTimeout(r, 100)); // one 80 ms tick
    const after = screenText(t.stdout);
    expect(after).not.toContain(FRAMES[0]);
    expect(FRAMES.some(f => after.includes(f))).toBe(true);
  });

  test('resolved scan renders the grouped list; empty groups without warnings are hidden', async () => {
    const t = mount();
    await flush();
    await flush();

    const lines = linesOf(screenText(t.stdout));
    expect(lines.some(l => l.includes('TypeScript'))).toBe(true);
    expect(lines.some(l => l.includes('eslint'))).toBe(true);
    expect(lines.some(l => l.includes('fzf'))).toBe(true);
    // only groups WITH content (or a warning) render
    const headers = ['ADM (1) ▾', 'npm (1) ▾', 'other (1) ▾'];
    const idx = headers.map(h => lines.findIndex(l => l === h));
    expect(idx.every(i => i >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(lines.some(l => l.includes('brew'))).toBe(false);
    expect(lines.some(l => l.includes('cargo'))).toBe(false);
    // pinned hint line (discoverable keys)
    expect(lines.some(l => l.includes('↑↓ move') && l.includes('q quit'))).toBe(true);
  });

  test('a failed ADM registry renders its warning row; a MISSING manager stays silent (hidden)', async () => {
    const scan = onProgress => scanInventory({
      // no registry fixture → real read path: missing file → warning (as in production)
      configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-empty-')),
      catalog: [],
      execFunc: (cmd, opts, cb) => cb(new Error('spawn npm ENOENT'), ''),
      onProgress,
    });
    const t = mount({ scan });
    await flush();
    await flush();

    const frame = screenText(t.stdout);
    // the ADM registry is adm's own bookkeeping — missing it warns
    expect(frame).toContain('ADM (0)');
    expect(frame).toContain('ADM registry not found — ADM-installed tools not listed');
    // a MISSING manager is normal (owner policy) — empty AND silent → hidden
    expect(frame).not.toContain('npm (0)');
    expect(frame).not.toContain('brew (0)');
  });

  test('the list is static — zero paints between keypresses once the scan finishes', async () => {
    const t = mount();
    await flush();
    await flush();

    const count = t.stdout.writes.length;
    await new Promise(r => setTimeout(r, 250)); // loader interval would paint here
    expect(t.stdout.writes.length).toBe(count);

    t.inDev.press('\x1b[B'); // a key paints exactly once
    expect(t.stdout.writes.length).toBe(count + 1);
  });

  test('every frame is one atomic write: absolute home, per-line clears, pinned hint', async () => {
    const t = mount();
    await flush();
    await flush();

    t.inDev.press('\x1b[B');
    const last = t.stdout.writes[t.stdout.writes.length - 1];
    expect(last.startsWith('\x1b[H')).toBe(true);
    expect(last).toContain('\x1b[K');
    expect(last).toContain('\x1b[J');
    expect(last).toContain('q quit');
  });

  test('viewport starts at the top and follows the selection (scroll-with-hover)', async () => {
    const t = mount({ viewportRows: 3 });
    await flush();
    await flush();

    // START AT THE TOP: first row visible, later rows not rendered at all
    expect(rawLines(t.stdout)).toContain('> ADM (1) ▾');
    expect(screenText(t.stdout)).not.toContain('fzf');

    // ↓×4 → selection on 'other' header; window shifted down with it
    for (let i = 0; i < 4; i += 1) {
      t.inDev.press('\x1b[B');
      await flush();
    }
    expect(rawLines(t.stdout)).toContain('> other (1) ▾');
    expect(screenText(t.stdout)).not.toContain('ADM');

    // ↓ → last row; selection pinned inside the window
    t.inDev.press('\x1b[B');
    await flush();
    expect(rawLines(t.stdout)).toContain('> fzf');
    expect(screenText(t.stdout)).not.toContain('TypeScript');
  });

  test('↑↓ move the selection across headers and tool rows; q exits cleanly', async () => {
    const t = mount();
    await flush();
    await flush();

    // Visible rows: ADM hdr · TypeScript · npm hdr · eslint · other hdr · fzf
    expect(rawLines(t.stdout)).toContain('> ADM (1) ▾');
    expect(rawLines(t.stdout)).toContain('  TypeScript');

    t.inDev.press('\x1b[B'); // ↓ → TypeScript
    expect(rawLines(t.stdout)).toContain('> TypeScript');
    expect(rawLines(t.stdout)).toContain('  ADM (1) ▾');

    t.inDev.press('\x1b[B'); // ↓ → npm header
    expect(rawLines(t.stdout)).toContain('> npm (1) ▾');

    t.inDev.press('\x1b[B'); // ↓ → eslint
    expect(rawLines(t.stdout)).toContain('> eslint');

    t.inDev.press('\x1b[B'); // ↓ → other header
    expect(rawLines(t.stdout)).toContain('> other (1) ▾');

    t.inDev.press('\x1B[A'); // ↑ → back to eslint
    expect(rawLines(t.stdout)).toContain('> eslint');

    t.inDev.press('q');
    expect(t.exited()).toBe(true);
    expect(app.isDead()).toBe(true);
  });

  test('viewport + warning rows: the marker stays visible at the window edge (rows ≠ selectable count)', async () => {
    // regression: the ⚠ warning row occupies a FRAME row but is NOT
    // selectable — with a warning present (real runs: missing registry), the
    // slice-by-frame-rows used to push the selected row outside the window
    const scan = onProgress => {
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-warn-'));
      const catalog = [];
      for (let i = 1; i <= 30; i += 1) {
        catalog.push({ id: `tool${i}`, name: `Tool ${i}` });
        fs.writeFileSync(path.join(binDir, `tool${i}`), 'x');
      }
      return scanInventory({
        configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-warn-empty-')), // missing → ⚠
        npmJson: JSON.stringify({ dependencies: { pkg: { version: '1.0.0' } } }),
        catalog,
        env: { PATH: binDir },
        execFunc: (cmd, _o, cb) => cb(null, ''),
        goBinDir: fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-warn-gobin-')),
        onProgress,
      });
    };
    const t = mount({ scan, viewportRows: 4 });
    await flush();
    await flush();

    // rows: ADM hdr · ⚠ · npm hdr · pkg · other hdr · Tool 1..30
    // walk INTO the other group and down to the window's bottom edge
    for (let i = 0; i < 8; i += 1) {
      t.inDev.press('\x1b[B');
      await flush();
    }
    // selection sits on Tool 3-ish INSIDE a 4-row window that also carries
    // the ⚠ row — the marker must still be on screen
    const frame = screenText(t.stdout);
    const marked = frame.split('\n').filter(l => l.startsWith('> '));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('Tool');
  });

  test('a lying stdout.rows (screen-buffer height) still scrolls: window is hard-capped', async () => {
    // regression: Windows consoles can report the SCREEN BUFFER height
    // (hundreds/thousands of rows) as stdout.rows. The frame then outgrows
    // the VISIBLE window — the marker walks below it and the list never
    // scrolls. The window height must be capped.
    const scan = onProgress => {
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-rows-'));
      const catalog = [];
      for (let i = 1; i <= 40; i += 1) {
        catalog.push({ id: `tool${i}`, name: `Tool ${i}` });
        fs.writeFileSync(path.join(binDir, `tool${i}`), 'x');
      }
      return scanInventory({
        registry: [],
        npmJson: JSON.stringify({ dependencies: {} }),
        catalog,
        env: { PATH: binDir },
        execFunc: (cmd, _o, cb) => cb(null, ''),
        goBinDir: fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-rows-gobin-')),
        onProgress,
      });
    };
    const stdout = fakeStdout();
    stdout.rows = 9999; // lying console
    const inDev = fakeStdin();
    app = createToolsApp({ scan, stdout, stdin: inDev.stdin });
    app.run();
    await flush();
    await flush();

    // capped window: the tail of the list is NOT on screen initially
    expect(screenText(stdout)).not.toContain('Tool 40');

    // walking down past the cap scrolls the window
    for (let i = 0; i < 25; i += 1) inDev.press('\x1b[B');
    const marked = screenText(stdout).split('\n').filter(l => l.startsWith('> '));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('Tool');
    expect(screenText(stdout)).not.toContain('  Tool 1\n');
  });

  test('the window can show up to 50 rows on tall terminals', async () => {
    const scan = onProgress => {
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-tall-'));
      const catalog = [];
      for (let i = 1; i <= 60; i += 1) {
        catalog.push({ id: `tool${i}`, name: `Tool ${i}` });
        fs.writeFileSync(path.join(binDir, `tool${i}`), 'x');
      }
      return scanInventory({
        registry: [],
        npmJson: JSON.stringify({ dependencies: {} }),
        catalog,
        env: { PATH: binDir },
        execFunc: (cmd, _o, cb) => cb(null, ''),
        goBinDir: fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-tall-gobin-')),
        onProgress,
      });
    };
    const stdout = fakeStdout();
    stdout.rows = 60;
    const inDev = fakeStdin();
    app = createToolsApp({ scan, stdout, stdin: inDev.stdin });
    app.run();
    await flush();
    await flush();

    const frame = screenText(stdout);
    expect(frame).toContain('Tool 45');      // inside the 50-row window
    expect(frame).not.toContain('Tool 55');  // beyond the cap — scroll to it
  });

  test('the hint line is pinned to the last terminal row, whatever the list length', async () => {
    const t = mount(); // fakeStdout reports rows = 30
    await flush();
    await flush();

    const frame = t.stdout.writes[t.stdout.writes.length - 1];
    expect(frame).toContain('\x1b[30;1H'); // absolute position: row 30 = last
    const pinAt = frame.indexOf('\x1b[30;1H');
    expect(frame.indexOf('↑↓ move')).toBeGreaterThan(pinAt); // hint written there
  });

  test('Enter/Space on a group header collapses and expands it; hidden rows are skipped', async () => {
    const t = mount();
    await flush();
    await flush();

    t.inDev.press('\x1b[B'); // ↓ → TypeScript
    t.inDev.press('\x1b[B'); // ↓ → npm header
    expect(rawLines(t.stdout)).toContain('> npm (1) ▾');

    t.inDev.press('\r'); // Enter → collapse npm
    expect(rawLines(t.stdout)).toContain('> npm (1) ▸');
    expect(rawLines(t.stdout)).not.toContain('  eslint');

    t.inDev.press('\x1b[B'); // ↓ → skips hidden eslint, lands on other
    expect(rawLines(t.stdout)).toContain('> other (1) ▾');

    t.inDev.press('\x1B[A'); // ↑ → back to the npm header (still collapsed)
    expect(rawLines(t.stdout)).toContain('> npm (1) ▸');

    t.inDev.press(' '); // Space → expand npm again
    expect(rawLines(t.stdout)).toContain('  eslint');
    expect(rawLines(t.stdout)).toContain('> npm (1) ▾'); // selection did not move
  });

  test('group headers ALWAYS render green #167c51; bold only while selected (hover)', async () => {
    const chalk = require('chalk');
    const prev = chalk.level;
    chalk.level = 3; // truecolor — deterministic escape bytes (#167c51 = 22;124;81)
    try {
      const t = mount();
      await flush();
      await flush();
      const GREEN = '\x1b[38;2;22;124;81m';
      const frame = t.stdout.writes[t.stdout.writes.length - 1];
      // selected header (hover): green + bold + pointer
      expect(frame).toContain(GREEN);
      expect(frame).toContain('\x1b[1m');
      expect(strip(frame)).toContain('> ADM (1) ▾');

      // selection moved onto a tool row: the header stays green but is NOT bold
      t.inDev.press('\x1b[B');
      const f2 = t.stdout.writes[t.stdout.writes.length - 1];
      const admLine = f2.split('\n').find(l => strip(l).includes('ADM (1) ▾'));
      expect(admLine).toContain(GREEN);
      // assert the LIST column only — the panel column carries its own styling
      expect(admLine.split('│')[0]).not.toContain('\x1b[1m');
    } finally {
      chalk.level = prev;
    }
  });

  test('selected tool row renders red+bold like the adm wizard pointer', async () => {
    const chalk = require('chalk');
    const prev = chalk.level;
    chalk.level = 2; // wizard-style colors ON for this test only (setup forces 0)
    try {
      const t = mount();
      await flush();
      await flush();
      t.inDev.press('\x1b[B'); // onto the TypeScript tool row
      const frame = t.stdout.writes[t.stdout.writes.length - 1];
      expect(frame).toContain('\x1b[31m'); // red
      expect(frame).toContain('\x1b[1m');  // bold
      expect(strip(frame)).toContain('> TypeScript'); // the pointer row is the selected one
    } finally {
      chalk.level = prev;
    }
  });

  test('Ctrl+C exits the same way as q (never traps the user in raw mode)', () => {
    const t = mount();
    t.inDev.press('\u0003'); // Ctrl+C
    expect(t.exited()).toBe(true);
  });

  test('runToolsTui runs FULLSCREEN: alternate screen buffer in, restored out', async () => {
    const stdout = fakeStdout();
    const inDev = fakeStdin();
    const done = runToolsTui({
      tty: true,
      stdout,
      stdin: inDev.stdin,
      scan: scanFixtures,
    });
    await flush();
    await flush();
    inDev.press('q'); // the user quits — the runner resolves 0
    const code = await done;
    const writes = stdout.writes;
    expect(code).toBe(0);
    expect(writes[0]).toContain('\x1b[?1049h'); // alt screen ON first
    const restore = writes[writes.length - 1];
    expect(restore).toContain('\x1b[?1049l');   // alt buffer restored…
    expect(restore).toContain('\x1b[?25h');     // …and cursor visible again
  });

  test('runToolsTui without a TTY exits 1 with a notice, never renders', async () => {
    const errLines = [];
    const code = await runToolsTui({ tty: false, err: s => errLines.push(s) });
    expect(code).toBe(1);
    expect(errLines.join('\n')).toContain('needs a terminal');
  });

  // ---- #37 Phase 2: rescan (F5 / Shift+R; lowercase r NEVER rescans) ----

  const mountCountingScan = () => {
    let calls = 0;
    let pending = []; // gates armed by deferNext() — the next scan waits on one
    const scan = onProgress => {
      calls += 1;
      const run = () => scanFixtures(onProgress);
      if (pending.length > 0) return pending.shift().then(run);
      return Promise.resolve(run());
    };
    return {
      mount: () => mount({ scan }),
      calls: () => calls,
      deferNext: () => {
        let release;
        pending.push(new Promise(res => { release = res; }));
        return release; // sync gate fn
      },
    };
  };

  test('F5 triggers a full rescan: loader returns, scan runs again, cursor resets to top', async () => {
    const c = mountCountingScan();
    const t = c.mount();
    await flush();
    await flush();
    expect(c.calls()).toBe(1);
    expect(screenText(t.stdout)).toContain('rescan'); // hint advertises the new keys

    t.inDev.press('\x1b[B'); // selection moves off the top
    expect(rawLines(t.stdout)).toContain('> TypeScript');

    const gate = c.deferNext(); // hold the SECOND scan open
    t.inDev.press('\x1b[15~'); // F5
    await flush();
    expect(c.calls()).toBe(2);
    expect(screenText(t.stdout)).toContain('Scanning'); // loader replaces the list

    t.inDev.press('\x1b[15~'); // F5 during an in-flight scan is a no-op
    await flush();
    expect(c.calls()).toBe(2);

    gate(); // release the second scan
    await flush();
    await flush();
    expect(rawLines(t.stdout)).toContain('> ADM (1) ▾'); // cursor reset to top
    expect(screenText(t.stdout)).toContain('TypeScript'); // fresh list rendered
  });

  test('Shift+R triggers the same full rescan', async () => {
    const c = mountCountingScan();
    const t = c.mount();
    await flush();
    await flush();
    t.inDev.press('R');
    await flush();
    expect(c.calls()).toBe(2);
    await flush();
    await flush();
    expect(screenText(t.stdout)).toContain('TypeScript'); // list is back
  });

  test('lowercase r does NOT rescan (reserved for remove in Phase 4)', async () => {
    const c = mountCountingScan();
    const t = c.mount();
    await flush();
    await flush();
    t.inDev.press('r');
    await flush();
    await flush();
    expect(c.calls()).toBe(1);
    expect(screenText(t.stdout)).toContain('TypeScript'); // still the list, no loader
  });

  test('buildView (model): a collapsed group keeps its header + count but drops rows and selectable positions', () => {
    const result = {
      groups: [
        { id: 'npm', label: 'npm', entries: [{ id: 'eslint', name: 'eslint' }], warning: null },
        { id: 'other', label: 'other', entries: [{ id: 'fzf', name: 'fzf' }], warning: null },
      ],
    };
    const open = buildView(result, 0, new Set());
    expect(open.rows).toHaveLength(4); // hdr + eslint + hdr + fzf
    expect(open.selectable).toHaveLength(4);

    const collapsed = buildView(result, 0, new Set(['npm']));
    expect(collapsed.rows).toHaveLength(3); // npm hdr + other hdr + fzf
    expect(collapsed.rows[0]).toContain('npm (1) ▸'); // count stays, arrow flips
    expect(collapsed.rows.join('\n')).not.toContain('eslint');
    expect(collapsed.selectable.map(s => s.id)).toEqual(['npm', 'other', 'fzf']);
  });

  // ---- #38 Phase 3: the side panel (lazy tool-info + capability flags) ----

  // Tool-info fakes (the TUI receives the real getToolInfo in production).
  const richInfo = entry => ({
    id: entry.id, name: entry.name,
    version: '5.4.5', binPath: `/usr/bin/${entry.id}`, method: 'npm',
    size: 1572864, sizeLabel: '1.5 MB',
    configPaths: [`~/.config/${entry.id}`], cachePaths: [`~/.cache/${entry.id}`], docsPaths: [],
    flags: { canUpdate: true, canRemove: true, hasCache: true, canReveal: true },
  });
  const sparseInfo = entry => ({
    id: entry.id, name: entry.name,
    version: null, binPath: null, method: null,
    size: null, sizeLabel: null,
    configPaths: [], cachePaths: [], docsPaths: [],
    flags: { canUpdate: false, canRemove: false, hasCache: false, canReveal: false },
  });

  test('panel fills LAZILY: zero tool-info calls during scan or on headers, one per tool selection', async () => {
    const calls = [];
    const t = mount({
      toolInfo: e => { calls.push(e.id); return richInfo(e); },
    });
    await flush();
    await flush();
    // scan done, cursor sits on the ADM HEADER — nothing computed yet
    expect(calls).toEqual([]);

    t.inDev.press('\x1b[B'); // onto TypeScript
    expect(calls).toEqual(['typescript']);

    t.inDev.press('\x1b[B'); // npm header — placeholder again, no call
    t.inDev.press('\x1b[B'); // eslint
    expect(calls).toEqual(['typescript', 'eslint']);
  });

  test('headers keep the panel as a placeholder until a tool row is selected', async () => {
    const t = mount({ toolInfo: richInfo });
    await flush();
    await flush();
    expect(screenText(t.stdout)).toContain('select a tool');
  });

  test('panel shows the selected tool data: name, version, path, method, size, locations, legend', async () => {
    // a wide terminal so long paths fit the panel column without clipping
    const stdout = fakeStdout();
    stdout.columns = 130;
    const inDev = fakeStdin();
    app = createToolsApp({ scan: scanFixtures, stdout, stdin: inDev.stdin, toolInfo: richInfo });
    app.run();
    await flush();
    await flush();
    inDev.press('\x1b[B'); // TypeScript
    const frame = screenText(stdout);
    expect(frame).toContain('TypeScript');
    expect(frame).toContain('5.4.5');
    // the panel is a narrow strip by owner design (~20 cols min) — long
    // values CLIP with '…'; full values live in the tool-info bundle itself
    expect(frame).toContain('/usr/bin/');
    expect(frame).toContain('npm');
    expect(frame).toContain('1.5 MB');
    expect(frame).toContain('~/.config');
    expect(frame).toContain('~/.cache');
    expect(frame).toMatch(/docs\s+—/); // empty docs → gap marker
    expect(frame).toContain('(u) update');
    expect(frame).toContain('(f) folder');
    expect(frame).toContain('(c) cache');
  });

  test('missing data renders "—" and the legend dims EXACTLY per flags', async () => {
    const chalk = require('chalk');
    const prev = chalk.level;
    chalk.level = 2; // dim codes visible (setup forces 0)
    try {
      const t = mount({ toolInfo: sparseInfo });
      await flush();
      await flush();
      t.inDev.press('\x1b[B'); // a tool with every gap
      const lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      const gap = lines.find(l => l.includes('version'));
      expect(gap).toContain('—');
      for (const key of ['(u) update', '(r) remove', '(f) folder', '(c) cache']) {
        const line = lines.find(l => l.includes(key));
        expect(line.split('│')[1]).toContain('\x1b[2m'); // panel side: dimmed
      }
    } finally {
      chalk.level = prev;
    }
  });

  test('an active legend line renders WITHOUT dim codes (flags true)', async () => {
    const chalk = require('chalk');
    const prev = chalk.level;
    chalk.level = 2;
    try {
      const t = mount({ toolInfo: richInfo });
      await flush();
      await flush();
      t.inDev.press('\x1b[B');
      const lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      const line = lines.find(l => l.includes('(u) update'));
      expect(line.split('│')[1]).not.toContain('\x1b[2m'); // panel side: active — not dimmed
    } finally {
      chalk.level = prev;
    }
  });

  test('↑↓ moves the panel to the selected tool WITHOUT rescanning or reloading the list', async () => {
    let scans = 0;
    const scan = onProgress => { scans += 1; return scanFixtures(onProgress); };
    const t = mount({ scan, toolInfo: e => ({ ...richInfo(e), name: `PANEL-${e.id}` }) });
    await flush();
    await flush();
    expect(scans).toBe(1);

    t.inDev.press('\x1b[B'); // TypeScript
    let frame = screenText(t.stdout);
    expect(frame).toContain('PANEL-typescript');
    expect(frame).toContain('> TypeScript'); // list row still there

    t.inDev.press('\x1b[B'); // npm header
    t.inDev.press('\x1b[B'); // eslint
    frame = screenText(t.stdout);
    expect(frame).toContain('PANEL-eslint');   // panel followed the selection…
    expect(frame).toContain('TypeScript');     // …while the list rows stayed
    expect(scans).toBe(1);                     // no rescan, no list reload
  });

  test('the panel column starts at ~85% of the terminal (owner fix, round 4)', async () => {
    // owner keeps pushing the separator right: 40% → 55% → 70% → 75% → ~85%.
    // The panel keeps a hard minimum (~20 cols) so the buttons still fit.
    const stdout = fakeStdout();
    stdout.columns = 100;
    const inDev = fakeStdin();
    app = createToolsApp({ scan: scanFixtures, stdout, stdin: inDev.stdin, toolInfo: richInfo });
    app.run();
    await flush();
    await flush();
    inDev.press('\x1b[B'); // a tool row → panel filled
    const firstLine = screenText(stdout).split('\n')[0];
    const sepIdx = firstLine.indexOf('│');
    expect(sepIdx).toBeGreaterThanOrEqual(79);
    expect(sepIdx).toBeLessThanOrEqual(84);
    // buttons never clip out of the panel column
    const buttonLine = screenText(stdout).split('\n').find(l => l.includes('(u) update'));
    expect(strip(buttonLine).indexOf('(u) update')).toBeGreaterThan(sepIdx);
  });

  test('⚠ warning rows KEEP the panel separator (owner fix: the │ went missing there)', async () => {
    const scan = onProgress => {
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-sep-'));
      return scanInventory({
        configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-sep-empty-')), // ⚠ ADM registry
        npmJson: 'not json at all', // ⚠ npm group
        catalog: [],
        env: { PATH: binDir },
        execFunc: (cmd, _o, cb) => cb(null, ''),
        goBinDir: fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-sep-gobin-')),
        onProgress,
      });
    };
    const t = mount({ scan, toolInfo: sparseInfo });
    await flush();
    await flush();
    const frame = t.stdout.writes[t.stdout.writes.length - 1];
    const warnLine = frame.split('\n').find(l => l.includes('⚠'));
    expect(warnLine).toBeTruthy();
    expect(warnLine).toContain('│'); // the separator survives on ⚠ lines
  });

  test('legend renders as BUTTONS "(u) update" (owner UX, round 1)', async () => {
    const t = mount({ toolInfo: richInfo });
    await flush();
    await flush();
    t.inDev.press('\x1b[B'); // a tool → panel with buttons
    const frame = screenText(t.stdout);
    expect(frame).toContain('(u) update');
    expect(frame).toContain('(r) remove');
    expect(frame).toContain('(f) folder');
    expect(frame).toContain('(c) cache');
  });

  test('→ moves the hover onto the update button; ↑↓ cycle r/f/c; ← returns to the list', async () => {
    const chalk = require('chalk');
    const prev = chalk.level;
    chalk.level = 2;
    try {
      const t = mount({ toolInfo: richInfo });
      await flush();
      await flush();
      t.inDev.press('\x1b[B'); // tool hovered in the list
      expect(strip(screenText(t.stdout))).toContain('> TypeScript');

      t.inDev.press('\x1b[C'); // → hover jumps to the (u) update button
      let lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      const ub = lines.find(l => l.includes('(u) update'));
      expect(strip(ub)).toContain('> (u) update');       // pointer on the button
      expect(ub.split('│')[1]).toContain('\x1b[1m');         // focused = bold
      // the list keeps its marker but loses the bold hover style
      const tsLine = lines.find(l => strip(l).includes('> TypeScript'));
      expect(tsLine.split('│')[0]).not.toContain('\x1b[1m');

      t.inDev.press('\x1b[B'); // ↓ → (r) remove
      lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      expect(strip(lines.find(l => l.includes('(r) remove')))).toContain('> (r) remove');

      t.inDev.press('\x1b[B'); // ↓ → (f) folder
      lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      expect(strip(lines.find(l => l.includes('(f) folder')))).toContain('> (f) folder');

      t.inDev.press('\x1b[A'); // ↑ back to (r)
      lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      expect(strip(lines.find(l => l.includes('(r) remove')))).toContain('> (r) remove');

      t.inDev.press('\x1b[D'); // ← returns the hover to the list
      const backLine = t.stdout.writes[t.stdout.writes.length - 1].split('\n').find(l => strip(l).includes('> TypeScript'));
      expect(backLine.split('│')[0]).toContain('\x1b[1m'); // list hovered (bold) again
      lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      expect(strip(lines.find(l => l.includes('(u) update')))).not.toContain('> (');
    } finally {
      chalk.level = prev;
    }
  });

  test('the hover SKIPS dimmed buttons; with every button dimmed → stays on the list (owner fix)', async () => {
    const chalk = require('chalk');
    const prev = chalk.level;
    chalk.level = 2;
    try {
      // u + r enabled, f + c dimmed
      const partialInfo = entry => ({
        ...richInfo(entry),
        flags: { canUpdate: true, canRemove: true, canReveal: false, hasCache: false },
      });
      const t = mount({ toolInfo: partialInfo });
      await flush();
      await flush();
      t.inDev.press('\x1b[B'); // tool hovered
      t.inDev.press('\x1b[C'); // → lands on the FIRST ENABLED button (u)
      let lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      expect(strip(lines.find(l => l.includes('(u) update')))).toContain('> (u) update');

      t.inDev.press('\x1b[B'); // ↓ → r (enabled)
      lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      expect(strip(lines.find(l => l.includes('(r) remove')))).toContain('> (r) remove');

      t.inDev.press('\x1b[B'); // ↓ skips dimmed f and c, wraps back to u
      lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      expect(strip(lines.find(l => l.includes('(u) update')))).toContain('> (u) update');

      t.inDev.press('\x1b[A'); // ↑ skips f and c backwards → r
      lines = t.stdout.writes[t.stdout.writes.length - 1].split('\n');
      expect(strip(lines.find(l => l.includes('(r) remove')))).toContain('> (r) remove');

      // EVERY button dimmed → → never leaves the list
      const t2 = mount({ toolInfo: sparseInfo });
      await flush();
      await flush();
      t2.inDev.press('\x1b[B'); // tool hovered
      t2.inDev.press('\x1b[C'); // → nothing to focus — list keeps the hover
      const l2 = t2.stdout.writes[t2.stdout.writes.length - 1].split('\n');
      const ts2 = l2.find(l => strip(l).includes('> TypeScript'));
      expect(ts2.split('│')[0]).toContain('\x1b[1m'); // list still bold (hovered)
      const ub2 = l2.find(l => l.includes('(u) update'));
      expect(strip(ub2)).not.toContain('> (');        // no pointer on buttons
    } finally {
      chalk.level = prev;
    }
  });

  test('buildPanel (model): gaps become "—", legend lines map 1:1 to flags', () => {
    const rich = buildPanel(richInfo({ id: 'x', name: 'X' }), { width: 40 });
    const richJoined = rich.join('\n');
    expect(richJoined).toContain('X');
    expect(richJoined).toContain('5.4.5');
    // rich bundle has exactly ONE gap — docs (fixture provides no docs paths)
    expect(richJoined.split('—').length - 1).toBe(1);

    const sparse = buildPanel(sparseInfo({ id: 'y', name: 'y' }), { width: 40 });
    const sparseJoined = sparse.join('\n');
    const gapCount = sparseJoined.split('—').length - 1;
    expect(gapCount).toBe(7); // version, path, method, size, config, cache, docs
  });
});

// ── #39/#40: actions (u/r), sudo state machine, auto-refresh, reveal (f/c),
// terminal-too-small screen.
//
// Assumptions encoded by these tests (stated before RED, 2026-11-12):
// - `r` opens a FULL-FRAME confirm dialog in TWO y/n stages: "Are you sure?
//   (y/n)" → after y "User is sure: Yes ✓" + "Also remove config and cache?
//   (y/n)". n NEVER executes anything; other keys are swallowed while the
//   dialog is up.
// - While running, the frame is install-style: dots_12 loader frame +
//   "Removing/Updating <name> (<live command>)" + [elapsed] after 3s.
// - A DONE frame ("✓ Removed X") auto-returns to the list after doneDelayMs
//   (3s in production); a FAILED frame STAYS until esc.
// - Sudo state machine: a command failing with permission-shaped stderr
//   (sudo:, lock files, denials) → "blocked" frame carrying the copyable
//   command; ENTER retries the EXACT same command; esc dismisses.
// - Auto-refresh WITHOUT rescan: after remove the entry vanishes from the
//   rendered list; after update the row shows the ✓ badge and the panel
//   shows the probed new version (light single-manager probe — the scan
//   function is NOT called again).
// - Reveal (f/c) executes the platform command ONLY behind canReveal
//   (+ hasCache for c); it is TOLERANT — explorer exits 1 on success, so a
//   non-zero reveal exit still lands as done. A headless canReveal:false
//   leaves f/c inert — zero exec calls even from the buttons focus.
// - stdout below 80×24 renders the "terminal too small" screen INSTEAD of
//   any list/modal frame — from the very first frame (scan screen included).
describe('tools TUI actions (Phase 4 + 5)', () => {
  let app;
  afterEach(() => { if (app) { app.stop(); app = null; } });

  const actionInfo = entry => ({
    id: entry.id, name: entry.name,
    version: entry.version || '5.4.5', binPath: `/usr/bin/${entry.id}`, method: 'npm',
    size: 1024, sizeLabel: '1.0 KB',
    configPaths: [`~/.config/${entry.id}`], cachePaths: [`~/.cache/${entry.id}`], docsPaths: [],
    flags: { canUpdate: true, canRemove: true, hasCache: true, canReveal: true },
  });

  const mountActions = (props = {}) => {
    const stdout = fakeStdout();
    const inDev = fakeStdin();
    const execCalls = [];
    app = createToolsApp({
      scan: scanFixtures,
      stdout,
      stdin: inDev.stdin,
      onExit: () => {},
      toolInfo: actionInfo,
      execFunc: (cmd, _o, cb) => { execCalls.push(cmd); cb(null, '', ''); },
      ...props,
    });
    app.run();
    return { stdout, inDev, execCalls };
  };

  // selection onto the first TOOL row (TypeScript) — flags all enabled
  const selectTool = async t => {
    await flush();
    await flush();
    t.inDev.press('\x1b[B'); // ADM header → TypeScript
  };

  test('dialog without confirmation executes NOTHING (n cancels; other keys are swallowed)', async () => {
    const t = mountActions({ doneDelayMs: 10 });
    await selectTool(t);
    t.inDev.press('r');
    expect(screenText(t.stdout)).toContain('Remove TypeScript?');
    expect(screenText(t.stdout)).toContain('Are you sure? (y/n)');
    expect(t.execCalls).toEqual([]);

    t.inDev.press('n'); // no → back to the list, zero execution
    await flush();
    expect(t.execCalls).toEqual([]);
    expect(screenText(t.stdout)).toContain('TypeScript'); // back on the list

    // keys that belong to the list do nothing while the dialog is up
    t.inDev.press('r'); // dialog again…
    t.inDev.press('u'); // …and everything but y/n is swallowed
    t.inDev.press('f');
    t.inDev.press('\u001B[C');
    await flush();
    expect(t.execCalls).toEqual([]);
    expect(screenText(t.stdout)).toContain('Are you sure?'); // dialog untouched
    expect(screenText(t.stdout)).not.toContain('User is sure');
    t.inDev.press('n'); // cancel
    await flush();
    expect(t.execCalls).toEqual([]);
    expect(screenText(t.stdout)).not.toContain('Are you sure?');
  });

  test('r → y shows "User is sure: Yes ✓" + the cache question; n skips cleanup', async () => {
    const t = mountActions({ doneDelayMs: 30000 });
    await selectTool(t);
    t.inDev.press('r');
    t.inDev.press('y');
    const stage2 = screenText(t.stdout);
    expect(stage2).toContain('User is sure: Yes ✓');
    expect(stage2).toContain('Also remove config and cache? (y/n)');

    t.inDev.press('n'); // confirm WITHOUT the config/cache cleanup
    await flush(); // the plan starts on the next microtask
    expect(t.execCalls).toEqual(['npm uninstall -g typescript']);
    await flush(); await flush(); await flush();
    expect(screenText(t.stdout)).toContain('✓ Removed TypeScript');
  });

  test('r → y → y confirms WITH the config/cache cleanup; done auto-returns to the list', async () => {
    const t = mountActions({ doneDelayMs: 10 });
    await selectTool(t);
    t.inDev.press('r');
    t.inDev.press('y');
    t.inDev.press('y'); // cleanup ON
    await flush();
    expect(t.execCalls).toEqual(['npm uninstall -g typescript']);

    await flush(); await flush(); await flush();
    expect(screenText(t.stdout)).toContain('✓ Removed TypeScript');

    // done frame auto-returns to the main TUI after doneDelayMs (10 ms here)
    await new Promise(r => setTimeout(r, 40));
    const frame = screenText(t.stdout);
    expect(frame).not.toContain('Removed TypeScript'); // back to the list
    expect(frame).not.toContain('TypeScript'); // gone — no manual rescan
    expect(frame).toContain('eslint');         // the rest of the list survives
  });

  test('while running: install-style line — loader frame, Removing X (command) [elapsed]', async () => {
    const t = mountActions({
      doneDelayMs: 10,
      execFunc: (_cmd, _o, cb) => setTimeout(() => cb(null, '', ''), 30), // keep it running
    });
    await selectTool(t);
    t.inDev.press('r');
    t.inDev.press('y');
    t.inDev.press('n');
    await flush(); await flush();
    const running = screenText(t.stdout);
    expect(FRAMES.some(f => running.includes(f))).toBe(true); // loader animates
    expect(running).toContain('Removing TypeScript');         // capital R
    expect(running).toContain('(npm uninstall -g typescript)'); // live command

    await new Promise(r => setTimeout(r, 60)); // let it finish (and auto-return)
    expect(screenText(t.stdout)).not.toContain('Removing TypeScript');
  });

  test('sudo failure → blocked frame with the copyable command; retry repeats the SAME command', async () => {
    const sudoErr = { message: 'Command failed', stderr: 'sudo: a password is required' };
    let calls = 0;
    const t = mountActions({
      doneDelayMs: 10,
      execFunc: (cmd, _o, cb) => {
        calls += 1;
        if (calls === 1) cb(sudoErr, '', sudoErr.stderr);
        else cb(null, '', '');
      },
    });
    await selectTool(t);
    t.inDev.press('r');
    t.inDev.press('y');
    t.inDev.press('n');
    await flush(); await flush(); await flush();

    const blocked = screenText(t.stdout);
    expect(blocked).toContain('administrator (sudo) rights are required');
    expect(blocked).toContain('npm uninstall -g typescript'); // copyable command
    expect(blocked).toContain('enter retry');

    t.inDev.press('\r'); // retry
    await flush(); await flush(); await flush();
    expect(screenText(t.stdout)).toContain('✓ Removed TypeScript');
    t.inDev.press('\u001B');
    expect(screenText(t.stdout)).not.toContain('TypeScript');
  });

  test('a non-sudo failure lands in the failed frame and STAYS (no auto-return)', async () => {
    const t = mountActions({
      doneDelayMs: 10,
      execFunc: (_cmd, _o, cb) => cb({ message: 'npm ERR! enoent', stderr: 'npm ERR! enoent' }, '', 'npm ERR! enoent'),
    });
    await selectTool(t);
    t.inDev.press('r');
    t.inDev.press('y');
    t.inDev.press('n');
    await flush(); await flush(); await flush();
    expect(screenText(t.stdout)).toContain('✗ Removing failed');
    expect(screenText(t.stdout)).toContain('npm ERR! enoent');

    // errors do NOT auto-return — the frame stays well past doneDelayMs
    await new Promise(r => setTimeout(r, 40));
    expect(screenText(t.stdout)).toContain('✗ Removing failed');

    t.inDev.press('\u001B');
    expect(screenText(t.stdout)).toContain('TypeScript'); // untouched
  });

  test('update (u) refreshes the row: ✓ badge + probed new version in the panel — scan NOT re-run', async () => {
    let scans = 0;
    const scan = onProgress => { scans += 1; return scanFixtures(onProgress); };
    const versionedInfo = e => ({ ...actionInfo(e), version: e.version || '5.4.5' });
    const t = mountActions({
      scan,
      doneDelayMs: 30000,
      toolInfo: versionedInfo,
      probe: async () => ({ ok: true, entries: [{ id: 'typescript', version: '9.9.9' }] }),
    });
    await selectTool(t);
    t.inDev.press('u'); // direct shortcut — update runs WITHOUT a dialog
    await flush(); await flush(); await flush();
    expect(t.execCalls).toEqual(['npm update -g typescript']);
    expect(screenText(t.stdout)).toContain('✓ Updated TypeScript');
    expect(scans).toBe(1); // auto-refresh is NOT a rescan

    t.inDev.press('\u001B');
    const frame = screenText(t.stdout);
    expect(frame).toContain('TypeScript ✓'); // row shows the new state
    expect(frame).toContain('9.9.9');        // panel shows the probed version
  });

  test('update retry after a sudo block also refreshes the row', async () => {
    const sudoErr = { message: 'Command failed', stderr: 'E: Could not open lock file - Permission denied' };
    let calls = 0;
    const versionedInfo = e => ({ ...actionInfo(e), version: e.version || '5.4.5' });
    const t = mountActions({
      toolInfo: versionedInfo,
      doneDelayMs: 30000,
      probe: async () => ({ ok: true, entries: [{ id: 'typescript', version: '9.9.9' }] }),
      execFunc: (cmd, _o, cb) => {
        calls += 1;
        if (calls === 1) cb(sudoErr, '', sudoErr.stderr);
        else cb(null, '', '');
      },
    });
    await selectTool(t);
    t.inDev.press('u');
    await flush(); await flush();
    expect(screenText(t.stdout)).toContain('administrator (sudo) rights are required');
    t.inDev.press('\r'); // retry
    await flush(); await flush(); await flush();
    t.inDev.press('\u001B');
    expect(screenText(t.stdout)).toContain('TypeScript ✓');
  });

  test('update on an ALREADY-LATEST tool (winget no-upgrade exit) lands as "Already up to date"', async () => {
    const stderr = 'No available upgrade found.\nNo newer package versions are available from the configured sources.';
    const t = mountActions({
      doneDelayMs: 30000,
      probe: async () => ({ ok: true, entries: [{ id: 'typescript', version: '5.4.5' }] }),
      execFunc: (_cmd, _o, cb) => cb({ message: `Command failed: winget upgrade\n${stderr}`, stderr }, '', stderr),
    });
    await selectTool(t);
    t.inDev.press('u');
    await flush(); await flush(); await flush();
    const frame = screenText(t.stdout);
    expect(frame).toContain('✓ Already up to date — TypeScript'); // NOT "Updating failed"
    t.inDev.press('\u001B');
    expect(screenText(t.stdout)).toContain('TypeScript'); // entry untouched
  });

  test('remove NOT owned by the manager AND no known binary → "nothing removed", frame STAYS', async () => {
    // Git-LFS-like: winget owns nothing AND no binPath to fall back to
    const noBinInfo = e => ({ ...actionInfo(e), binPath: null });
    const t = mountActions({
      toolInfo: noBinInfo,
      execFunc: (_cmd, _o, cb) => cb(
        { message: 'Command failed: winget uninstall' },
        'No installed package found matching input criteria.',
        '',
      ),
    });
    await selectTool(t);
    t.inDev.press('r');
    t.inDev.press('y');
    t.inDev.press('n');
    await flush(); await flush(); await flush();
    expect(screenText(t.stdout)).toContain('· Not managed by npm — nothing removed');

    // error-like state: NO 3s auto-return (owner decision) — stays until esc
    await new Promise(r => setTimeout(r, 40));
    expect(screenText(t.stdout)).toContain('· Not managed by npm — nothing removed');

    t.inDev.press('\u001B');
    expect(screenText(t.stdout)).toContain('TypeScript'); // entry untouched
  });

  test('remove NOT owned by the manager falls back to deleting the ADM-known binary', async () => {
    // the tool shows in ADM with a REAL binPath (scan) — winget disowns it,
    // ADM removes the binary it knows
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-fallback-'));
    const bin = path.join(dir, 'git-lfs.exe');
    fs.writeFileSync(bin, 'x');
    const binInfo = e => ({ ...actionInfo(e), binPath: bin });
    const scan = async onProgress => {
      const res = await scanFixtures(onProgress);
      const entry = res.entries.find(x => x.id === 'typescript');
      if (entry) entry.binPath = bin; // the catalog PATH scan fills binPath
      return res;
    };
    const t = mountActions({
      scan,
      toolInfo: binInfo,
      execFunc: (_cmd, _o, cb) => cb(
        { message: 'Command failed: winget uninstall' },
        'No installed package found matching input criteria.',
        '',
      ),
    });
    await selectTool(t);
    t.inDev.press('r');
    t.inDev.press('y');
    t.inDev.press('n');
    await flush(); await flush(); await flush(); await flush();
    expect(fs.existsSync(bin)).toBe(false);   // the binary is gone
    expect(screenText(t.stdout)).toContain('✓ Removed TypeScript');
    t.inDev.press('\u001B');
    expect(screenText(t.stdout)).not.toContain('TypeScript'); // entry vanishes
  });

  test('reveal: f opens the tool folder, c the cache folder — the platform command per path', async () => {
    // REAL paths: reveal resolves targets against the actual filesystem
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-rev-'));
    const bin = path.join(dir, 'typescript'); // a FILE — linux opens its parent
    fs.writeFileSync(bin, 'x');
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-revc-'));
    const platform = process.platform;
    const expectCmd = target => {
      if (platform === 'win32') return `explorer /select,"${target}"`;
      if (platform === 'darwin') return `open -R "${target}"`;
      // linux xdg-open opens FOLDERS: a FILE target resolves to its parent
      return `xdg-open "${fs.statSync(target).isFile() ? path.dirname(target) : target}"`;
    };
    const revInfo = e => ({ ...actionInfo(e), binPath: bin, cachePaths: [cacheDir] });
    const t = mountActions({ platform, doneDelayMs: 30000, toolInfo: revInfo });
    await selectTool(t);
    t.inDev.press('f');
    await flush(); // the plan starts on the next microtask
    expect(t.execCalls).toEqual([expectCmd(bin)]);
    await flush(); await flush();
    expect(screenText(t.stdout)).toContain('✓ Opened folder');

    t.inDev.press('\u001B'); // dismiss done frame
    t.inDev.press('c');
    await flush();
    expect(t.execCalls).toEqual([expectCmd(bin), expectCmd(cacheDir)]);
  });

  test('reveal is TOLERANT: explorer exiting 1 after a successful open still lands as done', async () => {
    const t = mountActions({
      platform: 'win32',
      doneDelayMs: 30000,
      execFunc: (_cmd, _o, cb) => cb({ message: 'Command failed: explorer', stderr: '' }, '', ''),
    });
    await selectTool(t);
    t.inDev.press('f');
    await flush(); await flush(); await flush();
    expect(screenText(t.stdout)).toContain('✓ Opened folder'); // NOT failed
  });

  test('headless (canReveal false) → f/c are inert: zero exec calls, also from the buttons focus', async () => {
    const headlessInfo = e => ({
      ...actionInfo(e),
      flags: { canUpdate: true, canRemove: false, hasCache: true, canReveal: false },
    });
    const t = mountActions({ toolInfo: headlessInfo });
    await selectTool(t);
    t.inDev.press('f');
    t.inDev.press('c');
    expect(t.execCalls).toEqual([]);

    // buttons focus: → lands on the first ENABLED button (u); ↓ cycles to (c)
    // — enabled by hasCache but a cache reveal still needs canReveal: enter
    // must NOT execute anything
    t.inDev.press('\u001B[C'); // → buttons (hover: u)
    t.inDev.press('\x1b[B'); await flush(); // cycle enabled [u, c] → hover c
    t.inDev.press('\r');
    await flush();
    expect(t.execCalls).toEqual([]);
    expect(screenText(t.stdout)).toContain('eslint'); // never left the list
  });

  test('dimmed flags (all false) make u/r/f/c and → inert — no dialog, no execution', async () => {
    const sparse = e => ({ ...actionInfo(e), flags: { canUpdate: false, canRemove: false, hasCache: false, canReveal: false } });
    const t = mountActions({ toolInfo: sparse });
    await selectTool(t);
    t.inDev.press('u');
    t.inDev.press('r');
    t.inDev.press('f');
    t.inDev.press('c');
    t.inDev.press('\u001B[C'); // → with all dimmed stays on the list
    await flush();
    expect(t.execCalls).toEqual([]);
    expect(screenText(t.stdout)).not.toContain('Remove');
  });

  test('terminal below 80×24 shows ONLY the min-size screen — scan screen included, keys safe', async () => {
    const stdout = fakeStdout();
    stdout.columns = 70; // < 80 → too small
    const inDev = fakeStdin();
    let exited = false;
    app = createToolsApp({ scan: scanFixtures, stdout, stdin: inDev.stdin, onExit: () => { exited = true; } });
    app.run();
    await flush(); await flush(); // scan resolved behind the gate

    const frame = screenText(stdout);
    expect(frame).toContain('terminal too small');
    expect(frame).toContain('80×24');
    expect(frame).not.toContain('ADM');      // no list ever rendered
    expect(frame).not.toContain(FRAMES[0]);  // not even the scan loader

    inDev.press('\x1b[B'); // keys must not crash the gate
    inDev.press('r');
    expect(screenText(stdout)).toContain('terminal too small');
    expect(exited).toBe(false);
    inDev.press('q');
    expect(exited).toBe(true);
  });

  test('stdout taller than 24 but narrower than 80 → still the min-size screen', () => {
    const stdout = fakeStdout();
    stdout.rows = 30;
    stdout.columns = 79;
    const inDev = fakeStdin();
    app = createToolsApp({ scan: scanFixtures, stdout, stdin: inDev.stdin });
    app.run();
    expect(screenText(stdout)).toContain('terminal too small');
  });
});
