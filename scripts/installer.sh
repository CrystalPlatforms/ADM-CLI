#!/bin/sh
# ── ADM CLI installer (portable bundle, no Node required) ──────────────
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CrystalPlatforms/ADM-CLI/main/scripts/installer.sh | sh
#   sh installer.sh [--dry-run] [-y]
#
# What it does:
#   1. detects OS + arch (Linux/Darwin, x64/arm64)
#   2. downloads the release bundle (adm/app + adm/runtime — private Node)
#      — or uses ADM_BUNDLE=<file> as a local source (CI / air-gapped)
#   3. verifies the sha256 checksum BEFORE writing anything
#   4. unpacks to ~/.adm/{app,runtime}   (ADM_HOME overrides)
#   5. installs the launcher to ~/.local/bin/adm  (ADM_BIN_DIR overrides)
#   6. adds one PATH entry to the current shell's rc (marker-managed,
#      idempotent — running twice leaves zero duplicates)
#
# No sudo, no system Node. Env overrides: ADM_VERSION, ADM_BUNDLE,
# ADM_BUNDLE_SHA256, ADM_HOME, ADM_BIN_DIR, ADM_DRY_RUN=1.
set -eu

REPO="CrystalPlatforms/ADM-CLI"
PREFIX="${ADM_HOME:-$HOME/.adm}"
BIN_DIR="${ADM_BIN_DIR:-$HOME/.local/bin}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -y|--yes) : ;;
    --help|-h)
      echo "Usage: sh installer.sh [--dry-run] [-y]"
      echo "Env: ADM_VERSION=1.2.3 ADM_BUNDLE=/path/adm.tar.gz ADM_HOME=... ADM_BIN_DIR=..."
      exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 1 ;;
  esac
done
if [ "${ADM_DRY_RUN:-}" = "1" ]; then DRY_RUN=1; fi

info() { printf '  [INFO] %s\n' "$*"; }
ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
fail() { printf '  [ERROR] %s\n' "$*" >&2; }
step() {
  # step "description" — prints the plan in dry-run mode.
  if [ "$DRY_RUN" = "1" ]; then printf '  [PLAN] %s\n' "$*"; else info "$*"; fi
}

# ── 1. platform detection ───────────────────────────────────────────
OS_NAME=$(uname -s)
ARCH_RAW=$(uname -m)
case "$OS_NAME" in
  Linux) OS="linux" ;;
  Darwin) OS="darwin" ;;
  *) fail "unsupported OS: $OS_NAME (Linux and macOS are supported; Windows: use install.ps1)"
     exit 1 ;;
esac
case "$ARCH_RAW" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) fail "unsupported architecture: $ARCH_RAW"; exit 1 ;;
esac
TARGET="$OS-$ARCH"
echo ""
echo "  ADM installer — $TARGET"
echo ""

# ── 2. source: local bundle or release download ─────────────────────
TMP=""
# `|| true`: with set -e, a failing cleanup (empty TMP on the dry-run path)
# would override the script's exit status (dry-run exited 0 → reported 1).
cleanup() { [ -n "$TMP" ] && [ -d "$TMP" ] && rm -rf "$TMP" || true; }
trap cleanup EXIT INT TERM

if [ -n "${ADM_BUNDLE:-}" ]; then
  [ -f "$ADM_BUNDLE" ] || { fail "ADM_BUNDLE not found: $ADM_BUNDLE"; exit 1; }
  BUNDLE="$ADM_BUNDLE"
  step "using local bundle: $BUNDLE"
  EXPECTED="${ADM_BUNDLE_SHA256:-}"
  if [ -z "$EXPECTED" ] && [ -f "$BUNDLE.sha256" ]; then
    EXPECTED=$(cut -d' ' -f1 "$BUNDLE.sha256")
  fi
