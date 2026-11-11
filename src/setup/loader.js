// Loader — the dots_12 braille animation (56 frames), ADM's own spinner.
// Replaces the ASCII \|/- spinner everywhere ADM "works": startup
// (Preparing…), tool-status scan (Scanning…), per-tool install lines.
//
// Frames: dots_12 from cli-spinners/cli-loaders — MIT license.
//   https://cliloaders.com/dots_12 · https://github.com/cbmongithub/cli-loaders
//   (frames also mirrored in the repo root loader.txt)
//
// Wrap-aware: install lines carry the FULL command in parentheses, so a
// frame can span several terminal rows — every repaint erases ALL rows the
// previous frame occupied (a plain `\r\x1b[2K` would leave leftovers).
//
// The terminal cursor is HIDDEN while the loader animates (it would blink
// on top of the frame) and restored on every finish/stop.
const chalk = require('chalk');

const FRAMES = [
  '⢀⠀', '⡀⠀', '⠄⠀', '⢂⠀', '⡂⠀', '⠅⠀', '⢃⠀', '⡃⠀', '⠍⠀', '⢋⠀', '⡋⠀',
  '⠍⠁', '⢋⠁', '⡋⠁', '⠍⠉', '⠋⠉', '⠋⠉', '⠉⠙', '⠉⠙', '⠉⠩', '⠈⢙', '⠈⡙',
  '⢈⠩', '⡀⢙', '⠄⡙', '⢂⠩', '⡂⢘', '⠅⡘', '⢃⠨', '⡃⢐', '⠍⡐', '⢋⠠', '⡋⢀',
  '⠍⡁', '⢋⠁', '⡋⠁', '⠍⠉', '⠋⠉', '⠋⠉', '⠉⠙', '⠉⠙', '⠉⠩', '⠈⢙', '⠈⡙',
  '⠈⠩', '⠀⢙', '⠀⡙', '⠀⠩', '⠀⢘', '⠀⡘', '⠀⠨', '⠀⢐', '⠀⡐', '⠀⠠', '⠀⢀',
  '⠀⡀',
];

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

// Same method contract as miniSpinner (start/text/succeed/fail/info/stop),
// so the wizard's spinnerFactory injection works with either.
// Owner decision: the frame + text render in the terminal's default color
// (white) — no cyan/blue tint.
function loader(text, opts = {}) {
  const stdout = opts.stdout || process.stdout;
  const interval = opts.interval || 80;
  const frames = opts.frames || FRAMES;
  let current = text;
  let frame = 0;
  let timer = null;
  let active = false;
  let rows = 0; // visual rows the currently painted frame occupies
  let startedAt = 0;

  const cols = () => Math.max(20, (stdout.columns || 80) - 1);

  // erase-string for the currently painted frame
  const eraseStr = () => {
    if (rows <= 0) return '';
    return (rows > 1 ? `\x1b[${rows - 1}A` : '') + '\r\x1b[J';
  };

  // ONE atomic write per repaint (erase + content together) — separate
  // writes flicker on consoles without double buffering.
  const paint = () => {
    if (!active) return;
    const elapsed = Date.now() - startedAt;
    // long installs show the elapsed time — same contract as before
    const time = elapsed >= 3000 ? chalk.dim(` [${Math.floor(elapsed / 1000)}s]`) : '';
    const line = `${frames[frame % frames.length]} ${current}${time}`;
    stdout.write(eraseStr() + line);
    rows = Math.max(1, Math.ceil(stripAnsi(line).length / cols()));
    frame++;
  };

  const stopPaint = () => {
    if (timer) { clearInterval(timer); timer = null; }
  };

  const finish = (mark, msg) => {
    stopPaint();
    active = false;
    // cursor back + erase + status line in ONE write — no flicker
    stdout.write('\x1b[?25h' + eraseStr() + `${mark} ${msg || current}\n`);
    rows = 0;
  };

  return {
    start(t) {
      if (t) current = t;
      active = true;
      frame = 0;
      startedAt = Date.now();
      const line = `${frames[frame % frames.length]} ${current}`;
      stdout.write('\x1b[?25l' + (rows > 0 ? eraseStr() : '') + line);
      rows = Math.max(1, Math.ceil(stripAnsi(line).length / cols()));
      frame++;
      timer = setInterval(paint, interval);
      if (timer.unref) timer.unref();
      return this;
    },
    text(t) { current = t; paint(); return this; },
    succeed(msg) { finish(chalk.green('✓'), msg); return this; },
    fail(msg) { finish(chalk.red('✗'), msg); return this; },
    info(msg) { finish(chalk.yellow('i'), msg); return this; },
    stop() {
      stopPaint();
      if (active) {
        active = false;
        stdout.write('\x1b[?25h' + eraseStr());
        rows = 0;
      }
      return this;
    },
  };
}

module.exports = { loader, FRAMES };
