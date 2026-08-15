# improved-webtools repository workflows.
# The central QC implementation lives in ~/ai-review-ci/justfiles/bun.just.
# Project-specific installation, publishing, and live checks remain local.

ai_review_ci_schema_version := "1"
ai_review_ci_profile := "bun"
ai_review_ci_ref := "main"
ai_review_ci_release_channel := "main"
ai_review_ci_workflow_template_version := "1"
ai_review_ci_local_delegation := "global-justfile"
ai_review_ci_default_branch := "main"

# List available recipes.
default:
    @just --list

# Run commit-tier Bun and TypeScript QC.
test-commit:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-commit

# Run the full Bun test suite before pushing.
test-push:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-push

# Run CI acceptance QC.
test-ci:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci

# Set up npm trusted publishing manually.
setup-npm-trust:
    npm trust github --repository dzackgarza/{{file_stem(justfile_directory())}} --file publish.yml

# Publish from a local machine with 2FA.
publish:
    npm publish

# Install all project dependencies.
install: install-ts install-mcp

# Install TypeScript dependencies.
install-ts:
  bun install

# Install MCP server dependencies.
install-mcp:
  cd mcp-server && uv sync --dev

# Check TypeScript types.
typecheck:
  bunx tsc --noEmit

# Run TypeScript tests.
test:
  bun test

# Run MCP server tests.
mcp-test:
  cd mcp-server && uv run pytest

# Run local type and test checks.
check: typecheck test mcp-test

# Verify the live Reddit handler.
reddit-live-verify:
  bun scripts/verify-reddit-live.ts

# Verify the live YouTube handler.
youtube-live-verify:
  bun scripts/verify-youtube-live.ts
