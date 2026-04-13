# 🍕 Pizza

**Pi with toppings.**

Pizza is a set of extensions for [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) that turn it into a batteries-included coding agent. You get autonomous loops, context tracking, task management, multi-session control, and a nice status line — all out of the box.

## 📦 Install

```bash
curl -fsSL https://raw.githubusercontent.com/johnnygreco/pizza/main/install.sh | bash
```

This checks for Node.js (>= 20.6) and Pi, then sets everything up at `~/.pizza`.

Start a new Pi session and you're good to go.

### Options

```bash
# Pin a specific version
curl -fsSL .../install.sh | bash -s -- --version 0.2.0

# Uninstall
curl -fsSL .../install.sh | bash -s -- --uninstall
```

Set `PIZZA_HOME` to change the install directory (default: `~/.pizza`).

## 🧩 What You Get

### `/loop` — Autonomous agent loops

Run the agent in a loop until a condition is met. Great for "keep going until the tests pass" workflows.

```
/loop tests          # loop until tests pass
/loop custom <cond>  # loop until your condition is met
/loop self           # agent decides when it's done
/loop                # interactive picker
```

### `/context` — Context window dashboard

See how much of the context window you're using, what's loaded, and how much the session has cost so far.

```
/context
```

Shows a visual breakdown: system prompt, tools, conversation, loaded skills, project context files, and a running token/cost total.

### `/todos` — Task management

File-based todo lists stored in `~/.pi/todos/`. Supports distributed locking so multiple sessions can safely share tasks.

```
/todos
```

Opens an interactive TUI — create, search, claim, close, and delete tasks. The agent can also use the `todos` tool directly to manage tasks programmatically.

### `/pizza` — Session info

Quick look at the current Pizza version, model, and context usage.

### `--session-control` — Multi-session communication

Start Pi with `--session-control` to enable inter-session messaging via Unix sockets. Sessions can send messages to each other, get summaries, or subscribe to events.

```bash
pi --session-control                              # enable for this session
pi --control-session mybot --send-session-message "status update?"  # message another session
```

The agent also gets a `send_to_session` tool for programmatic cross-session communication.

### `/plan` and `/iterate` — Subagents

Spawn and orchestrate sub-agents in multiplexer panes. Plan complex tasks across multiple agents, then iterate on the results.

## 🛠️ Development

```bash
npm install
npm test
npm run typecheck
```

### Test a single extension

```bash
pi -e ./extensions/pizza-ui.ts
```

### Test the full package locally

```bash
pi install .
```

### Write an extension

Add a `.ts` file to `extensions/` and a matching test in `test/extensions/`.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI): void {
  // ...
}
```

### Release

```bash
make release VERSION=0.2.0
```

Bumps version, commits, tags, and pushes. CI creates the GitHub release.

## 📄 License

Apache 2.0
