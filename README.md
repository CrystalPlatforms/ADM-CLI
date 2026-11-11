# ADM CLI

**ADM** is a lightweight, multi-platform developer environment installer.
Run `adm` on a fresh machine, pick tool categories in an interactive wizard
(all categories on one screen), and ADM installs the tools the right way for
*your* system — distribution, package manager, architecture and shell — then
shows a ✓/✗ report. No Node.js needed: the recommended install is a portable
bundle that ships its own private Node runtime in `~/.adm/`.

Targets Node.js/web developers on macOS, Linux and Windows — cutting initial
dev setup from hours to minutes. No TUI, no AI, no integrations: just setup
that works everywhere.

## Install

All four channels end with the same `adm` command on your `PATH`.

### macOS / Linux — curl (portable bundle, **no Node needed**)

```bash
curl -fsSL https://raw.githubusercontent.com/CrystalPlatforms/ADM-CLI/main/scripts/installer.sh | sh
```

Installs to `~/.adm/{app,runtime}` (private Node) + launcher `~/.local/bin/adm`,
and adds one marker-managed PATH entry (`# adm-cli`) to your shell rc. No sudo.

### Windows — PowerShell (portable bundle, **no Node needed**)

```powershell
irm https://raw.githubusercontent.com/CrystalPlatforms/ADM-CLI/main/scripts/install.ps1 | iex
```

Installs to `%LOCALAPPDATA%\adm\{app,runtime}` + launcher `adm.cmd` in
`%LOCALAPPDATA%\Microsoft\WindowsApps` (already on the user PATH).

### Homebrew (macOS / Linux)

```bash
brew tap CrystalPlatforms/tap
brew install CrystalPlatforms/tap/adm
```

The formula wraps the same portable bundle — no system Node required.

### npm (Node.js ≥ 20 required)

```bash
npm install -g @crystalplatforms/adm
```

The npm channel needs a system Node ≥ 20 (`adm` reminds you how to fix it if
you have an older one — or points you at the Node-free bundle above).

## Usage

```bash
adm                     # interactive setup wizard: categories → tools → install → report
adm help                # command reference
adm -v                  # version
adm config [--json]     # config dir + detected environment (machine-readable with --json)
adm dotfiles sync       # sync dotfiles from a git repo into your home dir
adm upgrade             # self-update (see below)
adm uninstall           # remove ~/.adm and the shell PATH entries
adm feedback            # how to report bugs and ideas
```

### The wizard

`adm` with no arguments walks through:

1. **Categories** — all 11 on one screen, multi-select.
2. **Tools** — per selected category, with status: `✓` marks installed tools.
   Everything stays selectable: an installed pick **reinstalls** it, and a
   tool without a known automatic installer is still tried via the best
   available route (script installer → ecosystem fallback) — if nothing
   works it lands in the report as `✗` with a copyable hint. A failed
   attempt never blocks the run.
3. **Install** — one spinner per tool, then a final report
   (`✓ installed / ✓ reinstalled / skipped / ✗ + hint`).
4. **Git step** — after installing `git` or `gh` ADM offers to set your git
   identity; declining is remembered and never asked again.

### Self-update

```bash
adm upgrade --check     # read-only: is a newer release out? (exit 0 both ways)
adm upgrade --dry-run   # print the plan: asset, url, sha256, target — no changes
adm upgrade             # download bundle → verify sha256 → atomic swap of ~/.adm
adm update              # alias of `adm upgrade`
```

On the bundle channel the swap is atomic: the new version is downloaded and
checksum-verified **before** the old one is touched, the old app + runtime
are backed up, and any failure rolls back — your previous install stays
intact. On the npm channel ADM prints the `npm update -g` command instead of
swapping itself.

### Automation (CI / agents)

Non-interactive install of a known tool list — no prompts, never hangs on a
TTY check:

```bash
ADM_TOOLS="git,jq,typescript" adm              # real install
ADM_DRY_RUN=1 ADM_TOOLS="git,jq" adm           # print the plan only
```

PowerShell: `$env:ADM_TOOLS="typescript,node"; adm` (then
`$env:ADM_TOOLS=$null`).

