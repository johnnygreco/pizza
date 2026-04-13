# Pizza

Pi with toppings.

Pizza is [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) with toppings — a set of extensions that configure Pi into an opinionated coding agent.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/johnnygreco/pizza/main/install.sh | bash
```

This will check for Node.js, install [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) if needed, and set up Pizza.

### Options

```bash
# Install with the subagents extension (/plan, /iterate)
curl -fsSL .../install.sh | bash -s -- --with subagents

# Install a specific version
curl -fsSL .../install.sh | bash -s -- --version 0.2.0

# Uninstall
curl -fsSL .../install.sh | bash -s -- --uninstall
```

Set `PIZZA_HOME` to change the install directory (default: `~/.pizza`).

## What's Included

| Extension | Description |
|-----------|-------------|
| pizza-ui | Session banner, dynamic status line, `/pizza` command |
| [loop](https://github.com/mitsuhiko/agent-stuff) | Autonomous agent loops with breakout conditions (`/loop`) |
| [context](https://github.com/mitsuhiko/agent-stuff) | Context window visualization and session token/cost tracking (`/context`) |
| [todos](https://github.com/mitsuhiko/agent-stuff) | File-based task management with distributed locking (`/todos`) |
| [control](https://github.com/mitsuhiko/agent-stuff) | Inter-session communication via Unix sockets (`--session-control`) |
| [subagents](https://github.com/HazAT/pi-interactive-subagents) | Spawn and orchestrate sub-agents in multiplexer panes (`/plan`, `/iterate`) — install with `--with subagents` |

## Development

```bash
npm install
npm test
npm run typecheck
```

### Test an extension

```bash
pi -e ./extensions/pizza-ui.ts
```

### Test the full package

```bash
pi install .
```

### Write an extension

Add a `.ts` file to `extensions/`. Add a matching test in `test/extensions/`.

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

This bumps the version, commits, tags, and pushes. CI creates the GitHub release.

## License

Apache 2.0
