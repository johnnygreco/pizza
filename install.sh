#!/usr/bin/env bash
set -euo pipefail

main() {
    # ── Constants ────────────────────────────────────────────────────────
    REPO="johnnygreco/pizza"
    SUBAGENTS_REPO="nicobailon/pi-subagents"
    SUBAGENTS_COMMIT="9d1e88b2d9e48bc59503814fd443850341f74907"
    REQUIRED_PI_MAJOR_MINOR="0.66"
    DEFAULT_INSTALL_DIR="$HOME/.pizza"

    # ── Color helpers (tty-aware) ────────────────────────────────────────
    if [ -t 1 ]; then
        BOLD="\033[1m"
        RED="\033[31m"
        GREEN="\033[32m"
        YELLOW="\033[33m"
        CYAN="\033[36m"
        RESET="\033[0m"
    else
        BOLD="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
    fi

    info()    { printf "${CYAN}info${RESET}  %s\n" "$1"; }
    warn()    { printf "${YELLOW}warn${RESET}  %s\n" "$1"; }
    error()   { printf "${RED}error${RESET} %s\n" "$1" >&2; }
    success() { printf "${GREEN}ok${RESET}    %s\n" "$1"; }

    # ── Parse arguments ──────────────────────────────────────────────────
    PINNED_VERSION=""
    UNINSTALL=0

    while [ $# -gt 0 ]; do
        case "$1" in
            --version|-v)
                option="$1"
                shift
                if [ $# -eq 0 ]; then
                    error "Option $option requires a value"
                    usage
                    exit 1
                fi
                PINNED_VERSION="${1#v}"
                ;;
            --uninstall)
                UNINSTALL=1
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
        shift
    done

    INSTALL_DIR="${PIZZA_HOME:-$DEFAULT_INSTALL_DIR}"

    # ── Uninstall ────────────────────────────────────────────────────────
    if [ "$UNINSTALL" -eq 1 ]; then
        uninstall
        exit 0
    fi

    # ── Detect platform ──────────────────────────────────────────────────
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Darwin) OS_NAME="macOS" ;;
        Linux)  OS_NAME="Linux" ;;
        *)      error "Unsupported OS: $OS"; exit 1 ;;
    esac

    info "Detected platform: $OS_NAME ($ARCH)"

    # ── Check Node.js ────────────────────────────────────────────────────
    if ! command -v node &>/dev/null; then
        error "Node.js is required but not installed."
        echo ""
        case "$OS" in
            Darwin)
                echo "  Install via Homebrew:"
                echo "    brew install node"
                echo ""
                echo "  Or download from:"
                echo "    https://nodejs.org"
                ;;
            Linux)
                echo "  Install via your package manager:"
                echo "    sudo apt install nodejs npm    # Debian/Ubuntu"
                echo "    sudo dnf install nodejs npm    # Fedora"
                echo ""
                echo "  Or use nvm:"
                echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
                echo "    nvm install 22"
                ;;
        esac
        exit 1
    fi

    NODE_VERSION="$(node --version | sed 's/^v//')"
    NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"
    NODE_MINOR="$(echo "$NODE_VERSION" | cut -d. -f2)"
    if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || ! [[ "$NODE_MINOR" =~ ^[0-9]+$ ]]; then
        error "Could not parse Node.js version: v$NODE_VERSION"
        exit 1
    fi
    if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 6 ]; }; then
        error "Node.js >= 20.6.0 required (found v$NODE_VERSION)"
        exit 1
    fi
    success "Node.js v$NODE_VERSION"

    # ── Check / install Pi ───────────────────────────────────────────────
    check_pi

    # ── Resolve version ──────────────────────────────────────────────────
    if [ -n "$PINNED_VERSION" ]; then
        VERSION="$PINNED_VERSION"
    else
        VERSION="$(resolve_latest_version)"
    fi
    info "Installing Pizza v${VERSION}"

    # ── Download and extract ─────────────────────────────────────────────
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT

    TARBALL_URL="${PIZZA_TARBALL_URL:-https://github.com/${REPO}/releases/download/v${VERSION}/pizza-${VERSION}.tar.gz}"
    info "Downloading from ${TARBALL_URL}"

    if ! curl -fsSL "$TARBALL_URL" 2>"$TMP_DIR/dl.log" | tar -xz -C "$TMP_DIR" 2>>"$TMP_DIR/dl.log"; then
        error "Failed to download Pizza v${VERSION}"
        [ -s "$TMP_DIR/dl.log" ] && cat "$TMP_DIR/dl.log" >&2
        echo "  Check that the version exists: https://github.com/${REPO}/releases"
        exit 1
    fi

    EXTRACTED="$TMP_DIR/pizza-${VERSION}"
    if [ ! -d "$EXTRACTED/extensions" ]; then
        error "Downloaded archive does not contain extensions/"
        exit 1
    fi

    # ── Install core extensions ──────────────────────────────────────────
    mkdir -p "$INSTALL_DIR"

    rm -rf "$INSTALL_DIR/extensions" "$INSTALL_DIR/skills" "$INSTALL_DIR/prompts"
    cp -R "$EXTRACTED/extensions" "$INSTALL_DIR/extensions"
    cp -R "$EXTRACTED/skills" "$INSTALL_DIR/skills"
    cp -R "$EXTRACTED/prompts" "$INSTALL_DIR/prompts"
    [ -f "$EXTRACTED/LICENSE" ] && cp "$EXTRACTED/LICENSE" "$INSTALL_DIR/LICENSE"

    success "Core extensions installed"

    # ── Install subagents ────────────────────────────────────────────────
    info "Installing subagents extension"
    SUBAGENTS_URL="https://github.com/${SUBAGENTS_REPO}/archive/${SUBAGENTS_COMMIT}.tar.gz"

    if ! curl -fsSL "$SUBAGENTS_URL" 2>"$TMP_DIR/dl.log" | tar -xz -C "$TMP_DIR" 2>>"$TMP_DIR/dl.log"; then
        error "Failed to download subagents extension"
        [ -s "$TMP_DIR/dl.log" ] && cat "$TMP_DIR/dl.log" >&2
        exit 1
    fi

    rm -rf "$INSTALL_DIR/subagents"
    cp -R "$TMP_DIR/pi-subagents-${SUBAGENTS_COMMIT}" "$INSTALL_DIR/subagents"
    success "Subagents extension installed"

    # ── Generate package.json ────────────────────────────────────────────
    generate_package_json "$VERSION"

    # ── Register with Pi ─────────────────────────────────────────────────
    pi remove "$INSTALL_DIR" 2>/dev/null || true
    pi install "$INSTALL_DIR"
    success "Registered with Pi"

    # ── Summary ──────────────────────────────────────────────────────────
    echo ""
    printf "${BOLD}  Pizza v${VERSION} installed successfully!${RESET}\n"
    echo ""
    echo "  Location: $INSTALL_DIR"
    echo "  Extensions:"
    echo "    - pizza-ui"
    echo "    - loop"
    echo "    - context"
    echo "    - todos"
    echo "    - control"
    echo "    - subagents (/plan, /iterate)"
    echo ""
    echo "  Start a new Pi session to use Pizza."
    echo ""
}

