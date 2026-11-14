// Per-OS×arch script URL resolver for installMethod "script" tools.
// resolveScript(id, os, arch) → { url, run } | { manual }
//   url — download/script URL (for the plan and for humans)
//   run — the exact command that installs it (POSIX sh unless noted)

const key = (os, arch) => `${os}-${arch}`;

const LINUX_X86 = 'Linux-x86_64';
const LINUX_ARM = 'Linux-aarch64';
const MAC_X86 = 'MacOSX-x86_64';
const MAC_ARM = 'MacOSX-arm64';

const condaAsset = { 'linux-x64': LINUX_X86, 'linux-arm64': LINUX_ARM, 'darwin-x64': MAC_X86, 'darwin-arm64': MAC_ARM };

const SCRIPTS = {
  conda: {
    'linux-x64': () => ({ url: `https://repo.anaconda.com/miniconda/Miniconda3-latest-${condaAsset['linux-x64']}.sh`, run: 'curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o /tmp/miniconda.sh && sh /tmp/miniconda.sh -b' }),
    'linux-arm64': () => ({ url: `https://repo.anaconda.com/miniconda/Miniconda3-latest-${condaAsset['linux-arm64']}.sh`, run: 'curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh -o /tmp/miniconda.sh && sh /tmp/miniconda.sh -b' }),
    'darwin-x64': () => ({ url: `https://repo.anaconda.com/miniconda/Miniconda3-latest-${condaAsset['darwin-x64']}.sh`, run: 'curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh -o /tmp/miniconda.sh && sh /tmp/miniconda.sh -b' }),
    'darwin-arm64': () => ({ url: `https://repo.anaconda.com/miniconda/Miniconda3-latest-${condaAsset['darwin-arm64']}.sh`, run: 'curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-arm64.sh -o /tmp/miniconda.sh && sh /tmp/miniconda.sh -b' }),
    'win32-x64': () => ({ url: 'https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe', run: 'Start-Process -Wait $env:TEMP\\Miniconda3-latest-Windows-x86_64.exe /S', shell: 'powershell' }),
  },
  bun: {
    'linux-x64': () => ({ url: 'https://bun.sh/install', run: 'curl -fsSL https://bun.sh/install | sh' }),
    'linux-arm64': () => ({ url: 'https://bun.sh/install', run: 'curl -fsSL https://bun.sh/install | sh' }),
    'darwin-x64': () => ({ url: 'https://bun.sh/install', run: 'curl -fsSL https://bun.sh/install | sh' }),
    'darwin-arm64': () => ({ url: 'https://bun.sh/install', run: 'curl -fsSL https://bun.sh/install | sh' }),
    'win32-x64': () => ({ url: 'https://bun.sh/install.ps1', run: 'powershell -c "irm bun.sh/install.ps1 | iex"', shell: 'powershell' }),
    'win32-arm64': () => ({ url: 'https://bun.sh/install.ps1', run: 'powershell -c "irm bun.sh/install.ps1 | iex"', shell: 'powershell' }),
  },
  gcloud: {
    'linux-x64': () => ({ url: 'https://sdk.cloud.google.com', run: 'curl -fsSL https://sdk.cloud.google.com | sh' }),
    'linux-arm64': () => ({ url: 'https://sdk.cloud.google.com', run: 'curl -fsSL https://sdk.cloud.google.com | sh' }),
    'darwin-x64': () => ({ url: 'https://sdk.cloud.google.com', run: 'curl -fsSL https://sdk.cloud.google.com | sh' }),
    'darwin-arm64': () => ({ url: 'https://sdk.cloud.google.com', run: 'curl -fsSL https://sdk.cloud.google.com | sh' }),
    'win32-x64': () => ({ manual: 'install gcloud CLI for Windows: https://cloud.google.com/sdk/docs/install-sdk-for-windows' }),
    'win32-arm64': () => ({ manual: 'install gcloud CLI for Windows: https://cloud.google.com/sdk/docs/install-sdk-for-windows' }),
  },
  'azure-cli': {
    'linux-x64': () => ({ url: 'https://aka.ms/InstallAzureCli', run: 'curl -fsSL https://aka.ms/InstallAzureCli | sh' }),
    'linux-arm64': () => ({ url: 'https://aka.ms/InstallAzureCli', run: 'curl -fsSL https://aka.ms/InstallAzureCli | sh' }),
    'darwin-x64': () => ({ url: 'https://aka.ms/InstallAzureCli', run: 'curl -fsSL https://aka.ms/InstallAzureCli | sh' }),
    'darwin-arm64': () => ({ url: 'https://aka.ms/InstallAzureCli', run: 'curl -fsSL https://aka.ms/InstallAzureCli | sh' }),
    'win32-x64': () => ({ manual: 'on Windows install azure-cli via winget: winget install Microsoft.AzureCLI' }),
    'win32-arm64': () => ({ manual: 'on Windows install azure-cli via winget: winget install Microsoft.AzureCLI' }),
  },
  rustup: {
    'linux-x64': () => ({ url: 'https://sh.rustup.rs', run: 'curl -fsSL https://sh.rustup.rs | sh -s -- -y' }),
    'linux-arm64': () => ({ url: 'https://sh.rustup.rs', run: 'curl -fsSL https://sh.rustup.rs | sh -s -- -y' }),
    'darwin-x64': () => ({ url: 'https://sh.rustup.rs', run: 'curl -fsSL https://sh.rustup.rs | sh -s -- -y' }),
    'darwin-arm64': () => ({ url: 'https://sh.rustup.rs', run: 'curl -fsSL https://sh.rustup.rs | sh -s -- -y' }),
    'win32-x64': () => ({ url: 'https://win.rustup.rs/x86_64', run: 'iwr -useb https://win.rustup.rs/x86_64 -OutFile rustup-init.exe; ./rustup-init.exe -y', shell: 'powershell' }),
    'win32-arm64': () => ({ url: 'https://win.rustup.rs/aarch64', run: 'iwr -useb https://win.rustup.rs/aarch64 -OutFile rustup-init.exe; ./rustup-init.exe -y', shell: 'powershell' }),
  },
  'oh-my-zsh': {
    universal: () => ({ url: 'https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh', run: 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"' }),
  },
  helm: {
    'linux-x64': () => ({ url: 'https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3', run: 'curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | sh' }),
    'linux-arm64': () => ({ url: 'https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3', run: 'curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | sh' }),
    'darwin-x64': () => ({ url: 'https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3', run: 'curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | sh' }),
    'darwin-arm64': () => ({ url: 'https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3', run: 'curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | sh' }),
    'win32-x64': () => ({ manual: 'on Windows install helm via winget: winget install Helm.Helm' }),
    'win32-arm64': () => ({ manual: 'on Windows install helm via winget: winget install Helm.Helm' }),
  },
  composer: {
    'linux-x64': () => ({ url: 'https://getcomposer.org/installer', run: 'curl -fsSL https://getcomposer.org/installer -o /tmp/composer-setup.php && php /tmp/composer-setup.php --install-dir=$HOME/.local/bin --filename=composer' }),
    'linux-arm64': () => ({ url: 'https://getcomposer.org/installer', run: 'curl -fsSL https://getcomposer.org/installer -o /tmp/composer-setup.php && php /tmp/composer-setup.php --install-dir=$HOME/.local/bin --filename=composer' }),
    'darwin-x64': () => ({ url: 'https://getcomposer.org/installer', run: 'curl -fsSL https://getcomposer.org/installer -o /tmp/composer-setup.php && php /tmp/composer-setup.php --install-dir=$HOME/.local/bin --filename=composer' }),
    'darwin-arm64': () => ({ url: 'https://getcomposer.org/installer', run: 'curl -fsSL https://getcomposer.org/installer -o /tmp/composer-setup.php && php /tmp/composer-setup.php --install-dir=$HOME/.local/bin --filename=composer' }),
    'win32-x64': () => ({ manual: 'install composer via the installer: https://getcomposer.org/doc/00-intro.md#installation-windows' }),
    'win32-arm64': () => ({ manual: 'install composer via the installer: https://getcomposer.org/doc/00-intro.md#installation-windows' }),
  },
  vcpkg: {
    universal: () => ({ url: 'https://github.com/microsoft/vcpkg', run: 'git clone https://github.com/microsoft/vcpkg $HOME/.adm/vcpkg && $HOME/.adm/vcpkg/bootstrap-vcpkg.sh' }),
    'win32-x64': () => ({ url: 'https://github.com/microsoft/vcpkg', run: 'git clone https://github.com/microsoft/vcpkg $env:USERPROFILE\\.adm\\vcpkg; & $env:USERPROFILE\\.adm\\vcpkg\\bootstrap-vcpkg.bat', shell: 'powershell' }),
  },
  bazel: {
    'linux-x64': () => ({ url: 'https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-amd64', run: 'mkdir -p $HOME/.local/bin && curl -fsSL https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-amd64 -o $HOME/.local/bin/bazel && chmod +x $HOME/.local/bin/bazel' }),
    'linux-arm64': () => ({ url: 'https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-arm64', run: 'mkdir -p $HOME/.local/bin && curl -fsSL https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-arm64 -o $HOME/.local/bin/bazel && chmod +x $HOME/.local/bin/bazel' }),
    'darwin-x64': () => ({ url: 'https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-darwin-amd64', run: 'mkdir -p $HOME/.local/bin && curl -fsSL https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-darwin-amd64 -o $HOME/.local/bin/bazel && chmod +x $HOME/.local/bin/bazel' }),
    'darwin-arm64': () => ({ url: 'https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-darwin-arm64', run: 'mkdir -p $HOME/.local/bin && curl -fsSL https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-darwin-arm64 -o $HOME/.local/bin/bazel && chmod +x $HOME/.local/bin/bazel' }),
    'win32-x64': () => ({ manual: 'install bazelisk via choco: choco install bazelisk' }),
    'win32-arm64': () => ({ manual: 'install bazelisk via choco: choco install bazelisk' }),
  },
  // Homebrew as a regular catalog tool (PRD #42, C3 — macOS and Linux; the
  // official install script; status probed via `brew --version`).
  homebrew: {
    'darwin-x64': () => ({ url: 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh', run: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', statusProbe: 'brew --version' }),
    'darwin-arm64': () => ({ url: 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh', run: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', statusProbe: 'brew --version' }),
    'linux-x64': () => ({ url: 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh', run: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', statusProbe: 'brew --version' }),
    'linux-arm64': () => ({ url: 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh', run: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', statusProbe: 'brew --version' }),
    'win32-x64': () => ({ manual: 'Homebrew does not support Windows' }),
    'win32-arm64': () => ({ manual: 'Homebrew does not support Windows' }),
  },
};

// resolveScript(id, os, arch) → { url, run, shell? } | { manual }
// Falls back to a "universal" entry (platform-independent script) when the
// exact os-arch pair has none.
function resolveScript(id, os, arch) {
  const table = SCRIPTS[id];
  if (!table) return { manual: `no script installer known for "${id}" — install manually: https://github.com/CrystalPlatforms/ADM-CLI#manual-tools` };
  const exact = table[key(os, arch)];
  if (exact) return exact();
  if (table.universal) return table.universal();
  return { manual: `"${id}" has no install script for ${key(os, arch)} — install manually` };
}

module.exports = { resolveScript, SCRIPTS };
