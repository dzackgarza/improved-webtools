# improved-webtools style and conventions

- Plugin entrypoint is `src/index.ts` with named plugin factory exports.
- Domain routing logic lives in `src/webfetch-handlers/domains/`; shared types/indexes stay under `src/webfetch-handlers/`.
- Tests use Bun (`bun test`) and favor real fixtures under `tests/fixtures/real` over mocks for handler behavior.
- The repo uses strict TypeScript via `tsc --noEmit`.
- User-facing tool descriptions are concise and agent-oriented.
- For arXiv handling, the plugin maintains a local artifact library under `~/.cache/opencode-arxiv-library` unless overridden by `WEBFETCH_ARXIV_LIBRARY_DIR`.