# ── Helper functions ─────────────────────────────────────────────────────

usage() {
    cat <<EOF
Pizza installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/johnnygreco/pizza/main/install.sh | bash
  curl -fsSL ... | bash -s -- [options]

Options:
  --version <ver>     Install a specific version (default: latest release)
  --uninstall         Remove Pizza and deregister from Pi
  --help, -h          Show this help

Environment:
  PIZZA_HOME          Install directory (default: ~/.pizza)
  PIZZA_TARBALL_URL   Override download URL (for testing)

Examples:
  # Install latest
  curl -fsSL https://raw.githubusercontent.com/johnnygreco/pizza/main/install.sh | bash

  # Install specific version
  curl -fsSL .../install.sh | bash -s -- --version 0.2.0

  # Uninstall
  curl -fsSL .../install.sh | bash -s -- --uninstall
EOF
}

check_pi() {
    local pi_install_cmd="npm install -g @mariozechner/pi-coding-agent@~${REQUIRED_PI_MAJOR_MINOR}.0"

    if ! command -v pi &>/dev/null; then
        error "Pi is not installed. Install it first, then re-run this script:"
        echo "  $pi_install_cmd"
        exit 1
    fi

    PI_VERSION="$(pi --version 2>&1 || echo "unknown")"
    PI_MAJOR_MINOR="$(echo "$PI_VERSION" | cut -d. -f1,2)"

    if [ "$PI_MAJOR_MINOR" = "$REQUIRED_PI_MAJOR_MINOR" ]; then
        success "Pi v$PI_VERSION"
        return
    fi

    warn "Pi v$PI_VERSION found, but Pizza requires ~$REQUIRED_PI_MAJOR_MINOR.x"

    if ! command -v npm &>/dev/null; then
        error "npm not found, so Pi cannot be updated automatically. Update Pi, then re-run:"
        echo "  $pi_install_cmd"
        exit 1
    fi

    if [ -t 0 ]; then
        printf "  Update Pi? [Y/n] "
        read -r answer </dev/tty
        case "$answer" in
            [nN]*)
                error "Pizza requires Pi ~$REQUIRED_PI_MAJOR_MINOR.x. Update Pi, then re-run:"
                echo "  $pi_install_cmd"
                exit 1
                ;;
            *)
                info "Updating Pi to ~$REQUIRED_PI_MAJOR_MINOR"
                npm install -g "@mariozechner/pi-coding-agent@~${REQUIRED_PI_MAJOR_MINOR}.0"
                success "Pi updated to v$(pi --version 2>&1)"
                ;;
        esac
    else
        error "Pi v$PI_VERSION is not compatible (requires ~$REQUIRED_PI_MAJOR_MINOR.x). Update Pi, then re-run:"
        echo "  $pi_install_cmd"
        exit 1
    fi
}

