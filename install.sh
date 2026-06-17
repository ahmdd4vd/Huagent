#!/usr/bin/env bash
# install.sh — One-liner installer for huagent v6.0.0
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ahmdd4vd/Huagent/main/install.sh | sh
#
# With flags:
#   curl -fsSL https://raw.githubusercontent.com/ahmdd4vd/Huagent/main/install.sh | sh -s -- --version v6.0.0 --prefix ~/.local
#
# Install from npm instead of source:
#   curl -fsSL https://raw.githubusercontent.com/ahmdd4vd/Huagent/main/install.sh | sh -s -- --from-npm

set -euo pipefail

REPO="ahmdd4vd/Huagent"
BINARY_NAME="huagent"
VERSION="v6.0.0"
DEFAULT_PREFIX="/usr/local"
FALLBACK_PREFIX="$HOME/.local"

# ─── Args ───────────────────────────────────────────────────────────
TARGET_VERSION="main"
PREFIX=""
NO_SYMLINK=0
NO_PATH_UPDATE=0
SKIP_DEPS=0
FROM_NPM=0
DRY_RUN=0
VERBOSE=0

usage() {
  cat <<EOF
huagent installer v${VERSION}

Usage:
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh
  curl -fsSL ... | sh -s -- [options]

Options:
  --version <ref>       install from a specific tag/branch (default: main)
  --prefix <dir>        install prefix (default: /usr/local, falls back to ~/.local)
  --no-symlink          don't create a symlink in PREFIX/bin
  --no-path-update      don't modify PATH/shell rc
  --skip-deps           skip npm install (assumes deps already installed)
  --from-npm            install via 'npm install -g huagent' instead of cloning the repo
  --dry-run             print commands without executing
  --verbose             print extra debug output
  -h, --help            show this help

Examples:
  # Default install (from source, latest main)
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh

  # Install specific version
  curl -fsSL ... | sh -s -- --version v6.0.0

  # User-local install (no sudo)
  curl -fsSL ... | sh -s -- --prefix \$HOME/.local

  # Install from npm registry (faster, no build step)
  curl -fsSL ... | sh -s -- --from-npm

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) TARGET_VERSION="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --no-symlink) NO_SYMLINK=1; shift ;;
    --no-path-update) NO_PATH_UPDATE=1; shift ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    --from-npm) FROM_NPM=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --verbose) VERBOSE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    if [[ $VERBOSE -eq 1 ]]; then
      echo "▸ $*"
    else
      echo "▸ $(echo "$*" | head -c 80)..."
    fi
    "$@"
  fi
}

log() {
  echo "  $*"
}

warn() {
  echo "  ⚠ $*" >&2
}

err() {
  echo "  ✗ $*" >&2
}

ok() {
  echo "  ✓ $*"
}

# ─── Banner ─────────────────────────────────────────────────────────
echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║  huagent ${VERSION}                                          ║"
echo "  ║  AI coding agent CLI — 22 providers, 101 models           ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""

# ─── Sanity checks ──────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  err "node is not installed. Please install Node.js >= 18 first."
  echo "    → https://nodejs.org/en/download" >&2
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 18 ]]; then
  err "Node.js >= 18 required (you have $(node -v))."
  echo "    → https://nodejs.org/en/download" >&2
  exit 1
fi
ok "node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  err "npm is not installed. Please install npm."
  exit 1
fi
ok "npm $(npm -v)"

# git is only required for source install (not --from-npm)
if [[ $FROM_NPM -eq 0 ]]; then
  if ! command -v git >/dev/null 2>&1; then
    err "git is not installed. Please install git, or use --from-npm to install from npm."
    exit 1
  fi
  ok "git $(git --version | awk '{print $3}')"
fi
echo ""

# ─── Pick prefix ────────────────────────────────────────────────────
if [[ -z "$PREFIX" ]]; then
  if [[ -w "$DEFAULT_PREFIX/bin" ]] || [[ -w "$DEFAULT_PREFIX" ]]; then
    PREFIX="$DEFAULT_PREFIX"
    ok "using prefix: $PREFIX (writable)"
  else
    PREFIX="$FALLBACK_PREFIX"
    warn "$DEFAULT_PREFIX not writable, using $PREFIX instead"
  fi
fi
INSTALL_DIR="$PREFIX/share/huagent"
BIN_LINK="$PREFIX/bin/$BINARY_NAME"

