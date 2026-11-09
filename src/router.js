const { COMMANDS, AUTOMATION_HINTS } = require('./commands');
const { getVersion } = require('./commands/version');
const { showHelp, renderCommandLines } = require('./commands/help');
const { runFeedback } = require('./commands/feedback');
const { runConfig } = require('./commands/config');
const { runUninstall } = require('./commands/uninstall');
const { runDotfilesSync } = require('./commands/dotfiles');
const { runPlan } = require('./install/plan');
const { legacyCleanup } = require('./legacy-cleanup');
const { closestMatches } = require('./utils/closest-match');

function knownTokens() {
  const tokens = [];
  for (const cmd of COMMANDS) {
    tokens.push(cmd.name);
    for (const alias of cmd.aliases || []) tokens.push(alias);
  }
  return tokens;
}

function usageError(message, err) {
  const lines = [
    message,
    '',
    'Valid commands:',
    ...renderCommandLines(),
  ];
  err(lines.join('\n'));
  return 1;
}

function route(argv, deps = {}) {
  const log = deps.log || (s => process.stdout.write(s + '\n'));
  const err = deps.err || (s => process.stderr.write(s + '\n'));
  const tty = deps.tty !== undefined ? deps.tty : Boolean(process.stdin.isTTY);

  // ── adm (no args) ────────────────────────────────────────────
  if (argv.length === 0) {
    // Non-interactive tool planning: ADM_TOOLS=<id,id>
    if (process.env.ADM_TOOLS) {
      return runPlan(process.env.ADM_TOOLS, { log, err });
    }
    if (!tty) {
      // Never hang: stdin is not a terminal and no wizard exists yet.
      const lines = [
        'adm needs a terminal for interactive mode (wizard arrives in an upcoming version).',
        '',
        ...AUTOMATION_HINTS,
        '',
        'Valid commands:',
        ...renderCommandLines(),
      ];
      err(lines.join('\n'));
      return 1;
    }
    log('The interactive wizard arrives in an upcoming version.');
    log('For now: run "adm help" to see commands, or use ADM_TOOLS for automation:');
    for (const hint of AUTOMATION_HINTS.slice(1)) log(hint);
    return 0;
  }

  const head = argv[0];
  const rest = argv.slice(1);

  // ── help ─────────────────────────────────────────────────────
  if (head === 'help' || head === '--help' || head === '-h') {
    log(showHelp());
    return 0;
  }

  // ── -v / --version ───────────────────────────────────────────
  if (head === '-v' || head === '--version') {
    log(getVersion());
    return 0;
  }

  // ── feedback ─────────────────────────────────────────────────
  if (head === 'feedback') {
    return runFeedback({ log });
  }

  // ── config [--json] ──────────────────────────────────────────
  if (head === 'config') {
    const json = rest.includes('--json');
    const badFlags = rest.filter(f => f !== '--json');
    if (badFlags.length > 0) return usageError(`Unknown flag for "config": ${badFlags.join(', ')}`, err);
    return runConfig({ json, log, err });
  }

  // ── uninstall ────────────────────────────────────────────────
  if (head === 'uninstall') {
    if (rest.length > 0) return usageError(`"uninstall" takes no arguments, got: ${rest.join(' ')}`, err);
    return runUninstall({ log, err });
  }

  // ── dotfiles sync ────────────────────────────────────────────
  if (head === 'dotfiles') {
    if (rest[0] !== 'sync') {
      return usageError(`Unknown subcommand for "dotfiles": ${rest[0] || '(none)'}\nValid: adm dotfiles sync`, err);
    }
    return runDotfilesSync(rest.slice(1), { log, err });
  }

  // ── unknown command ──────────────────────────────────────────
  const suggestions = closestMatches(head, knownTokens());
  const lines = [`Unknown command: ${head}`];
  if (suggestions.length > 0) lines.push(`Did you mean: ${suggestions.join(', ')}?`);
  lines.push('');
  lines.push('Valid commands:');
  lines.push(...renderCommandLines());
  err(lines.join('\n'));
  return 1;
}

// Run one ADM invocation end-to-end and return the process exit code.
// Legacy cleanup runs on first start of every command except "-v" (kept
// machine-parsable) and the no-args notices.
async function main(argv, deps = {}) {
  const log = deps.log || (s => process.stdout.write(s + '\n'));
  const err = deps.err || (s => process.stderr.write(s + '\n'));
  const tty = deps.tty !== undefined ? deps.tty : Boolean(process.stdin.isTTY);

  const first = argv[0];
  // Cleanup runs on every start except "-v" (machine-parsable output) and
  // "uninstall" (it removes the whole config dir anyway; writing the cleanedAt
  // marker would resurrect the dir before the removal).
  const skipCleanup = first === '-v' || first === '--version' || first === 'uninstall';

  if (!skipCleanup) {
    // Keep machine-parsable output clean: the cleanup notice goes to stderr
    // when the invoked command prints JSON.
    const machineOutput = first === 'config' && argv.includes('--json');
    try {
      await legacyCleanup({ log: machineOutput ? err : log });
    } catch {
      // Cleanup must never block a command from running.
    }
  }

  try {
    return (deps.route || route)(argv, { log, err, tty });
  } catch (e) {
    err(`ADM failed: ${e && e.message ? e.message : e}`);
    return 2;
  }
}

module.exports = { route, main };
