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
};
const GO_BINS = { delve: 'dlv', gomock: 'mockgen' };
const CARGO_BINS = { delta: 'delta', 'fd-find': 'fd', ripgrep: 'rg', 'du-dust': 'dust', bottom: 'btm' };

const NVM_INSTALL = 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | sh';

// Pick the python installer command:
//   pip available → pip / pip3 available → pip3 / otherwise → python3 -m pip
function pipCommand(pkgName, availability = {}) {
  if (availability.pip) return `pip install --upgrade ${pkgName}`;
  if (availability.pip3) return `pip3 install --upgrade ${pkgName}`;
  return `python3 -m pip install --upgrade ${pkgName}`;
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
      return planned({ command: NVM_INSTALL, statusSource: 'command -v node' });

    case 'npm':
    case 'node': {
      const name = NPM_BINS[id] || id;
      return planned({ command: `npm install -g ${id}@latest`, statusSource: `command -v ${name}` });
    }

    case 'pip':
    case 'python': {
      const pkgName = id;
      return planned({ command: pipCommand(pkgName, opts.pipAvailability) });
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
      if (id === 'cargo') return resolveScript('rustup', env.os, env.arch).url
        ? { status: 'planned', command: resolveScript('rustup', env.os, env.arch).run, statusSource: 'command -v cargo' }
        : { status: 'manual', reason: resolveScript('rustup', env.os, env.arch).manual };
      return planned({ command: `rustup component add ${id}` });
    }

    case 'script': {
      const resolved = resolveScript(id, env.os, env.arch);
      if (resolved.manual) return { status: 'manual', reason: resolved.manual };
      return planned({ command: resolved.run, package: resolved.url });
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

module.exports = { buildToolPlan, pipCommand, statusBin, ALL_METHODS, NVM_INSTALL };
