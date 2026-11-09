const { loadCatalog } = require('../setup/catalog');
const { detectEnvironment, formatEnvironment } = require('../platform');
const { buildToolPlan } = require('../pkg/builders');
const { closestMatches } = require('../utils/closest-match');

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
function runPlan(toolsSpec, { log, err } = {}) {
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

  const env = detectEnvironment();
  const entries = requested.map(id => {
    const tool = byId.get(id);
    return { id, name: tool.name, category: tool.category, ...buildToolPlan(tool, env) };
  });

  log(`ADM install plan — ${entries.length} tool${entries.length === 1 ? '' : 's'} (dry run, nothing was installed)`);
  log('');
  log(`Environment:\n${formatEnvironment(env)}`);
  log('');
  for (const e of entries) {
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

  return 0;
}

module.exports = { runPlan, parseToolIds };
