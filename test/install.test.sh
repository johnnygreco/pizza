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
SUBAGENTS_COMMIT="$(grep 'SUBAGENTS_COMMIT=' "$INSTALL_SCRIPT" | head -1 | sed 's/.*"\(.*\)"/\1/')"
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
    mkdir -p "$pkg/extensions" "$pkg/skills" "$pkg/prompts" "$pkg/agents"
    echo '{}' > "$pkg/extensions/stub.json"
    echo '{}' > "$pkg/skills/stub.json"
    echo '{}' > "$pkg/prompts/stub.json"
    cat > "$pkg/agents/test-agent.md" << 'AGENT'
---
name: test-agent
description: A test agent
---
You are a test agent.
AGENT
    echo 'Apache 2.0' > "$pkg/LICENSE"
    tar -czf "$TEST_DIR/pizza.tar.gz" -C "$TEST_DIR/fixture" .

    # ── Subagents tarball fixture ─────────────────────────────────���─
    local sa="$TEST_DIR/sa_fixture/pi-subagents-${SUBAGENTS_COMMIT}"
    mkdir -p "$sa"
    echo '{}' > "$sa/package.json"
    tar -czf "$TEST_DIR/subagents.tar.gz" -C "$TEST_DIR/sa_fixture" .

    # ── Mock curl: serve local fixtures, delegate the rest ──────────
    cat > "$TEST_DIR/bin/curl" << MOCK
#!/usr/bin/env bash
for arg in "\$@"; do
    if [[ "\$arg" == *"pi-subagents"* ]]; then
        cat "$TEST_DIR/subagents.tar.gz"
        exit 0
    fi
done
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
    mock_pi "0.67.0"

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

# ════════════════════════════════════════════════��══════════════════════
# Tests: Node.js
# ═══════════════════════════════════════════════════════════════════════

test_node_too_old_exits() {
    echo "Node.js < 20.6.0 → hard error"
    create_env
    mock_pi "0.66.5"
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
    mock_pi "0.66.5"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_dir_exists "extensions/ installed" "$TEST_DIR/target/extensions"
    assert_dir_exists "skills/ installed" "$TEST_DIR/target/skills"
    assert_dir_exists "prompts/ installed" "$TEST_DIR/target/prompts"
    assert_dir_exists "agents/ installed" "$TEST_DIR/target/agents"
    assert_dir_exists "subagents/ installed" "$TEST_DIR/target/subagents"
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
    echo "package.json has correct version and includes subagents"
    create_env
    mock_pi "0.66.5"

    run_installer --version 0.99.0 >/dev/null 2>&1 || true

    assert_file_exists "package.json exists" "$TEST_DIR/target/package.json"
    assert_file_contains "version is 0.99.0" "$TEST_DIR/target/package.json" '"version": "0.99.0"'
    assert_file_contains "extensions field present" "$TEST_DIR/target/package.json" '"extensions"'
    assert_file_contains "subagents included" "$TEST_DIR/target/package.json" '"subagents"'

    destroy_env
}

test_pi_install_called_with_correct_path() {
    echo "pi install is called with the install directory"
    create_env
    mock_pi "0.66.5"

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
    mock_pi "0.66.5"

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
    mock_pi "0.66.5"

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
    mock_pi "0.66.5"

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
    mock_pi "0.66.5"

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
    mock_pi "0.66.5"

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

test_subagents_download_failure_exits() {
    echo "Failed subagents download → hard error"
    create_env
    mock_pi "0.66.5"

    # Override curl mock to fail on subagents URL
    cat > "$TEST_DIR/bin/curl" << MOCK
#!/usr/bin/env bash
for arg in "\$@"; do
    if [[ "\$arg" == *"pi-subagents"* ]]; then
        exit 1
    fi
done
exec "$REAL_CURL" "\$@"
MOCK
    chmod +x "$TEST_DIR/bin/curl"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    assert_exits_nonzero "exits non-zero" "$rc"
    assert_output_contains "shows subagents error" "$out" "Failed to download subagents"

    destroy_env
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: CLI argument handling
# ═══════════════════════════════════════════════════════════════════════

test_missing_version_value() {
    echo "Missing --version value → error with usage"
    create_env
    mock_pi "0.66.5"

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
    mock_pi "0.66.5"

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
    mock_pi "0.66.5"

    local out rc=0
    out="$(run_installer --uninstall)" || rc=$?

    assert_exits_zero "exits zero" "$rc"
    assert_output_contains "says nothing to uninstall" "$out" "Nothing to uninstall"

    destroy_env
}

# ═══════════════════════════════════════════════════════════════════════
# Tests: version resolution
# ══════════════════════════════════════════════���════════════════════════

test_git_fallback_excludes_prereleases() {
    echo "Version resolution: git fallback skips prerelease tags"
    create_env
    mock_pi "0.66.5"

    # Override curl: fail for GitHub API, pass through for tarballs
    cat > "$TEST_DIR/bin/curl" << MOCK
#!/usr/bin/env bash
for arg in "\$@"; do
    if [[ "\$arg" == *"api.github.com"* ]]; then
        exit 1
    fi
    if [[ "\$arg" == *"pi-subagents"* ]]; then
        cat "$TEST_DIR/subagents.tar.gz"
        exit 0
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
    test_subagents_download_failure_exits

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
