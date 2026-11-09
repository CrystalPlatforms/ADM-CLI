const { readConfig, writeConfig } = require('../config');

// Wizard's git step (#30, story 10): user.name + user.email, nothing else
// (SSH/GPG intentionally cut). Defaults come from the current git config;
// values are written via `git config --global` AND stored in
// ~/.adm/config.json under { git: { name, email } }.

// Reads one key from global git config ("" when unset). exec injectable.
function readGitValue(key, { execFunc } = {}) {
  const exec = execFunc || require('child_process').exec;
  return new Promise(resolve => {
    exec(`git config --global ${key}`, { shell: 'sh' }, (err, stdout) => {
      resolve(err ? '' : String(stdout || '').trim());
    });
  });
}

function gitSetCommand(key, value) {
  const escaped = String(value).replace(/"/g, '\\"');
  return `git config --global ${key} "${escaped}"`;
}

function setGitValue(key, value, { execFunc } = {}) {
  const exec = execFunc || require('child_process').exec;
  return new Promise((resolve, reject) => {
    exec(gitSetCommand(key, value), { shell: 'sh' }, err => (err ? reject(err) : resolve()));
  });
}

async function readSavedGit({ readConfigFn, configDir } = {}) {
  try {
    const cfg = await (readConfigFn || readConfig)(configDir);
    return (cfg && cfg.git) || {};
  } catch {
    return {};
  }
}

// Runs the git step. Returns:
//   { status: 'existing', name, email }  both already set — nothing asked
//   { status: 'declined-before' }        user declined in a previous run
//   { status: 'skipped' }                user declined now (remembered)
//   { status: 'configured', name, email } written via git config + config.json
async function runGitStep(opts = {}) {
  const {
    execFunc,
    prompt = require('inquirer').prompt,
    log = () => {},
    readConfigFn,
    writeConfigFn,
    configDir,
  } = opts;

  const fullConfig = await safeReadAll(readConfigFn, configDir);
  const savedGit = (fullConfig && fullConfig.git) || {};

  const currentName = (await readGitValue('user.name', { execFunc })) || savedGit.name || '';
  const currentEmail = (await readGitValue('user.email', { execFunc })) || savedGit.email || '';

  if (currentName && currentEmail) {
    log(`git already configured: ${currentName} <${currentEmail}>`);
    return { status: 'existing', name: currentName, email: currentEmail };
  }

  // A previous "no" is final — never ask again (unless git is configured now).
  if (savedGit.setupDeclined) {
    return { status: 'declined-before' };
  }

  const { proceed } = await prompt([{
    type: 'confirm',
    name: 'proceed',
    message: 'Configure git identity (user.name / user.email) now?',
    default: true,
  }]);
  if (!proceed) {
    // Remember the decline — the wizard must not re-ask on every start.
    try {
      const writer = writeConfigFn || ((cfg, dir) => writeConfig(cfg, dir));
      await writer({ ...fullConfig, git: { ...savedGit, setupDeclined: true } }, configDir);
    } catch { /* config write must never break the wizard */ }
    return { status: 'skipped' };
  }

  const answers = await prompt([
    {
      type: 'input',
      name: 'name',
      message: 'git user.name:',
      default: currentName,
      validate: v => String(v).trim().length > 0 || 'name cannot be empty',
    },
    {
      type: 'input',
      name: 'email',
      message: 'git user.email:',
      default: currentEmail,
      validate: v => /.+@.+/.test(String(v).trim()) || 'enter a valid email',
    },
  ]);

  const name = answers.name.trim();
  const email = answers.email.trim();
  await setGitValue('user.name', name, { execFunc });
  await setGitValue('user.email', email, { execFunc });

  // Persist in ADM config too (config.json), merged with whatever is saved.
  const writer = writeConfigFn || ((cfg, dir) => writeConfig(cfg, dir));
  const saved = await readSavedGit({ readConfigFn, configDir });
  const full = await safeReadAll(readConfigFn, configDir);
  await writer({
    ...full,
    git: { ...saved, name, email },
  }, configDir);

  return { status: 'configured', name, email };
}

async function safeReadAll(readConfigFn, configDir) {
  try {
    const read = readConfigFn || readConfig;
    return (await read(configDir)) || {};
  } catch {
    return {};
  }
}

module.exports = { runGitStep, readGitValue, setGitValue, gitSetCommand };
