const { loadCatalog } = require('../setup/catalog');
const { detectEnvironment } = require('../platform');
const { buildToolPlan } = require('../pkg/builders');
const { closestMatches } = require('../utils/closest-match');
const { executeInstall } = require('./executor');
const { renderResults } = require('./report');
const { appendInstalled } = require('../setup/registry');
const { parseToolIds } = require('./plan');

// Builds plan entries for a validated tool-id list (shared with plan.js).
function planEntriesFor(requested, { environment } = {}) {
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
  const env = environment || detectEnvironment();
  const entries = requested.map(id => {
    const tool = byId.get(id);
    return { id, name: tool.name, category: tool.category, method: tool.installMethod, ...buildToolPlan(tool, env) };
  });
  return { unknown: false, entries, environment: env };
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
    plan = planEntriesFor(requested);
  } catch (e) {
    err(`ADM failed: cannot load the tool catalog: ${e.message}`);
    return 2;
  }
  if (plan.unknown) {
    err(plan.message);
    return 1;
  }

  const outcome = await executeInstall(plan.entries, {
    ...opts,
    rcFile: plan.environment.rcFile,
    onInstalled: opts.onInstalled || (entry => appendInstalled(entry, { configDir: opts.configDir })),
  });

  log(renderResults(outcome.results, { summary: false }));
  log('');
  log(`Done: ${outcome.installed} installed, ${outcome.skipped} skipped, ${outcome.failed} failed.`);

  return outcome.failed > 0 ? 2 : 0;
}

module.exports = { runInstall, planEntriesFor };
