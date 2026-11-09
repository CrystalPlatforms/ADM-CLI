const { renderResults } = require('../../../src/install/report');

// Report contract (#29/#30): ✓ installed / ✓ skipped / ✗ failed + hint lines.
describe('renderResults', () => {
  test('marks installed / skipped / failed correctly', () => {
    const text = renderResults([
      { id: 'a', name: 'Tool A', status: 'installed' },
      { id: 'b', name: 'Tool B', status: 'skipped', reason: 'already installed' },
      { id: 'c', name: 'Tool C', status: 'failed', command: 'cmd c', error: 'boom', hint: 'run:\n  fix-it' },
    ]);
    expect(text).toContain('✓ Tool A — installed');
    expect(text).toContain('✓ Tool B — skipped');
    expect(text).toContain('already installed');
    expect(text).toContain('✗ Tool C — failed');
    expect(text).toContain('command: cmd c');
    expect(text).toContain('error: boom');
    expect(text).toContain('hint:');
    expect(text).toContain('  run:');           // hint indented, multi-line
    expect(text).toContain('    fix-it');
    expect(text).toContain('Done: 1 installed, 1 skipped, 1 failed.');
  });

  test('summary can be suppressed (runner adds its own line)', () => {
    const text = renderResults([{ id: 'a', name: 'A', status: 'installed' }], { summary: false });
    expect(text).not.toContain('Done:');
  });

  test('skipped link entries render their url', () => {
    const text = renderResults([
      { id: 'x', name: 'Ext', status: 'skipped', reason: 'manual extension — install from the link', url: 'https://example.com' },
    ], { summary: false });
    expect(text).toContain('https://example.com');
  });
});
