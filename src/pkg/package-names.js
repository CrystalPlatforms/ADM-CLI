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
//
// ── winget ids (HITL finding, 0.3.0) ────────────────────────────────────
// winget requires Publisher.Package ids (Git.Git, not "git") — the identity
// default is essentially ALWAYS wrong on winget, so every winget-route tool
// carries an explicit entry below. All ids verified against the live winget
// catalog (winget show --id <id> --exact) on winget 1.29.
const PACKAGE_NAMES = {
  // ── language runtimes ─────────────────────────────────────────
  python3: { brew: 'python', pacman: 'python', winget: 'Python.Python.3.13' },
  pyenv: {
    apt: { manual: 'pyenv is not in Debian/Ubuntu repos — install via script: curl -fsSL https://pyenv.run | sh' },
    dnf: { manual: 'pyenv is not in Fedora repos — install via script: curl -fsSL https://pyenv.run | sh' },
    pacman: { manual: 'pyenv lives in the AUR — install manually: https://aur.archlinux.org/packages/pyenv' },
    zypper: { manual: 'pyenv is not in openSUSE repos — install via script: curl -fsSL https://pyenv.run | sh' },
    apk: { manual: 'pyenv is not in Alpine repos — install via script: curl -fsSL https://pyenv.run | sh' },
    winget: 'pyenv-win.pyenv-win',
  },
  go: { apt: 'golang-go', winget: 'GoLang.Go' },
  jdk: {
    brew: 'openjdk',
    apt: 'default-jdk',
    dnf: 'java-21-openjdk-devel',
    pacman: 'jdk-openjdk',
    zypper: 'java-21-openjdk-devel',
    apk: 'openjdk21-jdk',
    winget: 'EclipseAdoptium.Temurin.21.JDK',
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
  scala: {
    dnf: { manual: 'scala is not in official Fedora repos — use Coursier or SDKMAN: https://get-coursier.io' },
    apk: { manual: 'scala is not in Alpine repos — use Coursier: https://get-coursier.io' },
    winget: 'VirtusLab.ScalaCLI',
  },
  kotlin: { dnf: { manual: 'kotlin is not in official Fedora repos — install via sdkman: https://sdkman.io' }, apk: { manual: 'kotlin is not in Alpine repos — install manually: https://kotlinlang.org/docs/getting-started.html' }, winget: 'Kotlin.Kotlin' },
  clojure: {
    apt: { manual: 'install from the Clojure apt repo: https://clojure.org/guides/install_clojure' },
    dnf: { manual: 'install from the Clojure rpm repo: https://clojure.org/guides/install_clojure' },
    zypper: { manual: 'install from the Clojure rpm repo: https://clojure.org/guides/install_clojure' },
    apk: { manual: 'clojure is not in Alpine repos — install via script: https://clojure.org/guides/install_clojure' },
    winget: 'Clojure.ClojureCLI',
  },
  sbt: {
    dnf: { manual: 'install from the sbt rpm repo: https://www.scala-sbt.org/download' },
    pacman: { manual: 'sbt lives in the AUR — https://aur.archlinux.org/packages/sbt' },
    zypper: { manual: 'install from the sbt rpm repo: https://www.scala-sbt.org/download' },
    apk: { manual: 'sbt is not in Alpine repos — https://www.scala-sbt.org/download' },
    winget: 'sbt.sbt',
  },
  graalvm: {
    brew: { manual: 'install the cask: brew install --cask graalvm/tap/graalvm-jdk' },
    apt: { manual: 'download from https://www.graalvm.org/downloads/' },
    dnf: { manual: 'download from https://www.graalvm.org/downloads/' },
    pacman: { manual: 'download from https://www.graalvm.org/downloads/' },
    zypper: { manual: 'download from https://www.graalvm.org/downloads/' },
    apk: { manual: 'download from https://www.graalvm.org/downloads/' },
    winget: { manual: 'no official GraalVM winget package — download a JDK build from https://www.graalvm.org/downloads/' },
  },
  ruby: { winget: 'RubyInstallerTeam.RubyWithDevKit.3.4' },
  php: { brew: 'php', apt: 'php-cli', dnf: 'php-cli', zypper: 'php8', winget: 'PHP.PHP.8.4' },
  symfony: {
    brew: 'symfony-cli/tap',
    apt: 'symfony-cli',
    dnf: 'symfony-cli',
    pacman: { manual: 'install via the Symfony installer script: https://symfony.com/download' },
    zypper: { manual: 'install via the Symfony installer script: https://symfony.com/download' },
    apk: { manual: 'install via the Symfony installer script: https://symfony.com/download' },
    choco: 'symfony-cli',
    scoop: 'symfony-cli',
    winget: 'Symfony-cli.Symfony-cli',
  },
  'wp-cli': { apt: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, dnf: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, pacman: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, zypper: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, apk: { manual: 'install via the official phar: https://wp-cli.org/#installing' }, winget: { manual: 'wp-cli is a phar — download from https://wp-cli.org/#installing' } },

  // ── jvm ecosystem ─────────────────────────────────────────────
  gradle: { winget: 'Gradle.Gradle' },
  maven: { winget: 'Apache.Maven' },
  ant: { winget: 'ApacheAnt.ApacheAnt' },
  leiningen: { winget: 'Leiningen.Leiningen' },
  jbang: { apt: { manual: 'jbang is not in Debian/Ubuntu repos — https://www.jbang.dev/download/' }, dnf: { manual: 'jbang is not in Fedora repos — https://www.jbang.dev/download/' }, pacman: { manual: 'jbang is not in official Arch repos — https://www.jbang.dev/download/' }, zypper: { manual: 'jbang is not in openSUSE repos — https://www.jbang.dev/download/' }, apk: { manual: 'jbang is not in Alpine repos — https://www.jbang.dev/download/' }, winget: 'jbangdev.jbang' },
  'spring-boot': { apt: { manual: 'install via sdkman: https://sdkman.io' }, dnf: { manual: 'install via sdkman: https://sdkman.io' }, pacman: { manual: 'install via sdkman: https://sdkman.io' }, zypper: { manual: 'install via sdkman: https://sdkman.io' }, apk: { manual: 'install via sdkman: https://sdkman.io' }, winget: { manual: 'no official Spring Boot CLI winget package — install via sdkman: https://sdkman.io' } },
  quarkus: { apt: { manual: 'quarkus CLI is not in Debian/Ubuntu repos — https://quarkus.io/guides/cli-tooling' }, dnf: { manual: 'quarkus CLI is not in Fedora repos — https://quarkus.io/guides/cli-tooling' }, pacman: { manual: 'quarkus CLI is not in official Arch repos — https://quarkus.io/guides/cli-tooling' }, zypper: { manual: 'quarkus CLI is not in openSUSE repos — https://quarkus.io/guides/cli-tooling' }, apk: { manual: 'quarkus CLI is not in Alpine repos — https://quarkus.io/guides/cli-tooling' }, winget: { manual: 'no official Quarkus CLI winget package — see https://quarkus.io/guides/cli-tooling' } },
  micronaut: { apt: { manual: 'install via sdkman: https://sdkman.io' }, dnf: { manual: 'install via sdkman: https://sdkman.io' }, pacman: { manual: 'install via sdkman: https://sdkman.io' }, zypper: { manual: 'install via sdkman: https://sdkman.io' }, apk: { manual: 'install via sdkman: https://sdkman.io' }, winget: { manual: 'no official Micronaut CLI winget package — install via sdkman: https://sdkman.io' } },
  visualvm: { apt: { manual: 'download from https://visualvm.github.io/' }, dnf: { manual: 'download from https://visualvm.github.io/' }, pacman: { manual: 'download from https://visualvm.github.io/' }, zypper: { manual: 'download from https://visualvm.github.io/' }, apk: { manual: 'download from https://visualvm.github.io/' }, winget: 'VisualVM.VisualVM' },
  jmeter: { apt: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, dnf: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, pacman: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, zypper: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, apk: { manual: 'download from https://jmeter.apache.org/download_jmeter.cgi' }, winget: 'Apache.JMeter' },
  jolokia: { apt: { manual: 'download from https://jolokia.org/' }, dnf: { manual: 'download from https://jolokia.org/' }, pacman: { manual: 'jolokia lives in the AUR' }, zypper: { manual: 'download from https://jolokia.org/' }, apk: { manual: 'download from https://jolokia.org/' }, winget: { manual: 'jolokia is a JVM agent, not a CLI — add it to your app: https://jolokia.org' } },
  flyway: { apt: { manual: 'download from https://documentation.red-gate.com/fd/quickstart-maven-224919678.html or use the download bundle' }, dnf: { manual: 'download from https://www.red-gate.com/products/flyway/ (download bundle)' }, pacman: { manual: 'flyway lives in the AUR — https://aur.archlinux.org/packages/flyway' }, zypper: { manual: 'download from https://www.red-gate.com/products/flyway/ (download bundle)' }, apk: { manual: 'download from https://www.red-gate.com/products/flyway/ (download bundle)' }, winget: 'Redgate.Flyway' },
  liquibase: { apt: { manual: 'download from https://www.liquibase.org/download' }, dnf: { manual: 'download from https://www.liquibase.org/download' }, pacman: { manual: 'download from https://www.liquibase.org/download' }, zypper: { manual: 'download from https://www.liquibase.org/download' }, apk: { manual: 'download from https://www.liquibase.org/download' }, winget: 'Liquibase.Liquibase' },
  coursier: { apt: { manual: 'install via script: curl -fL https://github.com/coursier/coursier/raw/stable/installs/cs-x86_64-pc-linux.gz | gzip -d > cs && chmod +x cs' }, dnf: { manual: 'install via script: https://get-coursier.io/docs/cli-installation' }, pacman: { manual: 'coursier lives in the AUR' }, zypper: { manual: 'install via script: https://get-coursier.io/docs/cli-installation' }, apk: { manual: 'install via script: https://get-coursier.io/docs/cli-installation' }, winget: { manual: 'install via the coursier bootstrapper: https://get-coursier.io/docs/cli-installation' } },
  mill: { apt: { manual: 'mill is not in Debian/Ubuntu repos — https://mill-build.org/mill/cli_installation.html' }, dnf: { manual: 'mill is not in Fedora repos — https://mill-build.org/mill/cli_installation.html' }, pacman: { manual: 'mill lives in the AUR' }, zypper: { manual: 'mill is not in openSUSE repos — https://mill-build.org/mill/cli_installation.html' }, apk: { manual: 'mill is not in Alpine repos — https://mill-build.org/mill/cli_installation.html' }, winget: { manual: 'no official mill winget package — see https://mill-build.org/mill/cli_installation.html' } },
  ammonite: { apt: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, dnf: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, pacman: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, zypper: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, apk: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' }, winget: { manual: 'install via script: https://ammonite.io/#Ammonite-ops' } },
  ktlint: { apt: { manual: 'ktlint is not in Debian/Ubuntu repos — https://pinterest.github.io/ktlint/install/cli/' }, dnf: { manual: 'ktlint is not in Fedora repos — https://pinterest.github.io/ktlint/install/cli/' }, pacman: { manual: 'ktlint lives in the AUR' }, zypper: { manual: 'ktlint is not in openSUSE repos — https://pinterest.github.io/ktlint/install/cli/' }, apk: { manual: 'ktlint is not in Alpine repos — https://pinterest.github.io/ktlint/install/cli/' }, winget: { manual: 'no official ktlint winget package — see https://pinterest.github.io/ktlint/install/cli/' } },
  detekt: { apt: { manual: 'detekt is not in Debian/Ubuntu repos — https://detekt.dev/docs/gettingstarted/cli/' }, dnf: { manual: 'detekt is not in Fedora repos — https://detekt.dev/docs/gettingstarted/cli/' }, pacman: { manual: 'detekt lives in the AUR' }, zypper: { manual: 'detekt is not in openSUSE repos — https://detekt.dev/docs/gettingstarted/cli/' }, apk: { manual: 'detekt is not in Alpine repos — https://detekt.dev/docs/gettingstarted/cli/' }, winget: { manual: 'no official detekt winget package — see https://detekt.dev/docs/gettingstarted/cli/' } },

  // ── c/c++ ─────────────────────────────────────────────────────
  gcc: { winget: 'BrechtSanders.WinLibs.POSIX.UCRT' },
  clang: { winget: 'LLVM.LLVM' },
  cmake: { winget: 'Kitware.CMake' },
  make: { winget: 'ezwinports.make' },
  ninja: { winget: 'Ninja-build.Ninja' },
  'clang-format': { dnf: 'clang-tools-extra', pacman: 'clang', zypper: 'clang', apk: 'clang', winget: { manual: 'clang-format ships with the LLVM toolchain — install it via ADM (tool "clang") or: winget install LLVM.LLVM' } },
  'clang-tidy': { dnf: 'clang-tools-extra', pacman: 'clang', zypper: 'clang', apk: 'clang', winget: { manual: 'clang-tidy ships with the LLVM toolchain — install it via ADM (tool "clang") or: winget install LLVM.LLVM' } },
  cppcheck: { winget: 'Cppcheck.Cppcheck' },
  gdb: { winget: { manual: 'gdb ships with the WinLibs GCC toolchain — install it via ADM (tool "gcc") or MSYS2: https://www.msys2.org' } },
  lldb: { winget: { manual: 'lldb ships with LLVM toolchain distributions — install via ADM (tool "clang") or: scoop install llvm' } },
  ccache: { winget: 'Ccache.Ccache' },
  valgrind: { winget: { manual: 'valgrind is a Unix profiler — use WSL: wsl -e bash -c "sudo apt install valgrind"' } },
  distcc: { winget: { manual: 'distcc is a Unix distributed compiler — use WSL: https://distcc.github.io' } },
  bear: { winget: { manual: 'bear (compilation DB generator) is a Unix tool — use WSL: https://github.com/rizsotto/Bear' } },
  doxygen: { winget: 'Doxygen.Doxygen' },
  bazelisk: { apt: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, dnf: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, pacman: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, zypper: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, apk: { manual: 'download the binary from https://github.com/bazelbuild/bazelisk/releases' }, winget: { manual: 'no official bazelisk winget package — download from https://github.com/bazelbuild/bazelisk/releases or: choco install bazelisk' } },

  // ── universal ─────────────────────────────────────────────────
  // Windows winget ids differ from the tool ids — explicit mapping below
  // (every id verified against the live winget catalog).
  curl: { winget: 'cURL.cURL' },
  jq: { winget: 'jqlang.jq' },
  yq: { winget: 'MikeFarah.yq' },
  git: { winget: 'Git.Git' },
  gh: { winget: 'GitHub.cli' },
  hub: { winget: 'GitHub.hub' },
  'git-lfs': { winget: 'GitHub.GitLFS' },
  gitflow: {
    dnf: { manual: 'gitflow is not in official Fedora repos — https://github.com/petervanderdoes/gitflow-avh/wiki/Installation' },
    zypper: { manual: 'gitflow is not in openSUSE repos — https://github.com/petervanderdoes/gitflow-avh/wiki/Installation' },
    apk: { manual: 'gitflow is not in Alpine repos — https://github.com/petervanderdoes/gitflow-avh/wiki/Installation' },
    winget: { manual: 'no git-flow winget package — via Chocolatey: choco install gitflow.avhEdition' },
    choco: 'gitflow.avhEdition',
  },
  tig: { winget: { manual: 'tig is a Unix TUI — use WSL: wsl -e bash -c "sudo apt install tig"' } },
  kubectl: { winget: 'Kubernetes.kubectl' },
  k9s: { apt: { manual: 'download from https://github.com/derailed/k9s/releases' }, dnf: { manual: 'download from https://github.com/derailed/k9s/releases' }, zypper: { manual: 'download from https://github.com/derailed/k9s/releases' }, winget: 'Derailed.k9s' },
  terraform: { winget: 'Hashicorp.Terraform' },
  packer: { winget: 'Hashicorp.Packer' },
  vagrant: { apt: { manual: 'install from the HashiCorp apt repo: https://developer.hashicorp.com/vagrant/install' }, dnf: { manual: 'install from the HashiCorp rpm repo: https://developer.hashicorp.com/vagrant/install' }, apk: { manual: 'vagrant is not in Alpine repos — https://developer.hashicorp.com/vagrant/install' }, winget: 'HashiCorp.Vagrant' },
  'ansible-dev': { apt: { manual: 'ansible-dev is not in Debian/Ubuntu repos — install ansible via pip instead' }, dnf: { manual: 'ansible-dev is not in Fedora repos — install ansible via pip instead' }, pacman: { manual: 'ansible-dev is not in official Arch repos — install ansible via pip instead' }, zypper: { manual: 'ansible-dev is not in openSUSE repos — install ansible via pip instead' }, apk: { manual: 'ansible-dev is not in Alpine repos — install ansible via pip instead' }, winget: { manual: 'no ansible winget package — install via pip: pip install ansible' } },
  neovim: { winget: 'Neovim.Neovim' },
  zsh: { winget: { manual: 'zsh is a Unix shell — use WSL: wsl -e bash -c "sudo apt install zsh"' } },
  'starship-brew': {
    brew: 'starship',
    apt: { manual: 'install via script: curl -sS https://starship.rs/install.sh | sh' },
    dnf: { manual: 'install via script: curl -sS https://starship.rs/install.sh | sh' },
    zypper: { manual: 'install via script: curl -sS https://starship.rs/install.sh | sh' },
    apk: { manual: 'install via script: curl -sS https://starship.rs/install.sh | sh' },
    winget: 'Starship.Starship',
  },
  htop: { winget: { manual: 'htop is a Unix TUI — use WSL: wsl -e bash -c "sudo apt install htop"' } },
  ncdu: { winget: { manual: 'ncdu is a Unix TUI — use WSL: wsl -e bash -c "sudo apt install ncdu"' } },
  // GnuWin32.Tree runs an INTERACTIVE setup wizard — headless winget install
  // aborts with "You cancelled the installation" (HITL finding, 0.3.0).
  tree: { winget: { manual: 'the winget tree package uses an interactive installer — use WSL: wsl -e bash -c "sudo apt install tree", or scoop: scoop install tree' } },
  openssl: { winget: 'ShiningLight.OpenSSL.Light' },
  // rsync is a Unix tool — no native Windows package exists anywhere
  rsync: { winget: { manual: 'rsync is a Unix tool and has no native Windows build — use WSL: wsl -e rsync <args>, or try Rclone for cloud sync: winget install Rclone.Rclone' }, choco: { manual: 'rsync on Windows requires WSL/Cygwin — recommended: wsl -e rsync <args>' } },
  // wget's winget manifest is permanently outdated (installer hash mismatch)
  // and Windows 10+ ships curl anyway — route to manual guidance.
  wget: { winget: { manual: 'the winget wget package is currently broken (installer hash mismatch). Windows 10+ already has curl built in: curl -O <url>. Or install wget via scoop: scoop install wget' } },
  ffmpeg: { winget: 'Gyan.FFmpeg' },
  tmux: { winget: { manual: 'tmux is a Unix terminal multiplexer and is not available on Windows — use WSL: wsl -e bash -c "sudo apt install tmux"' }, choco: { manual: 'tmux on Windows requires WSL/Cygwin — recommended: wsl -e bash -c "sudo apt install tmux"' } },
  lazydocker: { winget: 'JesseDuffield.Lazydocker', apt: { manual: 'download from https://github.com/jesseduffield/lazydocker/releases' }, dnf: { manual: 'download from https://github.com/jesseduffield/lazydocker/releases' }, zypper: { manual: 'download from https://github.com/jesseduffield/lazydocker/releases' }, apk: { manual: 'download from https://github.com/jesseduffield/lazydocker/releases' } },
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
  watchman: {
    apt: { manual: 'watchman is not in Debian/Ubuntu repos — build from source: https://facebook.github.io/watchman/docs/install' },
    dnf: { manual: 'watchman is not in Fedora repos — build from source: https://facebook.github.io/watchman/docs/install' },
    pacman: { manual: 'watchman lives in the AUR' },
    zypper: { manual: 'watchman is not in openSUSE repos — build from source: https://facebook.github.io/watchman/docs/install' },
    apk: { manual: 'watchman is not in Alpine repos — build from source: https://facebook.github.io/watchman/docs/install' },
    winget: 'facebook.watchman',
  },
  imagemagick: { dnf: 'ImageMagick', zypper: 'ImageMagick', winget: 'ImageMagick.ImageMagick' },
  shellcheck: { winget: { manual: 'no official shellcheck winget package — via scoop: scoop install shellcheck, or use WSL' } },
  shfmt: { winget: { manual: 'no shfmt winget package — download from https://github.com/mvdan/sh/releases or: scoop install shfmt' } },
  hadolint: { apt: { manual: 'download from https://github.com/hadolint/hadolint/releases' }, dnf: { manual: 'download from https://github.com/hadolint/hadolint/releases' }, pacman: { manual: 'hadolint lives in the AUR' }, zypper: { manual: 'download from https://github.com/hadolint/hadolint/releases' }, apk: { manual: 'download from https://github.com/hadolint/hadolint/releases' }, winget: 'hadolint.hadolint' },
  tfsec: { apt: { manual: 'tfsec is not in Debian/Ubuntu repos — download from https://github.com/aquasecurity/tfsec/releases (now part of trivy)' }, dnf: { manual: 'tfsec is not in Fedora repos — download from https://github.com/aquasecurity/tfsec/releases (now part of trivy)' }, pacman: { manual: 'tfsec lives in the AUR' }, zypper: { manual: 'download from https://github.com/aquasecurity/tfsec/releases (now part of trivy)' }, winget: { manual: 'tfsec is deprecated in favor of trivy — install the ADM tool "trivy" instead' } },
  trivy: { apt: { manual: 'install from the Aqua apt repo: https://trivy.dev/latest/getting-started/installation/' }, dnf: { manual: 'install from the Aqua rpm repo: https://trivy.dev/latest/getting-started/installation/' }, pacman: { manual: 'trivy lives in the AUR' }, zypper: { manual: 'install from the Aqua rpm repo: https://trivy.dev/latest/getting-started/installation/' }, winget: 'Aquasecurity.Trivy' },
  sonarqube: { apt: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, dnf: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, pacman: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, zypper: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, apk: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' }, winget: { manual: 'sonarqube runs from the zip bundle or docker: https://docs.sonarsource.com/sonarqube/latest/setup-and-upgrade/install-the-server/' } },
  overmind: { apt: { manual: 'download from https://github.com/DarthSim/overmind/releases' }, dnf: { manual: 'download from https://github.com/DarthSim/overmind/releases' }, pacman: { manual: 'overmind lives in the AUR' }, zypper: { manual: 'download from https://github.com/DarthSim/overmind/releases' }, apk: { manual: 'download from https://github.com/DarthSim/overmind/releases' }, winget: { manual: 'no overmind winget package — download from https://github.com/DarthSim/overmind/releases' } },

  // ── ai ────────────────────────────────────────────────────────
  ollama: { apt: { manual: 'install via script: curl -fsSL https://ollama.com/install.sh | sh' }, dnf: { manual: 'install via script: curl -fsSL https://ollama.com/install.sh | sh' }, pacman: { manual: 'ollama is not in official Arch repos — install via script: curl -fsSL https://ollama.com/install.sh | sh' }, zypper: { manual: 'install via script: curl -fsSL https://ollama.com/install.sh | sh' }, apk: { manual: 'install via script: curl -fsSL https://ollama.com/install.sh | sh' }, winget: 'Ollama.Ollama' },
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
