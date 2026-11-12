// ToolsApp — the `adm tools` TUI (plan plans/adm-tools-tui.md, Phase 1, #36).
//
// WHY NOT INK: empirically, ink's "erase N lines up + rewrite" repaints get
// garbled by ConPTY (Windows Terminal's PTY layer) exactly when the whole
// frame content shifts (viewport scroll) — the selection line vanishes from
// the emitted stream even though the bytes ink writes are correct (verified
// byte-for-byte with and without ConPTY, 2026-11-12). So the skin is drawn
// the same way the rest of ADM paints (setup/loader.js, setup/prompts.js):
// ONE atomic stdout write per frame, absolute homing (\x1b[H) + per-line
// clear (\x1b[K) + clear-to-end (\x1b[J), inside the alternate screen buffer.
//
// All scanning/merging lives in the terminal-neutral inventory module; this
// component ONLY renders state and handles keys. Selected-row style (red +
// bold + '>' pointer) mirrors the adm wizard (setup/prompts.js).

const chalk = require('chalk');
const { FRAMES } = require('../setup/loader');
const { scanInventory } = require('./inventory');

const FRAME_INTERVAL = 80; // same cadence as setup/loader.js

const HINT = '↑↓ move · Enter/Space expand/collapse · q quit';

// Builds the visible rows AND the flat list of selectable positions.
// Headers are selectable (Enter/Space target); a collapsed group hides its
// tool rows, so ↑/↓ skip them automatically. Warnings always stay visible.
// Owner decision: a group with NO entries and NO warning is hidden entirely
// (brew/pip/cargo/go/system stay invisible until Phase 2 parsers fill them).
//
// `selectable` entries carry `rowIndex` — the position IN `rows`. Selection
// coordinates (selected/top) count selectable rows, but the window slices
// FRAME rows; warning rows occupy a frame row without being selectable, so
// the two coordinate systems differ by exactly the warnings above a row.
function buildView(result, selected, collapsed) {
  const rows = [];
  const selectable = [];
  let idx = 0;
  for (const g of result.groups) {
    if (g.entries.length === 0 && !g.warning) continue;
    const isCollapsed = collapsed.has(g.id);
    const sel = idx === selected;
    const header = `${g.label} (${g.entries.length}) ${isCollapsed ? '▸' : '▾'}`;
    rows.push(sel ? chalk.red.bold(`> ${header}`) : `  ${header}`);
    selectable.push({ type: 'header', id: g.id, rowIndex: rows.length - 1 });
    idx += 1;
    if (g.warning) {
      rows.push(chalk.yellow(`  ⚠ ${g.warning}`));
    }
    if (!isCollapsed) {
      for (const entry of g.entries) {
        const s = idx === selected;
        rows.push(s ? chalk.red.bold(`> ${entry.name}`) : `  ${entry.name}`);
        selectable.push({ type: 'tool', id: entry.id, rowIndex: rows.length - 1 });
        idx += 1;
      }
    }
  }
  return { rows, selectable };
}

// Same key mapping contract as ink's useInput (whole-chunk matches).
function parseKey(chunk) {
  const input = String(chunk);
  return {
    up: input === '\u001B[A',
    down: input === '\u001B[B',
    enter: input === '\r',
    space: input === ' ',
    q: input === 'q',
    ctrlC: input === '\u0003',
  };
}

