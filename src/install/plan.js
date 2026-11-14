const { loadCatalog } = require('../setup/catalog');
const { detectEnvironment, formatEnvironment, probeManagers } = require('../platform');
const { buildToolPlan } = require('../pkg/builders');
const { closestMatches } = require('../utils/closest-match');
const { HOMEBREW_INSTALL } = require('./hints');
const { decideManager, MANAGER_PROVIDERS, METHOD_MANAGERS, orderByDependencies } = require('./consent');

// Parses the ADM_TOOLS spec ("id,id id") into tool ids.
function parseToolIds(spec) {
  return String(spec)
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Non-interactive install planning: ADM_TOOLS=<ids> adm
// Prints the plan for the current environment, changes nothing, exits 0.
// Unknown ids → usage error (1) enumerating the valid ids with closest
// matches. Execution errors → 2.
// The manager availability probe runs ONCE here (never per tool, #43) and
// feeds real manager detection; injectable for deterministic tests.
function runPlan(toolsSpec, { log, err, platform, env: envPath, probeManagers: probe } = {}) {
  log = log || (s => process.stdout.write(s + '\n'));
  err = err || (s => process.stderr.write(s + '\n'));

  let catalog;
  try {
    catalog = loadCatalog();
  } catch (e) {
    err(`ADM failed: cannot load the tool catalog: ${e.message}`);
    return 2;
  }
  const byId = new Map(catalog.flatMap(c => c.tools.map(t => [t.id, { ...t, category: c.id }])));

  const requested = parseToolIds(toolsSpec);
  const unknown = requested.filter(id => !byId.has(id));
  if (unknown.length > 0) {
    const allIds = [...byId.keys()];
    const suggestions = [...new Set(unknown.flatMap(id => closestMatches(id, allIds)))].slice(0, 5);
    const lines = [
      `Unknown tool id in ADM_TOOLS: ${unknown.join(', ')}`,
    ];
    if (suggestions.length > 0) lines.push(`Did you mean: ${suggestions.join(', ')}?`);
    lines.push('');
    lines.push('Valid tool ids:');
    lines.push(allIds.join(', '));
    err(lines.join('\n'));
    return 1;
  }

  const availability = (probe || probeManagers)({ platform, env: envPath });
  const env = detectEnvironment({
    platform,
    env: envPath,
    managerAvailability: availability,
  });
  const entries = requested.map(id => {
    const tool = byId.get(id);
    // `method` rides along: the consent engine keys ecosystem dependencies
    // off the install method (npm/pip/cargo/…), and the order pass needs it.
    return { id, name: tool.name, category: tool.category, method: tool.installMethod, ...buildToolPlan(tool, env) };
  });

  // Missing system manager → ONE clean block at the top (never a per-tool
  // error avalanche, PRD #42 story 9).
  if (entries.some(e => e.requiresManager === 'brew')) {
    log(`⚠ Homebrew is not installed — the system tools below require it.`);
    log(`  Install it with ADM (ADM_TOOLS=homebrew adm) or:`);
    log(`  ${HOMEBREW_INSTALL}`);
    log('');
  } else if (entries.some(e => e.managerMissing)) {
    const where = env.distro ? `${env.os} (${env.distro})` : env.os;
    log(`⚠ No supported package manager was detected on ${where}.`);
    log(`  System tools need one of: apt, dnf, pacman, zypper, apk (Linux) · brew (macOS) · winget, choco, scoop (Windows).`);
    log('');
  }

  // Missing ecosystem managers (#44): non-interactive → the dependent tool
  // is skipped with a reason while everything else stays in the plan.
  // A provider listed in ADM_TOOLS (e.g. node) is consent up-front.
  const consented = new Set(Object.entries(MANAGER_PROVIDERS)
    .filter(([, p]) => requested.includes(p.tool))
    .map(([m]) => m));
  const kept = [];
  const blocked = [];
  for (const e of entries) {
    const mgr = METHOD_MANAGERS[e.method];
    if (e.status === 'planned' && mgr && availability[mgr] === false) {
      const decision = decideManager({
        manager: mgr, toolName: e.name, consented: consented.has(mgr), asked: false, interactive: false,
      });
      if (decision.action === 'approved') {
        kept.push(e);
        continue;
      }
      blocked.push({ ...e, blockedReason: decision.reason, hint: decision.hint });
      continue;
    }
    kept.push(e);
  }
  // Plan order (#44): a manager install precedes the tools that require it —
  // Node before yarn/typescript. Stable: pick order preserved within a depth.
  orderByDependencies(kept);

  log(`ADM install plan — ${kept.length} tool${kept.length === 1 ? '' : 's'}${blocked.length ? ` (+${blocked.length} blocked)` : ''} (dry run, nothing was installed)`);
  log('');
  log(`Environment:\n${formatEnvironment(env)}`);
  log('');
  for (const e of kept) {
    const head = `${e.id} (${e.category}) — ${e.status}`;
    log(head);
    if (e.status === 'planned') {
      log(`  command:  ${e.command}`);
      if (e.manager) log(`  manager:  ${e.manager} · package: ${e.package}`);
      log(`  check:    ${e.statusSource}`);
    } else if (e.status === 'manual') {
      log(`  why:      ${e.reason}`);
    } else if (e.status === 'link') {
      log(`  url:      ${e.url}`);
    }
    log('');
  }
  for (const e of blocked) {
    log(`${e.id} (${e.category}) — ✗ ${e.blockedReason}`);
    log(`  hint:     ${e.hint}`);
    log('');
  }

  return 0;
}

module.exports = { runPlan, parseToolIds };
