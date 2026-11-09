// Minimal in-place spinner — a flicker-free ora substitute for plain
// Windows consoles.
//
// ora repaints with "clear line" + "write frame" as separate writes and uses
// braille glyphs (double-width on Windows) — the visible result on consoles
// without double buffering is flicker on every frame. This spinner overwrites
// the same line with `\r` + a fixed-width ASCII frame in ONE write, so the
// console never shows an intermediate empty frame.
const chalk = require('chalk');

const FRAMES = ['-', '\\', '|', '/'];

function miniSpinner(text, opts = {}) {
  const stdout = opts.stdout || process.stdout;
  const interval = opts.interval || 90;
  let timer = null;
  let frame = 0;
  let current = text;
  let active = false;
  let startedAt = 0;

  const paint = () => {
    if (!active) return;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    // show elapsed time after 3s — heavy installs look "stuck" otherwise
    const time = elapsed >= 3 ? chalk.dim(` [${elapsed}s]`) : '';
    const line = `${FRAMES[frame % FRAMES.length]} ${current}${time}`;
    stdout.write(`\r${line}`); // single write, same line — no erase, no flash
    frame++;
  };

  const stopPaint = () => {
    if (timer) { clearInterval(timer); timer = null; }
  };

  const finish = (mark, msg, color) => {
    stopPaint();
    active = false;
    stdout.write(`\r\x1b[2K${mark} ${msg || current}\n`);
  };

  return {
    start(t) {
      if (t) current = t;
      active = true;
      frame = 0;
      startedAt = Date.now();
      paint();
      timer = setInterval(paint, interval);
      // keep the process ticking until stopped (mirrors ora's behavior)
      if (timer.unref) timer.unref();
      return this;
    },
    text(t) { current = t; paint(); return this; },
    succeed(msg) { finish(chalk.green('✓'), msg, 'green'); return this; },
    fail(msg) { finish(chalk.red('✗'), msg, 'red'); return this; },
    info(msg) { finish(chalk.yellow('i'), msg, 'yellow'); return this; },
    stop() {
      stopPaint();
      active = false;
      stdout.write('\r\x1b[2K');
      return this;
    },
  };
}

module.exports = { miniSpinner };
