const fs = require('fs');
const path = require('path');
const { probeManager } = require('./inventory');
const { resolvePackageName } = require('../pkg/package-names');

// tool-actions (plan plans/adm-tools-tui.md, Phase 4 #39 / Phase 5 #40) —
// terminal-neutral action layer behind the `adm tools` TUI. ONE job per call:
//
//   buildActionPlan(action, entry, info, { includeConfigCache }) → steps | null
//   runActionPlan(steps, { execFunc, fs })                       → outcome
//   applyActionToResult(result, entryId, 'remove')               → boolean
//   refreshEntryAfterUpdate(result, entryId, managerKey, opts)   → { refreshed }
//   buildRevealCommand(platform, targetPath, { fs })             → command | null
//
// Commands are keyed by the inventory MANAGER_SOURCES keys (npm, brew, pip,
// cargo, go, dpkg, rpm, pacman, zypper, apk, winget, choco, scoop — 13).
// The command texts are the ones frozen in issue #39 (Phase 4 of the plan):
// only apt carries the sudo prefix; the sudo BLOCKED path (message + copyable
// command + retry) is the TUI's job, this module only reports sudoFailure.
// go has no uninstall command — its remove step deletes the binary instead.

const UPDATE_COMMANDS = {
  brew: id => `brew upgrade ${id}`,
  npm: id => `npm update -g ${id}`,
  pip: id => `pip3 install -U ${id}`,
  cargo: id => `cargo install --force ${id}`,
  go: id => `go install ${id}@latest`,
  dpkg: id => `sudo apt install --only-upgrade ${id}`,
  rpm: id => `dnf upgrade ${id}`,
  pacman: id => `pacman -S ${id}`,
  zypper: id => `zypper update ${id}`,
  apk: id => `apk upgrade ${id}`,
  winget: pkg => `winget upgrade --id ${pkg} --exact --accept-source-agreements --accept-package-agreements --disable-interactivity`,
  choco: id => `choco upgrade ${id} --yes`,
  scoop: id => `scoop update ${id}`,
};

const REMOVE_COMMANDS = {
  brew: id => `brew uninstall ${id}`,
  npm: id => `npm uninstall -g ${id}`,
  pip: id => `pip3 uninstall -y ${id}`,
  cargo: id => `cargo uninstall ${id}`,
  go: null, // binary deletion — go has no uninstall command
  dpkg: id => `sudo apt remove -y ${id}`,
  rpm: id => `dnf remove -y ${id}`,
  pacman: id => `pacman -R ${id}`,
  zypper: id => `zypper remove -y ${id}`,
  apk: id => `apk del ${id}`,
  winget: pkg => `winget uninstall --id ${pkg} --exact --accept-source-agreements --disable-interactivity`,
  choco: id => `choco uninstall -y ${id}`,
  scoop: id => `scoop uninstall ${id}`,
};

// Package-manager ids differ from tool ids — winget demands Publisher.Package
// (`Git.Git`, not `git`), apt renames (go → golang-go). System-manager actions
// resolve through the SAME catalog mapping the install used; the identity
// default keeps unmapped ids (htop stays htop).
function resolveActionPackage(manager, id) {
  const r = resolvePackageName(id, manager);
  return r && r.name ? r.name : id;
}

// cargo uninstall refuses when the crate's metadata is corrupt — the binary
// it recorded is already gone: "corrupt metadata, <bin> does not exist when
// it should". The correct removal is then deleting the leftover binary (the
// error names it; the plan may also carry an explicit binPath fallback).
const CORRUPT_METADATA_PATTERN = /corrupt metadata|does not exist when it should/i;

// winget reports a package already at its latest with a NON-ZERO exit:
// "No available upgrade found." / "No applicable upgrade found." / "No newer
// package versions are available" — a successful NO-OP, never a failure.
const NO_UPGRADE_PATTERN = /no (available |applicable )?upgrade found|no newer package versions are available/i;

// The manager does not own this package (e.g. Git LFS bundled with Git for
// Windows never registers in winget): "No installed package found matching
// input criteria." Removal is IMPOSSIBLE through this manager — an honest
// no-op ("nothing removed"), not a failure and NOT a list mutation.
const NOT_MANAGED_PATTERN = /no installed package found|no package found matching/i;

