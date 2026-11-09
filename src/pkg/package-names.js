// Per-distro package-name mapping: tool id → package name per manager.
//
//   PACKAGE_NAMES[id][manager] = 'package-name'      explicit mapping
//   PACKAGE_NAMES[id][manager] = { manual: 'reason'} not packaged for that manager
//
// Managers with no entry for a tool default to the tool id itself
// (most package names equal the tool id). resolvePackageName therefore ALWAYS
// returns { name } or { manual } — never undefined (completeness contract).
//
// Only deviations from the tool id are listed here; the identity default keeps
// the table maintainable. When a tool is genuinely absent from a manager's
// official repos, an explicit { manual } entry explains how to get it.
const PACKAGE_NAMES = {
  // ── language runtimes ─────────────────────────────────────────
  python3: { brew: 'python', pacman: 'python' },
  pyenv: {
    apt: { manual: 'pyenv is not in Debian/Ubuntu repos — install via script: curl -fsSL https://pyenv.run | sh' },
    dnf: { manual: 'pyenv is not in Fedora repos — install via script: curl -fsSL https://pyenv.run | sh' },
    pacman: { manual: 'pyenv lives in the AUR — install manually: https://aur.archlinux.org/packages/pyenv' },
    zypper: { manual: 'pyenv is not in openSUSE repos — install via script: curl -fsSL https://pyenv.run | sh' },
    apk: { manual: 'pyenv is not in Alpine repos — install via script: curl -fsSL https://pyenv.run | sh' },
  },
  go: { apt: 'golang-go' },
  jdk: {
    brew: 'openjdk',
    apt: 'default-jdk',
    dnf: 'java-21-openjdk-devel',
    pacman: 'jdk-openjdk',
    zypper: 'java-21-openjdk-devel',
    apk: 'openjdk21-jdk',
  },
  dotnet: {
    brew: 'dotnet',
    apt: 'dotnet-sdk-8.0',
    dnf: 'dotnet-sdk',
    pacman: 'dotnet-sdk',
    zypper: 'dotnet-sdk',
    apk: 'dotnet8-sdk',
    winget: 'Microsoft.DotNet.SDK.8',
    choco: 'dotnet-sdk',
    scoop: 'dotnet-sdk',
  },
  scala: { dnf: { manual: 'scala is not in official Fedora repos — use Coursier or SDKMAN: https://get-coursier.io' }, apk: { manual: 'scala is not in Alpine repos — use Coursier: https://get-coursier.io' } },
  kotlin: { dnf: { manual: 'kotlin is not in official Fedora repos — install via sdkman: https://sdkman.io' }, apk: { manual: 'kotlin is not in Alpine repos — install manually: https://kotlinlang.org/docs/getting-started.html' } },
  clojure: {
    apt: { manual: 'install from the Clojure apt repo: https://clojure.org/guides/install_clojure' },
    dnf: { manual: 'install from the Clojure rpm repo: https://clojure.org/guides/install_clojure' },
    zypper: { manual: 'install from the Clojure rpm repo: https://clojure.org/guides/install_clojure' },
    apk: { manual: 'clojure is not in Alpine repos — install via script: https://clojure.org/guides/install_clojure' },
  },
  sbt: {
    dnf: { manual: 'install from the sbt rpm repo: https://www.scala-sbt.org/download' },
    pacman: { manual: 'sbt lives in the AUR — https://aur.archlinux.org/packages/sbt' },
    zypper: { manual: 'install from the sbt rpm repo: https://www.scala-sbt.org/download' },
    apk: { manual: 'sbt is not in Alpine repos — https://www.scala-sbt.org/download' },
  },
  graalvm: {
    brew: { manual: 'install the cask: brew install --cask graalvm/tap/graalvm-jdk' },
    apt: { manual: 'download from https://www.graalvm.org/downloads/' },
    dnf: { manual: 'download from https://www.graalvm.org/downloads/' },
    pacman: { manual: 'download from https://www.graalvm.org/downloads/' },
    zypper: { manual: 'download from https://www.graalvm.org/downloads/' },
    apk: { manual: 'download from https://www.graalvm.org/downloads/' },
  },

  // ── jvm ecosystem (brew-only tools) ───────────────────────────
  jbang: { apt: { manual: 'jbang is not in Debian/Ubuntu repos — https://www.jbang.dev/download/' }, dnf: { manual: 'jbang is not in Fedora repos — https://www.jbang.dev/download/' }, pacman: { manual: 'jbang is not in official Arch repos — https://www.jbang.dev/download/' }, zypper: { manual: 'jbang is not in openSUSE repos — https://www.jbang.dev/download/' }, apk: { manual: 'jbang is not in Alpine repos — https://www.jbang.dev/download/' } },
  'spring-boot': { apt: { manual: 'install via sdkman: https://sdkman.io' }, dnf: { manual: 'install via sdkman: https://sdkman.io' }, pacman: { manual: 'install via sdkman: https://sdkman.io' }, zypper: { manual: 'install via sdkman: https://sdkman.io' }, apk: { manual: 'install via sdkman: https://sdkman.io' } },
  quarkus: { apt: { manual: 'quarkus CLI is not in Debian/Ubuntu repos — https://quarkus.io/guides/cli-tooling' }, dnf: { manual: 'quarkus CLI is not in Fedora repos — https://quarkus.io/guides/cli-tooling' }, pacman: { manual: 'quarkus CLI is not in official Arch repos — https://quarkus.io/guides/cli-tooling' }, zypper: { manual: 'quarkus CLI is not in openSUSE repos — https://quarkus.io/guides/cli-tooling' }, apk: { manual: 'quarkus CLI is not in Alpine repos — https://quarkus.io/guides/cli-tooling' } },
  micronaut: { apt: { manual: 'install via sdkman: https://sdkman.io' }, dnf: { manual: 'install via sdkman: https://sdkman.io' }, pacman: { manual: 'install via sdkman: https://sdkman.io' }, zypper: { manual: 'install via sdkman: https://sdkman.io' }, apk: { manual: 'install via sdkman: https://sdkman.io' } },
  visualvm: { apt: { manual: 'download from https://visualvm.github.io/' }, dnf: { manual: 'download from https://visualvm.github.io/' }, pacman: { manual: 'download from https://visualvm.github.io/' }, zypper: { manual: 'download from https://visualvm.github.io/' }, apk: { manual: 'download from https://visualvm.github.io/' } },
  jmeter: { apt: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, dnf: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, pacman: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, zypper: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, apk: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' } },
  jolokia: { apt: { manual: 'download from https://jolokia.org/' }, dnf: { manual: 'download from https://jolokia.org/' }, pacman: { manual: 'download from https://jolokia.org/' }, zypper: { manual: 'download from https://jolokia.org/' }, apk: { manual: 'download from https://jolokia.org/' } },
  flyway: { apt: { manual: 'download from https://documentation.red-gate.com/fd/quickstart-maven-224919678.html or use the download bundle' }, dnf: { manual: 'download from https://www.red-gate.com/products/flyway/ (download bundle)' }, pacman: { manual: 'flyway lives in the AUR — https://aur.archlinux.org/packages/flyway' }, zypper: { manual: 'download from https://www.red-gate.com/products/flyway/ (download bundle)' }, apk: { manual: 'download from https://www.red-gate.com/products/flyway/ (download bundle)' } },
  liquibase: { apt: { manual: 'download from https://www.liquibase.org/download' }, dnf: { manual: 'download from https://www.liquibase.org/download' }, pacman: { manual: 'download from https://www.liquibase.org/download' }, zypper: { manual: 'download from https://www.liquibase.org/download' }, apk: { manual: 'download from https://www.liquibase.org/download' } },
  coursier: { apt: { manual: 'install via script: curl -fL https://github.com/coursier/coursier/raw/stable/installs/cs-x86_64-pc-linux.gz | gzip -d > cs && chmod +x cs' }, dnf: { manual: 'install via script: https://get-coursier.io/docs/cli-installation' }, pacman: { manual: 'coursier lives in the AUR' }, zypper: { manual: 'install via script: https://get-coursier.io/docs/cli-installation' }, apk: { manual: 'install via script: https://get-coursier.io/docs/cli-installation' } },
  mill: { apt: { manual: 'mill is not in Debian/Ubuntu repos — https://mill-build.org/mill/cli_installation.html' }, dnf: { manual: 'mill is not in Fedora repos — https://mill-build.org/mill/cli_installation.html' }, pacman: { manual: 'mill lives in the AUR' }, zypper: { manual: 'mill is not in openSUSE repos — https://mill-build.org/mill/cli_installation.html' }, apk: { manual: 'mill is not in Alpine repos — https://mill-build.org/mill/cli_installation.html' } },
  ammonite: { apt: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, dnf: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, pacman: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, zypper: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, apk: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' } },
  ktlint: { apt: { manual: 'ktlint is not in Debian/Ubuntu repos — https://pinterest.github.io/ktlint/install/cli/' }, dnf: { manual: 'ktlint is not in Fedora repos — https://pinterest.github.io/ktlint/install/cli/' }, pacman: { manual: 'ktlint lives in the AUR' }, zypper: { manual: 'ktlint is not in openSUSE repos — https://pinterest.github.io/ktlint/install/cli/' }, apk: { manual: 'ktlint is not in Alpine repos — https://pinterest.github.io/ktlint/install/cli/' } },
  detekt: { apt: { manual: 'detekt is not in Debian/Ubuntu repos — https://detekt.dev/docs/gettingstarted/cli/' }, dnf: { manual: 'detekt is not in Fedora repos — https://detekt.dev/docs/gettingstarted/cli/' }, pacman: { manual: 'detekt lives in the AUR' }, zypper: { manual: 'detekt is not in openSUSE repos — https://detekt.dev/docs/gettingstarted/cli/' }, apk: { manual: 'detekt is not in Alpine repos — https://detekt.dev/docs/gettingstarted/cli/' } },

  // ── php ───────────────────────────────────────────────────────
  php: { brew: 'php', apt: 'php-cli', dnf: 'php-cli', zypper: 'php8' },
  symfony: {
    brew: 'symfony-cli/tap',
    apt: 'symfony-cli',
    dnf: 'symfony-cli',
    pacman: { manual: 'install via the Symfony installer script: https://symfony.com/download' },
    zypper: { manual: 'install via the Symfony installer script: https://symfony.com/download' },
    apk: { manual: 'install via the Symfony installer script: https://symfony.com/download' },
    choco: 'symfony-cli',
    scoop: 'symfony-cli',
  },
  'wp-cli': { apt: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, dnf: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, pacman: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, zypper: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, apk: { manual: 'install via the official phar: https://wp-cli.org/#installing' } },

  // ── c/c++ ─────────────────────────────────────────────────────
  bazelisk: { apt: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, dnf: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, pacman: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, zypper: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, apk: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' } },
  'clang-format': { dnf: 'clang-tools-extra', pacman: 'clang', zypper: 'clang', apk: 'clang' },
  'clang-tidy': { dnf: 'clang-tools-extra', pacman: 'clang', zypper: 'clang', apk: 'clang' },

  // ── universal ─────────────────────────────────────────────────
  gitflow: { dnf: { manual: 'gitflow is not in official Fedora repos — https://github.com/petervanderdoes/gitflow-avh/wiki/Installation' }, zypper: { manual: 'gitflow is not in openSUSE repos — https://github.com/petervanderdoes/gitflow-avh/wiki/Installation' }, apk: { manual: 'gitflow is not in Alpine repos — https://github.com/petervanderdoes/gitflow-avh/wiki/Installation' } },
  lazydocker: { apt: { manual: 'download from https://github.com/jesseduffield/lazydocker/releases' }, dnf: { manual: 'download from https://github.com/jesseduffield/lazydocker/releases' }, zypper: { manual: 'download from https://github.com/jesseduffield/lazydocker/releases' }, apk: { manual: 'download from https://github.com/jesseduffield/lazydocker/releases' } },
  docker: {
    apt: 'docker.io',
    dnf: 'moby-engine',
    winget: 'Docker.DockerDesktop',
    choco: 'docker-desktop',
    scoop: 'docker',
  },
  'docker-compose': {
    apt: 'docker-compose-v2',
    apk: 'docker-cli-compose',
    winget: { manual: 'docker compose ships with Docker Desktop (winget install Docker.DockerDesktop)' },
  },
  k9s: { apt: { manual: 'download from https://github.com/derailed/k9s/releases' }, dnf: { manual: 'download from https://github.com/derailed/k9s/releases' }, zypper: { manual: 'download from https://github.com/derailed/k9s/releases' } },
  vagrant: { apt: { manual: 'install from the HashiCorp apt repo: https://developer.hashicorp.com/vagrant/install' }, dnf: { manual: 'install from the HashiCorp rpm repo: https://developer.hashicorp.com/vagrant/install' }, zypper: { manual: 'install from the HashiCorp rpm repo: https://developer.hashicorp.com/vagrant/install' }, apk: { manual: 'vagrant is not in Alpine repos — https://developer.hashicorp.com/vagrant/install' } },
  'ansible-dev': { apt: { manual: 'ansible-dev is not in Debian/Ubuntu repos — install ansible via pip instead' }, dnf: { manual: 'ansible-dev is not in Fedora repos — install ansible via pip instead' }, pacman: { manual: 'ansible-dev is not in official Arch repos — install ansible via pip instead' }, zypper: { manual: 'ansible-dev is not in openSUSE repos — install ansible via pip instead' }, apk: { manual: 'ansible-dev is not in Alpine repos — install ansible via pip instead' } },
  'starship-brew': {
    brew: 'starship',
    apt: { manual: 'install via script: curl -sS https://starship.rs/install.sh | sh' },
    dnf: { manual: 'install via script: curl -sS https://starship.rs/install.sh | sh' },
    zypper: { manual: 'install via script: curl -sS https://starship.rs/install.sh | sh' },
    apk: { manual: 'install via script: curl -sS https://starship.rs/install.sh | sh' },
  },
  watchman: { apt: { manual: 'watchman is not in Debian/Ubuntu repos — build from source: https://facebook.github.io/watchman/docs/install' }, dnf: { manual: 'watchman is not in Fedora repos — build from source: https://facebook.github.io/watchman/docs/install' }, pacman: { manual: 'watchman lives in the AUR' }, zypper: { manual: 'watchman is not in openSUSE repos — build from source: https://facebook.github.io/watchman/docs/install' }, apk: { manual: 'watchman is not in Alpine repos — build from source: https://facebook.github.io/watchman/docs/install' } },
  imagemagick: { dnf: 'ImageMagick', zypper: 'ImageMagick' },
  hadolint: { apt: { manual: 'download from https://github.com/hadolint/hadolint/releases' }, dnf: { manual: 'download from https://github.com/hadolint/hadolint/releases' }, pacman: { manual: 'hadolint lives in the AUR' }, zypper: { manual: 'download from https://github.com/hadolint/hadolint/releases' }, apk: { manual: 'download from https://github.com/hadolint/hadolint/releases' } },
  tfsec: { apt: { manual: 'tfsec is not in Debian/Ubuntu repos — download from https://github.com/aquasecurity/tfsec/releases (now part of trivy)' }, dnf: { manual: 'tfsec is not in Fedora repos — download from https://github.com/aquasecurity/tfsec/releases (now part of trivy)' }, pacman: { manual: 'tfsec lives in the AUR' }, zypper: { manual: 'tfsec is not in openSUSE repos — download from https://github.com/aquasecurity/tfsec/releases (now part of trivy)' }, apk: { manual: 'tfsec is not in Alpine repos — download from https://github.com/aquasecurity/tfsec/releases (now part of trivy)' } },
  trivy: { apt: { manual: 'install from the Aqua apt repo: https://trivy.dev/latest/getting-started/installation/' }, dnf: { manual: 'install from the Aqua rpm repo: https://trivy.dev/latest/getting-started/installation/' }, pacman: { manual: 'trivy lives in the AUR' }, zypper: { manual: 'install from the Aqua rpm repo: https://trivy.dev/latest/getting-started/installation/' } },
  sonarqube: { apt: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, dnf: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, pacman: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, zypper: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, apk: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' } },
  overmind: { apt: { manual: 'download from https://github.com/DarthSim/overmind/releases' }, dnf: { manual: 'download from https://github.com/DarthSim/overmind/releases' }, pacman: { manual: 'overmind lives in the AUR' }, zypper: { manual: 'download from https://github.com/DarthSim/overmind/releases' }, apk: { manual: 'download from https://github.com/DarthSim/overmind/releases' } },

  // ── ai ────────────────────────────────────────────────────────
  ollama: { apt: { manual: 'install via script: curl -fsSL https://ollama.com/install.sh | sh' }, dnf: { manual: 'install via script: curl -fsSL https://ollama.com/install.sh | sh' }, pacman: { manual: 'ollama is not in official Arch repos — install via script: curl -fsSL https://ollama.com/install.sh | sh' }, zypper: { manual: 'install via script: curl -fsSL https://ollama.com/install.sh | sh' }, apk: { manual: 'install via script: curl -fsSL https://ollama.com/install.sh | sh' } },
};

// Resolves the package name for a tool on a manager.
// Returns { name } or { manual } — never undefined (completeness contract).
function resolvePackageName(id, manager) {
  const entry = PACKAGE_NAMES[id];
  if (entry) {
    const perManager = entry[manager];
    if (typeof perManager === 'string') return { name: perManager };
    if (perManager && typeof perManager === 'object' && perManager.manual) {
      return { manual: perManager.manual };
    }
  }
  // Default mapping: package name equals the tool id.
  return { name: id };
}

module.exports = { PACKAGE_NAMES, resolvePackageName };
