const { repairNpmPrefix, prefixNeedsRepair, npmBinDir, defaultTarget } = require('../../../src/install/npm-prefix');

// AC (#29): /usr prefix + EACCES simulation → ~/.npm-global set,
// PATH entry added, hint in result.
describe('npm-prefix repair', () => {
  const constants = { W_OK: 2 };

  describe('prefixNeedsRepair', () => {
    const access = (dir) => {
      if (dir.startsWith('/usr')) { const e = new Error('denied'); e.code = 'EACCES'; throw e; }
    };

    test('/usr prefix + EACCES simulation → needs repair', () => {
      expect(prefixNeedsRepair('/usr', { platform: 'linux', accessSync: access, constants })).toBe(true);
    });

    test('writable system prefix → no repair needed', () => {
      expect(prefixNeedsRepair('/usr', { platform: 'linux', accessSync: () => {}, constants })).toBe(false);
    });

    test('user prefix (writable) → no repair', () => {
      expect(prefixNeedsRepair('/home/dev/.npm-global', { platform: 'linux', accessSync: () => {}, constants })).toBe(false);
    });

    test('windows never needs repair', () => {
      expect(prefixNeedsRepair('C:\\Program Files\\nodejs', { platform: 'win32' })).toBe(false);
    });

    test('empty prefix → no repair', () => {
      expect(prefixNeedsRepair('', { platform: 'linux' })).toBe(false);
    });
  });

  describe('repairNpmPrefix', () => {
    test('sets ~/.npm-global prefix and adds the rc PATH entry', async () => {
      const commands = [];
      const execFunc = (cmd, opts, cb) => { commands.push({ cmd, shell: opts.shell }); cb(null, '', ''); };
      const rcCalls = [];
      const shellPaths = (o) => { rcCalls.push(o); return { changed: true, rcFile: o.rcFile }; };

      const res = await repairNpmPrefix({
        home: '/home/dev',
        platform: 'linux',
        execFunc,
        rcFile: '.bashrc',
        shellPaths,
      });

      expect(res.repaired).toBe(true);
      expect(res.prefix).toBe(defaultTarget('/home/dev'));
      expect(defaultTarget('/home/dev')).toContain('.npm-global');
      // 1. npm config set prefix was executed in sh
      expect(commands[0].cmd).toContain('npm config set prefix');
      expect(commands[0].cmd).toContain('.npm-global');
      expect(commands[0].shell).toBe('sh');
      // 2. PATH entry went through shell-paths with the npm-global entry key
      expect(rcCalls).toHaveLength(1);
      expect(rcCalls[0].entry).toBe('npm-global');
      expect(rcCalls[0].rcFile).toBe('.bashrc');
      // 3. hint carries a ready-to-use PATH command
      expect(res.hint).toContain('export PATH="$HOME/.npm-global/bin:$PATH"');
    });

    test('npm config failure → not repaired, hint with a copyable command', async () => {
      const execFunc = (cmd, opts, cb) => cb(new Error('npm: not found'));
      const res = await repairNpmPrefix({
        home: '/home/dev', platform: 'linux', execFunc, shellPaths: () => ({}),
      });
      expect(res.repaired).toBe(false);
      expect(res.hint).toContain('npm config set prefix');
    });

    test('windows → no-op', async () => {
      const res = await repairNpmPrefix({ platform: 'win32' });
      expect(res.repaired).toBe(false);
      expect(res.reason).toContain('windows');
    });
  });

  test('npmBinDir: unix appends /bin, windows is flat', () => {
    expect(npmBinDir('/home/dev/.npm-global', 'linux')).toBe('/home/dev/.npm-global/bin');
    expect(npmBinDir('C:\\npm', 'win32')).toBe('C:\\npm');
    expect(npmBinDir('', 'linux')).toBeNull();
  });
});
