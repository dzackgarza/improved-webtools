# FastMCP Server for improved-webtools

Wrapper that exposes `webfetch` and `websearch` tools via the Model Context Protocol.

## Installation

```bash
cd mcp-server
uv sync --dev
```

## Usage

### Run locally

```bash
cd mcp-server
uv run fastmcp run server.py
```

### Add to Qwen / Claude Desktop

```json
{
  "improved-webtools": {
    "command": "uv",
    "args": ["run", "fastmcp", "run", "server.py"],
    "cwd": "/home/dzack/opencode-plugins/improved-webtools/mcp-server"
  }
}
```

## Tools

### `webfetch`

Fetch URL content as plain text.

**Parameters:**

- `url` (required): URL to fetch (http/https only)

**Handles:**

- GitHub issues/PRs
- Reddit posts
- YouTube transcripts
- Wikipedia articles
- arXiv papers
- General web pages (via w3m)

### `websearch`

Search the web via SearxNG.

**Parameters:**

- `query` (required): Search query string
- `category` (optional): Category filter (news, it, npm, pypi, gh, hf, science, arx, etc.)
- `num_results` (optional): Results per page (1-20, default: 8)
- `offset` (optional): Pagination offset (0-200, default: 0)
- `recency` (optional): Recency in days (1=day, 31=month, 365=year)

## Environment Variables

Configure via `.envrc` in the project root:

- `SEARXNG_INSTANCE_URL`: SearxNG backend URL
- `WEBFETCH_CACHE_ENABLED`: Enable caching (default: 1)
- `WEBFETCH_CACHE_DIR`: Cache directory
- `WEBFETCH_CACHE_TTL_DAYS`: Cache TTL in days (default: 90)
- `REDDIT_APIFY_ACTOR`: Apify actor for Reddit scraping
- `WIKIPEDIA_API_USER_AGENT`: User agent for Wikipedia API

## Architecture

This wrapper:

1. Calls the shared `mcp-shim/run-tool.ts` executor to invoke TypeScript tools
2. Exposes tools via FastMCP without modifying original plugin code
3. Uses subprocess to execute TypeScript tools from Python

## Tests

```bash
cd mcp-server
uv run pytest tests/ -v
```
