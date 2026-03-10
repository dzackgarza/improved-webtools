
# Improved Web Tools

OpenCode plugin that shadows the built-in `webfetch` and `websearch` tools. It also
includes a FastMCP wrapper for the same logic.

## Installation

Install dependencies and set up the project:

```bash
cd /home/dzack/opencode-plugins/improved-webtools
just install
```

Register the plugin in OpenCode via `file:`:

```json
{
  "plugin": [
    "file:///home/dzack/opencode-plugins/improved-webtools/src/index.ts"
  ]
}
```

Sample local configuration: [`improved-webtools/.config/opencode.json`](./.config/opencode.json)

Default local mode is the real shadowing path:
- `webfetch`
- `websearch`

Manual debug mode exports non-shadowing aliases instead:
- `webfetch_debug`
- `websearch_debug`

To enable debug mode locally:

```bash
export IMPROVED_WEBTOOLS_DEBUG_MODE="1"
export OPENCODE_CONFIG="$PWD/.config/opencode.debug.json"
```

### MCP Installation

Add the MCP server to your configuration:

```json
{
  "mcp": {
    "improved-webtools": {
      "type": "local",
      "command": [
        "uvx",
        "--from",
        "git+https://github.com/dzack/opencode-plugins#subdirectory=improved-webtools/mcp-server",
        "improved-webtools-mcp"
      ]
    }
  }
}
```

## Tools

### Default tool ids

- `webfetch`
- `websearch`

### Debug-only tool ids

- `webfetch_debug`
- `websearch_debug`

### `webfetch`

Reads a webpage URL as plain text content. In debug mode the same behavior is exposed as
`webfetch_debug`.

**Parameters:**

- `url`: (string) The URL to fetch.
- `prompt?`: (string) Optional prompt for extraction.
- `cacheMode?`: `"default" | "refresh"` - Use `"refresh"` to bypass cached results and force a fresh fetch.

**Special Handling:**

- **ArXiv**: Routes `arxiv.org` URLs through a local artifact library. The library stores PDFs, source archives, BibTeX, and markdown conversions.
- **Cache**: `cacheMode: "refresh"` rebuilds local artifact directories for ArXiv URLs.

**Environment Variables:**

- `WEBFETCH_ARXIV_LIBRARY_DIR`: Overrides the default artifact root (`~/.cache/opencode-arxiv-library`).

### `websearch`

Searches the web with optional category narrowing (e.g., news, npm, pypi, gh, science).
Supports pagination via `offset` and `numResults`. In debug mode the same behavior is
exposed as `websearch_debug`.

## Dependencies

- **Runtime**: Bun, `@opencode-ai/plugin`, `js-tiktoken`
- **Commands**: `gh`, `w3m`, `curl`
- **Handlers**: `yt-dlp`, `uvx`, Apify CLI (for Reddit)
- **MCP**: Python 3.11+, `uv`, `fastmcp`

## Development

Run checks and tests:

```bash
just typecheck
just test
just mcp-test
```
