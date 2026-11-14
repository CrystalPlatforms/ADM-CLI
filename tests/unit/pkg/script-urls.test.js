const { resolveScript } = require('../../../src/pkg/script-urls');

describe('script URL resolver — per OS×arch', () => {
  test('conda resolves the Miniconda asset for each platform pair', () => {
    expect(resolveScript('conda', 'linux', 'x64').url)
      .toBe('https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh');
    expect(resolveScript('conda', 'linux', 'arm64').url)
      .toBe('https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh');
    expect(resolveScript('conda', 'darwin', 'x64').url)
      .toBe('https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh');
    expect(resolveScript('conda', 'darwin', 'arm64').url)
      .toBe('https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-arm64.sh');
  });

  test('conda commands run through sh with a real script path', () => {
    const r = resolveScript('conda', 'linux', 'arm64');
    expect(r.run).toContain('sh /tmp/miniconda.sh');
    expect(r.run).not.toContain('/bin/bash');
  });

  test('bun serves the same installer on linux and macOS (x64 and arm64)', () => {
    for (const [os, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
      const r = resolveScript('bun', os, arch);
      expect(r.url).toBe('https://bun.sh/install');
      expect(r.run).toBe('curl -fsSL https://bun.sh/install | sh');
    }
  });

  test('gcloud uses the universal installer on linux/macOS', () => {
    for (const [os, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
      const r = resolveScript('gcloud', os, arch);
      expect(r.url).toBe('https://sdk.cloud.google.com');
      expect(r.run).toContain('https://sdk.cloud.google.com');
    }
  });

  test('azure-cli uses aka.ms installer on linux/macOS, manual hint on windows', () => {
    for (const [os, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
      const r = resolveScript('azure-cli', os, arch);
      expect(r.url).toBe('https://aka.ms/InstallAzureCli');
    }
    expect(resolveScript('azure-cli', 'win32', 'x64').manual).toContain('winget');
  });

  test('no POSIX /bin/bash hardcoding anywhere in generated commands', () => {
    const { SCRIPTS } = require('../../../src/pkg/script-urls');
    // homebrew is exempt: its OFFICIAL installer line is
    // /bin/bash -c "$(curl -fsSL …)" — the upstream script is bash-only,
    // so this is the documented official command, not a portability hardcode.
    const BASH_OFFICIAL = new Set(['homebrew']);
    for (const [id, table] of Object.entries(SCRIPTS)) {
      for (const [pair, fn] of Object.entries(table)) {
        const r = fn();
        if (r.run && !BASH_OFFICIAL.has(id)) {
          expect({ id, pair, run: r.run }).toEqual(
            expect.objectContaining({ run: expect.not.stringContaining('/bin/bash') }),
          );
        }
      }
    }
  });

  test('bazelisk downloads the right binary per platform', () => {
    expect(resolveScript('bazel', 'linux', 'x64').run).toContain('bazelisk-linux-amd64');
    expect(resolveScript('bazel', 'linux', 'arm64').run).toContain('bazelisk-linux-arm64');
    expect(resolveScript('bazel', 'darwin', 'arm64').run).toContain('bazelisk-darwin-arm64');
  });

  test('rustup picks the windows init by architecture', () => {
    expect(resolveScript('rustup', 'win32', 'x64').url).toBe('https://win.rustup.rs/x86_64');
    expect(resolveScript('rustup', 'win32', 'arm64').url).toBe('https://win.rustup.rs/aarch64');
  });

  test('unknown script tool → manual with a reason', () => {
    const r = resolveScript('mystery-tool', 'linux', 'x64');
    expect(r.manual).toContain('mystery-tool');
  });
});
