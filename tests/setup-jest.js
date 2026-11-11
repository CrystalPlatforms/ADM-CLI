// Jest global setup.

// Force chalk's colors OFF for the whole test run. On a dev machine jest
// stdout IS a TTY, so chalk would wrap ✓/✗ marks in ANSI escapes and every
// assertion on plain text (e.g. '✓ Git installed\n') would fail only on the
// developer's terminal — never on CI (non-TTY). Tests must be
// environment-independent: no colors anywhere under jest.
require('chalk').level = 0;
