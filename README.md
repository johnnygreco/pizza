# 🍕 Pizza

**Pi with extra toppings** — an opinionated [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) setup, packaged as a set of extensions.

## 📦 Install

```bash
curl -fsSL https://raw.githubusercontent.com/johnnygreco/pizza/main/install.sh | bash
```

Requires Node.js >= 20.6 and Pi. Installs to `~/.pizza`.
Each Pizza release declares the Pi range it supports. The installer enforces that
range, and Pizza warns at session start if Pi is later upgraded past it.

```bash
# Pin a specific version
curl -fsSL .../install.sh | bash -s -- --version 0.2.0

# Uninstall
curl -fsSL .../install.sh | bash -s -- --uninstall
```

Set `PIZZA_HOME` to change the install directory.

## 🧩 What's in the box

### Commands

**`/context`** — See context window usage, loaded skills, and session cost.

**`/todos`** — File-based task management with distributed locking. Interactive TUI for creating, searching, and claiming tasks across sessions.

**`--session-control`** — Inter-session messaging via Unix sockets.

```bash
pi --session-control
pi --control-session mybot --send-session-message "status update?"
```

**`/run`**, **`/parallel`** — Subagent delegation with async support and parallel execution.

**`/pizza`** — Pizza version, Pi compatibility, model, cwd, active theme, banner section states, and context at a glance.
  - `/pizza resources [toggle|expand|collapse]` — control the resources section of the banner.
  - `/pizza shortcuts [toggle|expand|collapse]` — control the shortcuts + prefixes section of the banner.
  - `/pizza help` — show quick usage.

**`/theme`** — Pick a theme interactively, or `/theme <name>` to switch directly. Pizza's palette follows Pi's active theme.
  - `Ctrl+X` — cycle theme forward
  - `Ctrl+Q` — cycle theme backward

### Credits

`/context`, `/todos`, and `--session-control` are from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff). Subagents are from [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents).

## 🛠️ Development

```bash
npm install          # dev deps (includes pi-coding-agent for types)
make setup           # clone vendored subagents/ for local iteration (optional)

npm run typecheck
npm test             # vitest
make test-install    # install.sh smoke tests
make test-all        # vitest + install smoke tests
```

Test a single extension:

```bash
pi -e ./extensions/pizza-ui.ts
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
