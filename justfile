set fallback := true
repo_root := justfile_directory()
bun_qc_justfile := env_var("OPENCODE_BUN_QC_JUSTFILE")

default:
  @just test

justfile-hygiene:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ -e "{{repo_root}}/Justfile" ]; then
    echo "Remove Justfile; use lowercase justfile as the single canonical entrypoint." >&2
    exit 1
  fi

install: justfile-hygiene
  direnv exec "{{repo_root}}" bun install

[private]
_typecheck: justfile-hygiene
  direnv exec "{{repo_root}}" bunx tsc --noEmit

[private]
_quality-control: justfile-hygiene
  #!/usr/bin/env bash
  set -euo pipefail
  just --justfile "{{bun_qc_justfile}}" --working-directory "{{repo_root}}" _biome
  just --justfile "{{bun_qc_justfile}}" --working-directory "{{repo_root}}" _semgrep
  exec just --justfile "{{bun_qc_justfile}}" --working-directory "{{repo_root}}" _lizard

[private]
_integration-tests: justfile-hygiene
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{repo_root}}"
  exec direnv exec "{{repo_root}}" bun test tests/integration

typecheck: justfile-hygiene _typecheck

test: justfile-hygiene _typecheck _quality-control _integration-tests

check: test

# Setup npm trusted publisher (one-time manual setup)
setup-npm-trust:
  #!/usr/bin/env bash
  set -euo pipefail
  npm trust github --repository "dzackgarza/$(basename "{{repo_root}}")" --file publish.yml

# Manual publish from local (requires 2FA)
publish: check
  direnv exec "{{repo_root}}" npm publish

# Bump patch version, commit, and tag
bump-patch:
    npm version patch --no-git-tag-version
    git add package.json
    git commit -m "chore: bump version to v$(node -p 'require(\"./package.json\").version')"
    git tag "v$(node -p 'require(\"./package.json\").version')"

# Bump minor version, commit, and tag
bump-minor:
    npm version minor --no-git-tag-version
    git add package.json
    git commit -m "chore: bump version to v$(node -p 'require(\"./package.json\").version')"
    git tag "v$(node -p 'require(\"./package.json\").version')"

# Push commits and tags to trigger CI release
release: check
    git push && git push --tags
