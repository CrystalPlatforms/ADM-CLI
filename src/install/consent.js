// The consent engine (PRD #42, C2). Decides, for one (tool, missing manager)
// pair, whether the install is approved, must be asked about, or is skipped
// with a reason — separated from the wizard and the executor.
//
// Rules (PRD #42):
//   1. Selecting the manager's provider tool (e.g. Node.js/npm) in the wizard
//      = consent for this run — installs without questions.
//   2. Not selected + interactive = ONE question per manager per run.
//   3. Declined = the tool gets ✗ with a reason and a ready hint in the report.
//   4. Non-interactive (ADM_TOOLS=…) = ✗ with a reason; other tools continue.
//   6. Consents are per-run — NEVER persisted to disk.
//
// `decideManager` is the pure core (the test matrix targets it);
// `createConsentSession` owns the per-run asked/consented memory.

// The catalog tool that provisions a missing manager, and its human name.
const MANAGER_PROVIDERS = {
  brew: { tool: 'homebrew', name: 'Homebrew' },
  npm: { tool: 'node', name: 'Node.js' },
  pip: { tool: 'python3', name: 'Python' },
  cargo: { tool: 'rustup', name: 'Rust (rustup)' },
  go: { tool: 'go', name: 'Go' },
  gem: { tool: 'ruby', name: 'Ruby' },
  composer: { tool: 'composer', name: 'PHP (Composer)' },
  dotnet: { tool: 'dotnet', name: '.NET SDK' },
};

// Which ecosystem manager an install method requires. Entries here make an
// install DEPENDENT (depth 1 in the execution order); everything else
// (scripts, nvm, system-manager routes) is self-contained (depth 0).
const METHOD_MANAGERS = {
  npm: 'npm',
  node: 'npm',
  pip: 'pip',
  python: 'pip',
  cargo: 'cargo',
  go: 'go',
  gem: 'gem',
  composer: 'composer',
  dotnet: 'dotnet',
};

// Ready-to-run hint for a skipped manager.
function skipHint(manager) {
  const provider = MANAGER_PROVIDERS[manager];
  if (provider) return `run: ADM_TOOLS=${provider.tool} adm`;
  return `install ${manager} first, then retry`;
}

// Pure decision for one (tool, manager) pair.
// Returns:
//   { action: 'approved' }
//   { action: 'ask', message }
//   { action: 'skip', reason, hint }
function decideManager({ manager, toolName, consented, asked, interactive }) {
  const provider = MANAGER_PROVIDERS[manager];
  const label = provider ? `${manager} (${provider.name})` : manager;
  if (consented) return { action: 'approved' };
  if (!interactive) {
    return {
      action: 'skip',
      reason: `requires ${label}, which is not installed`,
      hint: skipHint(manager),
    };
  }
  if (asked) {
    return {
      action: 'skip',
      reason: `requires ${label} — you declined installing it this run`,
      hint: skipHint(manager),
    };
  }
  return { action: 'ask', message: `${toolName} requires ${label} — install it?` };
}

// Per-run consent state. confirm: async (message) => boolean (injectable).
// consentedManagers: managers approved up-front (their provider tool was
// picked in the wizard / listed in ADM_TOOLS). Everything lives in memory
// only — a finished run leaves no trace in the config.
function createConsentSession({ interactive = true, consentedManagers = [], confirm } = {}) {
  const consents = new Set(consentedManagers);
  const asked = new Set();
  return {
    get consents() { return [...consents]; },
    grant(manager) { consents.add(manager); },
    async resolve(toolName, manager, messageOverride) {
      const decision = decideManager({
        manager,
        toolName,
        consented: consents.has(manager),
        asked: asked.has(manager),
        interactive,
      });
      if (decision.action !== 'ask') return decision;
      asked.add(manager);
      const ok = await confirm(messageOverride || decision.message);
      if (ok) {
        consents.add(manager);
        return { action: 'approved' };
      }
      return decideManager({ manager, toolName, consented: false, asked: true, interactive: true });
    },
  };
}

// Execution-order depth: dependent installs (npm/pip/cargo/… methods) run
// AFTER their manager is in place. Array#sort is stable, so within the same
// depth the wizard's pick order is preserved.
function managerDepth(entry) {
  return (entry && METHOD_MANAGERS[entry.method]) ? 1 : 0;
}

// In-place stable sort: manager installs (or self-contained tools) before
// dependent tools — Node before yarn/typescript, rustup before cargo tools.
function orderByDependencies(entries) {
  return entries.sort((a, b) => managerDepth(a) - managerDepth(b));
}

module.exports = {
  MANAGER_PROVIDERS,
  METHOD_MANAGERS,
  decideManager,
  createConsentSession,
  skipHint,
  orderByDependencies,
};
