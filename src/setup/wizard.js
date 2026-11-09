const { loadCatalog, getToolsByCategories } = require('./catalog');
const { detectEnvironment } = require('../platform');
const { buildToolPlan } = require('../pkg/builders');
const { isInstalled, executeInstall } = require('../install/executor');
const { renderResults } = require('../install/report');
const { appendInstalled } = require('./registry');
const { runGitStep } = require('./git-step');
const { readConfig } = require('../config');
const { checkboxPrompt } = require('./prompts');
const { miniSpinner } = require('./spinner');

// The interactive setup wizard (#30): categories → tools → install → git step.
//
// Acceptance-critical details:
//   - the category screen renders ALL categories on ONE screen (pageSize ==
//     category count → inquirer never paginates)
//   - the tools screen marks already-installed tools "✓ … (installed)",
//     unchecked and disabled — they report `skipped`, never reinstall
//   - every install runs with an ora spinner (spinnerFactory injectable for
//     tests) and appends to ~/.adm/installed.json via the registry
//   - the final report reuses renderResults: ✓ installed / skipped / ✗ + hint
//
// All I/O is injectable (prompt, execFunc, spinnerFactory, configDir) so the
// whole flow is testable without a TTY (simulated-TTY tests).

// Pre-checks which tools are already installed (per statusSource probe).
async function collectStatuses(entries, opts = {}) {
  const map = new Map();
  for (const entry of entries) {
    let installed = false;
    try {
      installed = entry.status === 'planned' ? await isInstalled(entry, opts) : false;
    } catch {
      installed = false;
    }
    map.set(entry.id, { entry, installed });
  }
  return map;
}

// Builds the tools checkbox choices with status marks (#30 story 8).
// Clean labels: the reason goes to `disabled`, the prompt renders it as one
// short "(…)" suffix — no stacked double annotations.
function toolChoices(tools, statuses) {
  return tools.map(tool => {
    const st = statuses.get(tool.id);
    if (st && st.installed) {
      return { name: `✓ ${tool.name}`, value: tool.id, disabled: 'installed', checked: false };
    }
    const entry = st && st.entry;
    if (entry && (entry.status === 'manual' || entry.status === 'link')) {
      return { name: tool.name, value: tool.id, disabled: 'manual', checked: false };
    }
    return { name: tool.name, value: tool.id, checked: false };
  });
}

async function runWizard(opts = {}) {
  const {
    log = s => process.stdout.write(s + '\n'),
    prompt = require('inquirer').prompt,
    // Custom checkbox + spinner: both repaint atomically (single stdout
    // write per frame) — inquirer/ora flicker badly on plain consoles.
    checkbox = checkboxPrompt,
    spinnerFactory = text => miniSpinner(text),
    execFunc,
    home,
    configDir,
  } = opts;

  const env = detectEnvironment();
  const catalog = loadCatalog();

  // Ctrl+C in the checkbox prompt → graceful exit, exit code 0.
  const guard = p => p.catch(e => {
    if (e && e.code === 'ADM_CANCELLED') {
      log('Cancelled — nothing was changed.');
      return null;
    }
    throw e;
  });

  // ── 1. categories — ALL on one screen (story 6) ────────────────
  const categories = await guard(checkbox({
    name: 'categories',
    message: 'Which tool categories do you want to set up?',
    choices: catalog.map(c => ({ name: c.name, value: c.id })),
    pageSize: catalog.length,
  }));
  if (categories === null) return 0;

  if (!categories || categories.length === 0) {
    log('Nothing selected — nothing to do.');
    return 0;
  }

  // ── 2. tools for the selected categories, with status (story 7, 8) ──
  const tools = getToolsByCategories(categories);
  const statuses = await collectStatuses(tools.map(tool => ({
    id: tool.id,
    name: tool.name,
    category: tool.id,
    method: tool.installMethod,
    ...buildToolPlan(tool, env),
  })), { execFunc, home });

  const selectedIds = await guard(checkbox({
    name: 'tools',
    message: 'Pick the tools to install:',
    choices: toolChoices(tools, statuses),
    pageSize: Math.min(Math.max(tools.length, 10), 15),
  }));
  if (selectedIds === null) return 0;

  // Installed tools stay in the list on purpose: the executor probes them
  // again and reports them as `skipped` — they are never reinstalled.
  const toInstall = (selectedIds || [])
    .map(id => statuses.get(id))
    .filter(st => st && st.entry && st.entry.status === 'planned')
    .map(st => st.entry);

  // git step ONLY when the user actually installed git or gh — installing
  // unrelated tools must not nag about git identity. A previous decline
  // (remembered in config.json) also silences it forever.
  let declinedBefore = false;
  try {
    const saved = await readConfig(configDir);
    declinedBefore = Boolean(saved && saved.git && saved.git.setupDeclined);
  } catch {
    declinedBefore = false;
  }
  let gitOffered = false;

  if (toInstall.length === 0) {
    log('Nothing to install — everything you picked is already present.');
  } else {
    // ── 3. install with a spinner per tool (story 7) ──────────────
    let spinner = null;
    const outcome = await executeInstall(toInstall, {
      execFunc,
      home,
      rcFile: env.rcFile,
      onStart: ({ tool }) => {
        if (spinner) spinner.stop();
        spinner = spinnerFactory(`Installing ${tool.name}...`);
        spinner.start();
      },
      onProgress: ({ tool, result }) => {
        if (!spinner) return;
        if (result.status === 'installed') spinner.succeed(`${tool.name} installed`);
        else if (result.status === 'skipped') spinner.info(`${tool.name} already installed`);
        else spinner.fail(`${tool.name} failed (see report below)`);
        spinner = null;
      },
      onInstalled: entry => appendInstalled(entry, { configDir }),
    });

    // The git-identity question belongs to a git/gh install specifically.
    if (outcome.installed > 0 && !declinedBefore) {
      const GIT_TOOLS = new Set(['git', 'gh']);
      gitOffered = outcome.results.some(r => r.status === 'installed' && GIT_TOOLS.has(r.id));
    }

    // ── 4. final report: ✓ / ✓ skipped / ✗ + hint (story 9) ───────
    log('');
    log('Install report:');
    log(renderResults(outcome.results, { summary: false }));
  }

  // ── 5. git step (story 10) — only after an actual install happened ──
  // Reviewing the list without installing anything must not nag about git;
  // a declined setup is remembered in config.json and never asked again.
  if (gitOffered) {
    const gitResult = await runGitStep({ execFunc, prompt, log, configDir });
    if (gitResult.status === 'skipped') log('OK — you can set it later in any terminal: git config --global user.name "You"');
  }

  return 0;
}

module.exports = { runWizard, collectStatuses, toolChoices };
