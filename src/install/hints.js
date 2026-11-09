// Hint catalog (#29): a failed install must always end with a hint holding a
// ready-to-copy command. `hintFor` is pure — no I/O — so tests assert on the
// exact strings.

const NPM_PREFIX_FIX = 'mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global';

const HOMEBREW_INSTALL = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

// errorText: combined stdout+stderr of the failed command (or its message).
// ctx: { tool, method, command, manager, rcFile, platform }
// Returns a multi-line hint string. Always non-empty (generic fallback).
function hintFor(errorText, ctx = {}) {
  const text = String(errorText || '');
  const command = ctx.command || '';
  const lines = [];

  const isNpm = ctx.method === 'npm' || ctx.method === 'node' ||
    (typeof command === 'string' && command.startsWith('npm install'));

  if (/EACCES|EPERM|permission denied/i.test(text)) {
    if (isNpm && ctx.platform !== 'win32') {
      lines.push('npm cannot write to its global prefix (permission denied).');
      lines.push('Fix it without sudo — copy & run:');
      lines.push(`  ${NPM_PREFIX_FIX}`);
      if (ctx.rcFile) {
        lines.push('Then make sure the prefix is on PATH (ADM adds this automatically on the next run):');
        lines.push(`  echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/${ctx.rcFile}`);
      }
      return lines.join('\n');
    }
    if (command.includes('sudo')) {
      lines.push('This install needs your password — run it manually in a terminal where you can type it:');
      lines.push(`  ${command}`);
      return lines.join('\n');
    }
    lines.push('Permission denied. Run the command with elevated permissions or fix ownership, e.g.:');
    lines.push(`  sudo ${command}`);
    return lines.join('\n');
  }

  if (/command not found|ENOENT|not recognized/i.test(text)) {
    // Missing prerequisite binaries get targeted hints.
    if (/^brew\b|\/brew\b/.test(command)) {
      lines.push('Homebrew is not installed. Install it first:');
      lines.push(`  ${HOMEBREW_INSTALL}`);
      return lines.join('\n');
    }
    if (/\bpip\b/.test(command)) {
      lines.push('pip is not available — use python3 -m pip instead (copy & run):');
      lines.push(`  ${command.replace(/^pip\b/, 'python3 -m pip')}`);
      return lines.join('\n');
    }
    if (isNpm || /npm\b/.test(command)) {
      lines.push('npm was not found — install Node.js first: ADM_TOOLS=node adm');
      return lines.join('\n');
    }
    lines.push('A required command was not found in PATH. Install it first, then retry.');
    if (command) lines.push(`Command that failed: ${command}`);
    return lines.join('\n');
  }

  // Package genuinely missing from the manager's repositories
  // (winget: "No package found matching input criteria", apt: "Unable to
  // locate package", dnf/pacman/apk/zypper variants).
  if (/no package found matching input criteria|unable to locate package|no matching (packages|package)|target not found|unable to select packages|not found in (the )?repositories/i.test(text)) {
    const SEARCH = {
      winget: 'winget search', choco: 'choco search', scoop: 'scoop search',
      apt: 'apt-cache search', dnf: 'dnf search', pacman: 'pacman -Ss',
      zypper: 'zypper search', apk: 'apk search', brew: 'brew search',
    };
    lines.push(`This package is not in the ${ctx.manager || 'package manager'} repositories (or the id is different there).`);
    if (ctx.manager && SEARCH[ctx.manager]) {
      lines.push('Find the exact id, then retry — copy & run:');
      lines.push(`  ${SEARCH[ctx.manager]} <term>`);
    }
    if (command) lines.push(`Command that failed: ${command}`);
    return lines.join('\n');
  }

  // winget manifests that drifted from the actual installer file
  if (/installer hash does not match/i.test(text)) {
    lines.push("This winget package's manifest is outdated (the installer hash changed upstream) — it is a winget repository issue, not a broken setup.");
    lines.push('Retry later, search a different version, or install it manually.');
    if (command) lines.push(`Command that failed: ${command}`);
    return lines.join('\n');
  }

  // Generic fallback: always points at the exact command to inspect.
  lines.push('Install failed. Run the command manually to see the full error:');
  if (command) lines.push(`  ${command}`);
  return lines.join('\n');
}

module.exports = { hintFor, NPM_PREFIX_FIX, HOMEBREW_INSTALL };
