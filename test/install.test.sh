#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_SCRIPT="$(cd "$SCRIPT_DIR/.." && pwd)/install.sh"

# ── Test framework ──────────────────────────────────────────────────────
PASSED=0
FAILED=0

pass() {
    PASSED=$((PASSED + 1))
    printf "  \033[32m✓\033[0m %s\n" "$1"
}

fail() {
    FAILED=$((FAILED + 1))
    printf "  \033[31m✗\033[0m %s\n" "$1"
    [ -n "${2:-}" ] && printf "    %s\n" "$2"
}

# ── Per-test isolation ──────────────────────────────────────────────────
# Each test gets its own temp directory with its own bin/, fixtures, and
# install target. Nothing is shared between tests.

REAL_CURL="$(command -v curl)"
REAL_NODE="$(command -v node)"
TEST_DIR=""

# Create an isolated environment for a single test. Sets TEST_DIR and
# populates it with mock binaries and tarball fixtures.
create_env() {
    TEST_DIR="$(mktemp -d)"

    # ── Isolated HOME so symlinks don't touch the real ~/.agents/ ──
    mkdir -p "$TEST_DIR/home"

    # ── Mock bin directory ────────────────────────────────────────────
    mkdir -p "$TEST_DIR/bin"
    ln -s "$REAL_NODE" "$TEST_DIR/bin/node"
    cat > "$TEST_DIR/bin/npm" << 'M'
#!/usr/bin/env bash
exit 0
M
    chmod +x "$TEST_DIR/bin/npm"

    # ── Pizza tarball fixture (matches release artifact structure) ──
    local pkg="$TEST_DIR/fixture/pizza-0.99.0"
    mkdir -p "$pkg/extensions/shared/themes" "$pkg/skills" "$pkg/prompts" "$pkg/agents"
    echo '{}' > "$pkg/extensions/stub.json"
    echo '{}' > "$pkg/skills/stub.json"
    echo '{}' > "$pkg/prompts/stub.json"
    echo '{"name":"alpha"}' > "$pkg/extensions/shared/themes/alpha.json"
    echo '{"name":"beta"}'  > "$pkg/extensions/shared/themes/beta.json"
    cat > "$pkg/package.json" << 'PKG'
{
  "name": "pizza",
  "version": "0.99.0",
  "pizza": {
    "compatibility": {
      "pi": ">=0.67.0"
    }
  },
  "pi": {
    "extensions": ["extensions"],
    "skills": ["skills"],
    "prompts": ["prompts"]
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "0.67.0"
  }
}
PKG
    cat > "$pkg/agents/test-agent.md" << 'AGENT'
---
name: test-agent
description: A test agent
---
You are a test agent.
AGENT
    echo 'Apache 2.0' > "$pkg/LICENSE"
    tar -czf "$TEST_DIR/pizza.tar.gz" -C "$TEST_DIR/fixture" .

    # ── Mock curl: delegate to the real curl ────────────────────────
    cat > "$TEST_DIR/bin/curl" << MOCK
#!/usr/bin/env bash
exec "$REAL_CURL" "\$@"
MOCK
    chmod +x "$TEST_DIR/bin/curl"
}

destroy_env() {
    [ -n "$TEST_DIR" ] && rm -rf "$TEST_DIR"
    TEST_DIR=""
}

# ── Mock helpers ────────────────────────────────────────────────────────

# Create a mock pi binary that reports the given version.
# Also logs install/remove calls to $TEST_DIR/pi.log for verification.
mock_pi() {
    local version="$1"
    cat > "$TEST_DIR/bin/pi" << MOCK
#!/usr/bin/env bash
case "\$1" in
    --version) echo "$version" ;;
    install|remove) echo "\$@" >> "$TEST_DIR/pi.log"; exit 0 ;;
    *) exit 0 ;;
esac
MOCK
    chmod +x "$TEST_DIR/bin/pi"
}

mock_node_version() {
    local version="$1"
    mv "$TEST_DIR/bin/node" "$TEST_DIR/bin/node.real"
    cat > "$TEST_DIR/bin/node" << MOCK
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then
    echo "$version"
    exit 0
fi
exec "\$(dirname "\$0")/node.real" "\$@"
MOCK
    chmod +x "$TEST_DIR/bin/node"
}

