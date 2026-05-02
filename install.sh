#!/usr/bin/env bash
set -euo pipefail

main() {
    # ── Constants ────────────────────────────────────────────────────────
    REPO="johnnygreco/pizza"
    DEFAULT_PI_COMPATIBILITY_RANGE=">=0.67.0"
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

    PI_COMPATIBILITY_RANGE="$(resolve_pi_compatibility_range "$EXTRACTED/package.json")"

    # ── Check / install Pi ───────────────────────────────────────────────
    check_pi "$PI_COMPATIBILITY_RANGE"

    # ── Install core extensions ──────────────────────────────────────────
    mkdir -p "$INSTALL_DIR"

    rm -rf "$INSTALL_DIR/extensions" "$INSTALL_DIR/skills" "$INSTALL_DIR/prompts" "$INSTALL_DIR/agents" "$INSTALL_DIR/subagents"
    cp -R "$EXTRACTED/extensions" "$INSTALL_DIR/extensions"
    cp -R "$EXTRACTED/skills" "$INSTALL_DIR/skills"
    cp -R "$EXTRACTED/prompts" "$INSTALL_DIR/prompts"
    [ -d "$EXTRACTED/agents" ] && cp -R "$EXTRACTED/agents" "$INSTALL_DIR/agents"
    [ -f "$EXTRACTED/LICENSE" ] && cp "$EXTRACTED/LICENSE" "$INSTALL_DIR/LICENSE"

    success "Core extensions installed"

    # ── Symlink agent definitions into ~/.agents/ ────────────────────────
    link_agents

    # ── Symlink themes into ~/.pi/agent/themes/ ──────────────────────────
    link_themes

    # ── Apply pi settings pizza depends on (quietStartup) ────────────────
    apply_pi_settings

    # ── Generate package.json ────────────────────────────────────────────
    generate_package_json "$VERSION" "$PI_COMPATIBILITY_RANGE"

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
    echo "    - pizza-theme"
    echo "    - pizza-status"
    echo "    - pizza-editor"
    echo "    - pizza-subagents"
    echo ""
    echo "  Start a new Pi session to use Pizza."
    echo ""
}

# ── Helper functions ─────────────────────────────────────────────────────

