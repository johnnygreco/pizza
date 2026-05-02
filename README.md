# 🍕 Pizza

**Pi with extra toppings** — an opinionated [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) setup, packaged as a set of extensions.

## 📦 Install

```bash
curl -fsSL https://raw.githubusercontent.com/johnnygreco/pizza/main/install.sh | bash
```

Requires Node.js >= 20.6 and Pi. Installs to `~/.pizza`.
Each Pizza release declares the minimum Pi version it supports. The installer
enforces that floor, and Pizza warns at session start only when Pi is older than it.

```bash
# Pin a specific version
curl -fsSL .../install.sh | bash -s -- --version 0.2.0

# Uninstall
curl -fsSL .../install.sh | bash -s -- --uninstall
```

Set `PIZZA_HOME` to change the install directory.

## 🧩 What's in the box

### Commands

**`/pizza`** — Pizza version, Pi compatibility, model, cwd, active theme, banner layout, and context at a glance.
  - `/pizza resources` — print the resources section using the same formatting as the banner.
  - `/pizza shortcuts` — print the shortcuts + prefixes section using the same formatting as the banner.
  - `/pizza help` — show quick usage.

**`/theme`** — Pick a theme interactively, or `/theme <name|next|prev>` to switch directly. Pizza's palette follows Pi's active theme.
  - `Ctrl+Q` — cycle theme forward

**`/create-subagent <description>`** — Generate a reviewable Pizza subagent draft, then run once, keep for session, save permanently, preview context, or cancel.

**`/subagents`** — Manage subagent definitions, running/recent runs, and the review inbox. Use the `subagent` tool action `activity` with a run id to inspect what a running subagent is currently doing.

**`/remove-subagent <name>`** — Remove a saved or session-scoped subagent. Builtins cannot be deleted.

**`:<agent-name> <prompt>`** — Shortcut syntax to run an existing subagent directly, e.g. `:reviewer review the current diff`. Use `:reviewer` to run with no explicit user prompt.
  - `:subagents` or `:agents list` — quick list of existing subagents.

### Extensions

Pizza now ships only its first-party extensions, including `pizza-subagents` for scoped delegation. Add third-party Pi extensions separately as you need them.

## 🛠️ Development

```bash
npm install          # dev deps (includes pi-coding-agent for types)

npm run typecheck
npm test             # vitest
make test-install    # install.sh smoke tests
make test-all        # vitest + install smoke tests
```

Test a single extension:

```bash
pi -e ./extensions/pizza-ui.ts
pi -e ./extensions/pizza-subagents
```

Test the full package locally:

```bash
pi install .
```

See [AGENTS.md](AGENTS.md) for architecture notes and the [Pi extension docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#extensions) for writing your own extensions.

### Release

```bash
make release VERSION=0.2.0
```

## 📄 License

Apache 2.0
