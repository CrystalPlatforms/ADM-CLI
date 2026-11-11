const chalk = require('chalk');
const { loadCatalog, getToolsByCategories } = require('./catalog');
const { detectEnvironment } = require('../platform');
const { buildToolPlan, withFallbackRoute } = require('../pkg/builders');
const { isInstalled, executeInstall } = require('../install/executor');
const { renderResults } = require('../install/report');
const { appendInstalled } = require('./registry');
const { runGitStep } = require('./git-step');
const { readConfig } = require('../config');
const { checkboxPrompt, confirmPrompt } = require('./prompts');
const { loader } = require('./loader');
const { saveReport } = require('../reports');
const { getVersion } = require('../commands/version');

// The interactive setup wizard (#30): banner → Preparing… → categories →
// Scanning… → tools → install → "Worked for…" → report → git step.
//
// Acceptance-critical details:
//   - the banner (CrystalPlatforms ADM-CLI vX.Y.Z) is printed ONCE and stays
//     on top for the whole session
//   - all "work" phases use the dots_12 loader: Preparing… (startup),
//     Scanning… (status probes) and every install line
//   - install lines carry the full command in parentheses and the whole
//     install process collapses into one "Worked for <time>" line when it
//     ends — the report below stays
//   - the tools screen marks installed tools "✓ …" but keeps them
//     selectable — picking one triggers a REINSTALL (`reinstalled`) (#34)
//   - manual/link tools stay selectable: no automatic route → `manual`
//     entry with a copyable hint (guidance, not a failure — owner decision)
//   - every report is persisted to <configDir>/reports/ (owner decision);
//     a missing config dir produces a loud ⚠ line, never a silent skip
//
// All I/O is injectable (prompt, execFunc, spinnerFactory, configDir,
// stdout, env) so the whole flow is testable without a TTY.

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
// reinstall on pick), manual/link tools keep a clean label (and report as
// `manual` guidance on pick) — no disabled rows, no locked tools.
function toolChoices(tools, statuses) {
  return tools.map(tool => {
    const st = statuses.get(tool.id);
    if (st && st.installed) {
      return { name: `✓ ${tool.name}`, value: tool.id, checked: false };
    }
    return { name: tool.name, value: tool.id, checked: false };
  });
}

