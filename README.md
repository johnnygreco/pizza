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

## Architecture

Pizza runs Pi in-process. It is not a fork, not a subprocess wrapper — it imports Pi's bootstrap directly and calls it with pizza's configuration.

**What pizza controls:**

- `--version` and `--help` — pizza intercepts these and shows its own branding
- Global config directory — `~/.pizza/` instead of `~/.pi/agent/` (override with `PIZZA_DIR`)
- Shipped extensions — always loaded via Pi's `-e` flag
- In-session UI — status bar, `/status` command, and any future extensions
- User extensions — discovered from `~/.pizza/extensions/`

**What Pi controls:**

- Everything else: session management, TUI, tools, model selection, arg parsing
- Project-local config still uses `.pi/` directories (Pi's namespace)
- Runtime strings (tool descriptions, model names) come from Pi

This is intentional. Pizza pushes Pi's extension system as far as it goes rather than reimplementing Pi's internals.

### Integration boundary

Pizza resolves Pi's internal `main.js` via `import.meta.resolve` — this path is not part of Pi's public exports. The `~` semver pin and an `existsSync` guard catch breakage from layout changes, but this is the most fragile point in the harness. If Pi ever exports `main()` publicly, pizza should switch to that.

### File layout

```
src/
├── cli.ts              # Entry point — sets process title, calls main()
├── main.ts             # Intercepts --version/--help, resolves Pi, injects extensions
├── config.ts           # VERSION (from package.json), paths, config dir
├── index.ts            # Public API
└── extensions/
    └── status.ts       # Shipped extension: status bar + /status command
```

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
