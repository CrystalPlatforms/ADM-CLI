# INDEX.md — Project Map for AI Agents

> Generated: 2026-11-15 by /index-md. If older than 14 days, suggest running /index-md again.
> Read THIS file instead of scanning the repo. Never read files listed in § Secrets map.

## 1. Overview

ADM (`@crystalplatforms/adm` v0.4.0) is a lightweight, multi-platform developer-environment installer CLI. Running `adm` on a fresh machine opens an interactive wizard (11 tool categories, 277 tools) that installs tools the right way for the detected OS, distro, package manager, architecture and shell, then prints a ✓/✗ report. The recommended install channel is a portable bundle that ships its own private Node runtime in `~/.adm/`, so no Node.js is needed on the target machine. Explicitly no TUI-framework bloat, no AI, no cloud integrations. Targets macOS, Linux, Windows; MIT; repo `github.com/CrystalPlatforms/ADM-CLI`.

## 2. Tech stack

| Aspect | Value |
|---|---|
| Language | Plain JavaScript, **CommonJS** (`require`/`module.exports`), no TypeScript, no transpile step |
| Runtime | Node.js >= 20 (`engines` field); portable bundle pins Node 20.18.1 (`scripts/build-bundle.js`) |
| Runtime deps | `chalk@^4.1.2`, `inquirer@^8.2.6`, `ora@^5.4.1` |
| Dev deps | `jest@^30.5.2` |
| Other tech | Bash (`installer.sh`), PowerShell (`install.ps1`), shell completions (bash/zsh), Homebrew formula, GitHub Actions |
| Lint/format | none |

## 3. Directory map

| Path | Purpose |
|---|---|
| `bin/` | `adm` executable entry (Node <20 gate + router) |
| `src/` | All CLI source, CJS modules split by concern (see §4) |
| `scripts/` | Installers (sh/ps1/js), bundle builder, Homebrew formula + generator, shell completions |
| `tests/` | Jest suites (`tests/unit/**` mirrors src) + `setup-jest.js` |
| `plans/` | PRDs + implementation plan (v0.3 → v0.5 roadmap), written in Polish |
| `.github/` | Single workflow `workflows/ci.yml` |
| `.claude/` | 15 generic dev-process agent skills (agent-cli, ask, tdd, ship, …) — not project docs |
| `landing/` | Static single-page site (`index.html` + `assets/`) — **untracked** |
| `brag-output/` | Hyperframes launch-video output for v0.4 (`brag.mp4`, composition/, briefs) — **untracked** |
| `writes-content/` | Launch content set 2026-11-13 (article + 4 social posts + story ledger) — **gitignored** |

## 4. Key files & entry points

| File | Role |
|---|---|
| `bin/adm` | Entry point; runs Node <20 gate (`src/engines.js`) first, then `main()`; exit 1 on old Node, exit 2 on crash |
| `src/router.js` | Arg routing to all commands; legacy cleanup; usage errors with closest-match suggestions |
| `src/commands.js` | **Frozen CLI surface** — single source of truth for commands/aliases/flags/summaries; add new commands here first |
| `src/engines.js` | Node-version gate; must stay parseable by OLD Node (no optional chaining / `??`) |
| `src/config/index.js` | Config dir (`~/.adm`, `ADM_CONFIG_DIR` override), registry helpers |
| `src/setup/` | Wizard: `wizard.js`, `catalog.js`, `prompts.js`, `loader.js`, `spinner.js`, `registry.js`, `git-step.js` |
| `src/install/` | Install pipeline: `plan.js` → `run.js`/`executor.js` → `report.js`; plus `consent.js`, `hints.js`, `npm-prefix.js`, `shell-paths.js` |
| `src/pkg/` | Package names, install-command `builders.js`, per-manager `managers.js`, `script-urls.js` (curl-script installers) |
| `src/platform/` | OS/distro (`os-release.js`), manager probe (`manager-probe.js`), shell detection (`shell.js`) |
| `src/upgrade/` | Self-update: GitHub release fetch, sha256 verify, atomic swap + rollback, channel detection |
| `src/commands/` | Leaf commands: help, version, config, uninstall, dotfiles, feedback |
| `src/tools/` | `adm tools`: `tools-tui.js` (raw-ANSI TUI, no ink), `inventory.js`, `tool-info.js`, `tool-actions.js`, `managers.js` |
| `src/utils/` | `closest-match.js`, `dotfiles-sync.js`, `file-conflict-handler.js` |
| `src/data/extensions.json` | Tool catalog: 11 categories / 277 tools with install methods |
| `scripts/build-bundle.js` | Builds portable release bundles (app + private Node) for 5 targets |
| `scripts/installer.sh` / `install.ps1` | Portable-bundle installers (macOS/Linux / Windows) |
| `scripts/homebrew/gen-formula.js` | Stamps Homebrew formula with real sha256 (`adm.rb`) |
| `scripts/completion/` | `adm.bash`, `adm.zsh` completions |

## 5. Commands

| Script | Does |
|---|---|
| `npm start` | `node ./bin/adm` — run CLI locally |
| `npm test` | `jest --config=jest.config.js` |
| `npm run prepublishOnly` | Runs test suite before `npm publish` |

No lint/build/dev scripts. Bundle build is ad-hoc: `node scripts/build-bundle.js --all`. Dev linkage: `npm link`.

## 6. Tests

| Aspect | Value |
|---|---|
| Location | `tests/unit/**` — 37 files mirroring src (incl. `cli.e2e.test.js`), ~511 cases |
| Framework | Jest 30, `testEnvironment: node`, `npm test` |
| Setup | `tests/setup-jest.js` forces `chalk.level = 0` — plain text only |
| Convention | Fixtures/mocked exec only — no production calls, no network |

