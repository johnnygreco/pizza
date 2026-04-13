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

# ── Fixtures ────────────────────────────────────────────────────────────
WORK_DIR=""
REAL_CURL="$(command -v curl)"

setup() {
    WORK_DIR="$(mktemp -d)"

    # Pizza tarball fixture
    local pkg="$WORK_DIR/fixture/pizza-0.99.0"
    mkdir -p "$pkg/extensions" "$pkg/skills" "$pkg/prompts"
    echo '{}' > "$pkg/extensions/stub.json"
    echo '{}' > "$pkg/skills/stub.json"
    echo '{}' > "$pkg/prompts/stub.json"
    tar -czf "$WORK_DIR/pizza.tar.gz" -C "$WORK_DIR/fixture" .

    # Subagents tarball fixture (matches SUBAGENTS_COMMIT in install.sh)
    local sa="$WORK_DIR/sa_fixture/pi-interactive-subagents-bf4fb961c14567c949e010dca5ec01590b08289a"
    mkdir -p "$sa"
    echo '{}' > "$sa/package.json"
    tar -czf "$WORK_DIR/subagents.tar.gz" -C "$WORK_DIR/sa_fixture" .

    # Mock bin directory — real node, no-op npm
    mkdir -p "$WORK_DIR/bin"
    ln -s "$(command -v node)" "$WORK_DIR/bin/node"
    cat > "$WORK_DIR/bin/npm" << 'M'
#!/usr/bin/env bash
exit 0
M
    chmod +x "$WORK_DIR/bin/npm"
}

teardown() {
    [ -n "$WORK_DIR" ] && rm -rf "$WORK_DIR"
}

# Helpers ────────────────────────────────────────────────────────────────

mock_pi() {
    cat > "$WORK_DIR/bin/pi" << MOCK
#!/usr/bin/env bash
case "\$1" in
    --version) echo "$1" ;;
    *) exit 0 ;;
esac
MOCK
    chmod +x "$WORK_DIR/bin/pi"
}

remove_mock() { rm -f "$WORK_DIR/bin/$1"; }

reset_target() { rm -rf "$WORK_DIR/target"; }

# Run install.sh with stdin from /dev/null (non-TTY) and controlled env.
run_installer() {
    env \
        PATH="$WORK_DIR/bin:/usr/bin:/bin" \
        PIZZA_HOME="$WORK_DIR/target" \
        PIZZA_TARBALL_URL="file://$WORK_DIR/pizza.tar.gz" \
        bash "$INSTALL_SCRIPT" "$@" </dev/null 2>&1
}

# ── Test cases ──────────────────────────────────────────────────────────

test_nontty_incompatible_pi_exits() {
    echo "Non-TTY with incompatible Pi"
    reset_target
    mock_pi "0.67.0"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    if [ "$rc" -ne 0 ]; then
        pass "exits non-zero"
    else
        fail "should exit non-zero" "got $rc"
    fi

    if echo "$out" | grep -q "not compatible"; then
        pass "prints incompatibility error"
    else
        fail "should print incompatibility error"
    fi

    if echo "$out" | grep -q "npm install -g"; then
        pass "shows manual update command"
    else
        fail "should show manual update command"
    fi

    if [ ! -d "$WORK_DIR/target/extensions" ]; then
        pass "does not install anything"
    else
        fail "should not have installed extensions"
    fi
}

test_nontty_no_pi_skips_registration() {
    echo "Non-TTY with no Pi"
    reset_target
    remove_mock pi

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    if [ "$rc" -eq 0 ]; then
        pass "exits successfully"
    else
        fail "should succeed" "got exit $rc"
    fi

    if echo "$out" | grep -q "Pi is not installed"; then
        pass "warns Pi is missing"
    else
        fail "should warn Pi is missing"
    fi

    if [ -d "$WORK_DIR/target/extensions" ]; then
        pass "extensions installed"
    else
        fail "extensions should be installed"
    fi

    if echo "$out" | grep -q "pi install"; then
        pass "shows manual registration command"
    else
        fail "should show manual registration command"
    fi
}

test_nontty_no_pi_no_npm_still_downloads() {
    echo "Non-TTY with no Pi and no npm"
    reset_target
    remove_mock pi
    remove_mock npm

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    if [ "$rc" -eq 0 ]; then
        pass "exits successfully"
    else
        fail "should succeed" "got exit $rc"
    fi

    if echo "$out" | grep -q "npm not found"; then
        pass "warns npm is missing"
    else
        fail "should warn npm is missing"
    fi

    if [ -d "$WORK_DIR/target/extensions" ]; then
        pass "extensions installed"
    else
        fail "extensions should be installed"
    fi

    if echo "$out" | grep -q "pi install"; then
        pass "shows manual registration command"
    else
        fail "should show manual registration command"
    fi
}

test_node_version_floor() {
    echo "Node.js version gate enforces >= 20.6.0"
    reset_target
    remove_mock pi

    local real_node="$WORK_DIR/bin/node.real"
    mv "$WORK_DIR/bin/node" "$real_node"

    cat > "$WORK_DIR/bin/node" << 'MOCK'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
    echo "v20.0.0"
    exit 0
fi
exec "$(dirname "$0")/node.real" "$@"
MOCK
    chmod +x "$WORK_DIR/bin/node"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    mv "$real_node" "$WORK_DIR/bin/node"

    if [ "$rc" -ne 0 ]; then
        pass "exits non-zero"
    else
        fail "should exit non-zero" "got $rc"
    fi

    if echo "$out" | grep -q "Node.js >= 20.6.0 required"; then
        pass "prints version floor error"
    else
        fail "should print version floor error"
    fi

    if [ ! -d "$WORK_DIR/target/extensions" ]; then
        pass "does not install anything"
    else
        fail "should not have installed extensions"
    fi
}

