const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { readConfig } = require('../config');
const { syncDotfiles } = require('../utils/dotfiles-sync');

// `adm dotfiles sync [--repo <url>] [--copy] [--only <name,name>]`
// Port of the old logic: clones/pulls the dotfiles repo into ~/.adm/dotfiles,
// then symlinks (or copies) known files into the home directory.
async function runDotfilesSync(flags = [], { log, err } = {}) {
  log = log || (s => process.stdout.write(s + '\n'));
  err = err || (s => process.stderr.write(s + '\n'));
  const configDir = process.env.ADM_CONFIG_DIR || path.join(require('os').homedir(), '.adm');
  const dotfilesDir = path.join(configDir, 'dotfiles');

  // ── parse flags ──────────────────────────────────────────────
  const options = {};
  const bad = [];
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === '--help' || f === '-h') {
      log('Usage: adm dotfiles sync [--repo <url>] [--copy] [--only <name,name>]');
      log('');
      log('  --repo <url>      dotfiles git repo (or set dotfiles.repo in the config)');
      log('  --copy            copy files instead of symlinking');
      log('  --only <name,name>  sync only these files (e.g. --only bashrc,zshrc)');
      return 0;
    }
    if (f === '--repo') options.repo = flags[++i];
    else if (f === '--copy') options.copy = true;
    else if (f === '--only') options.only = String(flags[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else bad.push(f);
  }
  if (bad.length > 0) {
    err(`Unknown flags for "dotfiles sync": ${bad.join(', ')}\nValid flags: --repo <url>, --copy, --only <name,name>`);
    return 1;
  }

  // ── resolve repo URL ─────────────────────────────────────────
  let repoUrl = options.repo;
  if (!repoUrl) {
    const config = await readConfig();
    repoUrl = config?.dotfiles?.repo;
  }
  if (!repoUrl) {
    err('No dotfiles repo URL. Pass --repo <url> or set it in the config (dotfiles.repo).\nExample: adm dotfiles sync --repo https://github.com/you/dotfiles');
    return 1;
  }

  // ── clone or pull ────────────────────────────────────────────
  const { execFileSync } = require('child_process');
  const s = ora('Syncing dotfiles...').start();
  try {
    if (fs.existsSync(path.join(dotfilesDir, '.git'))) {
      s.text = 'Pulling updates...';
      execFileSync('git', ['pull'], { cwd: dotfilesDir, stdio: 'pipe' });
    } else {
      if (fs.existsSync(dotfilesDir)) {
        fs.rmSync(dotfilesDir, { recursive: true, force: true });
      }
      s.text = 'Cloning dotfiles repo...';
      fs.mkdirSync(configDir, { recursive: true });
      execFileSync('git', ['clone', repoUrl, dotfilesDir], { stdio: 'pipe' });
    }
    s.succeed('Dotfiles repo ready');
  } catch (e) {
    s.fail(`Git error: ${e.message}`);
    return 2;
  }

  // ── sync files ───────────────────────────────────────────────
  log(chalk.bold('\n  Syncing files:'));
  const result = await syncDotfiles({
    repo: repoUrl,
    copy: options.copy,
    only: options.only,
  });

  const total = result.symlinked.length + result.copied.length;
  log(chalk.bold(`\n  Done: ${total} file${total === 1 ? '' : 's'} synced`));
  if (result.skipped.length > 0) log(chalk.yellow(`  Skipped: ${result.skipped.join(', ')}`));
  if (result.backedUp.length > 0) log(chalk.blue(`  Backed up: ${result.backedUp.join(', ')}`));
  if (result.errors.length > 0) log(chalk.red(`  Errors: ${result.errors.map(e => e.file).join(', ')}`));

  return result.errors.length > 0 ? 2 : 0;
}

module.exports = { runDotfilesSync };