# Run install.sh with stdin from /dev/null (non-TTY) and controlled env.
# Prefix env var overrides before the -- separator, installer args after.
#   run_installer --version 0.99.0
#   run_installer PIZZA_TARBALL_URL="file:///other.tar.gz" -- --version 0.99.0
run_installer() {
    local -a env_overrides=()
    local -a installer_args=()
    local past_sep=0

    for arg in "$@"; do
        if [ "$past_sep" -eq 1 ]; then
            installer_args+=("$arg")
        elif [ "$arg" = "--" ]; then
            past_sep=1
        elif [[ "$arg" == *=* ]]; then
            env_overrides+=("$arg")
        else
            # No separator used — everything is installer args
            installer_args+=("$arg")
        fi
    done

    env \
        PATH="$TEST_DIR/bin:/usr/bin:/bin" \
        HOME="$TEST_DIR/home" \
        PIZZA_HOME="$TEST_DIR/target" \
        PIZZA_TARBALL_URL="file://$TEST_DIR/pizza.tar.gz" \
        "${env_overrides[@]+"${env_overrides[@]}"}" \
        bash "$INSTALL_SCRIPT" "${installer_args[@]+"${installer_args[@]}"}" </dev/null 2>&1
}

# ── Assertion helpers ───────────────────────────────────────────────────

assert_exits_nonzero() {
    local label="$1" rc="$2"
    if [ "$rc" -ne 0 ]; then pass "$label"; else fail "$label" "expected non-zero, got $rc"; fi
}

assert_exits_zero() {
    local label="$1" rc="$2"
    if [ "$rc" -eq 0 ]; then pass "$label"; else fail "$label" "expected zero, got $rc"; fi
}

assert_output_contains() {
    local label="$1" out="$2" pattern="$3"
    if echo "$out" | grep -q "$pattern"; then pass "$label"; else fail "$label" "pattern not found: $pattern"; fi
}

assert_output_not_contains() {
    local label="$1" out="$2" pattern="$3"
    if ! echo "$out" | grep -q "$pattern"; then pass "$label"; else fail "$label" "pattern should not match: $pattern"; fi
}

assert_dir_exists() {
    local label="$1" dir="$2"
    if [ -d "$dir" ]; then pass "$label"; else fail "$label" "$dir does not exist"; fi
}

assert_dir_missing() {
    local label="$1" dir="$2"
    if [ ! -d "$dir" ]; then pass "$label"; else fail "$label" "$dir should not exist"; fi
}

assert_file_exists() {
    local label="$1" file="$2"
    if [ -f "$file" ]; then pass "$label"; else fail "$label" "$file does not exist"; fi
}

assert_file_contains() {
    local label="$1" file="$2" pattern="$3"
    if grep -q "$pattern" "$file" 2>/dev/null; then pass "$label"; else fail "$label" "pattern not found in $file: $pattern"; fi
}