function fmtDuration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}m ${rest}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${rest}s`;
}

// Startup phases are FAST (a few ms) — without this the loader would flash
// invisibly. Owner decision: Preparing… must actually be seen.
async function ensureVisible(since, minMs) {
  const left = minMs - (Date.now() - since);
  if (left > 0) await new Promise(r => setTimeout(r, left));
}

async function runWizard(opts = {}) {
  const {
    log = s => process.stdout.write(s + '\n'),
    prompt = require('inquirer').prompt,
    // Custom checkbox + loader: both repaint atomically (single stdout
    // write per frame) — inquirer/ora flicker badly on plain consoles.
    checkbox = checkboxPrompt,
    confirm = confirmPrompt, // y/n prompt (injectable for tests)
    spinnerFactory = text => loader(text),
    execFunc,
    home,
    configDir,
    stdout = process.stdout,
    env: envOverride, // injectable for tests (defaults to real detection)
  } = opts;

  // Ctrl+C in a prompt → graceful exit, exit code 0.
  const guard = p => p.catch(e => {
    if (e && e.code === 'ADM_CANCELLED') {
      log('Cancelled — nothing was changed.');
      return null;
    }
    throw e;
  });

  // Cursor-position collapse (owner fix, 0.3.x): instead of COUNTING lines
  // to erase (inquirer leftovers, wrapped frames or child-process output can
  // skew any count), remember the cursor position before a phase and wipe
  // from that exact spot down afterwards.
  const cursorSave = () => { if (stdout.isTTY) stdout.write('\x1b[s'); };
  const cursorRestoreClear = () => { if (stdout.isTTY) stdout.write('\x1b[u\x1b[J'); };

  // ── banner — printed once, stays on top for the whole session ─────
  log(chalk.bold(`CrystalPlatforms ADM-CLI v${getVersion()}`));

  // ── Preparing… — catalog, environment and saved config under the loader
  const prepStart = Date.now();
  const prep = spinnerFactory('Preparing...');
  prep.start();
  const env = envOverride || detectEnvironment();
  const catalog = loadCatalog();
  let declinedBefore = false;
  try {
    const saved = await readConfig(configDir);
    declinedBefore = Boolean(saved && saved.git && saved.git.setupDeclined);
  } catch {
    declinedBefore = false;
  }
  await ensureVisible(prepStart, 600); // the phase is real but fast — keep it visible
  prep.stop();

  // ── 1. categories — ALL on one screen (story 6) ─────────────────
  const categories = await guard(checkbox({
    name: 'categories',
    message: 'Choose categories...',
    choices: catalog.map(c => ({ name: c.name, value: c.id })),
    pageSize: catalog.length,
  }));
  if (categories === null) return 0;
  if (!categories || categories.length === 0) {
    log('Nothing selected — nothing to do.');
    return 0;
  }
  log(`${chalk.green('✓')} Chosen ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}.`);

  // ── 2. tools for the selected categories, with status (Scanning…) ──
  const scanStart = Date.now();
  const scan = spinnerFactory('Scanning...');
  scan.start();
  const tools = getToolsByCategories(categories);
  const statuses = await collectStatuses(tools.map(tool => ({
    id: tool.id,
    name: tool.name,
    category: tool.id,
    method: tool.installMethod,
    ...buildToolPlan(tool, env),
  })), { execFunc, home });
  await ensureVisible(scanStart, 500); // keep the loader + Scanning… visible
  scan.stop();

  const selectedIds = await guard(checkbox({
    name: 'tools',
    message: 'Choose tools to install...',
    choices: toolChoices(tools, statuses),
    pageSize: Math.min(Math.max(tools.length, 10), 15),
  }));
  if (selectedIds === null) return 0;
  if (!selectedIds || selectedIds.length === 0) {
    log('Nothing selected — nothing to do.');
    return 0;
  }
  log(`${chalk.green('✓')} Chosen ${selectedIds.length} tool${selectedIds.length === 1 ? '' : 's'} to install.`);

  // Everything the user picked is attempted (#34):
  //   - an installed pick forces a REINSTALL (executor skips its
  //     "already installed" probe) and lands as `reinstalled` in the report
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

  // ── split picks: runnable vs. guidance-only ─────────────────────
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

  // ── Windows runtime question (HITL finding, 0.3.0) ──────────────
  // ADM always runs under Node. On Windows, installing Node.js spawns an
  // MSI whose Restart Manager restarts running node.exe processes — it can
  // kill THIS session mid-run. Owner decision: ASK, and on confirmation
  // really install (the risk belongs to whoever answered "yes"). POSIX is
  // safe (nvm installs into ~/.nvm, nothing restarts processes).
  if ((env.os || process.platform) === 'win32') {
    const nodeIdx = runnable.findIndex(e => e.id === 'node');
    if (nodeIdx >= 0) {
      let confirmed = false;
      const nodeMsg = 'Installing Node.js from inside ADM can restart this session (the Windows installer restarts running node.exe). Install anyway?';
      try {
        // the confirm atomically replaces its question with the done-format
        // line (single write — owner fix: no flicker on y/n)
        confirmed = await confirm({
          message: nodeMsg,
          defaultValue: false,
          answerLine: ok => ok
            ? `${chalk.green('✓')} Node.js install confirmed.`
            : `${chalk.yellow('❗')} Node.js install declined — manual command in the report.`,
        });
      } catch {
        confirmed = false; // prompt cancelled → treat as declined
        log(`${chalk.yellow('❗')} Node.js install declined — manual command in the report.`);
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

  let gitOffered = false;

  if (runnable.length === 0 && manualResults.length === 0) {
    log('Nothing selected — nothing to do.');
  } else {
    let results = manualResults;
    let workedLine = null;

    if (runnable.length > 0) {
      // ── 3. install with the loader per tool — the line carries the
      //      full command in parentheses, and after 3s its [elapsed] (owner decision)
      let spinner = null;
      let prevRows = 0; // rows the previous tool's finished status line occupies
      const eraseRows = n => {
        if (n > 0 && stdout.isTTY) stdout.write((n > 1 ? `\x1b[${n - 1}A` : '') + '\r\x1b[J');
      };
      const installStart = Date.now();
      cursorSave(); // collapse anchor: everything below is wiped on finish
      const outcome = await executeInstall(runnable, {
        execFunc,
        home,
        rcFile: env.rcFile,
        onStart: ({ tool }) => {
          if (spinner) spinner.stop();
          // owner decision: ONE install line at a time — the previous
          // tool's status line disappears as the next tool starts
          eraseRows(prevRows);
          prevRows = 0;
          spinner = spinnerFactory(`${tool.force ? 'Reinstalling' : 'Installing'} ${tool.name} (${tool.command})`);
          spinner.start();
        },
        onProgress: ({ tool, result }) => {
          if (!spinner) return;
          if (result.status === 'installed') spinner.succeed(`${tool.name} ${tool.force ? 'reinstalled' : 'installed'}`);
          else if (result.status === 'skipped') spinner.info(`${tool.name} already installed`);
          else spinner.fail(`${tool.name} failed (see report below)`);
          spinner = null;
          prevRows = 1; // status lines are short — always exactly one row
        },
        onInstalled: entry => appendInstalled(entry, { configDir }),
      });

      workedLine = `Worked for ${fmtDuration(Date.now() - installStart)}`;

      // ── 4. report assembly: ✓ installed / ✓ reinstalled / i manual ──
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

      // ── collapse (owner decision): restore the saved cursor position and
      // clear — the whole install process disappears EXACTLY, whatever
      // wrapped or printed in between; the report below stays. Non-TTY
      // (tests) never drew the lines → the save/restore is skipped there.
      cursorRestoreClear();
    }

    const reportText = renderResults(results, { summary: false });

    // persist FIRST so the report heading can carry the saved path
    const header = [
      `ADM install report — ${new Date().toISOString()}`,
      `ADM ${getVersion()} · ${env.os}${env.distro ? `/${env.distro}` : ''} · manager: ${env.manager} · shell: ${env.shell}`,
      workedLine,
    ].filter(l => l !== null);
    const body = [...header, '', reportText].join('\n') + '\n';
    const saved = saveReport('install', body, { configDir });
    const savedNote = saved.file
      ? chalk.dim(` (saved: ${saved.file})`)
      : chalk.dim(` (⚠ not saved: ${saved.error})`);

    if (workedLine) log(chalk.bold(workedLine));
    log('');
    log(chalk.bold('Install report:') + savedNote);
    log(reportText);
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