resolve_latest_version() {
    local version

    # Try GitHub API first
    version="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
        | grep '"tag_name"' \
        | sed 's/.*"v\([^"]*\)".*/\1/' \
    )" || true

    if [ -n "$version" ]; then
        echo "$version"
        return
    fi

    # Fallback: git ls-remote (exclude prerelease tags)
    if command -v git &>/dev/null; then
        version="$(git ls-remote --tags --refs "https://github.com/${REPO}.git" 2>/dev/null \
            | awk -F/ '{print $NF}' \
            | sed 's/^v//' \
            | grep -v '-' \
            | sort -V \
            | tail -1 \
        )" || true

        if [ -n "$version" ]; then
            echo "$version"
            return
        fi
    fi

    error "Could not determine latest version. Use --version to specify."
    exit 1
}

generate_package_json() {
    local version="$1"

    cat > "$INSTALL_DIR/package.json" << EOF
{
  "name": "pizza",
  "version": "${version}",
  "description": "Pizza — Pi with toppings",
  "pi": {
    "extensions": ["extensions", "subagents"],
    "skills": ["skills"],
    "prompts": ["prompts"]
  }
}
EOF
}

uninstall() {
    if command -v pi &>/dev/null; then
        pi remove "$INSTALL_DIR" 2>/dev/null || true
        success "Deregistered from Pi"
    fi

    if [ -d "$INSTALL_DIR" ]; then
        rm -rf "$INSTALL_DIR"
        success "Removed $INSTALL_DIR"
    else
        info "Nothing to uninstall ($INSTALL_DIR does not exist)"
    fi
}

main "$@"
