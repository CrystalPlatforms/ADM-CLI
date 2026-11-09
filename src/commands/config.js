const { detectEnvironment, formatEnvironment } = require('../platform');
const { configDir, readConfig } = require('../config');
const { getVersion } = require('./version');

// `adm config` — human-readable view.
// `adm config --json` — machine-readable view with a frozen key set:
//   version, configDir, configFile, os, distro, distroVersion,
//   manager, arch, isWSL, shell, rcFile
async function runConfig({ json, log, err } = {}) {
  log = log || (s => process.stdout.write(s + '\n'));
  err = err || (s => process.stderr.write(s + '\n'));

  let saved = {};
  try {
    saved = await readConfig();
  } catch {
    saved = {};
  }

  const dir = configDir();
  const file = require('path').join(dir, 'config.json');
  const env = detectEnvironment();

  if (json) {
    log(JSON.stringify({
      version: getVersion(),
      configDir: dir,
      configFile: file,
      os: env.os,
      distro: env.distro,
      distroVersion: env.distroVersion,
      manager: env.manager,
      arch: env.arch,
      isWSL: env.isWSL,
      shell: env.shell,
      rcFile: env.rcFile,
    }, null, 2));
    return 0;
  }

  const lines = [
    `ADM v${getVersion()}`,
    '',
    'Paths:',
    `  Config dir:   ${dir}`,
    `  Config file:  ${file}`,
    '',
    'Environment:',
    formatEnvironment(env),
    '',
    'Saved config:',
  ];
  const keys = Object.keys(saved);
  if (keys.length === 0) {
    lines.push('  (empty)');
  } else {
    for (const key of keys) {
      const value = JSON.stringify(saved[key]);
      lines.push(`  ${key}: ${value.length > 80 ? value.slice(0, 77) + '...' : value}`);
    }
  }
  log(lines.join('\n'));
  return 0;
}

module.exports = { runConfig };
