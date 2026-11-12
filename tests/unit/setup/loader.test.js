const { loader, FRAMES } = require('../../../src/setup/loader');

// dots_12 loader (owner decision, 0.3.x): replaces the ASCII \|/- spinner.
// Frames from cli-spinners/cli-loaders (MIT).

function fakeStdout() {
  const writes = [];
  return {
    writes,
    columns: 80,
    isTTY: true,
    write: s => writes.push(s),
  };
}

describe('loader — dots_12 frames', () => {
  test('56 frames, each exactly 2 chars wide (braille pair)', () => {
    expect(FRAMES).toHaveLength(56);
    for (const f of FRAMES) {
      expect(f).toHaveLength(2);
      // braille block + braille blank — no plain ASCII spinner glyphs
      expect(f).not.toMatch(/[|/\\-]/);
    }
  });

  test('paints the first frame and advances on the interval', () => {
    jest.useFakeTimers();
    const out = fakeStdout();
    const s = loader('Preparing...', { stdout: out, interval: 80 });
    s.start();
    expect(out.writes.join('')).toContain('⢀⠀ Preparing...');
    jest.advanceTimersByTime(400); // ~5 frames
    const painted = out.writes.join('');
    // the interval kept repainting
    expect(painted.split('Preparing...').length - 1).toBeGreaterThanOrEqual(2);
    s.stop();
    jest.useRealTimers();
  });

  test('wrap-aware: a long frame erases every row it occupied', () => {
    jest.useFakeTimers();
    const out = fakeStdout(); // columns 80 → a 150-char line wraps to 3 rows
    const s = loader(`Installing Git (${'x'.repeat(150)})`, { stdout: out, interval: 80 });
    s.start();
    expect(out.writes.join('')).toContain('Installing Git (');
    jest.advanceTimersByTime(80); // second paint must erase ALL wrapped rows
    const all = out.writes.join('');
    expect(all).toMatch(/\x1b\[\d+A/); // cursor moved UP (multi-row erase)…
    expect(all).toContain('\x1b[J');   // …and cleared to end of screen
    s.stop();
    jest.useRealTimers();
  });

  test('succeed/fail/info leave a marked line; stop clears without a mark', () => {
    const out = fakeStdout();
    const s = loader('Working...', { stdout: out });
    s.start();
    s.succeed('Git installed');
    expect(out.writes.join('')).toContain('✓ Git installed\n');
    // the cursor is hidden while animating and restored on finish
    expect(out.writes.join('')).toContain('\x1b[?25l');
    expect(out.writes.join('')).toContain('\x1b[?25h');

    const s2 = loader('Working...', { stdout: out });
    s2.start();
    s2.stop();
    expect(out.writes.join('')).toContain('\r\x1b[J');
    expect(out.writes.join('')).not.toContain('✓ Working');
  });

  test('the loader renders in the default terminal color (no cyan/blue)', () => {
    const out = fakeStdout();
    const s = loader('Preparing...', { stdout: out });
    s.start();
    s.stop();
    // no ANSI color codes around the frame (cursor moves are fine)
    const colored = out.writes.join('').match(/\x1b\[3\d?m|\x1b\[9\d?m/g);
    expect(colored).toBeNull();
  });

  test('the loader line carries the full command it was given', () => {
    const out = fakeStdout();
    const cmd = 'winget install --id Git.Git --exact --accept-source-agreements --accept-package-agreements';
    const s = loader(`Installing Git (${cmd})`, { stdout: out });
    s.start();
    expect(out.writes.join('')).toContain(`Installing Git (${cmd})`);
    s.stop();
  });
});
