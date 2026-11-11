const { loadCatalog, getToolsByCategories } = require('./catalog');
const { detectEnvironment } = require('../platform');
const { buildToolPlan, withFallbackRoute } = require('../pkg/builders');
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
//   - the tools screen marks already-installed tools "✓ …" but keeps them
//     selectable — picking one triggers a REINSTALL (status `reinstalled`)
//     (#34: nothing in the list silently refuses anymore)
//   - manual/link tools stay selectable too: the best available route runs
//     (script fallback), and only a genuine dead end lands in the report as
//     `failed` with a hint (#34) — a failed retry never blocks the run
//   - every install runs with an ora spinner (spinnerFactory injectable for
//     tests) and appends to ~/.adm/installed.json via the registry
//   - the final report reuses renderResults: ✓ installed / ✓ reinstalled /
//     skipped / ✗ + hint
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
// Everything stays selectable (#34): installed tools carry a "✓" mark (and
// reinstall on pick), manual/link tools keep a clean label (and retry the
// best available route on pick) — no disabled rows, no locked tools.
function toolChoices(tools, statuses) {
  return tools.map(tool => {
    const st = statuses.get(tool.id);
    if (st && st.installed) {
      return { name: `✓ ${tool.name}`, value: tool.id, checked: false };
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
    env: envOverride, // injectable for tests (defaults to real detection)
  } = opts;

  const env = envOverride || detectEnvironment();
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

  // Everything the user picked is attempted (#34):
  //   - an installed pick forces a REINSTALL (executor skips its
  //     "already installed" probe) and lands as `reinstalled` in the report
  //   - a manual pick first retries the script-install fallback route
  //   - tools with NO route on this platform (manual after the fallback,
  //     link-only extensions) run nothing — they land in the report as
  //     `manual` entries with a copyable hint. Owner decision (0.3.0 HITL):
  //     a missing route is GUIDANCE, not a failure.
  const toInstall = (selectedIds || [])
    .map(id => statuses.get(id))
    .filter(st => st && st.entry)
    .map(st => {
      const entry = withFallbackRoute(st.entry, env);
      entry.force = Boolean(st.installed);
      return entry;
    });

  // ── split picks: runnable vs. guidance-only ─────────────────────────
  const manualResults = [];
  const runnable = [];
  for (const entry of toInstall) {
    if (entry.status === 'manual') {
      manualResults.push({
        id: entry.id, name: entry.name, category: entry.category, method: entry.method,
        status: 'manual', hint: entry.reason,
      });
    } else if (entry.status === 'link') {
      manualResults.push({
        id: entry.id, name: entry.name, category: entry.category, method: entry.method,
        status: 'manual', hint: `install from: ${entry.url || '(no link known)'}`,
      });
    } else {
      runnable.push(entry);
    }
  }

  // ── Windows runtime question (HITL finding, 0.3.0) ──────────────────
  // ADM always runs under Node. On Windows, installing Node.js spawns an
  // MSI whose Restart Manager restarts running node.exe processes — it can
  // kill THIS session mid-run. Owner decision: ASK, and on confirmation
  // really install (the risk belongs to whoever answered "yes"). POSIX is
  // safe (nvm installs into ~/.nvm, nothing restarts processes).
  if ((env.os || process.platform) === 'win32') {
    const nodeIdx = runnable.findIndex(e => e.id === 'node');
    if (nodeIdx >= 0) {
      let confirmed = false;
      try {
        const answer = await prompt([{
          name: 'nodeRuntime',
          type: 'confirm',
          message: 'Installing Node.js from inside ADM can restart this session (the Windows installer restarts running node.exe). Install anyway?',
          default: false,
        }]);
        confirmed = Boolean(answer && answer.nodeRuntime);
      } catch {
        confirmed = false; // prompt cancelled → treat as declined
      }
      if (!confirmed) {
        const [entry] = runnable.splice(nodeIdx, 1);
        manualResults.push({
          id: entry.id, name: entry.name, category: entry.category, method: entry.method,
          status: 'manual',
          hint: 'close ADM, then run in a separate terminal: winget install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements',
        });
      }
    }
  }

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

  if (runnable.length === 0 && manualResults.length === 0) {
    log('Nothing selected — nothing to do.');
  } else {
    let results = manualResults;

    if (runnable.length > 0) {
      // ── 3. install with a spinner per tool (story 7) ──────────────
      let spinner = null;
      const outcome = await executeInstall(runnable, {
        execFunc,
        home,
        rcFile: env.rcFile,
        onStart: ({ tool }) => {
          if (spinner) spinner.stop();
          spinner = spinnerFactory(tool.force ? `Reinstalling ${tool.name}...` : `Installing ${tool.name}...`);
          spinner.start();
        },
        onProgress: ({ tool, result }) => {
          if (!spinner) return;
          if (result.status === 'installed') spinner.succeed(`${tool.name} ${tool.force ? 'reinstalled' : 'installed'}`);
          else if (result.status === 'skipped') spinner.info(`${tool.name} already installed`);
          else spinner.fail(`${tool.name} failed (see report below)`);
          spinner = null;
        },
        onInstalled: entry => appendInstalled(entry, { configDir }),
      });

      // ── 4. final report: ✓ installed / ✓ reinstalled / i manual / ✗ ──
      // Forced picks of already-installed tools report as `reinstalled`
      // (the non-interactive ADM_TOOLS runner keeps its own contract).
      const reinstalledIds = new Set(runnable.filter(e => e.force).map(e => e.id));
      results = [...outcome.results.map(r => {
        if (r.status === 'installed' && reinstalledIds.has(r.id)) {
          return { ...r, status: 'reinstalled' };
        }
        return r;
      }), ...manualResults];

      // The git-identity question belongs to a git/gh FRESH install — a
      // reinstall means the user already has it configured.
      if (outcome.installed > 0 && !declinedBefore) {
        const GIT_TOOLS = new Set(['git', 'gh']);
        gitOffered = results.some(r => r.status === 'installed' && GIT_TOOLS.has(r.id));
      }
    }

    log('');
    log('Install report:');
    log(renderResults(results, { summary: false }));
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
