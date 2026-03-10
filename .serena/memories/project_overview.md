# improved-webtools overview

- Purpose: OpenCode plugin that provides `webfetch` and `websearch`, plus a FastMCP wrapper exposing the same logic.
- Tech stack: TypeScript/Bun for the plugin, Python/uv/FastMCP for the MCP wrapper.
- Key runtime dependencies: `@opencode-ai/plugin`, `js-tiktoken`, external commands `gh`, `w3m`, `curl`, plus handler-specific tools such as `yt-dlp`, `uvx`, and Apify CLI access for Reddit.
- Structure:
  - `src/index.ts`: main plugin entrypoint and tool definitions.
  - `src/webfetch-handlers/domains/*.ts`: domain-specific webfetch routing for arXiv, GitHub, Reddit, Wikipedia, YouTube.
  - `tests/unit/*.test.ts`: main Bun unit/regression tests.
  - `tests/integration/webtools-plugin.test.ts`: integration coverage.
  - `mcp-server/`: Python FastMCP wrapper with its own pytest suite.
- Local config pattern: repo contains `.config/opencode.json` and `.envrc` for local OpenCode verification.