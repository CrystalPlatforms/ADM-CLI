const fs = require('fs');
const os = require('os');
const path = require('path');
const { saveReport, reportsDir } = require('../../src/reports');

// Report persistence (owner decision, 0.3.x): every report lands in
// <configDir>/reports/, one file per run. A MISSING config dir fails
// loudly — no auto-creation, no silent skip.

describe('saveReport — persistence to the global cache', () => {
  test('writes <configDir>/reports/report-<stamp>.txt and returns the file', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-rep-'));
    const now = new Date('2026-11-11T15:42:08Z');
    const r = saveReport('install', 'REPORT BODY\n', { configDir, now });
    expect(r.file).toBeTruthy();
    expect(path.basename(r.file)).toBe('report-2026-11-11T15-42-08.txt');
    expect(fs.readFileSync(r.file, 'utf8')).toBe('REPORT BODY\n');
    expect(path.dirname(r.file)).toBe(path.join(configDir, 'reports'));
  });

  test('the reports/ subfolder is auto-created when the config dir exists', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-rep2-'));
    expect(fs.existsSync(path.join(configDir, 'reports'))).toBe(false);
    const r = saveReport('install', 'x', { configDir });
    expect(r.file).toBeTruthy();
    expect(fs.existsSync(path.join(configDir, 'reports'))).toBe(true);
  });

  test('missing config dir → { error }, nothing written, nothing created', () => {
    const missing = path.join(os.tmpdir(), `adm-nope-${Date.now()}`);
    const r = saveReport('install', 'BODY', { configDir: missing });
    expect(r.error).toContain('does not exist');
    expect(r.error).toContain('cannot save report');
    expect(fs.existsSync(path.join(missing, 'reports'))).toBe(false);
  });

  test('reportsDir honors ADM_CONFIG_DIR', () => {
    const prev = process.env.ADM_CONFIG_DIR;
    process.env.ADM_CONFIG_DIR = path.join('x', 'y');
    try {
      expect(reportsDir()).toBe(path.join(path.join('x', 'y'), 'reports'));
    } finally {
      if (prev === undefined) delete process.env.ADM_CONFIG_DIR;
      else process.env.ADM_CONFIG_DIR = prev;
    }
  });
});