assert_file_not_contains() {
    local label="$1" file="$2" pattern="$3"
    if ! grep -q "$pattern" "$file" 2>/dev/null; then pass "$label"; else fail "$label" "pattern should not be in $file: $pattern"; fi
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: Pi missing
# ═══════════════════════════════════════════════════════════════════════

test_no_pi_exits_with_error() {
    echo "Pi not installed → hard error"
    create_env

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "says Pi is not installed" "$out" "Pi is not installed"
    assert_output_contains "shows install command" "$out" "npm install -g"
    assert_dir_missing "nothing installed" "$TEST_DIR/target/extensions"

    destroy_env
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: Pi wrong version
# ═══════════════════════════════════════════════════════════════════════

test_incompatible_pi_nontty_exits() {
    echo "Incompatible Pi (non-TTY) → hard error"
    create_env
    mock_pi "0.66.0"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "shows incompatibility" "$out" "not compatible"
    assert_output_contains "shows update command" "$out" "npm install -g"
    assert_dir_missing "nothing installed" "$TEST_DIR/target/extensions"

    destroy_env
}

test_incompatible_pi_no_npm_exits() {
    echo "Incompatible Pi + no npm → hard error"
    create_env
    mock_pi "0.65.0"
    rm -f "$TEST_DIR/bin/npm"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "says npm not found" "$out" "npm not found"
    assert_output_contains "shows update command" "$out" "npm install -g"
    assert_dir_missing "nothing installed" "$TEST_DIR/target/extensions"

    destroy_env
}

test_incompatible_pi_uses_dependency_fallback_when_metadata_missing() {
    echo "Incompatible Pi uses inferred range when metadata is missing"
    create_env
    mock_pi "0.66.5"

    cat > "$TEST_DIR/fixture/pizza-0.99.0/package.json" << 'PKG'
{
  "name": "pizza",
  "version": "0.99.0",
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "0.67.0"
  }
}
PKG
    tar -czf "$TEST_DIR/pizza.tar.gz" -C "$TEST_DIR/fixture" .

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "shows inferred range" "$out" "requires 0.67.0+"
    assert_dir_missing "nothing installed" "$TEST_DIR/target/extensions"

    destroy_env
}

test_newer_pi_is_accepted() {
    echo "Newer Pi release is accepted"
    create_env
    mock_pi "0.72.1"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_output_contains "shows detected Pi version" "$out" "Pi v0.72.1"
    assert_dir_exists "extensions/ installed" "$TEST_DIR/target/extensions"

    destroy_env
}

# ════════════════════════════════════════════════��══════════════════════
# Tests: Node.js
# ═══════════════════════════════════════════════════════════════════════

test_node_too_old_exits() {
    echo "Node.js < 20.6.0 → hard error"
    create_env
    mock_pi "0.67.1"
    mock_node_version "v20.0.0"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "shows version requirement" "$out" "Node.js >= 20.6.0 required"
    assert_dir_missing "nothing installed" "$TEST_DIR/target/extensions"

    destroy_env
}

test_node_missing_exits() {
    echo "Node.js not installed → hard error"
    create_env
    rm -f "$TEST_DIR/bin/node"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "says Node required" "$out" "Node.js is required"

    destroy_env
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: happy path
# ═══════════════════════════════════════════════════════════════════════

test_successful_install() {
    echo "Happy path: compatible Pi → full install"
    create_env
    mock_pi "0.67.1"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_dir_exists "extensions/ installed" "$TEST_DIR/target/extensions"
    assert_dir_exists "skills/ installed" "$TEST_DIR/target/skills"
    assert_dir_exists "prompts/ installed" "$TEST_DIR/target/prompts"
    assert_dir_exists "agents/ installed" "$TEST_DIR/target/agents"
    assert_dir_missing "legacy subagents/ removed" "$TEST_DIR/target/subagents"
    assert_file_exists "LICENSE copied" "$TEST_DIR/target/LICENSE"

    # Agent symlinks
    if [ -L "$TEST_DIR/home/.agents/test-agent.md" ]; then
        local link_target
        link_target="$(readlink "$TEST_DIR/home/.agents/test-agent.md")"
        if [ "$link_target" = "$TEST_DIR/target/agents/test-agent.md" ]; then
            pass "agent symlink points to install dir"
        else
            fail "agent symlink target wrong" "expected $TEST_DIR/target/agents/test-agent.md, got $link_target"
        fi
    else
        fail "agent symlink not created" "$TEST_DIR/home/.agents/test-agent.md"
    fi

    assert_output_contains "shows success" "$out" "installed successfully"
    assert_output_contains "registered with Pi" "$out" "Registered with Pi"

    destroy_env
}

test_package_json_generated() {
    echo "package.json has correct version and only first-party extensions"
    create_env
    mock_pi "0.67.1"

    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    assert_file_exists "package.json exists" "$TEST_DIR/target/package.json"
    assert_file_contains "version is 0.99.0" "$TEST_DIR/target/package.json" '"version": "0.99.0"'
    assert_file_contains "extensions field present" "$TEST_DIR/target/package.json" '"extensions"'
    assert_file_not_contains "subagents omitted" "$TEST_DIR/target/package.json" '"subagents"'
    assert_file_contains "pi compatibility is preserved" "$TEST_DIR/target/package.json" '"pi": ">=0.67.0"'

    destroy_env
}

test_pi_install_called_with_correct_path() {
    echo "pi install is called with the install directory"
    create_env
    mock_pi "0.67.1"

    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    assert_file_exists "pi was called" "$TEST_DIR/pi.log"
    assert_file_contains "pi install called with target" "$TEST_DIR/pi.log" "install $TEST_DIR/target"
    # remove is called first (cleanup of previous registration)
    assert_file_contains "pi remove called with target" "$TEST_DIR/pi.log" "remove $TEST_DIR/target"

    destroy_env
}

test_reinstall_cleans_old_files() {
    echo "Reinstall replaces old extension files"
    create_env
    mock_pi "0.67.1"

    # First install
    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    # Drop a leftover file
    echo "stale" > "$TEST_DIR/target/extensions/leftover.txt"

    # Reinstall
    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    if [ ! -f "$TEST_DIR/target/extensions/leftover.txt" ]; then
        pass "stale file removed on reinstall"
    else
        fail "stale file should be removed"
    fi

    # Add a stale agent symlink that no longer corresponds to a shipped agent
    ln -sf "$TEST_DIR/target/agents/old-agent.md" "$TEST_DIR/home/.agents/old-agent.md"

    # Reinstall again
    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    if [ ! -L "$TEST_DIR/home/.agents/old-agent.md" ]; then
        pass "stale agent symlink removed on reinstall"
    else
        fail "stale agent symlink should be removed"
    fi

    # Current agent symlink should still work
    if [ -L "$TEST_DIR/home/.agents/test-agent.md" ]; then
        pass "current agent symlink preserved on reinstall"
    else
        fail "current agent symlink should exist after reinstall"
    fi

    destroy_env
}

test_agent_symlink_skips_user_files() {
    echo "Agent symlink skips existing non-Pizza files"
    create_env
    mock_pi "0.67.1"

    # Pre-create a user-owned agent with the same name
    mkdir -p "$TEST_DIR/home/.agents"
    echo "my custom agent" > "$TEST_DIR/home/.agents/test-agent.md"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_zero "exits zero" "$rc"

    # User file should NOT be overwritten
    if [ ! -L "$TEST_DIR/home/.agents/test-agent.md" ]; then
        pass "user agent file not replaced by symlink"
    else
        fail "user agent file was replaced by a symlink"
    fi

    assert_file_contains "user file preserved" "$TEST_DIR/home/.agents/test-agent.md" "my custom agent"
    assert_output_contains "warns about skip" "$out" "Skipping test-agent.md"

    destroy_env
}

test_version_v_prefix_stripped() {
    echo "--version v0.99.0 strips the v prefix"
    create_env
    mock_pi "0.67.1"

    local out rc=0
    out="$(run_installer --version v0.99.0)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_output_contains "installs 0.99.0 (no v)" "$out" "Installing Pizza v0.99.0"
    assert_file_contains "package.json version has no v" "$TEST_DIR/target/package.json" '"version": "0.99.0"'

    destroy_env
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: download failures
# ══════════════════════════════════════════��════════════════════════════

test_bad_tarball_url_exits() {
    echo "Failed pizza tarball download → hard error"
    create_env
    mock_pi "0.67.1"

    local out rc=0
    out="$(run_installer PIZZA_TARBALL_URL="file:///nonexistent/pizza-0.99.0.tar.gz" -- --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "shows download error" "$out" "Failed to download"
    assert_dir_missing "nothing installed" "$TEST_DIR/target/extensions"

    destroy_env
}

test_corrupt_tarball_exits() {
    echo "Tarball missing extensions/ → hard error"
    create_env
    mock_pi "0.67.1"

    # Create a tarball without extensions/
    local bad="$TEST_DIR/bad_fixture/pizza-0.99.0"
    mkdir -p "$bad/skills" "$bad/prompts"
    echo '{}' > "$bad/skills/stub.json"
    tar -czf "$TEST_DIR/pizza.tar.gz" -C "$TEST_DIR/bad_fixture" .

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "says extensions missing" "$out" "does not contain extensions"

    destroy_env
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: CLI argument handling
# ═══════════════════════════════════════════════════════════════════════

test_missing_version_value() {
    echo "Missing --version value → error with usage"
    create_env
    mock_pi "0.67.1"

    local out rc=0
    out="$(run_installer --version)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "shows error" "$out" "Option --version requires a value"
    assert_output_contains "shows usage" "$out" "Usage:"

    destroy_env
}

test_unknown_option() {
    echo "Unknown option → error with usage"
    create_env

    local out rc=0
    out="$(run_installer --bogus)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "shows error" "$out" "Unknown option: --bogus"
    assert_output_contains "shows usage" "$out" "Usage:"

    destroy_env
}

test_help_flag() {
    echo "--help prints usage and exits cleanly"
    create_env

    local out rc=0
    out="$(run_installer --help)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_output_contains "shows usage" "$out" "Usage:"
    assert_output_contains "shows options" "$out" "Options:"
    assert_output_contains "shows examples" "$out" "Examples:"

    destroy_env
}

# ═════════════════════════════════════════════════���═════════════════════
# Tests: uninstall
# ══════════════════════════════════════════════════════════════════��════

test_uninstall_removes_directory() {
    echo "Uninstall removes install directory and deregisters"
    create_env
    mock_pi "0.67.1"

    # Install first
    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    local out rc=0
    out="$(run_installer --uninstall)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_dir_missing "install directory removed" "$TEST_DIR/target"
    assert_output_contains "deregistered" "$out" "Deregistered from Pi"

    # Agent symlinks should be cleaned up
    if [ -L "$TEST_DIR/home/.agents/test-agent.md" ]; then
        fail "agent symlink should be removed after uninstall"
    else
        pass "agent symlink removed on uninstall"
    fi

    destroy_env
}

test_uninstall_nonexistent() {
    echo "Uninstall with nothing to remove → clean exit"
    create_env
    mock_pi "0.67.1"

    local out rc=0
    out="$(run_installer --uninstall)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_output_contains "says nothing to uninstall" "$out" "Nothing to uninstall"

    destroy_env
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: theme symlinks
# ═══════════════════════════════════════════════════════════════════════

# Assert $1 is a symlink whose target equals $2.
assert_symlink_to() {
    local label="$1" link="$2" expected="$3"
    if [ ! -L "$link" ]; then
        fail "$label" "$link is not a symlink"
        return
    fi
    local actual
    actual="$(readlink "$link")"
    if [ "$actual" = "$expected" ]; then
        pass "$label"
    else
        fail "$label" "expected $expected, got $actual"
    fi
}

test_themes_symlinked_into_pi() {
    echo "Install symlinks every shipped theme into pi's themes dir"
    create_env
    mock_pi "0.67.1"

    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    local themes_dir="$TEST_DIR/home/.pi/agent/themes"
    local src="$TEST_DIR/target/extensions/shared/themes"
    assert_symlink_to "alpha.json symlinked" "$themes_dir/alpha.json" "$src/alpha.json"
    assert_symlink_to "beta.json symlinked"  "$themes_dir/beta.json"  "$src/beta.json"

    destroy_env
}

test_theme_symlink_skips_user_files() {
    echo "Theme symlink skips an existing user-owned file"
    create_env
    mock_pi "0.67.1"

    # Pre-create a user-owned theme at a name we also ship.
    local themes_dir="$TEST_DIR/home/.pi/agent/themes"
    mkdir -p "$themes_dir"
    echo '{"name":"my-alpha"}' > "$themes_dir/alpha.json"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_zero "exits zero" "$rc"

    # User file preserved, not replaced by a symlink
    if [ -L "$themes_dir/alpha.json" ]; then
        fail "user theme file was replaced by a symlink"
    else
        pass "user theme file not replaced"
    fi
    assert_file_contains "user file content preserved" "$themes_dir/alpha.json" "my-alpha"
    assert_output_contains "warns about skip" "$out" "Skipping alpha.json"

    # Other themes still linked
    local src="$TEST_DIR/target/extensions/shared/themes"
    assert_symlink_to "beta.json still symlinked" "$themes_dir/beta.json" "$src/beta.json"

    destroy_env
}

test_uninstall_removes_theme_symlinks() {
    echo "Uninstall removes pizza theme symlinks but leaves user files alone"
    create_env
    mock_pi "0.67.1"

    local themes_dir="$TEST_DIR/home/.pi/agent/themes"
    mkdir -p "$themes_dir"
    # User's own theme co-existing with pizza's bundled ones
    echo '{"name":"mine"}' > "$themes_dir/mine.json"

    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    # Sanity: pizza symlinks exist before uninstall
    [ -L "$themes_dir/alpha.json" ] || fail "precondition: alpha symlink should exist"
    [ -L "$themes_dir/beta.json" ]  || fail "precondition: beta symlink should exist"

    run_installer --uninstall >/dev/null 2>&1 || true

    if [ -e "$themes_dir/alpha.json" ]; then
        fail "alpha.json symlink should be removed on uninstall"
    else
        pass "alpha.json symlink removed on uninstall"
    fi
    if [ -e "$themes_dir/beta.json" ]; then
        fail "beta.json symlink should be removed on uninstall"
    else
        pass "beta.json symlink removed on uninstall"
    fi
    assert_file_exists "user-owned theme preserved" "$themes_dir/mine.json"
    assert_file_contains "user theme content intact" "$themes_dir/mine.json" "mine"

    destroy_env
}

test_reinstall_refreshes_theme_symlinks() {
    echo "Reinstall removes stale pizza theme symlinks and re-links current ones"
    create_env
    mock_pi "0.67.1"

    # First install
    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    local themes_dir="$TEST_DIR/home/.pi/agent/themes"
    local src="$TEST_DIR/target/extensions/shared/themes"

    # Simulate a stale pizza-owned symlink for a theme no longer shipped.
    ln -sf "$src/gamma.json" "$themes_dir/gamma.json"

    # Reinstall
    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    if [ -L "$themes_dir/gamma.json" ]; then
        fail "stale pizza theme symlink should be removed on reinstall"
    else
        pass "stale pizza theme symlink removed"
    fi
    assert_symlink_to "alpha.json re-linked after reinstall" "$themes_dir/alpha.json" "$src/alpha.json"
    assert_symlink_to "beta.json re-linked after reinstall"  "$themes_dir/beta.json"  "$src/beta.json"

    destroy_env
}

# ── Helper: read one key from a JSON file via node ────────────────────────
json_get() {
    local file="$1" key="$2"
    node -e '
const fs = require("node:fs");
const [path, key] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const value = data[key];
if (value === undefined) process.stdout.write("__MISSING__");
else process.stdout.write(JSON.stringify(value));
' "$file" "$key"
}

test_settings_creates_file_when_absent() {
    echo "Install creates settings.json with quietStartup=true when none exists"
    create_env
    mock_pi "0.67.1"

    local settings_file="$TEST_DIR/home/.pi/agent/settings.json"
    [ -f "$settings_file" ] && rm -f "$settings_file"

    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    assert_file_exists "settings.json created" "$settings_file"
    local val
    val="$(json_get "$settings_file" quietStartup)"
    if [ "$val" = "true" ]; then
        pass "quietStartup set to true"
    else
        fail "quietStartup not true" "got: $val"
    fi

    destroy_env
}

test_settings_preserves_other_keys() {
    echo "Install preserves other keys already in settings.json"
    create_env
    mock_pi "0.67.1"

    local settings_file="$TEST_DIR/home/.pi/agent/settings.json"
    mkdir -p "$(dirname "$settings_file")"
    cat >"$settings_file" <<'EOF'
{
  "theme": "dark",
  "someOtherKey": 42
}
EOF

    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    local theme other quiet
    theme="$(json_get "$settings_file" theme)"
    other="$(json_get "$settings_file" someOtherKey)"
    quiet="$(json_get "$settings_file" quietStartup)"

    if [ "$theme" = '"dark"' ]; then pass "theme preserved"; else fail "theme not preserved" "got: $theme"; fi
    if [ "$other" = "42" ]; then pass "someOtherKey preserved"; else fail "someOtherKey not preserved" "got: $other"; fi
    if [ "$quiet" = "true" ]; then pass "quietStartup added"; else fail "quietStartup not added" "got: $quiet"; fi

    destroy_env
}

test_uninstall_restores_prior_quietstartup_value() {
    echo "Uninstall restores prior quietStartup (user had it false)"
    create_env
    mock_pi "0.67.1"

    local settings_file="$TEST_DIR/home/.pi/agent/settings.json"
    mkdir -p "$(dirname "$settings_file")"
    cat >"$settings_file" <<'EOF'
{
  "quietStartup": false,
  "theme": "pizzeria"
}
EOF

    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    # Mid-state: pizza set it true
    local mid
    mid="$(json_get "$settings_file" quietStartup)"
    if [ "$mid" = "true" ]; then pass "quietStartup flipped to true during install"; else fail "install did not set quietStartup" "got: $mid"; fi

    run_installer --uninstall >/dev/null 2>&1 || true

    assert_file_exists "settings.json still exists after uninstall" "$settings_file"
    local restored theme
    restored="$(json_get "$settings_file" quietStartup)"
    theme="$(json_get "$settings_file" theme)"
    if [ "$restored" = "false" ]; then pass "quietStartup restored to false"; else fail "quietStartup not restored" "got: $restored"; fi
    if [ "$theme" = '"pizzeria"' ]; then pass "unrelated keys preserved"; else fail "theme not preserved" "got: $theme"; fi

    destroy_env
}

test_uninstall_removes_settings_file_if_we_created_it() {
    echo "Uninstall deletes settings.json if pizza created it and nothing else was added"
    create_env
    mock_pi "0.67.1"

    local settings_file="$TEST_DIR/home/.pi/agent/settings.json"
    [ -f "$settings_file" ] && rm -f "$settings_file"

    run_installer --version 0.99.0 >/dev/null 2>&1 || true
    assert_file_exists "settings.json created during install" "$settings_file"

    run_installer --uninstall >/dev/null 2>&1 || true
    if [ ! -f "$settings_file" ]; then
        pass "settings.json removed on uninstall (pizza created it, nothing added)"
    else
        fail "settings.json should be removed" "$(cat "$settings_file")"
    fi

    destroy_env
}

test_uninstall_removes_only_quietstartup_if_no_prior_key() {
    echo "Uninstall removes only quietStartup when it was absent pre-install"
    create_env
    mock_pi "0.67.1"

    local settings_file="$TEST_DIR/home/.pi/agent/settings.json"
    mkdir -p "$(dirname "$settings_file")"
    cat >"$settings_file" <<'EOF'
{
  "theme": "pizzeria"
}
EOF

    run_installer --version 0.99.0 >/dev/null 2>&1 || true
    run_installer --uninstall >/dev/null 2>&1 || true

    assert_file_exists "settings.json kept (theme still present)" "$settings_file"
    local quiet theme
    quiet="$(json_get "$settings_file" quietStartup)"
    theme="$(json_get "$settings_file" theme)"
    if [ "$quiet" = "__MISSING__" ]; then pass "quietStartup removed"; else fail "quietStartup should be removed" "got: $quiet"; fi
    if [ "$theme" = '"pizzeria"' ]; then pass "theme preserved through round trip"; else fail "theme not preserved" "got: $theme"; fi

    destroy_env
}

test_reinstall_preserves_original_backup() {
    echo "Reinstall does not lose the true pre-pizza quietStartup value"
    create_env
    mock_pi "0.67.1"

    local settings_file="$TEST_DIR/home/.pi/agent/settings.json"
    mkdir -p "$(dirname "$settings_file")"
    echo '{"quietStartup": false}' >"$settings_file"

    # First install: backup captures `false` as prior state.
    run_installer --version 0.99.0 >/dev/null 2>&1 || true
    # Reinstall: backup should NOT be overwritten to capture `true`.
    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    run_installer --uninstall >/dev/null 2>&1 || true

    local restored
    restored="$(json_get "$settings_file" quietStartup)"
    if [ "$restored" = "false" ]; then
        pass "reinstall preserved original backup (restored to false)"
    else
        fail "reinstall lost original backup" "got: $restored"
    fi

    destroy_env
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: version resolution
# ══════════════════════════════════════════════���════════════════════════

test_git_fallback_excludes_prereleases() {
    echo "Version resolution: git fallback skips prerelease tags"
    create_env
    mock_pi "0.67.1"

    # Override curl: fail for GitHub API, pass through for tarballs
    cat > "$TEST_DIR/bin/curl" << MOCK
#!/usr/bin/env bash
for arg in "\$@"; do
    if [[ "\$arg" == *"api.github.com"* ]]; then
        exit 1
    fi
done
exec "$REAL_CURL" "\$@"
MOCK
    chmod +x "$TEST_DIR/bin/curl"

    # Mock git ls-remote: return stable + prerelease tags
    cat > "$TEST_DIR/bin/git" << 'MOCK'
#!/usr/bin/env bash
if [ "${1:-}" = "ls-remote" ]; then
    cat << 'TAGS'
aaa0001	refs/tags/v0.1.0
aaa0002	refs/tags/v0.1.1
aaa0003	refs/tags/v0.2.0
aaa0004	refs/tags/v0.3.0-rc1
aaa0005	refs/tags/v0.3.0-beta1
TAGS
    exit 0
fi
exit 0
MOCK
    chmod +x "$TEST_DIR/bin/git"

    # Prepare a tarball matching the expected resolved version (0.2.0)
    local pkg="$TEST_DIR/versioned/pizza-0.2.0"
    mkdir -p "$pkg/extensions" "$pkg/skills" "$pkg/prompts" "$pkg/agents"
    echo '{}' > "$pkg/extensions/stub.json"
    echo '{}' > "$pkg/skills/stub.json"
    echo '{}' > "$pkg/prompts/stub.json"
    tar -czf "$TEST_DIR/versioned.tar.gz" -C "$TEST_DIR/versioned" .

    local out rc=0
    out="$(run_installer PIZZA_TARBALL_URL="file://$TEST_DIR/versioned.tar.gz" --)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_output_contains "resolves to 0.2.0" "$out" "Installing Pizza v0\.2\.0"

    destroy_env
}

test_prerelease_tag_detection() {
    echo "Release workflow: prerelease tag pattern"

    # Mirrors the [[ "\$TAG" == *-* ]] check in release.yml
    local ok=1
    for tag in v0.1.0 v1.0.0 v2.3.4; do
        if [[ "$tag" == *-* ]]; then
            fail "stable tag '$tag' wrongly detected as prerelease"
            ok=0
        fi
    done
    [ "$ok" -eq 1 ] && pass "stable tags pass through"

    ok=1
    for tag in v0.1.0-rc1 v1.0.0-beta1 v2.0.0-alpha.1 v0.3.0-rc.2; do
        if [[ "$tag" != *-* ]]; then
            fail "prerelease tag '$tag' not detected"
            ok=0
        fi
    done
    [ "$ok" -eq 1 ] && pass "prerelease tags detected"
}

# ═══════════════════════════════════════════════════════════════════════
# Runner
# ═══════════════════════════════════════════════════════════════════════
main() {
    echo ""
    echo "install.sh smoke tests"
    echo "======================"

    echo ""
    echo "--- Pi missing ---"
    test_no_pi_exits_with_error

    echo ""
    echo "--- Pi wrong version ---"
    test_incompatible_pi_nontty_exits
    echo ""
    test_incompatible_pi_no_npm_exits
    echo ""
    test_incompatible_pi_uses_dependency_fallback_when_metadata_missing
    echo ""
    test_newer_pi_is_accepted

    echo ""
    echo "--- Node.js ---"
    test_node_too_old_exits
    echo ""
    test_node_missing_exits

    echo ""
    echo "--- Happy path ---"
    test_successful_install
    echo ""
    test_package_json_generated
    echo ""
    test_pi_install_called_with_correct_path
    echo ""
    test_reinstall_cleans_old_files
    echo ""
    test_agent_symlink_skips_user_files
    echo ""
    test_version_v_prefix_stripped

    echo ""
    echo "--- Download failures ---"
    test_bad_tarball_url_exits
    echo ""
    test_corrupt_tarball_exits

    echo ""
    echo "--- CLI arguments ---"
    test_missing_version_value
    echo ""
    test_unknown_option
    echo ""
    test_help_flag

    echo ""
    echo "--- Uninstall ---"
    test_uninstall_removes_directory
    echo ""
    test_uninstall_nonexistent

    echo ""
    echo "--- Themes ---"
    test_themes_symlinked_into_pi
    echo ""
    test_theme_symlink_skips_user_files
    echo ""
    test_uninstall_removes_theme_symlinks
    echo ""
    test_reinstall_refreshes_theme_symlinks

    echo ""
    echo "--- Pi settings ---"
    test_settings_creates_file_when_absent
    echo ""
    test_settings_preserves_other_keys
    echo ""
    test_uninstall_restores_prior_quietstartup_value
    echo ""
    test_uninstall_removes_settings_file_if_we_created_it
    echo ""
    test_uninstall_removes_only_quietstartup_if_no_prior_key
    echo ""
    test_reinstall_preserves_original_backup

    echo ""
    echo "--- Version resolution ---"
    test_git_fallback_excludes_prereleases
    echo ""
    test_prerelease_tag_detection

    echo ""
    echo "======================"
    printf "%d passed, %d failed\n" "$PASSED" "$FAILED"
    echo ""

    [ "$FAILED" -gt 0 ] && exit 1
    exit 0
}

main
