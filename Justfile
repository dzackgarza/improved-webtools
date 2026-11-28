
ai_review_ci_schema_version := "1"
ai_review_ci_profile := "bun"
ai_review_ci_ref := "main"
ai_review_ci_release_channel := "main"
ai_review_ci_workflow_template_version := "1"
ai_review_ci_local_delegation := "global-justfile"
ai_review_ci_default_branch := "main"

[doc("List available recipes.")]
default:
    @just --list

[doc("Run commit-tier Bun and TypeScript QC.")]
test-commit:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-commit

[doc("Run the full Bun test suite before pushing.")]
test-push:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-push

[doc("Run CI acceptance QC.")]
test-ci:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci

[doc("Set up npm trusted publishing manually.")]
setup-npm-trust:
    npm trust github --repository dzackgarza/{{file_stem(justfile_directory())}} --file publish.yml

[doc("Publish from a local machine with 2FA.")]
publish:
    npm publish

[doc("Install all project dependencies.")]
install: install-ts install-mcp

[doc("Install TypeScript dependencies.")]
install-ts:
  bun install

[doc("Install MCP server dependencies.")]
install-mcp:
  cd mcp-server && uv sync --dev

[doc("Check TypeScript types.")]
typecheck:
  bunx tsc --noEmit

[doc("Run TypeScript tests.")]
test:
  bun test

[doc("Run MCP server tests.")]
mcp-test:
  cd mcp-server && uv run pytest

[doc("Run local type and test checks.")]
check: typecheck test mcp-test

[doc("Verify the live Reddit handler.")]
reddit-live-verify:
  bun scripts/verify-reddit-live.ts

[doc("Verify the live YouTube handler.")]
youtube-live-verify:
  bun scripts/verify-youtube-live.ts

[doc("Run the scheduled whole-tree audit (semgrep and debt scans) through the central implementation.")]
ambient:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . ambient
