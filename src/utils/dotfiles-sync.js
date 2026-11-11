const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { handleConflict, createBackup } = require('./file-conflict-handler');

const DEFAULT_FILES = ['.bashrc', '.zshrc', '.gitconfig', '.ssh/config'];

/**
 * Syncs dotfiles from repo to home directory
 *
 * Options:
 *   repo: string — dotfiles repo path/URL
 *   homeDir: string — home directory (defaults to os.homedir())
 *   copy: boolean — copy instead of symlinking
 *   only: string[] — file filter (without dot, e.g. ['bashrc', 'zshrc'])
 *   files: string[] — file list (with dot, e.g. ['.bashrc'])
 *   onConflict: () => 'skip' | 'backup' — conflict strategy
 */
async function syncDotfiles(options = {}) {
  const configDir = process.env.ADM_CONFIG_DIR || path.join(require('os').homedir(), '.adm');
  const dotfilesDir = path.join(configDir, 'dotfiles');
  const homeDir = options.homeDir || process.env.ADM_TEST_HOME || require('os').homedir();

  // Determine file list to sync
  let files = options.files || DEFAULT_FILES;

  // --only filter (user provides without dot: 'bashrc' → '.bashrc')
  if (options.only && options.only.length > 0) {
    files = options.only.map(f => f.startsWith('.') ? f : '.' + f);
  }

  const result = { symlinked: [], copied: [], skipped: [], backedUp: [], errors: [] };

  for (const file of files) {
    const sourcePath = path.join(dotfilesDir, file);
    const targetPath = path.join(homeDir, file);

    // Check if source file exists in repo
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    // Create target directory if needed (e.g. .ssh/)
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Check for conflict
    const conflict = handleConflict({ targetPath, sourcePath });
    if (conflict === 'conflict') {
      const strategy = options.onConflict ? options.onConflict(file) : 'skip';
      if (strategy === 'skip') {
        result.skipped.push(file);
        console.log(chalk.yellow(`  ⚠ Skipped ${file} (conflict)`));
        continue;
      }
      if (strategy === 'backup') {
        createBackup(targetPath);
        result.backedUp.push(file);
        fs.unlinkSync(targetPath);
        console.log(chalk.blue(`  ℹ Backup ${file} → ${file}.backup`));
      }
    }

    // Symlink or copy
    try {
      if (options.copy) {
        fs.copyFileSync(sourcePath, targetPath);
        // Preserve permissions
        const sourceStat = fs.statSync(sourcePath);
        fs.chmodSync(targetPath, sourceStat.mode);
        result.copied.push(file);
        console.log(chalk.green(`  ✓ Copied ${file}`));
      } else {
        fs.symlinkSync(sourcePath, targetPath);
        result.symlinked.push(file);
        console.log(chalk.green(`  ✓ Symlink ${file}`));
      }
    } catch (err) {
      result.errors.push({ file, error: err.message });
      console.error(chalk.red(`  ✖ Error ${file}: ${err.message}`));
    }
  }

  return result;
}

module.exports = { syncDotfiles };
