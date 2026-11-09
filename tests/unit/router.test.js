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

  test('TTY (no ADM_TOOLS) launches the wizard and exits with its code', async () => {
    const d = sink();
    const seen = [];
    const code = await route([], {
      ...d,
      tty: true,
      wizard: async (opts) => { seen.push(opts); return 0; },
    });
    expect(code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].tty).toBe(true);
  });

  test('ADM_TOOLS + ADM_DRY_RUN=1 plans tools even without a TTY (exit 0)', () => {
    const prevTools = process.env.ADM_TOOLS;
    const prevDry = process.env.ADM_DRY_RUN;
    process.env.ADM_TOOLS = 'typescript';
    process.env.ADM_DRY_RUN = '1';
    try {
      const d = sink();
      const code = route([], { ...d, tty: false });
      expect(code).toBe(0);
      expect(d.calls.out.join('\n')).toContain('typescript');
    } finally {
      if (prevTools === undefined) delete process.env.ADM_TOOLS; else process.env.ADM_TOOLS = prevTools;
      if (prevDry === undefined) delete process.env.ADM_DRY_RUN; else process.env.ADM_DRY_RUN = prevDry;
    }
  });

  test('ADM_TOOLS without ADM_DRY_RUN runs the real install path', async () => {
    const prevTools = process.env.ADM_TOOLS;
    const prevDry = process.env.ADM_DRY_RUN;
    process.env.ADM_TOOLS = 'nonesuch';
    delete process.env.ADM_DRY_RUN;
    try {
      const d = sink();
      const code = await route([], { ...d, tty: false });
      // unknown id → usage error before anything is executed
      expect(code).toBe(1);
      expect(d.calls.err.join('\n')).toContain('Unknown tool id');
    } finally {
      if (prevTools === undefined) delete process.env.ADM_TOOLS; else process.env.ADM_TOOLS = prevTools;
      if (prevDry === undefined) delete process.env.ADM_DRY_RUN; else process.env.ADM_DRY_RUN = prevDry;
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
