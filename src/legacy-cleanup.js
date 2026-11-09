const fs = require('fs');
const path = require('path');
const { configDir, readConfig, writeConfig } = require('./config');

// v0.3 removed the AI/GitHub/GitLab features. On the first start of v0.3 we
// delete everything those features left on disk — tokens must not sit around
// unread — and remember it with a `cleanedAt` marker in the config.
//
// Legacy artifacts:
//   ~/.adm/tokens.enc        — encrypted GitHub/GitLab tokens
//   ~/.adm/ai-knowledge.json — AI knowledge cache
//   macOS keychain entries   — service "adm-cli" (github-token, gitlab-token…)
//
// Runs at most once: skipped when config.cleanedAt is set.
const LEGACY_FILES = ['tokens.enc', 'ai-knowledge.json'];
const KEYCHAIN_SERVICE = 'adm-cli';

function listKeychainAccounts() {
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync('security', ['dump-keychain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const accounts = [];
    // dump-keychain prints one block per entry; match the service and account
    // attributes within each block.
    const svceRe = /"svce"<blob>="([^"]*)"/g;
    const acctRe = /"acct"<blob>="([^"]+)"/g;
    for (const entry of out.split(/(?=class:)/g)) {
      svceRe.lastIndex = 0;
      acctRe.lastIndex = 0;
      const svce = svceRe.exec(entry);
      const acct = acctRe.exec(entry);
      if (svce && acct && svce[1] === KEYCHAIN_SERVICE) accounts.push(acct[1]);
    }
    return accounts;
  } catch {
    return [];
  }
}

function deleteKeychainAccount(account) {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

async function legacyCleanup({ log, platform, env } = {}) {
  log = log || (s => process.stdout.write(s + '\n'));
  platform = platform || process.platform;
  env = env || process.env;

  const dir = process.env.ADM_CONFIG_DIR || configDir();
  const config = await readConfig();
  if (config.cleanedAt) return { skipped: true, removed: [] };

  const removed = [];

  // Files from the old AI/token features
  for (const name of LEGACY_FILES) {
    const file = path.join(dir, name);
    try {
      fs.unlinkSync(file);
      removed.push(file);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  // macOS keychain tokens
  if (platform === 'darwin') {
    for (const account of listKeychainAccounts()) {
      if (deleteKeychainAccount(account)) removed.push(`keychain:${KEYCHAIN_SERVICE}/${account}`);
    }
  }

  const marker = { ...config, cleanedAt: new Date().toISOString() };
  await writeConfig(marker);

  if (removed.length > 0) {
    const lines = [
      'ADM cleanup: removed data from features that were dropped in v0.3 (AI, GitHub/GitLab integrations):',
      ...removed.map(r => `  - ${r}`),
      '',
      'Your secrets were deleted so they do not sit unread on disk.',
    ];
    log(lines.join('\n'));
  }

  return { skipped: false, removed };
}

module.exports = { legacyCleanup, LEGACY_FILES, KEYCHAIN_SERVICE };