## 7. CI/CD — `.github/workflows/ci.yml` (7 jobs)

| Job | Trigger | What it does |
|---|---|---|
| `smoke` | push main, tags v*, PRs | Matrix ubuntu/macos/windows, Node 20: `npm ci`, `adm -v`, `adm config --json`, `npm test` |
| `dry-run-plan` | same | `ADM_DRY_RUN=1 ADM_TOOLS=jq node ./bin/adm` — plan only, no changes |
| `real-install` | same | Installs `typescript` via `ADM_TOOLS` on ubuntu, rerun → all skipped, exit 0 |
| `installer-nodeless` | same | linux-x64 bundle installed in `debian:bookworm-slim` docker (no Node, no sudo) + tamper & idempotency tests |
| `installer-windows` | same | win32-x64 bundle, `install.ps1 -BundlePath`, verifies `adm.cmd -v` |
| `bundle-build` | tag `v*` only | Matrix of 5 targets → upload artifacts |
| `release-publish` | tag `v*` only | Merges artifacts, regenerates Homebrew formula with sha256, publishes GitHub Release |

npm publish is NOT in CI — manual `npm publish` only.

## 8. Docs & plans

| File | One-liner |
|---|---|
| `README.md` | Full product doc: install channels, usage, wizard flow, env hooks, commands, exit codes, dev + release process |
| `plans/PRD-v0.3.md` | PRD: v0.3.0 rewrite — lightweight multi-platform installer + portable bundle (Polish) |
| `plans/PRD-v0.4.md` | PRD: v0.4.0 — `adm tools` TUI; `adm doctor` deferred to v0.5 (Polish) |
| `plans/PRD-v0.5.md` | PRD: v0.5.0 — `adm doctor` health scan with ✓/⚠/✗ + `--json` (Polish) |
| `plans/adm-tools-tui.md` | Carved implementation plan for `adm tools` (Polish) |
| `writes-content/story.md` | Story ledger of published narrative beats (gitignored) |
| `writes-content/2026-11-13-launch/` | Launch set: `brief.md`, `article.md`, `x/bsky/substack/devto.md`, `VERIFY.md` |
| `brag-output/brag-plan.md` | v0.4 launch-video plan (real-CLI-only content rule) |
| `brag-output/composition-brief.md` | Hyperframes composition brief → `brag.mp4` |
| `brag-output/share-copy.txt` | Short social share copy |
| `landing/index.html` | Static landing page ("fresh machine → working dev env in one command") |
| `.claude/skills/*/SKILL.md` | 15 generic workflow skills — reusable tooling, not project docs |

## 9. Secrets map — ⚠️ DO NOT READ

No secret files found on disk (no `.env`, keys, tokens, credentials, keystores anywhere outside node_modules/.git).

`.gitignore` reserves: `.env`, `.env.*` (`!.env.example`) — no such files exist, including no `.env.example`.

## 10. Env variables

No `.env.example`. Variables read from `process.env` in code (names only):

| Variable | Where / purpose |
|---|---|
| `ADM_TOOLS` | wizard entry — comma-separated tool ids → non-interactive install |
| `ADM_DRY_RUN` | wizard / installers — print plan only |
| `ADM_CONFIG_DIR` | config dir override (default `~/.adm`) |
| `ADM_TEST_HOME` | test-only home override (`dotfiles-sync.js`) |
| `ADM_NODE_VERSION` | bundle builder — Node runtime version (default 20.18.1) |
| `ADM_HOME` | installers / upgrade — override bundle location |
| `ADM_VERSION` | installers — install a specific release version |
| `ADM_BUNDLE`, `ADM_BUNDLE_SHA256` | installers — install from local bundle (CI/air-gapped) |
| `ADM_BIN_DIR` | installers — override launcher install dir |
| `ADM_CHANNEL` | upgrade — force channel (`bundle` or `npm`) |

## 11. Gotchas

- **CommonJS only, no build step** — `src/` ships as-is; but `src/engines.js` + `bin/adm` must stay parseable by OLD Node (no optional chaining / `??`) because the gate runs before any other require.
- **Both `package-lock.json` and `yarn.lock` exist** — npm is canonical (README, CI `npm ci`). Don't run yarn install; it churns yarn.lock.
- **`.npmignore` AND package.json `files` both present** — `files` wins; keep both in sync when adding packaged files.
- **Untracked / ignored dirs**: `landing/`, `brag-output/`, `CLAUDE.md` untracked; `writes-content/` gitignored. Don't commit them casually.
- **Exit-code contract is API**: 0 = success (incl. "nothing to do"), 1 = usage error (must enumerate valid set), 2 = execution failure. New commands go into `src/commands.js` first.
- **`adm tools` TUI deliberately avoids ink** — ink repaints garble under Windows ConPTY; it draws raw ANSI. Scanning logic must stay terminal-neutral in `inventory.js`/`tool-info.js`/`tool-actions.js`.
- **jest**: tests in `tests/unit/` (not `__tests__`); `chalk.level = 0` — never assert on colored output; no network in tests.
- **Node >= 20 enforced** at runtime (friendly gate, exit 1); CI runs Node 20 on 3 OSes.
- **Release flow is manual/HITL**: green CI → fresh-machine pass sign-off → `build-bundle.js --all` + tag push (triggers bundle jobs) → manual `npm publish` + Homebrew tap update.
- **Plans/PRDs are in Polish**; product surface and code are English.
- **Windows is first-class**: PATH edits marker-managed (`# adm-cli`), idempotency-tested; PowerShell syntax advertised in help on win32.
