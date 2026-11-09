const path = require('path');
const { upsertRcEntry } = require('./shell-paths');

// npm global-prefix repair without sudo (#29, story 16).
//
// When npm's global prefix is a system directory (/usr, /usr/local) that the
// user cannot write to, `npm install -g` fails with EACCES. The fix:
//   1. `npm config set prefix ~/.npm-global`
//   2. PATH entry for ~/.npm-global/bin in the current shell's rc (marker)
// Both steps are idempotent; step 2 goes through shell-paths.

// System prefixes where a plain `npm install -g` needs root.
const SYSTEM_PREFIXES = ['/usr', '/usr/local', '/usr/lib'];

function defaultTarget(home) {
  return `${home}${path.sep}.npm-global`;
}

// Checks whether a prefix directory is writable by the current user.
// Injectable fs for tests; missing dir counts as "not writable".
function isWritable(dir, { accessSync, constants } = {}) {
  accessSync = accessSync || require('fs').accessSync;
  constants = constants || require('fs').constants;
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Runs `npm config get prefix` (exec injectable for tests).
async function getNpmPrefix({ execFunc, platform } = {}) {
  execFunc = execFunc || require('child_process').exec;
  const res = await new Promise((resolve) => {
    execFunc('npm config get prefix', { shell: platform === 'win32' ? undefined : 'sh' }, (err, stdout) => {
      resolve({ err, out: String(stdout || '').trim() });
    });
  });
  return res.out || '';
}

// True when the prefix needs repair: it is a known system prefix AND not
// writable by the current user. Windows prefixes (%APPDATA%\npm) are
// user-writable — never needs repair there.
function prefixNeedsRepair(prefix, { home, platform, accessSync, constants } = {}) {
  if (platform === 'win32') return false;
  if (!prefix) return false;
  const normalized = String(prefix).replace(/\/+$/, '');
  const system = SYSTEM_PREFIXES.some(p => normalized === p || normalized.startsWith(`${p}/`));
  if (!system) return false;
  return !isWritable(normalized, { accessSync, constants });
}

// Applies the repair. Returns:
//   { repaired, prefix, target, rcFile, hint }
//   { repaired: false, reason } when nothing needed doing or a step failed.
async function repairNpmPrefix(opts = {}) {
  const {
    home = require('os').homedir(),
    platform = process.platform,
    execFunc,
    rcFile,
    shellPaths = upsertRcEntry,
  } = opts;

  if (platform === 'win32') {
    return { repaired: false, reason: 'windows — npm prefix is user-writable by default' };
  }

  const target = defaultTarget(home);
  const exec = execFunc || require('child_process').exec;

  // 1. point npm's global prefix at ~/.npm-global
  const set = await new Promise((resolve) => {
    exec(`npm config set prefix "${target}"`, { shell: 'sh' }, (err) => resolve({ err }));
  });
  if (set.err) {
    return { repaired: false, reason: `npm config set prefix failed: ${set.err.message}`, hint: `  ${'mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global'}` };
  }

  // 2. PATH entry (idempotent, marker-managed)
  let rc = null;
  try {
    const res = shellPaths({ rcFile, entry: 'npm-global', home });
    rc = res.rcFile;
  } catch {
    rc = null;
  }

  return {
    repaired: true,
    prefix: target,
    target,
    rcFile: rc,
    hint: [
      'npm prefix repaired — future global installs go to ~/.npm-global (no sudo).',
      'Open a new shell or copy & run to use it right now:',
      '  export PATH="$HOME/.npm-global/bin:$PATH"',
    ].join('\n'),
  };
}

// Binary dir for a given npm prefix (unix appends /bin; windows is flat).
function npmBinDir(prefix, platform = process.platform) {
  if (!prefix) return null;
  return platform === 'win32' ? prefix : `${prefix.replace(/\/+$/, '')}/bin`;
}

module.exports = { repairNpmPrefix, prefixNeedsRepair, getNpmPrefix, npmBinDir, SYSTEM_PREFIXES, isWritable, defaultTarget };
