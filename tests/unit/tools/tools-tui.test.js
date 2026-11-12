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
const { createToolsApp, runToolsTui, buildView } = require('../../../src/tools/tools-tui');
const { scanInventory } = require('../../../src/tools/inventory');
const { FRAMES } = require('../../../src/setup/loader');

const strip = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const flush = () => new Promise(r => setImmediate(r));

// last complete frame = last atomic write (starts at \x1b[H)
function screenText(stdout) {
  const chunks = stdout.writes;
  return strip(chunks[chunks.length - 1] || '');
}
const linesOf = frame => frame.split('\n').map(l => l.replace(/^>\s/, '').trim()).filter(Boolean);

// real inventory module behind the injected scan fn — the TUI contract is
// "whatever scanInventory returns", so tests go through the public interface.
// #37: the remaining manager probes are stubbed with SILENT SUCCESS (empty
// output → empty groups, no warnings) so the scan resolves synchronously and
// the frames stay the Phase 1 shape (ADM + npm + other only).
const scanFixtures = onProgress => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-tui-path-'));
  fs.writeFileSync(path.join(binDir, 'fzf'), '#!/bin/sh\n'); // PATH-only hit → 'other'
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

  const rawLines = stdout => screenText(stdout).split('\n').filter(l => l.trim());

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

  test('a failed source renders an empty group with its warning row', async () => {
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
    // warning-carrying groups stay visible even when empty — the ⚠ explains why
    expect(frame).toContain('ADM (0)');
    expect(frame).toContain('npm (0)');
    expect(frame).toContain('npm not found — global packages not scanned');
    // empty without warning → hidden
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
      expect(admLine).not.toContain('\x1b[1m');
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
});
