---
name: push-pizza-release
description: Use when the user asks to cut or push a Pizza (pre-)release.
---

# Push Pizza Release

## Quick Reference

Release command: `make release VERSION=<version>` from repo root.
Repo: `https://github.com/johnnygreco/pizza`

## Steps

1. **Pre-flight checks** — run from repo root on a clean `main` branch. If dirty or wrong branch, stop and tell the user what to fix. Never stash, reset, or discard changes.

2. **Run the release** — `make release VERSION=<version>` using the user's exact version string (including prerelease suffixes like `0.0.2-rc6`). Let it finish end to end. If it fails, report the exact error and stop.

3. **Verify remotely** — after the push succeeds, confirm:
   - `origin/main` has the release commit
   - Tag `v<version>` exists remotely
   - The GitHub Release workflow completed successfully
   - The published release includes the `pizza-<version>.tar.gz` asset

4. **Report** — version, release commit SHA, release URL, artifact URL, and whether the worktree is clean.

## What `make release` Does

Requires branch `main` and clean worktree. Runs `npm test`, `bash test/install.test.sh`, `npm run typecheck`. Fails if tag `v<version>` exists. Bumps `package.json`/`package-lock.json` via `npm version` if needed, commits as `v<version>`, creates tag `v<version>`, pushes branch and tag.

CI (`.github/workflows/release.yml`) validates the tag against `package.json`, reruns tests, builds `pizza-<version>.tar.gz`, and publishes the GitHub release. Tags containing `-` are marked as prereleases.

## Useful Commands

```bash
# Local state
git status --short
git branch --show-current
git tag --list | tail -20
git log --oneline --decorate -5

# Remote verification
curl -fsSL 'https://api.github.com/repos/johnnygreco/pizza/actions/runs?per_page=5'
curl -fsSL 'https://api.github.com/repos/johnnygreco/pizza/releases/tags/v<version>'
```

Release page: `https://github.com/johnnygreco/pizza/releases/tag/v<version>`
Artifact: `https://github.com/johnnygreco/pizza/releases/download/v<version>/pizza-<version>.tar.gz`

## Guardrails

- This is a publishing action — avoid unrelated edits once release work begins.
- Do not create, delete, or retarget tags unless the user explicitly asks.
- Do not assume the release published just because the tag push succeeded — verify via GitHub API.
- If the workflow is still pending, say so and include the workflow URL.
