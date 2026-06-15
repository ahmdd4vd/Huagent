#!/usr/bin/env bash
# install.sh — One-liner installer for huagent v4.0.0
# Usage:   curl -fsSL https://raw.githubusercontent.com/d4vdxm/huagent/main/install.sh | sh
# Or with flags:
#   curl -fsSL ... | sh -s -- --version 4.0.0 --prefix ~/.local

set -euo pipefail

REPO="d4vdxm/huagent"
BINARY_NAME="huagent"
DEFAULT_PREFIX="/usr/local"
FALLBACK_PREFIX="$HOME/.local"

# ─── Args ───────────────────────────────────────────────────────────
VERSION="main"
PREFIX=""
NO_SYMLINK=0
NO_PATH_UPDATE=0
SKIP_DEPS=0
DRY_RUN=0

usage() {
  cat <<EOF
huagent installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh
  curl -fsSL ... | sh -s -- [options]

Options:
  --version <ref>       install from a specific tag/branch (default: main)
  --prefix <dir>        install prefix (default: /usr/local, falls back to ~/.local)
  --no-symlink          don't create a symlink in PREFIX/bin
  --no-path-update      don't modify PATH/shell rc
  --skip-deps           skip npm install (assumes deps already installed)
  --dry-run             print commands without executing
  -h, --help            show this help

Examples:
  # Default install
  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh

  # Specific version
  curl -fsSL ... | sh -s -- --version v4.0.0

  # User-local install (no sudo)
  curl -fsSL ... | sh -s -- --prefix \$HOME/.local

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --no-symlink) NO_SYMLINK=1; shift ;;
    --no-path-update) NO_PATH_UPDATE=1; shift ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    echo "▸ $*"
    "$@"
  fi
}

# ─── Sanity checks ──────────────────────────────────────────────────
echo ""
echo "  ✦ huagent installer v4.0.0 ✦"
echo "  the cutest, smartest coding agent"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node is not installed. Please install Node.js >= 18 first." >&2
  echo "  → https://nodejs.org/en/download" >&2
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 18 ]]; then
  echo "✗ Node.js >= 18 required (you have $(node -v))." >&2
  echo "  → https://nodejs.org/en/download" >&2
  exit 1
fi
echo "✓ node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  echo "✗ npm is not installed. Please install npm." >&2
  exit 1
fi
echo "✓ npm $(npm -v)"

if ! command -v git >/dev/null 2>&1; then
  echo "✗ git is not installed. Please install git." >&2
  exit 1
fi
echo "✓ git $(git --version | awk '{print $3}')"

# ─── Pick prefix ────────────────────────────────────────────────────
if [[ -z "$PREFIX" ]]; then
  if [[ -w "$DEFAULT_PREFIX/bin" ]] || [[ -w "$DEFAULT_PREFIX" ]]; then
    PREFIX="$DEFAULT_PREFIX"
    echo "✓ using prefix: $PREFIX (writable)"
  else
    PREFIX="$FALLBACK_PREFIX"
    echo "⚠ $DEFAULT_PREFIX not writable, using $PREFIX instead"
  fi
fi
INSTALL_DIR="$PREFIX/share/huagent"
BIN_LINK="$PREFIX/bin/$BINARY_NAME"

# ─── Download ───────────────────────────────────────────────────────
TMP_DIR=$(mktemp -d -t huagent-install-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

echo ""
echo "▸ Downloading huagent ($VERSION)..."
if [[ "$VERSION" == "main" ]] || [[ "$VERSION" == "master" ]]; then
  run git clone --depth 1 "https://github.com/${REPO}.git" "$TMP_DIR/huagent"
else
  run git clone --depth 1 --branch "$VERSION" "https://github.com/${REPO}.git" "$TMP_DIR/huagent"
fi

cd "$TMP_DIR/huagent"

# ─── Install deps + build ──────────────────────────────────────────
if [[ $SKIP_DEPS -eq 0 ]]; then
  echo "▸ Installing dependencies (this may take a minute)..."
  run npm ci --no-audit --no-fund
fi

echo "▸ Building..."
run npm run build

# ─── Install ────────────────────────────────────────────────────────
echo "▸ Installing to $INSTALL_DIR..."
run mkdir -p "$INSTALL_DIR"
run cp -R bin dist src package.json package-lock.json README.md LICENSE CHANGELOG.md install.sh "$INSTALL_DIR/"

# ─── Symlink ────────────────────────────────────────────────────────
if [[ $NO_SYMLINK -eq 0 ]]; then
  echo "▸ Creating symlink: $BIN_LINK → $INSTALL_DIR/bin/$BINARY_NAME.js"
  run mkdir -p "$(dirname "$BIN_LINK")"
  run ln -sf "$INSTALL_DIR/bin/$BINARY_NAME.js" "$BIN_LINK"
fi

# ─── PATH update ────────────────────────────────────────────────────
if [[ $NO_PATH_UPDATE -eq 0 ]] && [[ ":$PATH:" != *":$PREFIX/bin:"* ]]; then
  echo ""
  echo "⚠ $PREFIX/bin is not in your PATH."
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
      echo "✓ Added $PREFIX/bin to PATH in $SHELL_RC"
    fi
  fi
fi

# ─── Done ───────────────────────────────────────────────────────────
echo ""
echo "╭──────────────────────────────────────────────────────────────╮"
echo "│  ✦ huagent installed successfully! ✦                         │"
echo "╰──────────────────────────────────────────────────────────────╯"
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
echo ""
echo "  ✧･ﾟ: *✧･ﾟ:*  Made with ♡ by huanime  *:･ﾟ✧*:･ﾟ✧"
echo ""