// Plan builder for u/r. Steps are { type: 'command', command, label } or
// { type: 'deletePath', path, label }. Returns null when no safe plan exists
// (unknown manager, go-without-binary) — callers are flag-gated upstream
// (canUpdate/canRemove), so null simply means "nothing to execute".
// The remove dialog's "config and cache" step appends deletePath steps for
// the tool-info locations (existing paths only — tool-info guarantees it).
function buildActionPlan(action, entry, info, { includeConfigCache = false } = {}) {
  const id = entry && entry.id;
  if (!id || !entry.manager) return null;
  const pkg = resolveActionPackage(entry.manager, id);
  if (action === 'update') {
    const build = UPDATE_COMMANDS[entry.manager];
    return build ? [{ type: 'command', command: build(pkg), label: `update ${id} (${entry.manager})` }] : null;
  }
  if (action !== 'remove') return null;
  const steps = [];
  if (entry.manager === 'go') {
    if (!entry.binPath) return null;
    steps.push({ type: 'deletePath', path: entry.binPath, label: `delete ${entry.binPath}` });
  } else {
    const build = REMOVE_COMMANDS[entry.manager];
    if (!build) return null;
    steps.push({
      type: 'command', command: build(pkg), label: `remove ${id} (${entry.manager})`,
      // cargo --path installs leave corrupt metadata behind — the binary
      // deletion fallback removes what the uninstall refuses to touch
      ...(entry.manager === 'cargo' && entry.binPath ? {
        fallbackSteps: [{ type: 'deletePath', path: entry.binPath, label: `delete ${entry.binPath}` }],
      } : {}),
      // a manager that does not OWN the package (Git LFS bundled with Git
      // never registers in winget) still ADM owns it — fall back to deleting
      // the binary the scan found
      ...(entry.binPath ? {
        binPathFallback: [{ type: 'deletePath', path: entry.binPath, label: `delete ${entry.binPath}` }],
      } : {}),
    });
  }
  if (includeConfigCache && info) {
    const seen = new Set();
    for (const p of [...(info.configPaths || []), ...(info.cachePaths || [])]) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      steps.push({ type: 'deletePath', path: p, label: `delete ${p}` });
    }
  }
  return steps;
}

// Permission-failure signals across managers: apt/dpkg lock files, sudo
// password prompts, generic OS denials, winget/choco elevation (UAC):
// "Failed in attempting to elevate", "requires administrator rights". Never
// throws.
const SUDO_PATTERN = /permission denied|operation not permitted|access denied|sudo:|could not open lock file|unable to lock|are you root|not root|elevat|administrator|admin rights|admin privileges/i;

function isSudoFailure(err) {
  const text = [err && err.stderr, err && err.stdout, err && err.message]
    .map(s => String(s || '')).join('\n');
  return SUDO_PATTERN.test(text);
}

// A REAL, copyable command for the blocked screen — a raw path is not a
// command the user can paste anywhere.
function buildDeleteCommand(platform, targetPath) {
  if (platform === 'win32') {
    return `powershell -NoProfile -Command "Remove-Item -Force '${targetPath}'"`;
  }
  return `rm -f "${targetPath}"`;
}

