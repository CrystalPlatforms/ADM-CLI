const { EventEmitter } = require('events');
const { checkboxPrompt, eraseFrame } = require('../../../src/setup/prompts');

// The flicker-free checkbox prompt: every render is ONE stdout write
// (erase + content composed together) — the acceptance criterion for "no
// flashing on every keypress" on plain Windows consoles.

function fakeStdout() {
  const writes = [];
  return {
    writes,
    write(s) { writes.push(String(s)); },
    removeListener() {},
    on() {},
  };
}

function fakeStdin() {
  const stream = new EventEmitter();
  stream.isTTY = true; // not a real TTY — we inject inputStream instead
  return stream;
}

const CHOICES = [
  { name: 'Alpha', value: 'alpha' },
  { name: 'Beta', value: 'beta' },
  { name: 'Gamma', value: 'gamma', disabled: 'already installed' },
  { name: 'Delta', value: 'delta' },
];

async function run(keys, { choices = CHOICES, pageSize = 3 } = {}) {
  const stdout = fakeStdout();
  const inputStream = new EventEmitter();
  const p = checkboxPrompt({
    message: 'Pick:',
    choices,
    pageSize,
    stdout,
    inputStream,
  });
  // let the first render happen (the promise starts it synchronously)
  await new Promise(r => setImmediate(r));
  for (const k of keys) inputStream.emit('keypress', k.name || k, k);
  const result = await p;
  return { result, writes: stdout.writes };
}

describe('checkboxPrompt', () => {
  test('space toggles, enter confirms → selected values resolved', async () => {
    const { result } = await run([
      { name: 'space' }, // Alpha on
      { name: 'down' },  // → Beta
      { name: 'space' }, // Beta on
      { name: 'enter' },
    ]);
    expect(result).toEqual(['alpha', 'beta']);
  });

  test('disabled choices are skipped by arrows and cannot be selected', async () => {
    const { result } = await run([
      { name: 'down' },  // 0 Alpha → 1 Beta
      { name: 'down' },  // 1 Beta → skips Gamma → 3 Delta
      { name: 'space' }, // Delta on
      { name: 'up' },    // 3 → skips Gamma → 1 Beta
      { name: 'enter' },
    ]);
    expect(result).toEqual(['delta']);
  });

  test('every keypress repaints erase+content in ONE write (no empty frame)', async () => {
    const { writes } = await run([
      { name: 'down' },
      { name: 'space' },
      { name: 'enter' },
    ]);
    // Each repaint call is a single string containing BOTH the erase
    // sequence and the fresh content — the console never renders an
    // intermediate blank state between the two.
    const repaints = writes.slice(1).filter(w => w.includes('[ ]'));
    expect(repaints.length).toBeGreaterThan(0);
    for (const w of repaints) {
      expect(w).toMatch(/\x1b\[\d+A\r\x1b\[J/); // erase prefix…
      expect(w).toContain('[ ]');               // …and content in the SAME write
    }
  });

  test('page scrolls when pageSize < number of choices', async () => {
    // 4 choices, pageSize 3 — walk down to the last choice, which starts
    // outside the visible window (scroll must follow the pointer)
    const { result } = await run(
      [{ name: 'down' }, { name: 'down' }, { name: 'space' }, { name: 'enter' }],
      { pageSize: 3 },
    );
    expect(result).toEqual(['delta']); // reached the last (off-window) choice
  });

  test('Ctrl+C rejects with ADM_CANCELLED', async () => {
    expect.assertions(1);
    await run([{ name: 'space' }, { name: 'c', ctrl: true }]).catch(e => {
      expect(e.code).toBe('ADM_CANCELLED');
    });
  });

  test('eraseFrame composes cursor-up + clear', () => {
    expect(eraseFrame(3)).toBe('\x1b[2A\r\x1b[J');
    expect(eraseFrame(0)).toBe('');
  });

  test('non-TTY stdin rejects with a clear error', async () => {
    await expect(checkboxPrompt({
      message: 'Pick:', choices: CHOICES,
      stdout: fakeStdout(),
      stdin: { isTTY: false },
    })).rejects.toThrow('TTY');
  });
});
