[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I2I57UKJ8)


# Improved Web Tools

OpenCode plugin that shadows the built-in `webfetch` and `websearch` tools. It also
includes a FastMCP wrapper for the same logic.

## Installation

Install dependencies and set up the project:

```bash
cd ./improved-webtools
just install
```

Register the plugin in OpenCode via `file:`:

```json
{
  "plugin": [
    "file:///path/to/improved-webtools/src/index.ts"
  ]
}
```

Sample local configuration: [`improved-webtools/.config/opencode.json`](./.config/opencode.json)
Sample local MCP configuration: [`improved-webtools/.config/opencode.mcp.json`](./.config/opencode.mcp.json)

> [!WARNING]
> Using `git+` with local git repositories (e.g., `git+file://`, local `git+ssh://`) is NOT supported and will not work. Always use the `file://` directive for local development.

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
        "git+https://github.com/dzackgarza/opencode-improved-webtools-plugin.git#subdirectory=mcp-server",
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
just typecheck
just test
just mcp-test
just reddit-live-verify
YTDLP_COOKIES_FILE=/abs/path/to/youtube.cookies just youtube-live-verify
```

`just reddit-live-verify` runs the live Reddit handler against the configured Apify actor and proves the nested-comment render path without making the default Bun suite depend on live Apify access.

`just youtube-live-verify` preflights `uvx`, `yt-dlp` via `uvx`, and `openai-whisper` via `uvx` before running a caption-backed TED proof, a no-subtitles Whisper proof, and an invalid-video failure check. On CPU-only hosts, the Whisper leg can take several minutes; set `YOUTUBE_VERIFY_TIMEOUT_MS` higher if it times out before transcription completes.