// Executes steps SEQUENTIALLY (a remove's cleanup steps must not start
// before the uninstall finished). Command failures stop the plan and report
// sudoFailure; TOLERANT steps (reveal) count non-zero exits as success —
// explorer.exe famously exits 1 after successfully opening a folder.
// Missing deletePath targets are not failures (force:true). onStep(step, i)
// reports each step right before it runs (the TUI shows the live command).
async function runActionPlan(steps, { execFunc, fs: fsMod = fs, onStep } = {}) {
  const run = execFunc || ((cmd, o, cb) => require('child_process').exec(cmd, o, cb));
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (onStep) {
      try { onStep(step, i); } catch { /* progress reporting never breaks the plan */ }
    }
    if (step.type === 'deletePath') {
      try {
        fsMod.rmSync(step.path, { recursive: true, force: true });
      } catch (err) {
        // protected location (Program Files ACLs: Users have RX only) → a
        // rights problem: the blocked screen upstream shows the REAL command
        return {
          ok: false, stepIndex: i, step, err,
          command: buildDeleteCommand(process.platform, step.path),
          sudoFailure: isSudoFailure({ message: err.message }),
        };
      }
      continue;
    }
    const res = await new Promise(resolve => {
      run(step.command, { shell: process.platform === 'win32' ? undefined : 'sh' }, (err, stdout, stderr) => {
        resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    });
    if (res.err && !step.tolerant) {
      const errText = `${res.stderr}\n${res.stdout}\n${res.err.message}`;
      // winget "already at the latest" is a benign no-op — not a failure
      if (NO_UPGRADE_PATTERN.test(errText)) {
        return { ok: true, noop: 'already-latest' };
      }
      // the manager does not own this package (bundled installs) — but ADM
      // does: fall back to deleting the binary the scan found. Without a
      // known binary: an honest "nothing removed" no-op.
      if (NOT_MANAGED_PATTERN.test(errText)) {
        if (step.binPathFallback && step.binPathFallback.length > 0) {
          steps.splice(i, 1, ...step.binPathFallback);
          i -= 1; // the loop's i += 1 lands on the first fallback step
          continue;
        }
        return { ok: true, noop: 'not-managed' };
      }
      // corrupt-metadata remove (cargo): splice a binary-deletion fallback in
      // place of the failed uninstall — the path comes from the error text
      // itself (cargo names the missing binary in backticks) or from the
      // step's explicit fallbackSteps
      if (CORRUPT_METADATA_PATTERN.test(errText)) {
        const fromError = errText.match(/`([^`]+)` does not exist/i);
        const cleanup = fromError
          ? [{ type: 'deletePath', path: fromError[1], label: `delete ${fromError[1]}` }]
          : step.fallbackSteps;
        if (cleanup && cleanup.length > 0) {
          steps.splice(i, 1, ...cleanup);
          i -= 1; // the loop's i += 1 lands on the first fallback step
          continue;
        }
      }
      return {
        ok: false, stepIndex: i, step, err: res.err,
        stdout: res.stdout, stderr: res.stderr,
        command: step.command,
        // exec does NOT attach stdout/stderr to the error object — pass them
        // explicitly or elevation text printed on stdout is missed
        sudoFailure: isSudoFailure({ stderr: res.stderr, stdout: res.stdout, message: res.err.message }),
      };
    }
  }
  return { ok: true };
}

// Auto-refresh after a completed remove: drops the entry from result.entries
// and from its group — no rescan. Returns whether something was removed.
function applyActionToResult(result, entryId, action) {
  if (action !== 'remove' || !result) return false;
  const before = result.entries.length;
  result.entries = result.entries.filter(e => e.id !== entryId);
  for (const g of result.groups) {
    g.entries = g.entries.filter(e => e.id !== entryId);
  }
  return result.entries.length < before;
}

// Auto-refresh after a completed update: re-probes ONLY the entry's manager
// (light probe, not a rescan), merges the fresh version/binPath into the
// stored entry and marks it updated — the row shows the new state (✓) and the
// panel shows the refreshed version. A failed probe keeps the old values; the
// updated marker still lands (the action itself succeeded).
async function refreshEntryAfterUpdate(result, entryId, managerKey, opts = {}) {
  const probe = opts.probe || probeManager;
  const entry = result && result.entries ? result.entries.find(e => e.id === entryId) : null;
  if (!entry) return { refreshed: false };
  let probed = null;
  try {
    probed = await probe(managerKey, opts.probeOpts || {});
  } catch {
    probed = null;
  }
  if (probed && probed.ok && Array.isArray(probed.entries)) {
    const fresh = probed.entries.find(e => e.id === entryId);
    if (fresh) {
      if (fresh.version) entry.version = fresh.version;
      if (!entry.binPath && fresh.binPath) entry.binPath = fresh.binPath;
    }
  }
  entry.updated = true;
  return { refreshed: true, version: entry.version || null };
}

// A recorded path may no longer exist — revealing it lands the user in a
// random default folder. Resolve to the NEAREST ANCESTOR that still exists
// (the original path wins when it exists; the filesystem root ends the walk).
function nearestExisting(p, fsMod) {
  let cur = p;
  for (let i = 0; i < 32; i += 1) {
    try {
      fsMod.statSync(cur);
      return cur;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return cur;
      cur = parent;
    }
  }
  return cur;
}

// Reveal command per platform (Phase 5): select the item in the platform file
// manager. linux xdg-open only opens FOLDERS, so a file target resolves to its
// parent directory. win32 paths are normalized to backslashes (registry
// entries can carry POSIX-style separators explorer cannot select). Unknown
// platform / empty target → null (flag stays dimmed).
function buildRevealCommand(platform, targetPath, { fs: fsMod = fs } = {}) {
  if (!targetPath) return null;
  let p = String(targetPath);
  if (platform === 'darwin') return `open -R "${nearestExisting(p, fsMod)}"`;
  if (platform === 'win32') {
    p = nearestExisting(p.replace(/\//g, '\\'), fsMod);
    return `explorer /select,"${p}"`;
  }
  if (platform === 'linux') {
    p = nearestExisting(p, fsMod);
    let folder = p;
    try {
      if (fsMod.statSync(p).isFile()) folder = path.dirname(p);
    } catch {
      // stat unavailable — keep the target as given
    }
    return `xdg-open "${folder}"`;
  }
  return null;
}

module.exports = {
  buildActionPlan,
  runActionPlan,
  applyActionToResult,
  refreshEntryAfterUpdate,
  buildRevealCommand,
  isSudoFailure,
  UPDATE_COMMANDS,
  REMOVE_COMMANDS,
};
