const fs = require('fs').promises;
const path = require('path');
const os = require('os');

function configDir() {
  return process.env.ADM_CONFIG_DIR || path.join(os.homedir(), '.adm');
}

async function ensureConfigDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readConfig(dirOverride) {
  const dir = dirOverride || configDir();
  const file = path.join(dir, 'config.json');
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeConfig(obj, dirOverride) {
  const dir = dirOverride || configDir();
  await ensureConfigDir(dir);
  const file = path.join(dir, 'config.json');
  await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
}

module.exports = { configDir, readConfig, writeConfig, ensureConfigDir };
