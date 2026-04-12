# 🍕 Pizza

Pi with your personal toppings.

Pizza is a coding agent harness built on [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). It runs Pi's runtime with your own extensions, config, and tooling layered on top. Single npm install, one command.

## Install

```
npm install -g pizza
```

Requires Node.js >= 20.6.0.

## Usage

```
pizza [options] [messages...]
```

All of Pi's flags and commands work. Run `pizza --help` for the full list.

On first run, authenticate with a provider:

```
pizza
# then use /login inside the session
```

## How it works

🍕 Pizza is not a fork of Pi or a wrapper around it. It runs Pi's runtime in-process with its own identity:

- **Config directory**: `~/.pizza/` (override with `PIZZA_DIR`)
- **Shipped extensions**: loaded automatically via Pi's `-e` flag
- **User extensions**: discovered from `~/.pizza/extensions/`

```
src/
├── cli.ts              # Entry point — sets process title, calls main()
├── main.ts             # Resolves Pi's main(), injects shipped extensions
├── config.ts           # 🍕 Pizza identity: version, paths, config dir
├── index.ts            # Public API
└── extensions/
    └── status.ts       # Shipped extension: status bar + /status command
```

`cli.ts` sets `process.title = "pizza"` and points `PI_CODING_AGENT_DIR` to `~/.pizza`. `main.ts` resolves Pi's `main()` from the dependency, prepends shipped extensions as `-e` flags, and calls it. From there, Pi runs normally — session management, TUI, tools, model selection — all powered by Pi's core.

Customization happens through Pi extensions. Each extension gets full access to Pi's `ExtensionAPI`: lifecycle events, tool registration, commands, shortcuts, UI components, system prompt modification, and more. See [Pi's extension docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md).

## Development

```bash
npm install
npm run build
npm test

# Run locally
node dist/cli.js --help
```

## License

MIT
