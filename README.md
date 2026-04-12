# 🍕 Pizza

Pi with toppings.

Pizza is [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) with toppings — a set of extensions that configure Pi into an opinionated coding agent.

## 📦 Install

```bash
pi install npm:pizza-pi
```

## 🧩 What's Included

| Extension | Description |
|-----------|-------------|
| 🍕 pizza-ui | Session banner, dynamic status line, `/pizza` command |
| 🔁 [loop](https://github.com/mitsuhiko/agent-stuff) | Autonomous agent loops with breakout conditions (`/loop`) |
| 📊 [context](https://github.com/mitsuhiko/agent-stuff) | Context window visualization and session token/cost tracking (`/context`) |
| 📝 [todos](https://github.com/mitsuhiko/agent-stuff) | File-based task management with distributed locking (`/todos`) |
| 📡 [control](https://github.com/mitsuhiko/agent-stuff) | Inter-session communication via Unix sockets (`--session-control`) |
| 🤖 [subagents](https://github.com/HazAT/pi-interactive-subagents) | Spawn and orchestrate sub-agents in multiplexer panes (`/plan`, `/iterate`) |

## 🛠️ Development

```bash
npm install
npm test
npm run typecheck
```

### 🧪 Test an extension

```bash
pi -e ./extensions/pizza-ui.ts
```

### 📋 Test the full package

```bash
pi install .
```

### ✏️ Write an extension

Add a `.ts` file to `extensions/`. Add a matching test in `test/extensions/`.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI): void {
  // ...
}
```
### 🔗 Include a third-party extension

Add it as a dependency and point the `pi` manifest at the package root so the loader resolves extensions from its own `pi` field:

```json
{
  "dependencies": {
    "some-pi-extension": "^1.0.0"
  },
  "pi": {
    "extensions": ["extensions", "node_modules/some-pi-extension"]
  }
}
```

If the dependency isn't published on npm (e.g. installed from GitHub), add it to `bundledDependencies` so `npm pack` includes it in the tarball:

```json
{
  "bundledDependencies": ["some-pi-extension"]
}
```

## 📄 License

Apache 2.0
