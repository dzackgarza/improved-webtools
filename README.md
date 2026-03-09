[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I2I57UKJ8)

# Improved Web Tools

OpenCode plugin that provides `webfetch` and `websearch` tools, including a FastMCP wrapper for the same logic.

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

### `webfetch`

Reads a webpage URL as plain text content.

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

Searches the web with optional category narrowing (e.g., news, npm, pypi, gh, science). Supports pagination via `offset` and `numResults`.

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