else
  command -v curl >/dev/null 2>&1 || { fail "curl is required for downloading (or set ADM_BUNDLE to a local bundle)"; exit 1; }
  if [ -n "${ADM_VERSION:-}" ]; then
    VERSION="${ADM_VERSION#v}"
  else
    step "resolving the latest release version"
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
      sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -n 1)
    [ -n "$VERSION" ] || { fail "cannot resolve the latest release — set ADM_VERSION"; exit 1; }
  fi
  ASSET="adm-v$VERSION-$TARGET.tar.gz"
  URL="https://github.com/$REPO/releases/download/v$VERSION/$ASSET"
  step "downloading $URL"
  if [ "$DRY_RUN" = "1" ]; then
    info "[PLAN] would verify sha256 against $ASSET.sha256"
    info "[PLAN] would unpack to $PREFIX/{app,runtime}"
    info "[PLAN] would install the launcher to $BIN_DIR/adm"
    info "[PLAN] would add one PATH entry (marker '# adm-cli') to the current shell's rc"
    echo ""
    echo "  Dry run complete — nothing was written."
    exit 0
  fi
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/$ASSET" "$URL"
  curl -fsSL -o "$TMP/$ASSET.sha256" "$URL.sha256" || true
  BUNDLE="$TMP/$ASSET"
  EXPECTED="${ADM_BUNDLE_SHA256:-}"
  if [ -z "$EXPECTED" ] && [ -f "$TMP/$ASSET.sha256" ]; then
    EXPECTED=$(cut -d' ' -f1 "$TMP/$ASSET.sha256")
  fi
fi

# ── 3. sha256 verification — BEFORE anything is written ────────────
if [ -n "$EXPECTED" ]; then
  step "verifying sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    CHECK_OK=$(printf '%s  %s\n' "$EXPECTED" "$BUNDLE" | sha256sum -c - >/dev/null 2>&1 && echo yes || echo no)
  elif command -v shasum >/dev/null 2>&1; then
    CHECK_OK=$(printf '%s  %s\n' "$EXPECTED" "$BUNDLE" | shasum -a 256 -c - >/dev/null 2>&1 && echo yes || echo no)
  else
    fail "no sha256 tool found (sha256sum/shasum) — cannot verify the bundle; aborting"
    exit 1
  fi
  if [ "$CHECK_OK" != "yes" ]; then
    fail "checksum mismatch — the bundle is corrupted or tampered with. Nothing was written."
    fail "expected sha256: $EXPECTED"
    exit 1
  fi
  ok "checksum verified"
else
  warn "no checksum available for this bundle — skipping verification"
fi

if [ "$DRY_RUN" = "1" ]; then
  info "[PLAN] would unpack to $PREFIX/{app,runtime}"
  info "[PLAN] would install the launcher to $BIN_DIR/adm"
  info "[PLAN] would add one PATH entry (marker '# adm-cli') to the current shell's rc"
  echo ""
  echo "  Dry run complete — nothing was written."
  exit 0
fi

# ── 4. unpack to ~/.adm/{app,runtime} ──────────────────────────────
TMP=${TMP:-$(mktemp -d)}
step "unpacking to $PREFIX"
mkdir -p "$TMP/unpack"
tar xzf "$BUNDLE" -C "$TMP/unpack"
[ -d "$TMP/unpack/adm/app" ] || { fail "bundle layout unexpected (adm/app missing)"; exit 1; }

mkdir -p "$PREFIX"
# Replace the whole portable package (app + runtime move together).
rm -rf "$PREFIX/app" "$PREFIX/runtime"
mv "$TMP/unpack/adm/app" "$PREFIX/app"
mv "$TMP/unpack/adm/runtime" "$PREFIX/runtime"
ok "installed app + runtime to $PREFIX"

# ── 5. launcher in ~/.local/bin ────────────────────────────────────
step "installing the launcher to $BIN_DIR/adm"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/adm" <<LAUNCHER
#!/bin/sh
# ADM launcher — runs adm under the bundled private Node.
exec "$PREFIX/runtime/bin/node" "$PREFIX/app/bin/adm" "\$@"
LAUNCHER
chmod +x "$BIN_DIR/adm"
ok "launcher installed: $BIN_DIR/adm"

# ── 6. PATH entry in the current shell's rc (idempotent) ───────────
RC="$HOME/.profile"
case "$(basename "${SHELL:-}" 2>/dev/null)" in
  bash)
    RC="$HOME/.bashrc"
    [ -f "$RC" ] || RC="$HOME/.bash_profile"
    ;;
  zsh) RC="$HOME/.zshrc" ;;
esac
step "ensuring PATH entry ($BIN_DIR) in $RC"
if [ -f "$RC" ] && grep -q '.local/bin' "$RC" 2>/dev/null; then
  ok "PATH already contains $BIN_DIR — nothing to add"
else
  printf '\n# adm-cli\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"
  ok "added one PATH entry to $RC (marker: # adm-cli)"
fi

echo ""
echo "  ADM is installed. Start a new shell or run: . \"$RC\""
echo "  Then: adm help"
echo ""
