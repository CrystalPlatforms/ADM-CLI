const { resolvePackageName } = require('./package-names');
const { resolveScript } = require('./script-urls');
const { installCommand } = require('./managers');

// ── ecosystem package-name overrides ──────────────────────────
// Only where the install identifier differs from the catalog tool id.
const GO_PACKAGES = {
  'golangci-lint': 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint',
  goreleaser: 'github.com/goreleaser/goreleaser/v2',
  air: 'github.com/air-verse/air',
  ginkgo: 'github.com/onsi/ginkgo/v2/ginkgo',
  delve: 'github.com/go-delve/delve/cmd/dlv',
  gofumpt: 'mvdan.cc/gofumpt',
  goimports: 'golang.org/x/tools/cmd/goimports',
  gomock: 'go.uber.org/mock/mockgen',
  staticcheck: 'honnef.co/go/tools/cmd/staticcheck',
  gosec: 'github.com/securego/gosec/v2/cmd/gosec',
  gotestsum: 'gotest.tools/gotestsum',
  swag: 'github.com/swaggo/swag/cmd/swag',
  'protoc-gen-go': 'google.golang.org/protobuf/cmd/protoc-gen-go',
  grpcurl: 'github.com/fullstorydev/grpcurl/cmd/grpcurl',
  ghq: 'github.com/x-motemen/ghq',
  fzf: 'github.com/junegunn/fzf',
  lazygit: 'github.com/jesseduffield/lazygit',
  hugo: 'github.com/gohugoio/hugo',
  temporal: 'github.com/temporalio/cli/cmd/temporal',
  ko: 'github.com/google/ko',
  buf: 'github.com/bufbuild/buf/cmd/buf',
};

const CARGO_PACKAGES = { delta: 'git-delta' };
const GEM_PACKAGES = { 'factory-bot': 'factory_bot' };
const COMPOSER_PACKAGES = {
  'php-cs-fixer': 'friendsofphp/php-cs-fixer',
  phpunit: 'phpunit/phpunit',
  pest: 'pestphp/pest',
  laravel: 'laravel/installer',
  drush: 'drush/drush',
  deployer: 'deployer/deployer',
  phan: 'phan/phan',
  rector: 'rector/rector',
  infection: 'infection/infection',
};
const DOTNET_PACKAGES = {
  sonarscanner: 'dotnet-sonarscanner',
  coverlet: 'coverlet.console',
  reportgenerator: 'dotnet-reportgenerator-globaltool',
  roslynator: 'roslynator.commandline',
  nuke: 'nuke.globaltool',
};

// Binary produced after install (for `command -v <bin>` status checks) where
// it differs from the catalog id.
const NPM_BINS = {
  '@anthropic-ai/claude-code': 'claude',
  '@openai/codex': 'codex',
  '@anthropic-ai/gemini-cli': 'gemini',
  '@githubnext/github-copilot-cli': 'github-copilot-cli',
  '@plandex/cli': 'plandex',
  // npm package name differs from the produced binary — the status probe
  // must check the REAL command or installed tools look "not installed"
  // (HITL finding, 0.3.0: picking installed TypeScript kept re-"installing").
  typescript: 'tsc',
};
const GO_BINS = { delve: 'dlv', gomock: 'mockgen' };
const CARGO_BINS = { delta: 'delta', 'fd-find': 'fd', ripgrep: 'rg', 'du-dust': 'dust', bottom: 'btm' };

const NVM_INSTALL = 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | sh';

// Pick the python installer command:
//   pip available → pip / pip3 available → pip3 / otherwise → python3 -m pip
// On Windows the fallback MUST be `python -m pip`: python3.exe is commonly a
// Microsoft Store alias stub that silently opens the Store (installs hang).
function pipCommand(pkgName, availability = {}, os) {
  if (availability.pip) return `pip install --upgrade ${pkgName}`;
  if (availability.pip3) return `pip3 install --upgrade ${pkgName}`;
  const python = os === 'win32' ? 'python -m pip install --upgrade' : 'python3 -m pip install --upgrade';
  return `${python} ${pkgName}`;
}

