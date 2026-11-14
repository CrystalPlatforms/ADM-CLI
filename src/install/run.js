const { loadCatalog } = require('../setup/catalog');
const { detectEnvironment, probeManagers } = require('../platform');
const { buildToolPlan } = require('../pkg/builders');
const { closestMatches } = require('../utils/closest-match');
const { executeInstall } = require('./executor');
const { renderResults } = require('./report');
const { appendInstalled } = require('../setup/registry');
const { parseToolIds } = require('./plan');
const { saveReport } = require('../reports');
const { getVersion } = require('../commands/version');
const { decideManager, MANAGER_PROVIDERS, METHOD_MANAGERS, orderByDependencies } = require('./consent');
const { HOMEBREW_INSTALL } = require('./hints');

// Builds plan entries for a validated tool-id list (shared with plan.js).
// The availability probe runs ONCE (never per tool, #43) unless a resolved
// environment is passed in.
function planEntriesFor(requested, { environment, platform, env, probeManagers: probe } = {}) {
  const catalog = loadCatalog();
  const byId = new Map(catalog.flatMap(c => c.tools.map(t => [t.id, { ...t, category: c.id }])));
  const unknown = requested.filter(id => !byId.has(id));
  if (unknown.length > 0) {
    const allIds = [...byId.keys()];
    const suggestions = [...new Set(unknown.flatMap(id => closestMatches(id, allIds)))].slice(0, 5);
    const lines = [`Unknown tool id in ADM_TOOLS: ${unknown.join(', ')}`];
    if (suggestions.length > 0) lines.push(`Did you mean: ${suggestions.join(', ')}?`);
    lines.push('');
    lines.push('Valid tool ids:');
    lines.push(allIds.join(', '));
    return { unknown: true, message: lines.join('\n') };
  }
  let environmentResolved = environment;
  let availability = null;
  if (!environmentResolved) {
    availability = (probe || probeManagers)({ platform, env });
    environmentResolved = detectEnvironment({ platform, env, managerAvailability: availability });
  }
  const entries = requested.map(id => {
    const tool = byId.get(id);
    return { id, name: tool.name, category: tool.category, method: tool.installMethod, ...buildToolPlan(tool, environmentResolved) };
  });
  return { unknown: false, entries, environment: environmentResolved, availability };
}

// Real install run: ADM_TOOLS=<ids> adm  (no ADM_DRY_RUN).
// Exit codes: 0 = all installed/skipped · 1 = unknown tool id (usage) ·
//             2 = at least one install failed (execution failure).
async function runInstall(toolsSpec, opts = {}) {
  const log = opts.log || (s => process.stdout.write(s + '\n'));
  const err = opts.err || (s => process.stderr.write(s + '\n'));

  let requested;
  try {
    requested = parseToolIds(toolsSpec);
  } catch (e) {
    err(`ADM failed: ${e.message}`);
    return 2;
  }

  let plan;
  try {
    plan = planEntriesFor(requested, {
      platform: opts.platform,
      env: opts.env,
      probeManagers: opts.probeManagers,
    });
  } catch (e) {
    err(`ADM failed: cannot load the tool catalog: ${e.message}`);
    return 2;
  }
  if (plan.unknown) {
    err(plan.message);
    return 1;
  }

  // Non-interactive consent (#44): nothing can be asked here. A provider
  // listed in ADM_TOOLS (e.g. node) is consent up-front; a tool whose
  // ecosystem manager is missing gets ✗ with a reason + hint and the REST
  // installs normally (the run never collapses). Consents are per-run only.
  const consented = new Set(Object.entries(MANAGER_PROVIDERS)
    .filter(([, p]) => requested.includes(p.tool))
    .map(([m]) => m));
  const runnable = [];
  const consentResults = [];
  for (const entry of plan.entries) {
    const mgr = METHOD_MANAGERS[entry.method];
    if (entry.status === 'planned' && mgr && plan.availability && plan.availability[mgr] === false) {
      const decision = decideManager({
        manager: mgr, toolName: entry.name, consented: consented.has(mgr), asked: false, interactive: false,
      });
      if (decision.action === 'approved') {
        runnable.push(entry);
        continue;
      }
      consentResults.push({
        id: entry.id, name: entry.name, category: entry.category, method: entry.method,
        status: 'failed', error: decision.reason, hint: decision.hint,
      });
      continue;
    }
    if (entry.status === 'manual' && (entry.requiresManager || entry.managerMissing)) {
      consentResults.push({
        id: entry.id, name: entry.name, category: entry.category, method: entry.method,
        status: 'failed', error: entry.reason,
        hint: entry.requiresManager === 'brew'
          ? `run: ADM_TOOLS=homebrew adm\nOfficial installer: ${HOMEBREW_INSTALL}`
          : entry.reason,
      });
      continue;
    }
    runnable.push(entry);
  }
  // Execution order (#44): a manager install precedes the tools that need it.
  orderByDependencies(runnable);

  const outcome = await executeInstall(runnable, {
    ...opts,
    rcFile: plan.environment.rcFile,
    onInstalled: opts.onInstalled || (entry => appendInstalled(entry, { configDir: opts.configDir })),
  });

  const allResults = [...outcome.results, ...consentResults];
  const counts = {
    installed: allResults.filter(r => r.status === 'installed').length,
    skipped: allResults.filter(r => r.status === 'skipped').length,
    failed: allResults.filter(r => r.status === 'failed').length,
  };

  const reportText = renderResults(allResults, { summary: false });
  log(reportText);
  log('');
  log(`Done: ${counts.installed} installed, ${counts.skipped} skipped, ${counts.failed} failed.`);

  // Persist the report to the global cache (owner decision) — a missing
  // config dir yields a loud ⚠ on stderr, never a silent skip.
  const body = [
    `ADM install report — ${new Date().toISOString()}`,
    `ADM ${getVersion()} · ADM_TOOLS=${toolsSpec}`,
    '',
    reportText,
    `Done: ${counts.installed} installed, ${counts.skipped} skipped, ${counts.failed} failed.`,
  ].join('\n') + '\n';
  const saved = saveReport('install', body, { configDir: opts.configDir });
  if (saved.error) err(`⚠ ${saved.error}`);

  return counts.failed > 0 ? 2 : 0;
}

module.exports = { runInstall, planEntriesFor };
