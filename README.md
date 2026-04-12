# 🍕 Pizza

Pi with toppings.

Pizza is [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) with some additional features. It's fully Pi-compatible — same extensions, tools, models, and workflows — with a few extras on top.

## Install

```bash
npm install -g pizza
```

Requires Node.js `>= 20.6.0`.

## Usage

```text
pizza [options] [@files...] [messages...]
```

Run `pizza --help` for the full command list.

On first run, authenticate with a provider:

```text
pizza
# then use /login inside the session
```

### Examples

```bash
# Start an interactive session
pizza

# One-shot prompt (non-interactive)
pizza -p "List all .ts files in src/"

# Attach files as context
pizza @prompt.md "Summarize this plan"

# Pick a model
pizza --model openai/gpt-4o "Help me refactor this code"

# Cycle between models with thinking levels
pizza --models sonnet:high,haiku:low

# Restrict tools
pizza --tools read,grep,find,ls -p "Review the code in src/"

# Continue or resume a session
pizza --continue "What did we discuss?"
pizza --resume
```

### Package Commands

```bash
pizza install <source> [-l]     # Install an extension
pizza remove <source> [-l]      # Remove an extension
pizza update [source]           # Update extensions
pizza list                      # List installed extensions
pizza config                    # Show configuration overview
```

Pass `-l` to install or remove from project-local settings instead of global.

## Configuration

Pizza keeps its config under `~/.pizza/` (override with `PIZZA_DIR`):

```text
~/.pizza/
├── extensions/       # Extensions
├── prompts/          # Prompt templates
├── skills/           # Skills
├── themes/           # Themes
├── auth.json         # Provider credentials
└── models.json       # Model configuration
```

Project-local `.pizza/` directories layer on top of global config. Pi's `.pi/` project settings still apply.

Run `pizza config` to see the full resolved configuration.

## Development

```bash
npm install
npm run build
npm test

# Run locally
node dist/cli.js --help
node dist/cli.js config
```

### File Layout

```text
src/
├── cli.ts                  # Binary entry point
├── app.ts                  # Bootstrap flow
├── args.ts                 # Argument parsing and help
├── runtime.ts              # Runtime and service creation
├── session-target.ts       # Session selection and fork/continue logic
├── model-selection.ts      # Model resolution and scoped-model handling
├── package-commands.ts     # install/remove/update/list/config commands
├── files.ts                # @file and stdin prompt assembly
├── diagnostics.ts          # Startup/runtime diagnostics
├── config.ts               # Version and path model
├── index.ts                # Public API
└── extensions/
    └── pizza-ui.ts         # /pizza and /status commands
```

## License

Apache 2.0