test_missing_version_value() {
    echo "Missing --version value returns a usage error"
    reset_target
    mock_pi "0.66.5"

    local out rc=0
    out="$(run_installer --version)" || rc=$?

    if [ "$rc" -ne 0 ]; then
        pass "exits non-zero"
    else
        fail "should exit non-zero" "got $rc"
    fi

    if echo "$out" | grep -q "Option --version requires a value"; then
        pass "prints a helpful error"
    else
        fail "should print a helpful error"
    fi

    if echo "$out" | grep -q "Usage:"; then
        pass "shows usage"
    else
        fail "should show usage"
    fi
}

test_stale_subagents_removed() {
    echo "Stale subagents removed on reinstall without --with subagents"
    reset_target
    mock_pi "0.66.5"

    # Simulate a prior install that included subagents
    mkdir -p "$WORK_DIR/target/subagents"
    echo "stale" > "$WORK_DIR/target/subagents/marker"

    local out rc=0
    out="$(run_installer --version 0.99.0)" || rc=$?

    if [ "$rc" -eq 0 ]; then
        pass "reinstall succeeds"
    else
        fail "reinstall should succeed" "exit $rc"
    fi

    if [ ! -d "$WORK_DIR/target/subagents" ]; then
        pass "subagents/ directory removed"
    else
        fail "subagents/ should be removed"
    fi

    if echo "$out" | grep -qi "stale subagents"; then
        pass "warns about stale removal"
    else
        fail "should warn about stale subagents"
    fi

    if ! grep -q '"subagents"' "$WORK_DIR/target/package.json"; then
        pass "package.json excludes subagents"
    else
        fail "package.json should not mention subagents"
    fi
}

test_subagents_included_when_requested() {
    echo "Subagents installed when --with subagents passed"
    reset_target
    mock_pi "0.66.5"

    # Mock curl: serve local subagents tarball for subagent URLs, delegate otherwise
    cat > "$WORK_DIR/bin/curl" << MOCK
#!/usr/bin/env bash
for arg in "\$@"; do
    if [[ "\$arg" == *"pi-interactive-subagents"* ]]; then
        cat "$WORK_DIR/subagents.tar.gz"
        exit 0
    fi
done
exec "$REAL_CURL" "\$@"
MOCK
    chmod +x "$WORK_DIR/bin/curl"

    local out rc=0
    out="$(run_installer --version 0.99.0 --with subagents)" || rc=$?

    remove_mock curl

    if [ "$rc" -eq 0 ]; then
        pass "install succeeds"
    else
        fail "should succeed" "exit $rc — $out"
    fi

    if [ -d "$WORK_DIR/target/subagents" ]; then
        pass "subagents/ directory exists"
    else
        fail "subagents/ should exist"
    fi

    if grep -q '"subagents"' "$WORK_DIR/target/package.json" 2>/dev/null; then
        pass "package.json includes subagents"
    else
        fail "package.json should include subagents"
    fi
}

test_git_fallback_excludes_prereleases() {
    echo "Version resolution: git fallback skips prerelease tags"
    reset_target
    mock_pi "0.66.5"

    # Mock curl: fail for GitHub API, pass through for local tarball
    cat > "$WORK_DIR/bin/curl" << MOCK
#!/usr/bin/env bash
for arg in "\$@"; do
    if [[ "\$arg" == *"api.github.com"* ]]; then
        exit 1
    fi
done
exec "$REAL_CURL" "\$@"
MOCK
    chmod +x "$WORK_DIR/bin/curl"

    # Mock git ls-remote: return stable + prerelease tags
    cat > "$WORK_DIR/bin/git" << 'MOCK'
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
    chmod +x "$WORK_DIR/bin/git"

    # Prepare a tarball matching the expected resolved version (0.2.0)
    local pkg="$WORK_DIR/versioned/pizza-0.2.0"
    mkdir -p "$pkg/extensions" "$pkg/skills" "$pkg/prompts"
    echo '{}' > "$pkg/extensions/stub.json"
    echo '{}' > "$pkg/skills/stub.json"
    echo '{}' > "$pkg/prompts/stub.json"
    tar -czf "$WORK_DIR/versioned.tar.gz" -C "$WORK_DIR/versioned" .

    local out rc=0
    out="$(env \
        PATH="$WORK_DIR/bin:/usr/bin:/bin" \
        PIZZA_HOME="$WORK_DIR/target" \
        PIZZA_TARBALL_URL="file://$WORK_DIR/versioned.tar.gz" \
        bash "$INSTALL_SCRIPT" </dev/null 2>&1)" || rc=$?

    remove_mock curl
    remove_mock git

    if [ "$rc" -eq 0 ]; then
        pass "install succeeds via git fallback"
    else
        fail "should succeed" "exit $rc — $out"
    fi

    if echo "$out" | grep -q "Installing Pizza v0\.2\.0"; then
        pass "resolves to 0.2.0 (skips prereleases)"
    else
        fail "should resolve to 0.2.0" "output: $out"
    fi
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

# ── Runner ──────────────────────────────────────────────────────────────
main() {
    echo ""
    echo "install.sh smoke tests"
    echo "======================"

    setup
    trap teardown EXIT

    echo ""
    test_nontty_incompatible_pi_exits
    echo ""
    test_nontty_no_pi_skips_registration
    echo ""
    test_nontty_no_pi_no_npm_still_downloads
    echo ""
    test_node_version_floor
    echo ""
    test_missing_version_value
    echo ""
    test_stale_subagents_removed
    echo ""
    test_subagents_included_when_requested
    echo ""
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