### Environment hooks

| Variable | Where | What it does |
|----------|-------|--------------|
| `ADM_TOOLS` | `adm` (no args) | Comma-separated tool ids → non-interactive install, no prompts |
| `ADM_DRY_RUN` | `ADM_TOOLS` runs | `1` → print the install plan only, change nothing |
| `ADM_CONFIG_DIR` | all commands | Override the config dir (default `~/.adm`) |
| `ADM_HOME` | installers, `adm upgrade` | Override the bundle location (default `~/.adm` / `%LOCALAPPDATA%\adm`) |
| `ADM_CHANNEL` | `adm upgrade` | Force channel detection: `bundle` or `npm` |
| `ADM_VERSION` | installers | Install a specific release version |
| `ADM_BUNDLE`, `ADM_BUNDLE_SHA256` | installers | Install from a local bundle file (CI / air-gapped) |
| `ADM_DRY_RUN` | installers | `1` → print the install plan only, change nothing |

## Commands

| Command | Aliases | Flags | Description |
|---------|---------|-------|-------------|
| `adm` (no args) | | | Interactive setup wizard (needs a terminal; see Automation otherwise) |
| `help` | `--help`, `-h` | | Show available commands |
| `-v` | `--version` | | Print ADM version |
| `feedback` | | | Show how to report bugs and ideas |
| `config` | | `--json` | Show ADM config and detected environment |
| `uninstall` | | | Remove ADM data (`~/.adm`) and shell PATH entries |
| `upgrade` | `update` | `--check`, `--dry-run` | Self-update with sha256 verification and rollback |
| `dotfiles sync` | | `--repo <url>`, `--copy`, `--only <name,name>` | Sync dotfiles from a git repo |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success — including "nothing to do" and "already up to date" |
| `1` | Usage error — the message enumerates the valid commands/flags |
| `2` | Execution failure — install failed, checksum mismatch, upgrade rolled back |

Every failure message is actionable: unknown commands suggest the closest
match, failed installs print the exact command and a hint, upgrade failures
state whether the old version was restored.

## Manual tools

A handful of tools have no reliable automatic installer everywhere (some
VS Code extensions, platform-specific CLIs). ADM still tries the best route
available for your platform; when nothing works the report shows `✗` with a
link or command to finish manually. Nothing is ever silently skipped in the
wizard.

## Development

```bash
npm install          # dependencies (chalk, inquirer, ora + jest)
npm test             # jest suite (unit + simulated-TTY + e2e)
npm start            # run ./bin/adm locally
npm link             # link globally for development
node ./bin/adm -v    # direct run
```

### Project structure

```
bin/adm                 entry point (+ friendly Node < 20 message)
src/
├── router.js           arg routing, legacy cleanup, exit codes
├── commands.js          the frozen CLI surface (single source of truth)
├── setup/               wizard: catalog, prompts, spinner, registry, git step
├── install/             plan → executor → report pipeline
├── pkg/                 package names, install commands, script URLs, builders
├── platform/            OS / distro / manager / shell detection
├── upgrade/             self-update: fetch, verify, atomic swap, rollback
├── commands/            help, version, config, uninstall, dotfiles, feedback
└── data/                tool catalog (extensions.json)
scripts/
├── installer.sh         POSIX installer (portable bundle)
├── install.ps1          Windows installer (portable bundle)
├── build-bundle.js      build the release bundles (app + private Node)
└── completion/          bash + zsh completion
tests/unit/              jest suites (fixtures only — no production calls)
plans/                   PRDs, roadmap
```

### Releasing

1. `npm test` green + CI matrix green.
2. Manual HITL pass on a fresh Node-less machine/container and on Windows —
   the owner signs the release off (results recorded in the release issue).
3. Build bundles: `node scripts/build-bundle.js --all` → GitHub Release
   (`adm-vX.Y.Z-<target>.tar.gz` + `.sha256` per target).
4. `npm publish` (runs the test suite via `prepublishOnly`).
5. Update the Homebrew tap (the formula lives in `scripts/homebrew/`,
   stamped by `gen-formula.js`).

## License

MIT — see [LICENSE](./LICENSE).
