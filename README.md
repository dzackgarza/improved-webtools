
# Improved Web Tools

OpenCode plugin that shadows the built-in `webfetch` and `websearch` tools. It also
includes a FastMCP wrapper for the same logic.

## Installation

Install dependencies and set up the project:

```bash
cd ./improved-webtools
just install
```

Register the published plugin in OpenCode:

```json
{
  "plugin": [
    "@dzackgarza/improved-webtools@git+https://github.com/dzackgarza/improved-webtools.git"
  ]
}
```

Repo-root [`opencode.json`](./opencode.json) is the canonical proof config for local and CI runs. CI starts `opencode serve` from the repo root and relies on standard global-plus-project config precedence.

Default tool ids are the real shadowing path:
- `webfetch`
- `websearch`

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
- `overwrite_cache?`: (boolean) Set to `true` to bypass cached results and force a fresh fetch.

**Special Handling:**

- **ArXiv**: Routes `arxiv.org` URLs through a local artifact library. The library stores PDFs, source archives, BibTeX, and markdown conversions.
- **Cache**: `overwrite_cache: true` rebuilds local artifact directories for ArXiv URLs.

**Environment Variables:**

- `WEBFETCH_ARXIV_LIBRARY_DIR`: Overrides the default artifact root at `~/.cache/opencode-arxiv-library`
- `REDDIT_APIFY_ACTOR`: Optionally overrides the Reddit actor used for live verification and handler calls
- `YTDLP_COOKIES_FILE`: Optionally points at a Netscape-format cookie jar for `yt-dlp` when YouTube bot-checks gate spoken/informational videos
- `YOUTUBE_VERIFY_TIMEOUT_MS`: Optionally increases the per-command timeout used by `just youtube-live-verify` on slow CPU hosts during Whisper transcription

### `websearch`

Searches the web with optional category narrowing (e.g., news, npm, pypi, gh, science).
Supports pagination via `offset` and `num_results`. In debug mode the same behavior is
exposed as `websearch_debug`.

## Dependencies

- **Runtime**: Bun, `@opencode-ai/plugin`, `js-tiktoken`
- **Commands**: `gh`, `w3m`, `curl`
- **Handlers**: `yt-dlp`, `uvx`, Apify CLI (for Reddit)
- **MCP**: Python 3.11+, `uv`, `fastmcp`

## Development

Run checks and tests:

```bash
direnv allow .
just typecheck
just test
```

CI is the canonical proof environment. For local debugging, start a repo-local OpenCode server from this checkout, set `OPENCODE_BASE_URL`, and then run the same `just` entrypoints.
