.PHONY: publish test typecheck

test:
	npm test

typecheck:
	npm run typecheck

publish:
ifndef VERSION
	$(error VERSION is required. Usage: make publish VERSION=0.2.0)
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
	@# Run tests
	npm test
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
	@# Create and push tag
	git tag "v$(VERSION)"
	git push origin main
	git push origin "v$(VERSION)"
	@# Cut GitHub release with auto-generated notes
	gh release create "v$(VERSION)" --generate-notes
	@echo ""
	@echo "Published v$(VERSION)"
