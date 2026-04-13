.PHONY: release setup test typecheck

SUBAGENTS_REPO = https://github.com/HazAT/pi-interactive-subagents.git
SUBAGENTS_COMMIT = bf4fb961c14567c949e010dca5ec01590b08289a

setup:
	@if [ -d subagents ]; then \
		echo "subagents/ already exists. To update: rm -rf subagents && make setup"; \
	else \
		git clone $(SUBAGENTS_REPO) subagents; \
		git -C subagents checkout $(SUBAGENTS_COMMIT); \
		echo "Subagents extension cloned to subagents/"; \
	fi

test:
	npm test

typecheck:
	npm run typecheck

release:
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
	@# Run tests and typecheck
	npm test
	npm run typecheck
	@# Check if tag already exists
	@TAG="v$(VERSION)"; \
	if git rev-parse "$$TAG" >/dev/null 2>&1; then \
		echo "Error: tag $$TAG already exists."; \
		echo "To delete it locally and remotely, run:"; \
		echo "  git tag -d $$TAG && git push origin :refs/tags/$$TAG"; \
		exit 1; \
	fi
	@# Update version in package.json and commit
	npm version $(VERSION) --no-git-tag-version
	git add package.json package-lock.json
	git commit -m "v$(VERSION)"
	@# Create and push tag (CI creates the GitHub release)
	git tag "v$(VERSION)"
	git push origin main
	git push origin "v$(VERSION)"
	@echo ""
	@echo "Tag v$(VERSION) pushed. CI will create the GitHub release."