// Builds the install plan entry for one tool in one environment.
// Returns:
//   { status: 'planned', command, manager?, package?, statusSource }
//   { status: 'manual', reason }
//   { status: 'link', url }
function buildToolPlan(tool, env, opts = {}) {
  const method = tool.installMethod;
  const id = tool.id;

  const planned = (fields) => ({
    status: 'planned',
    ...fields,
    statusSource: fields.statusSource || `command -v ${statusBin(id, method)}`,
  });

  switch (method) {
    case 'nvm':
      // POSIX nvm installs via the official script. Windows has no `sh` (and
      // nvm-windows is a different tool entirely) — install Node.js LTS
      // through the detected manager instead (HITL finding, 0.3.0).
      if (env.os === 'win32') {
        const NODE_WIN = { winget: 'OpenJS.NodeJS.LTS', choco: 'nodejs-lts', scoop: 'nodejs-lts' };
        const nodePkg = NODE_WIN[env.manager];
        if (!nodePkg) {
          return { status: 'manual', reason: 'no supported package manager for Node.js — install the LTS from https://nodejs.org' };
        }
        return planned({ command: installCommand(env.manager, nodePkg), manager: env.manager, package: nodePkg, statusSource: 'command -v node' });
      }
      return planned({ command: NVM_INSTALL, statusSource: 'command -v node' });

    case 'npm':
    case 'node': {
      const name = NPM_BINS[id] || id;
      return planned({ command: `npm install -g ${id}@latest`, statusSource: `command -v ${name}` });
    }

    case 'pip':
    case 'python': {
      const pkgName = id;
      return planned({ command: pipCommand(pkgName, opts.pipAvailability, env.os) });
    }

    case 'cargo': {
      const crate = CARGO_PACKAGES[id] || id;
      return planned({ command: `cargo install ${crate}`, package: crate, statusSource: `command -v ${CARGO_BINS[id] || id}` });
    }

    case 'go': {
      const modulePath = GO_PACKAGES[id] || id;
      return planned({ command: `go install ${modulePath}@latest`, package: modulePath, statusSource: `command -v ${GO_BINS[id] || id}` });
    }

    case 'gem': {
      const gem = GEM_PACKAGES[id];
      if (!gem) {
        // dry-rb is a family of gems, not a single installable gem
        if (id === 'dry-rb') return { status: 'manual', reason: 'dry-rb is a family of gems (dry-validation, dry-rails…) — install the gem you need: https://dry-rb.org' };
      }
      return planned({ command: `gem install ${gem || id}`, package: gem || id });
    }

    case 'composer': {
      const pkgName = COMPOSER_PACKAGES[id] || id;
      return planned({ command: `composer global require ${pkgName}`, package: pkgName });
    }

    case 'dotnet': {
      const pkgName = DOTNET_PACKAGES[id] || id;
      return planned({ command: `dotnet tool install -g ${pkgName}`, package: pkgName });
    }

    case 'rustup': {
      // rustup itself (the "cargo" catalog entry) and rustup components
      if (id === 'cargo') {
        const s = resolveScript('rustup', env.os, env.arch);
        if (s.manual) return { status: 'manual', reason: s.manual };
        return planned({ command: s.run, shell: s.shell, statusSource: 'command -v cargo' });
      }
      return planned({ command: `rustup component add ${id}` });
    }

    case 'script': {
      const resolved = resolveScript(id, env.os, env.arch);
      if (resolved.manual) return { status: 'manual', reason: resolved.manual };
      // `shell: 'powershell'` propagates to the executor (Windows-only scripts).
      return planned({ command: resolved.run, package: resolved.url, shell: resolved.shell });
    }

    case 'link':
      return { status: 'link', url: tool.url || `https://marketplace.visualstudio.com/search?term=${id}` };

    default: {
      // Manager-backed install: brew / apt / dnf / pacman / zypper / apk /
      // winget / choco / scoop. Manager methods in the catalog all mean
      // "install via the system manager" — resolved per environment.
      const resolved = resolvePackageName(id, env.manager);
      if (resolved.manual) return { status: 'manual', reason: resolved.manual };
      const command = installCommand(env.manager, resolved.name);
      if (!command) return { status: 'manual', reason: `no package manager detected on ${env.os} — install ${id} manually` };
      return planned({ command, manager: env.manager, package: resolved.name });
    }
  }
}

// Best-effort retry route for a tool whose primary plan came back manual
// (#34: the wizard must try, not silently refuse). The manager route already
// failed — before giving up, try the script-installer table for the same
// platform. Returns the original entry when no script route exists either
// (the executor then reports `failed` with the reason as the hint).
function withFallbackRoute(entry, env) {
  if (entry.status !== 'manual') return entry;
  const resolved = resolveScript(entry.id, env.os, env.arch);
  if (resolved.manual) return entry;
  return {
    ...entry,
    status: 'planned',
    command: resolved.run,
    package: resolved.url,
    shell: resolved.shell,
    method: 'script',
    retryFallback: true,
    statusSource: entry.statusSource || `command -v ${statusBin(entry.id, 'script')}`,
  };
}

function statusBin(id, method) {
  if (NPM_BINS[id]) return NPM_BINS[id];
  if (GO_BINS[id]) return GO_BINS[id];
  if (CARGO_BINS[id]) return CARGO_BINS[id];
  return id;
}

// Every install method the builders handle (builder matrix reference).
const ALL_METHODS = [
  'nvm', 'npm', 'node', 'pip', 'python', 'cargo', 'go', 'gem', 'composer',
  'dotnet', 'rustup', 'script', 'link',
  'brew', 'apt', 'dnf', 'pacman', 'zypper', 'apk', 'winget', 'choco', 'scoop',
];

module.exports = { buildToolPlan, withFallbackRoute, pipCommand, statusBin, ALL_METHODS, NVM_INSTALL };
