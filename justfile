# Setup npm trusted publisher (one-time manual setup)
setup-npm-trust:
    npm trust github --repository dzackgarza/{{file_stem(justfile_directory())}} --file publish.yml

# Manual publish from local (requires 2FA)
publish:
    npm publish

install: install-ts install-mcp bundle-bridge

install-ts:
  bun install

install-mcp:
  cd mcp-server && uv sync --dev

bundle-bridge:
  mkdir -p mcp-server/src/improved_webtools/vendor
  bun build ./src/bridge.ts --target bun --outfile ./mcp-server/src/improved_webtools/vendor/improved-webtools-bridge.mjs
  cp ./scripts/wikipedia_html_to_markdown.py ./mcp-server/src/improved_webtools/vendor/wikipedia_html_to_markdown.py

typecheck:
  bunx tsc --noEmit

test:
  bun test

mcp-test: bundle-bridge
  cd mcp-server && uv run pytest

check: typecheck test mcp-test

reddit-live-verify:
  bun scripts/verify-reddit-live.ts

youtube-live-verify:
  bun scripts/verify-youtube-live.ts
