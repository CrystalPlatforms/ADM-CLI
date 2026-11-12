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
// component ONLY renders state and handles keys. Style (owner decisions):
// group headers ALWAYS green #167c51, bold on selection ("hover"); tool rows
// keep the adm wizard selection style (red + bold + '>' pointer).

const chalk = require('chalk');
const { FRAMES } = require('../setup/loader');
const { scanInventory } = require('./inventory');
const { getToolInfo } = require('./tool-info');

const FRAME_INTERVAL = 80; // same cadence as setup/loader.js

const HINT = '↑↓ move · →/← actions · Enter/Space collapse · F5/Shift+R rescan · q quit';

// strips ANSI so visible widths can be computed (padding/truncation)
const stripAnsi = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// clips a cell to the visible width (ANSI stripped — a truncated row loses
// its color, acceptable for overlong warnings/paths)
const clip = (s, width) => `${stripAnsi(s).slice(0, Math.max(0, width - 1))}…`;

// One frame row cell: clipped to the column width, then padded so the right
// column starts at the same offset on every line.
const padCell = (s, width) => {
  const visible = stripAnsi(s);
  return visible.length > width ? clip(s, width) : s + ' '.repeat(width - visible.length);
};

const truncateCell = (s, width) => (stripAnsi(s).length > width ? clip(s, width) : s);

// The action buttons (owner UX: "(u) update" chips, no brackets — hover
// renders red+bold with the '>' pointer). Order is the ↑↓ cycle order in the
// buttons focus. Flags dim a button; executing is Phase 4/5.
const BUTTONS = [
  { key: 'u', label: 'update', flag: 'canUpdate' },
  { key: 'r', label: 'remove', flag: 'canRemove' },
  { key: 'f', label: 'folder', flag: 'canReveal' },
  { key: 'c', label: 'cache', flag: 'hasCache' },
];

// The side panel (owner style: Claude-diff preview — dim keys, gap "—").
// Pure model: (info | null, { width, focusButton }) => lines. A NULL info
// renders the placeholder (selection sits on a group header, nothing
// measured yet). focusButton: -1 = none (hover in the list), 0..3 = the
// hovered button (red+bold+'>', same style as the list selection).
function buildPanel(info, { width = 30, focusButton = -1 } = {}) {
  if (!info) return [chalk.dim('select a tool — ↑↓')];
  const lines = [];
  lines.push(chalk.hex('#167c51').bold(truncateCell(info.name, width)));
  lines.push(chalk.dim('─'.repeat(Math.min(26, Math.max(8, width)))));
  const rows = [
    ['version', info.version],
    ['path', info.binPath],
    ['method', info.method],
    ['size', info.sizeLabel],
    ['config', (info.configPaths && info.configPaths[0]) || null],
    ['cache', (info.cachePaths && info.cachePaths[0]) || null],
    ['docs', (info.docsPaths && info.docsPaths[0]) || null],
  ];
  for (const [label, value] of rows) {
    const shown = value === null || value === undefined || value === '' ? chalk.dim('—') : truncateCell(String(value), width - 9);
    lines.push(`${chalk.dim(label.padEnd(8))}${shown}`);
  }
  lines.push('');
  BUTTONS.forEach((b, i) => {
    const text = `(${b.key}) ${b.label}`;
    const focused = i === focusButton;
    const enabled = Boolean(info.flags && info.flags[b.flag]);
    if (focused) lines.push(chalk.red.bold(`> ${text}`));
    else if (enabled) lines.push(`  ${text}`);
    else lines.push(chalk.dim(`  ${text}`));
  });
  return lines;
}

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
function buildView(result, selected, collapsed, focusInList = true) {
  const rows = [];
  const selectable = [];
  let idx = 0;
  for (const g of result.groups) {
    if (g.entries.length === 0 && !g.warning) continue;
    const isCollapsed = collapsed.has(g.id);
    const sel = idx === selected && focusInList;
    const marked = idx === selected;
    const header = `${g.label} (${g.entries.length}) ${isCollapsed ? '▸' : '▾'}`;
    // owner decision (#37 follow-up): headers are ALWAYS green #167c51 and
    // gain bold on "hover" (the selection cursor — this TUI is keyboard-only)
    rows.push(sel ? chalk.hex('#167c51').bold(`> ${header}`) : chalk.hex('#167c51')(marked ? `> ${header}` : `  ${header}`));
    selectable.push({ type: 'header', id: g.id, rowIndex: rows.length - 1 });
    idx += 1;
    if (g.warning) {
      rows.push(chalk.yellow(`  ⚠ ${g.warning}`));
    }
    if (!isCollapsed) {
      for (const entry of g.entries) {
        const s = idx === selected && focusInList;
        const m = idx === selected;
        rows.push(s ? chalk.red.bold(`> ${entry.name}`) : (m ? `> ${entry.name}` : `  ${entry.name}`));
        selectable.push({ type: 'tool', id: entry.id, rowIndex: rows.length - 1 });
        idx += 1;
      }
    }
  }
  return { rows, selectable };
}

// Same key mapping contract as ink's useInput (whole-chunk matches).
// F5 arrives as CSI 15~; Shift+R as a plain capital R. Lowercase r is
// RESERVED for remove (Phase 4) — it must never trigger a rescan.
function parseKey(chunk) {
  const input = String(chunk);
  return {
    up: input === '\u001B[A',
    down: input === '\u001B[B',
    right: input === '\u001B[C',
    left: input === '\u001B[D',
    enter: input === '\r',
    space: input === ' ',
    q: input === 'q',
    ctrlC: input === '\u0003',
    f5: input === '\u001B[15~',
    shiftR: input === 'R',
  };
}

