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
