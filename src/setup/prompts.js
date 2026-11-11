const chalk = require('chalk');

// A flicker-free checkbox prompt — a small, self-contained replacement for
// inquirer's checkbox on plain Windows consoles.
//
// Why not inquirer@8: its ScreenManager repaints with "erase N lines" and
// "write content" as TWO separate stdout writes, so terminals without double
// buffering briefly show an empty area — a visible flash on EVERY keypress.
// This prompt composes erase + full content into ONE write() per render,
// uses ASCII-only glyphs ([x]/[ ]), and keeps the cursor hidden while active.
//
// Same choice contract as inquirer: { name, value, checked?, disabled? }
// disabled: true or a reason string — rendered dim, not selectable.
// Resolves with the array of selected (non-disabled) values.

// Erases the previous frame (n lines up + clear-to-bottom) — always paired
// with the new content in the same write().
function eraseFrame(lines) {
  if (lines <= 0) return '';
  return `\x1b[${lines - 1}A\r\x1b[J`;
}

function checkboxPrompt(options) {
  const {
    name = '',
    message,
    choices,
    pageSize = 7,
    stdout = process.stdout,
    stdin = process.stdin,
    inputStream, // test hook: Event-emitter standing in for raw stdin
  } = options;

  return new Promise((resolve, reject) => {
    if (!stdin.isTTY && !inputStream) {
      reject(new Error('checkboxPrompt needs a terminal (TTY)'));
      return;
    }

    // ── state ───────────────────────────────────────────────────
    const state = choices.map(c => ({
      ...c,
      checked: Boolean(c.checked) && !c.disabled,
      isDisabled: Boolean(c.disabled),
    }));
    let index = 0;
    let top = 0;
    let drawnLines = 0;
    let settled = false;

    const visibleCount = () => Math.min(state.length, Math.max(1, pageSize));

    const clampScroll = () => {
      const vis = visibleCount();
      if (index < top) top = index;
      if (index >= top + vis) top = index - vis + 1;
      if (top > state.length - vis) top = Math.max(0, state.length - vis);
    };

    const firstSelectable = () => state.findIndex(c => !c.isDisabled);
    const lastSelectable = () => {
      for (let i = state.length - 1; i >= 0; i--) if (!state[i].isDisabled) return i;
      return state.length - 1;
    };
    const nextSelectable = (from, dir) => {
      let i = from;
      for (let step = 0; step < state.length; step++) {
        i = (i + dir + state.length) % state.length;
        if (!state[i].isDisabled) return i;
      }
      return from;
    };

    // ── rendering (one write per frame) ─────────────────────────
    const content = () => {
      const lines = [];
      lines.push(`? ${message}`);
      clampScroll();
      const vis = visibleCount();
      for (let i = top; i < top + vis; i++) {
        const c = state[i];
        const marker = c.checked ? '[x]' : '[ ]';
        const pointer = i === index ? chalk.red.bold('>') : ' ';
        const label = c.isDisabled
          ? chalk.dim(`${c.name}${typeof c.disabled === 'string' ? ` (${c.disabled})` : ' (locked)'}`)
          : c.name;
        const line = `${pointer} ${marker} ${label}`;
        // the active row is red + bold so it clearly stands out
        lines.push(i === index ? chalk.red.bold(line) : line);
      }
      lines.push(chalk.dim('  arrows = move · space = select · enter = done'));
      return lines;
    };

    const render = () => {
      const lines = content();
      const chunk = (drawnLines > 0 ? eraseFrame(drawnLines) : '\x1b[?25l') + lines.join('\n');
      drawnLines = lines.length;
      stdout.write(chunk); // THE fix: erase + content in a single atomic write
    };

    const close = () => {
      settled = true;
      if (inputStream) {
        inputStream.removeListener('keypress', onKey);
      } else {
        stdin.removeListener('keypress', onKey);
        if (stdin.setRawMode) stdin.setRawMode(false);
        stdin.pause && stdin.pause();
        stdin.resume && stdin.resume();
      }
      stdout.removeListener('resize', onResize);
      stdout.write(eraseFrame(drawnLines) + '\x1b[?25h'); // remove the block, show cursor
    };

    const finish = () => {
      if (settled) return;
      close();
      resolve(state.filter(c => c.checked && !c.isDisabled).map(c => c.value));
    };

    const abort = () => {
      if (settled) return;
      close();
      const err = new Error('cancelled');
      err.code = 'ADM_CANCELLED';
      reject(err);
    };

    // ── keys ────────────────────────────────────────────────────
    const onKey = (ch, key = {}) => {
      const seq = key.name ? key.name : String(ch || '');
      if (key.ctrl && seq === 'c') { abort(); return; }
      switch (seq) {
        case 'up':
        case 'k':
          index = nextSelectable(index, -1);
          break;
        case 'down':
        case 'j':
          index = nextSelectable(index, 1);
          break;
        case 'space':
          if (!state[index].isDisabled) state[index].checked = !state[index].checked;
          break;
        case 'enter':
        case 'return':
          finish();
          return;
        default:
          return; // unknown key → no repaint
      }
      if (!settled) render();
    };

    const onResize = () => {
      if (!settled) { drawnLines = 0; render(); }
    };

    stdout.on('resize', onResize);

    if (inputStream) {
      inputStream.on('keypress', onKey);
    } else {
      const readline = require('readline');
      readline.emitKeypressEvents(stdin);
      if (stdin.setRawMode) stdin.setRawMode(true);
      stdin.resume();
      stdin.on('keypress', onKey);
    }

    render();
  });
}

