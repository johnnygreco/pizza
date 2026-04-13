.PHONY: help setup test test-install test-all typecheck release

SUBAGENTS_REPO = https://github.com/nicobailon/pi-subagents.git
SUBAGENTS_COMMIT = 9d1e88b2d9e48bc59503814fd443850341f74907

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Clone subagents extension for local development
	@if [ -d subagents ]; then \
		echo "subagents/ already exists. To update: rm -rf subagents && make setup"; \
	else \
		git clone $(SUBAGENTS_REPO) subagents; \
		git -C subagents checkout $(SUBAGENTS_COMMIT); \
		echo "Subagents extension cloned to subagents/"; \
	fi

test: ## Run unit tests (vitest)
	npm test

test-install: ## Run install.sh smoke tests
	bash test/install.test.sh

test-all: ## Run all tests (unit + install smoke tests)
	npm test
	bash test/install.test.sh

typecheck: ## Run TypeScript type checking
	npm run typecheck

release: ## Tag and push a release (VERSION=x.y.z required)
ifndef VERSION
	$(error VERSION is required. Usage: make release VERSION=0.2.0)
endif
	@# Ensure we're on main
	@BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$BRANCH" != "main" ]; then \
		echo "Error: must be on main branch (currently on $$BRANCH)"; \
		exit 1; \
	fi
	@# Ensure working tree is clean
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Error: uncommitted changes detected. Commit or stash them first."; \
		exit 1; \
	fi
	@# Run all tests and typecheck
	$(MAKE) test-all
	$(MAKE) typecheck
	@# Check if tag already exists
	@TAG="v$(VERSION)"; \
	if git rev-parse "$$TAG" >/dev/null 2>&1; then \
		echo "Error: tag $$TAG already exists."; \
		echo "To delete it locally and remotely, run:"; \
		echo "  git tag -d $$TAG && git push origin :refs/tags/$$TAG"; \
		exit 1; \
	fi
	@# Update version in package.json and commit (skip if already correct)
	@CURRENT=$$(node -p "require('./package.json').version"); \
	if [ "$$CURRENT" != "$(VERSION)" ]; then \
		npm version $(VERSION) --no-git-tag-version; \
		git add package.json package-lock.json; \
		git commit -m "v$(VERSION)"; \
	fi
	@# Create and push tag (CI creates the GitHub release)
	git tag "v$(VERSION)"
	git push origin main
	git push origin "v$(VERSION)"
	@echo ""
	@echo "Tag v$(VERSION) pushed. CI will create the GitHub release."
