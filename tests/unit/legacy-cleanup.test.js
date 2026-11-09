const fs = require('fs');
const os = require('os');
const path = require('path');
const { legacyCleanup, LEGACY_FILES } = require('../../src/legacy-cleanup');

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-cleanup-'));
  const prev = process.env.ADM_CONFIG_DIR;
  process.env.ADM_CONFIG_DIR = dir; // isolate from the real ~/.adm
  return { dir, logs: [], errs: [], restore: () => {
    if (prev === undefined) delete process.env.ADM_CONFIG_DIR;
    else process.env.ADM_CONFIG_DIR = prev;
  } };
}

describe('legacyCleanup — first start of v0.3', () => {
  test('removes tokens.enc and ai-knowledge.json, reports, writes cleanedAt', async () => {
    const f = makeFixture();
    fs.writeFileSync(path.join(f.dir, 'tokens.enc'), 'secret');
    fs.writeFileSync(path.join(f.dir, 'ai-knowledge.json'), '{}');
    fs.writeFileSync(path.join(f.dir, 'config.json'), JSON.stringify({ old: true }));

    const result = await legacyCleanup({ log: s => f.logs.push(s), platform: 'linux' });
    f.restore();

    expect(result.skipped).toBe(false);
    expect(result.removed.map(r => path.basename(String(r)))).toEqual(
      expect.arrayContaining(LEGACY_FILES),
    );
    for (const name of LEGACY_FILES) {
      expect(fs.existsSync(path.join(f.dir, name))).toBe(false);
    }
    // other files untouched
    expect(fs.existsSync(path.join(f.dir, 'config.json'))).toBe(true);

    const config = JSON.parse(fs.readFileSync(path.join(f.dir, 'config.json'), 'utf8'));
    expect(config.cleanedAt).toBeTruthy();
    expect(config.old).toBe(true);

    const output = f.logs.join('\n');
    expect(output).toContain('tokens.enc');
    expect(output).toContain('ai-knowledge.json');
  });

  test('writes the cleanedAt marker even when there is nothing to remove', async () => {
    const f = makeFixture();
    const result = await legacyCleanup({ log: s => f.logs.push(s), platform: 'linux' });
    f.restore();

    expect(result.removed).toEqual([]);
    const config = JSON.parse(fs.readFileSync(path.join(f.dir, 'config.json'), 'utf8'));
    expect(config.cleanedAt).toBeTruthy();
    expect(f.logs.join('\n')).not.toContain('removed data');
  });

  test('is idempotent: second start is skipped', async () => {
    const f = makeFixture();
    await legacyCleanup({ log: s => f.logs.push(s), platform: 'linux' });
    const result = await legacyCleanup({ log: s => f.logs.push(s), platform: 'linux' });
    f.restore();
    expect(result.skipped).toBe(true);
  });
});