// A flicker-free y/n confirm — the same single-write philosophy as
// checkboxPrompt. Renders "? message (y/n)" on one line; y/n answer
// immediately, Enter takes the default, Ctrl+C cancels (ADM_CANCELLED).
// On answer the question is ATOMICALLY replaced (one write) by the
// caller's `answerLine(confirmed)` done-format line — zero flicker on the
// transition (owner fix, 0.3.x: the inquirer confirm left its rows on
// screen and the erase/redraw blink was visible).
function confirmPrompt(options) {
  const {
    message,
    defaultValue = false,
    answerLine = () => '',
    stdout = process.stdout,
    stdin = process.stdin,
    inputStream,
  } = options;

  return new Promise((resolve, reject) => {
    if (!stdin.isTTY && !inputStream) {
      reject(new Error('confirmPrompt needs a terminal (TTY)'));
      return;
    }

    const cols = () => Math.max(20, (stdout.columns || 80) - 1);
    const plain = s => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    const question = `? ${message} ${chalk.dim('(y/n)')}`;
    let rows = Math.max(1, Math.ceil((plain(question).length + 4) / cols()));
    let settled = false;

    const eraseStr = () => (rows > 1 ? `\x1b[${rows - 1}A` : '') + '\r\x1b[J';

    const detach = () => {
      if (inputStream) {
        inputStream.removeListener('keypress', onKey);
      } else {
        stdin.removeListener('keypress', onKey);
        if (stdin.setRawMode) stdin.setRawMode(false);
        stdin.pause && stdin.pause();
        stdin.resume && stdin.resume();
      }
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      detach();
      // ONE atomic write: hide-cursor cleanup + erase question + done line
      stdout.write(eraseStr() + answerLine(value) + '\n' + '\x1b[?25h');
      resolve(value);
    };

    const abort = () => {
      if (settled) return;
      settled = true;
      detach();
      stdout.write(eraseStr() + '\x1b[?25h');
      const err = new Error('cancelled');
      err.code = 'ADM_CANCELLED';
      reject(err);
    };

    const onKey = (ch, key = {}) => {
      const seq = key.name ? key.name : String(ch || '').toLowerCase();
      if (key.ctrl && seq === 'c') { abort(); return; }
      if (seq === 'y') { finish(true); return; }
      if (seq === 'n') { finish(false); return; }
      if (seq === 'enter' || seq === 'return') { finish(defaultValue); return; }
    };

    stdout.write('\x1b[?25l' + question); // hide cursor + render, one write

    if (inputStream) {
      inputStream.on('keypress', onKey);
    } else {
      const readline = require('readline');
      readline.emitKeypressEvents(stdin);
      if (stdin.setRawMode) stdin.setRawMode(true);
      stdin.resume();
      stdin.on('keypress', onKey);
    }
  });
}

module.exports = { checkboxPrompt, confirmPrompt, eraseFrame };