# Remove all symlinks in ~/.agents/ that point into the pizza install dir.
unlink_agents() {
    local agents_dir="$HOME/.agents"
    [ -d "$agents_dir" ] || return 0

    local count=0
    for link in "$agents_dir"/*.md; do
        [ -L "$link" ] || continue
        local target
        target="$(readlink "$link")"
        case "$target" in
            "$INSTALL_DIR/agents/"*) rm -f "$link"; count=$((count + 1)) ;;
        esac
    done

    if [ "$count" -gt 0 ]; then
        success "Removed $count agent symlink(s) from $agents_dir"
    fi
}

# Resolve pi's agent directory, honoring *_CODING_AGENT_DIR env vars the same
# way pi's config.ts does. Falls back to ~/.pi/agent.
pi_agent_dir() {
    local agent_dir=""
    if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
        agent_dir="$PI_CODING_AGENT_DIR"
    elif [ -n "${TAU_CODING_AGENT_DIR:-}" ]; then
        agent_dir="$TAU_CODING_AGENT_DIR"
    else
        # Look for any *_CODING_AGENT_DIR override (same fallback pi uses).
        while IFS='=' read -r key value; do
            case "$key" in
                *_CODING_AGENT_DIR)
                    if [ -n "$value" ]; then
                        agent_dir="$value"
                        break
                    fi
                    ;;
            esac
        done < <(env)
    fi

    if [ -z "$agent_dir" ]; then
        agent_dir="$HOME/.pi/agent"
    fi

    # Expand ~ as pi does.
    case "$agent_dir" in
        "~")   agent_dir="$HOME" ;;
        "~/"*) agent_dir="$HOME/${agent_dir#~/}" ;;
    esac

    echo "$agent_dir"
}

pi_themes_dir() {
    echo "$(pi_agent_dir)/themes"
}

pi_settings_file() {
    echo "$(pi_agent_dir)/settings.json"
}

settings_backup_file() {
    echo "$INSTALL_DIR/.pi-settings.backup.json"
}

# Set pi-side overrides that pizza relies on (currently just quietStartup, so
# pi's `[Skills]/[Extensions]/[Themes]` boot listing stays suppressed — pizza's
# banner shows a collapsible equivalent). Original values are backed up so
# uninstall can restore exactly what was there.
apply_pi_settings() {
    local settings_file backup_file
    settings_file="$(pi_settings_file)"
    backup_file="$(settings_backup_file)"

    mkdir -p "$(dirname "$settings_file")"

    if ! node -e '
const fs = require("node:fs");
const [settingsPath, backupPath] = process.argv.slice(1);
const overrides = { quietStartup: true };

const existedBefore = fs.existsSync(settingsPath);
let settings = {};
if (existedBefore) {
    try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            settings = parsed;
        }
    } catch (err) {
        console.error(`Failed to parse ${settingsPath}: ${err.message}`);
        process.exit(1);
    }
}

// Only write the backup once, so reinstall does not overwrite the true
// pre-pizza state with pizza-managed values.
if (!fs.existsSync(backupPath)) {
    const keys = {};
    for (const key of Object.keys(overrides)) {
        keys[key] = Object.prototype.hasOwnProperty.call(settings, key)
            ? { present: true, value: settings[key] }
            : { present: false };
    }
    fs.writeFileSync(backupPath, JSON.stringify({ existedBefore, keys }, null, 2) + "\n");
}

let changed = !existedBefore;
for (const [key, value] of Object.entries(overrides)) {
    if (settings[key] !== value) {
        settings[key] = value;
        changed = true;
    }
}
if (changed) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}
' "$settings_file" "$backup_file"; then
        error "Failed to update $settings_file"
        exit 1
    fi

    success "Pi settings updated (quietStartup = true)"
}

# Restore the pre-pizza pi settings recorded by apply_pi_settings.
revert_pi_settings() {
    local settings_file backup_file
    settings_file="$(pi_settings_file)"
    backup_file="$(settings_backup_file)"

    [ -f "$backup_file" ] || return 0

    node -e '
const fs = require("node:fs");
const [settingsPath, backupPath] = process.argv.slice(1);

let backup;
try {
    backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
} catch {
    backup = { keys: {}, existedBefore: false };
}

let settings = {};
const fileExists = fs.existsSync(settingsPath);
if (fileExists) {
    try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            settings = parsed;
        }
    } catch {
        settings = {};
    }
}

for (const [key, state] of Object.entries(backup.keys ?? {})) {
    if (state.present) {
        settings[key] = state.value;
    } else {
        delete settings[key];
    }
}

if (!backup.existedBefore && Object.keys(settings).length === 0) {
    // The file did not exist before pizza and nothing else has been added
    // to it since — remove it rather than leaving an empty "{}" behind.
    if (fileExists) {
        fs.rmSync(settingsPath, { force: true });
    }
} else {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}
fs.rmSync(backupPath, { force: true });
' "$settings_file" "$backup_file"

    success "Pi settings reverted"
}

# Remove all symlinks in pi's themes dir that point into the pizza install dir.
unlink_themes() {
    local themes_dir
    themes_dir="$(pi_themes_dir)"
    [ -d "$themes_dir" ] || return 0

    local count=0
    for link in "$themes_dir"/*.json; do
        [ -L "$link" ] || continue
        local target
        target="$(readlink "$link")"
        case "$target" in
            "$INSTALL_DIR/extensions/shared/themes/"*) rm -f "$link"; count=$((count + 1)) ;;
        esac
    done

    if [ "$count" -gt 0 ]; then
        success "Removed $count theme symlink(s) from $themes_dir"
    fi
}

# Symlink each .json file in $INSTALL_DIR/extensions/shared/themes/ into pi's
# themes dir so pi's initTheme() can resolve them at startup (before extensions
# load) and so pi's file watcher picks up edits.
link_themes() {
    local themes_src="$INSTALL_DIR/extensions/shared/themes"
    local themes_dir
    themes_dir="$(pi_themes_dir)"

    # Clean stale symlinks from a previous install
    unlink_themes

    # Nothing to link if no .json files shipped
    local has_themes=0
    for f in "$themes_src"/*.json; do
        [ -f "$f" ] && has_themes=1 && break
    done
    [ "$has_themes" -eq 0 ] && return 0

    mkdir -p "$themes_dir"

    local count=0
    for f in "$themes_src"/*.json; do
        [ -f "$f" ] || continue
        local name dest
        name="$(basename "$f")"
        dest="$themes_dir/$name"

        # Don't clobber files that aren't ours
        if [ -e "$dest" ]; then
            local is_ours=0
            if [ -L "$dest" ]; then
                case "$(readlink "$dest")" in
                    "$INSTALL_DIR/extensions/shared/themes/"*) is_ours=1 ;;
                esac
            fi
            if [ "$is_ours" -eq 0 ]; then
                warn "Skipping $name — $dest already exists (not managed by Pizza)"
                continue
            fi
        fi

        ln -sf "$f" "$dest"
        count=$((count + 1))
    done

    if [ "$count" -gt 0 ]; then
        success "$count theme(s) linked into $themes_dir"
    fi
}

# Symlink each .md file in $INSTALL_DIR/agents/ into ~/.agents/.
link_agents() {
    local agents_dir="$HOME/.agents"

    # Clean stale symlinks from a previous install
    unlink_agents

    # Nothing to link if no .md files shipped
    local has_agents=0
    for f in "$INSTALL_DIR/agents/"*.md; do
        [ -f "$f" ] && has_agents=1 && break
    done
    [ "$has_agents" -eq 0 ] && return 0

    mkdir -p "$agents_dir"

    local count=0
    for f in "$INSTALL_DIR/agents/"*.md; do
        [ -f "$f" ] || continue
        local name dest
        name="$(basename "$f")"
        dest="$agents_dir/$name"

        # Don't clobber files that aren't ours
        if [ -e "$dest" ]; then
            local is_ours=0
            if [ -L "$dest" ]; then
                case "$(readlink "$dest")" in
                    "$INSTALL_DIR/agents/"*) is_ours=1 ;;
                esac
            fi
            if [ "$is_ours" -eq 0 ]; then
                warn "Skipping $name — $dest already exists (not managed by Pizza)"
                continue
            fi
        fi

        ln -sf "$f" "$dest"
        count=$((count + 1))
    done

    if [ "$count" -gt 0 ]; then
        success "$count agent definition(s) linked into $agents_dir"
    fi
}

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

extract_first_semver() {
    node -e '
const input = process.argv[1] ?? "";
const match = input.match(/(?:^|[^0-9])v?(\d+\.\d+(?:\.\d+)?)(?!\d)/);
if (match) process.stdout.write(match[1]);
' "$1"
}

describe_pi_range() {
    node -e '
const range = (process.argv[1] ?? "").trim();
const minimum = range.match(/^>=\s*v?(\d+)\.(\d+)\.(\d+)$/);
if (minimum) {
  process.stdout.write(`${minimum[1]}.${minimum[2]}.${minimum[3]}+`);
  process.exit(0);
}
const match = range.match(/^~\s*v?(\d+)\.(\d+)\.(\d+)$/);
process.stdout.write(match ? `${match[1]}.${match[2]}.x` : range);
' "$1"
}

resolve_pi_compatibility_range() {
    local package_json="$1"
    local resolved=""

    if [ -f "$package_json" ]; then
        resolved="$(node -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const explicit = pkg.pizza?.compatibility?.pi;
if (typeof explicit === "string" && explicit.trim()) {
  process.stdout.write(explicit.trim());
  process.exit(0);
}
const dep =
  pkg.devDependencies?.["@mariozechner/pi-coding-agent"] ??
  pkg.dependencies?.["@mariozechner/pi-coding-agent"];
if (typeof dep === "string") {
  const match = dep.match(/(?:^|[^0-9])v?(\d+)\.(\d+)(?:\.(\d+))?(?!\d)/);
  if (match) {
    process.stdout.write(`>=${match[1]}.${match[2]}.0`);
  }
}
' "$package_json" 2>/dev/null || true)"
    fi

    if [ -n "$resolved" ]; then
        echo "$resolved"
    else
        echo "$DEFAULT_PI_COMPATIBILITY_RANGE"
    fi
}

pi_version_satisfies() {
    node -e '
function parseSemver(input) {
  const match = String(input ?? "").match(/(?:^|[^0-9])v?(\d+)\.(\d+)(?:\.(\d+))?(?!\d)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? "0"),
  };
}

function compare(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

const version = parseSemver(process.argv[1]);
const range = String(process.argv[2] ?? "").trim();
if (!version) process.exit(1);

const minimum = range.match(/^>=\s*v?(\d+)\.(\d+)\.(\d+)$/);
if (minimum) {
  process.exit(
    compare(version, {
      major: Number(minimum[1]),
      minor: Number(minimum[2]),
      patch: Number(minimum[3]),
    }) >= 0
      ? 0
      : 1
  );
}

const tilde = range.match(/^~\s*v?(\d+)\.(\d+)\.(\d+)$/);
if (tilde) {
  const minimum = {
    major: Number(tilde[1]),
    minor: Number(tilde[2]),
    patch: Number(tilde[3]),
  };
  process.exit(
    version.major === minimum.major &&
    version.minor === minimum.minor &&
    compare(version, minimum) >= 0
      ? 0
      : 1
  );
}

const exact = parseSemver(range);
process.exit(exact && compare(version, exact) === 0 ? 0 : 1);
' "$1" "$2"
}

check_pi() {
    local required_pi_range="$1"
    local required_pi_label detected_pi_label raw_pi_version normalized_pi_version
    local pi_install_cmd="npm install -g \"@mariozechner/pi-coding-agent@${required_pi_range}\""

    required_pi_label="$(describe_pi_range "$required_pi_range")"

    if ! command -v pi &>/dev/null; then
        error "Pi is not installed. Install it first, then re-run this script:"
        echo "  $pi_install_cmd"
        exit 1
    fi

    raw_pi_version="$(pi --version 2>&1 || echo "unknown")"
    normalized_pi_version="$(extract_first_semver "$raw_pi_version")"

    if [ -n "$normalized_pi_version" ]; then
        detected_pi_label="v$normalized_pi_version"
    else
        detected_pi_label="version '$raw_pi_version'"
    fi

    if [ -n "$normalized_pi_version" ] && pi_version_satisfies "$normalized_pi_version" "$required_pi_range"; then
        success "Pi v$normalized_pi_version"
        return
    fi

    warn "Pi ${detected_pi_label} found, but Pizza requires ${required_pi_label}"

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
                error "Pizza requires Pi ${required_pi_label}. Update Pi, then re-run:"
                echo "  $pi_install_cmd"
                exit 1
                ;;
            *)
                info "Updating Pi to ${required_pi_label}"
                npm install -g "@mariozechner/pi-coding-agent@${required_pi_range}"
                raw_pi_version="$(pi --version 2>&1 || echo "unknown")"
                normalized_pi_version="$(extract_first_semver "$raw_pi_version")"
                success "Pi updated to ${normalized_pi_version:+v$normalized_pi_version}${normalized_pi_version:-$raw_pi_version}"
                ;;
        esac
    else
        error "Pi ${detected_pi_label} is not compatible (requires ${required_pi_label}). Update Pi, then re-run:"
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
    local pi_compatibility_range="$2"

    cat > "$INSTALL_DIR/package.json" << EOF
{
  "name": "pizza",
  "version": "${version}",
  "description": "Pizza — Pi with extra toppings",
  "pizza": {
    "compatibility": {
      "pi": "${pi_compatibility_range}"
    }
  },
  "pi": {
    "extensions": ["extensions"],
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

    # Remove agent + theme symlinks before deleting the install dir (targets
    # disappear). Revert pi settings before removing INSTALL_DIR too, since
    # the backup file lives under it.
    unlink_agents
    unlink_themes
    revert_pi_settings

    if [ -d "$INSTALL_DIR" ]; then
        rm -rf "$INSTALL_DIR"
        success "Removed $INSTALL_DIR"
    else
        info "Nothing to uninstall ($INSTALL_DIR does not exist)"
    fi
}

main "$@"
