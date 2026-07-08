# Setup npm trusted publisher (one-time manual setup)
setup-npm-trust:
    npm trust github --repository dzackgarza/{{file_stem(justfile_directory())}} --file publish.yml

# Manual publish from local (requires 2FA)
publish:
    npm publish

# Install project dependencies and required external tools
setup:
    just install
    curl -fsSL https://apify.com/install-cli.sh | bash

install: install-ts install-mcp

install-ts:
  bun install

install-mcp:
  cd mcp-server && uv sync --dev

typecheck:
  bunx tsc --noEmit

test:
  bun test

mcp-test:
  cd mcp-server && uv run pytest

check: typecheck test mcp-test

reddit-live-verify:
  bun scripts/verify-reddit-live.ts

youtube-live-verify:
  bun scripts/verify-youtube-live.ts
