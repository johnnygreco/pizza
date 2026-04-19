# AGENTS.md

## What Pizza is

Pizza is a curated collection of extensions for [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), a flexible coding agent. Pi ships as a minimal core with a first-class extension API; Pizza uses that API to turn Pi into a more opinionated, batteries-included coding agent ("Pi with extra toppings").

- Pi is the host. Pizza never forks or patches Pi — it only registers extensions, skills, prompts, agent definitions, and themes through Pi's public interfaces.
- Pizza bundles third-party extensions (`subagents` from `nicobailon/pi-subagents`, commands adapted from `mitsuhiko/agent-stuff`) alongside first-party ones. The distribution is the product.
- Pi compatibility is a hard constraint. `package.json` → `pizza.compatibility.pi` declares the supported range; runtime checks warn if Pi drifts outside it. Keep it honest when APIs change.

## How users consume Pizza

Users don't clone the repo. They run `install.sh` against a GitHub release tarball:

```bash
curl -fsSL https://raw.githubusercontent.com/johnnygreco/pizza/main/install.sh | bash
```

The installer downloads a release to `$PIZZA_HOME` (default `~/.pizza`), pulls in vendored third-party extensions at pinned revisions, wires everything into Pi's expected locations, and registers the package with `pi install`. `--uninstall` reverses all of it.

What this means during development:

- **`install.sh` is load-bearing and the source of truth for the install surface.** Anything placed, linked, or configured outside `$PIZZA_HOME` goes through it, and every install step has a matching undo path. When adding a new category of installed artifact, mirror the pattern: install step, clean step, ownership check before clobbering user-owned files. Update `test/install.test.sh` alongside.
- **Only what ships in the release tarball reaches users.** `.github/workflows/release.yml` defines what gets bundled; everything else (`test/`, `Makefile`, configs, `node_modules/`) is development-only. Adding a new top-level directory that users need means updating that workflow.
- **Registration wiring lives in `package.json` → `pi.extensions` / `pi.skills` / `pi.prompts`.** Agents are wired up separately via symlinks in `install.sh`.
- **Extensions are `.ts` loaded by Pi's jiti runtime — no build step.** Edit and run.
- **Vendored extensions (e.g. `subagents/`) are fetched at install time, not committed.** Use `make setup` to pull them locally when you need them.

## Development workflow

Setup:

```bash
npm install        # dev deps, including pi-coding-agent for types
make setup         # clone pinned subagents/ for local iteration (optional)
```

Iterate:

```bash
pi -e ./extensions/<name>.ts      # load a single extension into a Pi session
pi install .                       # install the whole package locally, as users would
```

Quality gates (all three also run in CI via `.github/workflows/ci.yml`):

```bash
npm run typecheck
npm test                # vitest, unit tests under test/
make test-install       # install.sh smoke tests (test/install.test.sh)
make test-all           # vitest + install smoke tests
```

Shell logic in `install.sh` is not covered by vitest — run `make test-install` when touching it.

Release (maintainer-only):

```bash
make release VERSION=0.2.0
```

Enforces a clean `main`, runs `test-all` + `typecheck`, bumps `package.json`, commits, tags `v<VERSION>`, and pushes. `.github/workflows/release.yml` then re-validates, builds the tarball, and publishes the GitHub Release that `install.sh` downloads. Tags containing `-` (e.g. `v0.2.0-rc1`) publish as prereleases.

Bumping the supported Pi range means updating both `devDependencies["@mariozechner/pi-coding-agent"]` and `pizza.compatibility.pi` in `package.json`, then running the quality gates to confirm the compatibility-check logic still behaves.
