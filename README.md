# 🍕 Pizza

**Pi with toppings** — my opinionated [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) setup, packaged as a set of extensions.

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

**`/loop`** — Run the agent in a loop until a condition is met.

```
/loop tests          # loop until tests pass
/loop custom <cond>  # loop until your condition is met
/loop self           # agent decides when it's done
```

**`/context`** — See context window usage, loaded skills, and session cost.

**`/todos`** — File-based task management with distributed locking. Interactive TUI for creating, searching, and claiming tasks across sessions.

**`--session-control`** — Inter-session messaging via Unix sockets.

```bash
pi --session-control
pi --control-session mybot --send-session-message "status update?"
```

**`/agents`**, **`/run`**, **`/chain`**, **`/parallel`** — Subagent delegation with async support, chains, and parallel execution.

**`/pizza`** — Version, model, and context at a glance.

### Credits

`/loop`, `/context`, `/todos`, and `--session-control` are from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff). Subagents are from [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents).

## 🛠️ Development

```bash
npm install
npm test
npm run typecheck
```

Test a single extension:

```bash
pi -e ./extensions/pizza-ui.ts
```

Test the full package locally:

```bash
pi install .
```

See the [Pi extension docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#extensions) for writing your own extensions.

### Release

```bash
make release VERSION=0.2.0
```

## 📄 License

Apache 2.0