// Creates the TUI controller. I/O is fully injectable for tests.
//   scan         (onProgress) => Promise<{ entries, groups }>  — required
//   stdout       Writable (frames land here)
//   stdin        EventEmitter emitting 'data' (keys)
//   onExit       () => void — called on q / Ctrl+C
//   viewportRows number — window height override (tests); default rows - 3
function createToolsApp({ scan, stdout, stdin, onExit, viewportRows }) {
  let progress = null;        // { done, total } | null
  let result = null;          // { entries, groups } | null
  let cursor = { selected: 0, top: 0 };
  const collapsed = new Set();
  let frameTimer = null;
  let frame = 0;
  let dead = false;           // stopped accepting keys / rendering

  // Viewport height: explicit prop wins (tests). Otherwise rows-3 — but only
  // if stdout.rows is SANE: Windows consoles can report the SCREEN BUFFER
  // height (hundreds/thousands of lines) instead of the visible window, and
  // a frame taller than the visible area means the marker walks below it and
  // the list "never scrolls" (owner symptom, #36). Owner decision: the window
  // may show up to 50 rows on tall terminals; when rows looks insane, fall
  // back to the conservative fixed window.
  const MAX_WINDOW = 50;
  const height = () => {
    if (viewportRows) return Math.max(3, viewportRows);
    const rows = stdout.rows;
    const sane = Number.isFinite(rows) && rows >= 8 && rows <= 100;
    return Math.max(5, sane ? Math.min(rows - 3, MAX_WINDOW) : 20);
  };

  const clampIdx = (n, len) => Math.max(0, Math.min(len - 1, n));

  // ONE atomic write per frame (loader pattern): home + per-line clear +
  // clear-to-end, so a shrinking frame never leaves residue. Frame lines
  // must stay within one terminal row (Phase 1 content is short); the
  // trailing \x1b[J clears leftovers of any taller previous frame.
  const paint = (lines, withHint = true) => {
    if (dead) return;
    const body = lines.map(l => `${l}\x1b[K`).join('\n');
    const rows = stdout.rows;
    const sane = Number.isFinite(rows) && rows >= 8 && rows <= 100;
    if (sane) {
      // Owner request: the hint lives on the terminal's LAST row — absolute
      // positioning, independent of how many list rows the frame carries.
      // \x1b[J first clears leftovers of any taller previous frame (and the
      // previous hint), then the hint is written at row `rows`.
      const hint = withHint ? `\x1b[${rows};1H${chalk.dim(HINT)}\x1b[K` : '';
      stdout.write(`\x1b[H${body}\n\x1b[J${hint}`);
    } else {
      // rows unusable (lying console) — keep the hint right below the frame
      const hint = withHint ? `${chalk.dim(HINT)}\x1b[K` : '';
      stdout.write(`\x1b[H${body}\x1b[K\n\x1b[J${hint}`);
    }
  };

  const render = () => {
    if (dead) return;
    if (!result) {
      // scan screen: loader + counter, NO hint (owner request — the hint
      // appears only once the tool list is up)
      const counter = progress ? `Scanning ${progress.done}/${progress.total}…` : 'Scanning…';
      paint([`${FRAMES[frame % FRAMES.length]} ${counter}`], false);
      return;
    }
    const { selected, top } = cursor;
    const { rows, selectable } = buildView(result, selected, collapsed);
    // Window = FRAME rows from selectable[top] to selectable[top + height - 1]
    // (mapping through rowIndex — warning rows shift the two coordinate
    // systems, and slicing rows directly used to cut the selected row off).
    const firstIdx = Math.min(top, selectable.length - 1);
    const lastIdx = Math.min(top + height() - 1, selectable.length - 1);
    if (firstIdx < 0 || lastIdx < 0) { paint([chalk.dim(HINT)]); return; }
    const first = selectable[firstIdx].rowIndex;
    // when the window reaches the LAST selectable row, show everything below
    // it too — a warning row under the final group must stay visible
    const stop = lastIdx >= selectable.length - 1
      ? rows.length
      : selectable[lastIdx].rowIndex + 1;
    paint(rows.slice(first, stop)); // the hint is pinned by paint() itself
  };

  const move = (delta) => {
    if (!result) return;
    const { selectable } = buildView(result, cursor.selected, collapsed);
    const len = selectable.length;
    setCursor(({ selected: s, top: t }) => {
      const next = clampIdx(s + delta, len);
      let nextTop = t;
      if (next < t) nextTop = next;
      else if (next >= t + height()) nextTop = Math.max(0, next - height() + 1);
      return { selected: next, top: nextTop };
    });
  };

  const toggle = () => {
    if (!result) return;
    const { selectable } = buildView(result, cursor.selected, collapsed);
    const row = selectable[cursor.selected];
    if (!row || row.type !== 'header') return;
    if (collapsed.has(row.id)) collapsed.delete(row.id);
    else collapsed.add(row.id);
    const len = buildView(result, cursor.selected, collapsed).selectable.length;
    setCursor(({ selected: s, top: t }) => ({
      selected: clampIdx(s, len),
      top: Math.min(t, Math.max(0, len - height())),
    }));
  };

  // single state write → ONE paint per keypress (selection + window together)
  const setCursor = (updater) => {
    cursor = updater(cursor);
    render();
  };

  const onData = (chunk) => {
    if (dead) return;
    const key = parseKey(chunk);
    if (key.q || key.ctrlC) {
      stop();
      if (onExit) onExit();
      return;
    }
    if (key.up) move(-1);
    else if (key.down) move(1);
    else if (key.enter || key.space) toggle();
  };

  const stop = () => {
    if (dead) return;
    dead = true;
    if (frameTimer) clearInterval(frameTimer);
    stdin.removeListener('data', onData);
    // leave raw mode / stop consuming the stream (real terminal stdin only)
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
    if (typeof stdin.pause === 'function') stdin.pause();
  };

  return {
    // mounts: raw mode + hide cursor, starts the loader animation + scan,
    // attaches keys
    run() {
      // raw mode: keys must arrive per-keystroke, not per-line (real stdin)
      if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
      if (typeof stdin.setEncoding === 'function') stdin.setEncoding('utf8');
      if (typeof stdin.resume === 'function') stdin.resume();
      stdout.write('\x1b[?25l'); // hide cursor (loader contract)
      stdin.on('data', onData);
      render();
      frameTimer = setInterval(() => {
        if (result) { clearInterval(frameTimer); frameTimer = null; return; }
        frame += 1;
        render();
      }, FRAME_INTERVAL);
      Promise.resolve()
        .then(() => scan((done, total) => {
          progress = { done, total };
          render();
        }))
        .then(res => {
          result = res;
          cursor = { selected: 0, top: 0 };
          if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
          render();
        });
    },
    stop,
    isDead: () => dead,
  };
}

// Runner for `adm tools`: mounts the app over the REAL scanInventory and
// resolves 0 on a clean exit (q / Ctrl+C). Non-TTY callers get exit 1 with a
// notice (same guard pattern as the wizard, #26).
//
// FULLSCREEN (owner fix): the app runs in the terminal's ALTERNATE screen
// buffer (\x1b[?1049…, like vim/less) — nothing it draws leaks into the
// normal scrollback, so scrolling up never reveals the pre-app prompt.
// stdout/stdin are injectable for tests.
async function runToolsTui(opts = {}) {
  const err = opts.err || (s => process.stderr.write(s + '\n'));
  const tty = opts.tty !== undefined ? opts.tty : Boolean(process.stdin.isTTY);
  if (!tty) {
    err('adm tools needs a terminal for interactive mode.');
    return 1;
  }
  const stdout = opts.stdout || process.stdout;
  const stdin = opts.stdin || process.stdin;

  stdout.write('\x1b[?1049h'); // enter alt buffer (clears it)
  try {
    await new Promise(resolve => {
      const app = createToolsApp({
        scan: opts.scan || scanInventory,
        stdout,
        stdin,
        onExit: resolve,
      });
      app.run();
    });
  } finally {
    stdout.write('\x1b[?1049l\x1b[?25h'); // restore main buffer + cursor
  }
  return 0;
}

module.exports = { createToolsApp, runToolsTui };
