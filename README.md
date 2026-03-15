# Improved Web Tools

CLI-first web fetch and web search for OpenCode.

The standalone CLI is the product surface. The OpenCode plugin and the FastMCP server are thin adapters over the same canonical implementation.

## Quick Start

Install repo-local dependencies and build the vendored bridge bundle:

```bash
just install
```

Run the CLI locally:

```bash
uv run --directory mcp-server improved-webtools doctor
uv run --directory mcp-server improved-webtools search "openai" --num-results 3
uv run --directory mcp-server improved-webtools fetch https://example.com
```

Run the packaged CLI directly with `uvx`:

```bash
uvx --from git+https://github.com/dzackgarza/opencode-plugin-improved-webtools.git#subdirectory=mcp-server improved-webtools doctor
```

## Commands

- `fetch <url>` reads a page as readable text and routes supported domains through specialized handlers.
- `search <query>` queries SearXNG with optional category, domain, offset, and recency controls.
- `doctor` checks config and required local commands before you debug a failing fetch or search.

Run `improved-webtools --help` or `improved-webtools <command> --help` for focused help.

## Setup

Required:

- `bun` on `PATH`
- `SEARXNG_INSTANCE_URL` for `search`

Common command dependencies:

- `curl` and `w3m` for default `fetch`
- `gh` for GitHub URLs
- `apify` for Reddit URLs
- `uvx` for Wikipedia and YouTube handlers

Optional environment variables:

- `WEBFETCH_CACHE_ENABLED`
- `WEBFETCH_CACHE_DIR`
- `WEBFETCH_CACHE_TTL_DAYS`
- `WEBFETCH_ARXIV_LIBRARY_DIR`
- `REDDIT_APIFY_ACTOR`
- `WIKIPEDIA_API_USER_AGENT`
- `YTDLP_COOKIES_FILE`
- `YOUTUBE_VERIFY_TIMEOUT_MS`

The CLI fails fast with setup messages when a required command or config value is missing.

## OpenCode Plugin

Register the plugin with OpenCode after the CLI is working:

```json
{
  "plugin": [
    "file:///abs/path/to/opencode-plugin-improved-webtools/src/index.ts"
  ]
}
```

Default tool ids:

- `webfetch`
- `websearch`

Manual debug mode exports non-shadowing aliases instead:

- `webfetch_debug`
- `websearch_debug`

Enable debug mode locally with:

```bash
export IMPROVED_WEBTOOLS_DEBUG_MODE="1"
export OPENCODE_CONFIG="$PWD/.config/opencode.debug.json"
```

## MCP Server

Run locally:

```bash
uv run --directory mcp-server improved-webtools-mcp
```

Register remotely with `uvx`:

```json
{
  "mcp": {
    "improved-webtools": {
      "type": "local",
      "command": [
        "uvx",
        "--from",
        "git+https://github.com/dzackgarza/opencode-plugin-improved-webtools.git#subdirectory=mcp-server",
        "improved-webtools-mcp"
      ]
    }
  }
}
```

## Validation

Run the full repo check from the canonical automation entrypoint:

```bash
just --justfile justfile check
```