// Creates the TUI controller. I/O is fully injectable for tests.
//   scan         (onProgress) => Promise<{ entries, groups }>  — required
//   stdout       Writable (frames land here)
//   stdin        EventEmitter emitting 'data' (keys)
//   onExit       () => void — called on q / Ctrl+C
//   viewportRows number — window height override (tests); default rows - 3
function createToolsApp({ scan, stdout, stdin, onExit, viewportRows, toolInfo: toolInfoOpt }) {
  const toolInfo = toolInfoOpt || getToolInfo;
  let progress = null;        // { done, total } | null
  let result = null;          // { entries, groups } | null
  let cursor = { selected: 0, top: 0 };
  let panelInfo = null;       // tool-info bundle for the SELECTED tool | null
  let focus = 'list';         // 'list' | 'buttons' — where the hover lives
  let buttonIdx = 0;          // hovered button when focus === 'buttons'
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
    const { rows, selectable } = buildView(result, selected, collapsed, focus === 'list');
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
    const listLines = rows.slice(first, stop);

    // TWO-COLUMN FRAME: list window left, side panel right. The panel is
    // frame-height independent — it starts at the tool name regardless of
    // where the list window sits.
    const cols = stdout.columns || 80;
    // owner fix (#38 feedback, round 3): the list keeps ~75% of the terminal.
    // ⚠ warning rows render in the list column like every other row — at
    // this width real warnings fit, and the separator stays unbroken.
    const listWidth = Math.max(44, Math.min(cols - 22, Math.floor(cols * 0.85)));
    const panelWidth = Math.max(10, cols - listWidth - 3);
    const panelLines = buildPanel(panelInfo, { width: panelWidth, focusButton: focus === 'buttons' ? buttonIdx : -1 });
    const height2 = Math.max(listLines.length, panelLines.length);
    const composed = [];
    for (let i = 0; i < height2; i += 1) {
      const listLine = listLines[i] || '';
      composed.push(`${padCell(listLine, listWidth)}${chalk.dim(' │ ')}${panelLines[i] || ''}`);
    }
    paint(composed); // the hint is pinned by paint() itself
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

  // LAZY tool-info: recomputed ONLY when the selection changes to a tool row
  // (never during the scan — the scan doesn't touch tool-info at all).
  // Headers / placeholders → panelInfo null.
  const refreshPanel = () => {
    panelInfo = null;
    if (!result) return;
    const { selectable } = buildView(result, cursor.selected, collapsed);
    const row = selectable[cursor.selected];
    if (row && row.type === 'tool') {
      const entry = result.entries.find(e => e.id === row.id);
      if (entry) panelInfo = toolInfo(entry);
    }
  };

  // single state write → ONE paint per keypress (selection + window together)
  const setCursor = (updater) => {
    cursor = updater(cursor);
    refreshPanel();
    render();
  };

  // dots_12 loader loop — runs ONLY while scanning (result === null); it
  // self-clears once the scan resolves. Re-created by rescan().
  const startLoader = () => {
    if (frameTimer) clearInterval(frameTimer);
    frameTimer = setInterval(() => {
      if (result) { clearInterval(frameTimer); frameTimer = null; return; }
      frame += 1;
      render();
    }, FRAME_INTERVAL);
  };

  const onScanProgress = (done, total) => {
    progress = { done, total };
    render();
  };

  const applyResult = (res) => {
    result = res;
    cursor = { selected: 0, top: 0 };
    focus = 'list';
    buttonIdx = 0;
    if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
    refreshPanel(); // fresh scan → selection on a header → placeholder panel
    render();
  };

  // FULL manual rescan (F5 / Shift+R): drops the current result, restarts the
  // loader and reruns the scan from scratch. Never runs while a scan is
  // already in flight (result === null IS the scanning state).
  const rescan = () => {
    if (!result) return;
    result = null;
    progress = null;
    frame = 0;
    cursor = { selected: 0, top: 0 };
    focus = 'list';
    buttonIdx = 0;
    startLoader();
    render();
    Promise.resolve()
      .then(() => scan(onScanProgress))
      .then(applyResult);
  };

  const onData = (chunk) => {
    if (dead) return;
    const key = parseKey(chunk);
    if (key.q || key.ctrlC) {
      stop();
      if (onExit) onExit();
      return;
    }
    // ENABLED buttons only — the hover never rests on a dimmed one; with all
    // dimmed the → key simply does nothing (hover stays in the list)
    const enabledButtons = () => (panelInfo && panelInfo.flags
      ? BUTTONS.map((b, i) => (panelInfo.flags[b.flag] ? i : -1)).filter(i => i >= 0)
      : []);

    if (key.up || key.down) {
      if (focus === 'buttons') {
        const enabled = enabledButtons();
        if (enabled.length > 0) {
          const pos = enabled.indexOf(buttonIdx);
          const next = ((pos + (key.down ? 1 : -1)) % enabled.length + enabled.length) % enabled.length;
          buttonIdx = enabled[next];
          render();
        }
      } else {
        move(key.up ? -1 : 1);
      }
    } else if (key.right) {
      // → moves the hover from a tool row onto the FIRST ENABLED action button
      const enabled = enabledButtons();
      if (panelInfo && enabled.length > 0) {
        focus = 'buttons';
        buttonIdx = enabled[0];
        render();
      }
    } else if (key.left) {
      if (focus === 'buttons') { focus = 'list'; render(); }
    } else if (key.enter || key.space) {
      if (focus === 'list') toggle(); // Enter on a button = Phase 4 action
    } else if (key.f5 || key.shiftR) {
      rescan();
    }
    // lowercase r: intentionally unbound (remove in Phase 4)
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
      startLoader();
      Promise.resolve()
        .then(() => scan(onScanProgress))
        .then(applyResult);
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

module.exports = { createToolsApp, runToolsTui, buildView, buildPanel };
