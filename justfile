repo_root := justfile_directory()

justfile-hygiene:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ -e "{{repo_root}}/Justfile" ]; then
    echo "Remove Justfile; use lowercase justfile as the single canonical entrypoint." >&2
    exit 1
  fi

install: install-ts install-mcp

install-ts:
  direnv exec "{{repo_root}}" bun install

install-mcp:
  direnv exec "{{repo_root}}" sh -lc 'cd mcp-server && uv sync --dev'

typecheck:
  direnv exec "{{repo_root}}" bunx tsc --noEmit

test:
  direnv exec "{{repo_root}}" bun test

mcp-test:
  direnv exec "{{repo_root}}" sh -lc 'cd mcp-server && uv run pytest'

check: justfile-hygiene typecheck test mcp-test

reddit-live-verify:
  direnv exec "{{repo_root}}" bun scripts/verify-reddit-live.ts

youtube-live-verify:
  direnv exec "{{repo_root}}" bun scripts/verify-youtube-live.ts

setup-npm-trust:
  #!/usr/bin/env bash
  set -euo pipefail
  npm trust github --repository "dzackgarza/$(basename "{{repo_root}}")" --file publish.yml

publish: check
  direnv exec "{{repo_root}}" npm publish
