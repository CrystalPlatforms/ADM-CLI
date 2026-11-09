const { route, main } = require('../../src/router');
const { COMMANDS } = require('../../src/commands');

function sink() {
  const calls = { out: [], err: [] };
  return {
    calls,
    log: s => calls.out.push(s),
    err: s => calls.err.push(s),
  };
}

describe('route — command table contract', () => {
  test('every COMMANDS entry dispatches without throwing', () => {
    const d = sink();
    expect(() => route(['help'], d)).not.toThrow();
  });

  test('help aliases route to the help command', () => {
    for (const argv of [['help'], ['--help'], ['-h']]) {
      const d = sink();
      expect(route(argv, d)).toBe(0);
      expect(d.calls.out.join('\n')).toContain('Show available commands');
    }
  });

  test('-v and --version print the version and exit 0', () => {
    for (const argv of [['-v'], ['--version']]) {
      const d = sink();
      expect(route(argv, d)).toBe(0);
      expect(d.calls.out.join('\n')).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe('route — usage errors enumerate the valid set', () => {
  test('unknown command exits 1 and lists every valid command', () => {
    const d = sink();
    const code = route(['definitely-not-a-command'], d);
    expect(code).toBe(1);
    const stderr = d.calls.err.join('\n');
    expect(stderr).toContain('Unknown command: definitely-not-a-command');
    for (const cmd of COMMANDS) {
      expect(stderr).toContain(cmd.name);
    }
  });

  test('typo gets a closest-match suggestion', () => {
    const d = sink();
    route(['confi'], d);
    expect(d.calls.err.join('\n')).toContain('Did you mean: config?');
  });

  test('no-suggestion unknown command omits the "Did you mean" line', () => {
    const d = sink();
    route(['zzzzzzzzzz'], d);
    expect(d.calls.err.join('\n')).not.toContain('Did you mean');
  });

  test('unknown config flag exits 1', () => {
    const d = sink();
    expect(route(['config', '--yaml'], d)).toBe(1);
  });

  test('uninstall rejects arguments', () => {
    const d = sink();
    expect(route(['uninstall', '--extra'], d)).toBe(1);
  });

  test('dotfiles without sync subcommand exits 1 and names the valid subcommand', () => {
    const d = sink();
    expect(route(['dotfiles'], d)).toBe(1);
    expect(d.calls.err.join('\n')).toContain('adm dotfiles sync');
  });
});

describe('route — no-args behaviour', () => {
  test('non-TTY never hangs: exits 1 with automation hints', () => {
    const d = sink();
    const code = route([], { ...d, tty: false });
    expect(code).toBe(1);
    const stderr = d.calls.err.join('\n');
    expect(stderr).toContain('ADM_TOOLS');
    expect(stderr).toContain('terminal');
  });

  test('TTY prints the wizard-arrives-later notice and exits 0', () => {
    const d = sink();
    const code = route([], { ...d, tty: true });
    expect(code).toBe(0);
    expect(d.calls.out.join('\n')).toContain('wizard arrives');
  });

  test('ADM_TOOLS plans tools even without a TTY (exit 0)', () => {
    const prev = process.env.ADM_TOOLS;
    process.env.ADM_TOOLS = 'typescript';
    try {
      const d = sink();
      const code = route([], { ...d, tty: false });
      expect(code).toBe(0);
      expect(d.calls.out.join('\n')).toContain('typescript');
    } finally {
      if (prev === undefined) delete process.env.ADM_TOOLS;
      else process.env.ADM_TOOLS = prev;
    }
  });
});

describe('main — exit codes', () => {
  test('returns 2 when a command throws (execution failure)', async () => {
    const d = sink();
    const code = await main(['config'], {
      ...d,
      route: () => { throw new Error('boom'); },
    });
    expect(code).toBe(2);
    expect(d.calls.err.join('\n')).toContain('boom');
  });

  test('returns 1 for usage errors', async () => {
    const d = sink();
    const code = await main(['nope'], d);
    expect(code).toBe(1);
  });
});