# ─── NPM install path ───────────────────────────────────────────────
if [[ $FROM_NPM -eq 1 ]]; then
  echo "▸ Installing from npm registry..."
  # Allow custom npm prefix via NPM_CONFIG_PREFIX
  if [[ "$PREFIX" != "$DEFAULT_PREFIX" ]]; then
    NPM_CONFIG_PREFIX="$PREFIX" run npm install -g huagent@latest --no-audit --no-fund
  else
    run npm install -g huagent@latest --no-audit --no-fund
  fi
  echo ""
  echo "  ╔═══════════════════════════════════════════════════════════╗"
  echo "  ║  huagent installed successfully (via npm)!                ║"
  echo "  ╚═══════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Verify:"
  echo "    which $BINARY_NAME"
  echo "    $BINARY_NAME --version"
  echo ""
  echo "  Configure provider:"
  echo "    export ANTHROPIC_API_KEY=***       # or any provider's key"
  echo "    $BINARY_NAME"
  echo ""
  echo "  Update later:  npm update -g huagent"
  echo "  Uninstall:     npm uninstall -g huagent"
  echo ""
  exit 0
fi

# ─── Download ───────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d -t huagent-install-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "▸ Downloading huagent ($TARGET_VERSION)..."
if [[ "$TARGET_VERSION" == "main" ]] || [[ "$TARGET_VERSION" == "master" ]]; then
  run git clone --depth 1 "https://github.com/${REPO}.git" "$TMP_DIR/huagent"
else
  run git clone --depth 1 --branch "$TARGET_VERSION" "https://github.com/${REPO}.git" "$TMP_DIR/huagent"
fi

cd "$TMP_DIR/huagent"

# ─── Install deps + build ──────────────────────────────────────────
if [[ $SKIP_DEPS -eq 0 ]]; then
  echo "▸ Installing dependencies (this may take a minute)..."
  run npm ci --no-audit --no-fund || run npm install --no-audit --no-fund
fi

echo "▸ Building..."
run npm run build

# ─── Install ────────────────────────────────────────────────────────
echo "▸ Installing to $INSTALL_DIR..."
run mkdir -p "$INSTALL_DIR"
# Copy only the files needed at runtime (bin + dist + metadata).
# Don't copy src/, tests/, scripts/, node_modules/ — saves ~200MB.
run cp -R bin dist package.json package-lock.json README.md LICENSE CHANGELOG.md "$INSTALL_DIR/"
# Copy node_modules (needed for runtime deps)
if [[ -d node_modules ]]; then
  run cp -R node_modules "$INSTALL_DIR/"
  # Remove dev-only deps to save space
  rm -rf "$INSTALL_DIR/node_modules/.cache" 2>/dev/null || true
fi

# ─── Symlink ────────────────────────────────────────────────────────
if [[ $NO_SYMLINK -eq 0 ]]; then
  echo "▸ Creating symlink: $BIN_LINK → $INSTALL_DIR/bin/$BINARY_NAME.js"
  run mkdir -p "$(dirname "$BIN_LINK")"
  run ln -sf "$INSTALL_DIR/bin/$BINARY_NAME.js" "$BIN_LINK"
fi

# ─── PATH update ────────────────────────────────────────────────────
if [[ $NO_PATH_UPDATE -eq 0 ]] && [[ ":$PATH:" != *":$PREFIX/bin:"* ]]; then
  echo ""
  warn "$PREFIX/bin is not in your PATH."
  echo ""
  echo "  Add this to your ~/.bashrc, ~/.zshrc, or equivalent:"
  echo "    export PATH=\"$PREFIX/bin:\$PATH\""
  echo ""
  SHELL_RC=""
  if [[ -n "${BASH_VERSION:-}" ]]; then
    SHELL_RC="$HOME/.bashrc"
  elif [[ -n "${ZSH_VERSION:-}" ]]; then
    SHELL_RC="$HOME/.zshrc"
  fi
  if [[ -n "$SHELL_RC" ]] && [[ -w "$SHELL_RC" ]]; then
    if ! grep -qF "$PREFIX/bin" "$SHELL_RC" 2>/dev/null; then
      echo "" >> "$SHELL_RC"
      echo "# Added by huagent installer" >> "$SHELL_RC"
      echo "export PATH=\"$PREFIX/bin:\$PATH\"" >> "$SHELL_RC"
      ok "Added $PREFIX/bin to PATH in $SHELL_RC"
    fi
  fi
fi

# ─── Done ───────────────────────────────────────────────────────────
echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║  huagent installed successfully!                          ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "  Run:"
echo "    export ANTHROPIC_API_KEY=***       # or any provider's key"
echo "    $BINARY_NAME"
echo ""
echo "  Or directly:"
echo "    node $INSTALL_DIR/bin/$BINARY_NAME.js"
echo ""
echo "  List providers:   $BINARY_NAME → /providers"
echo "  List models:      $BINARY_NAME → /models"
echo "  Diagnostics:      $BINARY_NAME → /doctor"
echo "  Help:             $BINARY_NAME --help"
echo ""
echo "  Update later:  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh"
echo "  Uninstall:     rm -rf $INSTALL_DIR $BIN_LINK"
echo ""
