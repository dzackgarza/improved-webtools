# improved-webtools

OpenCode plugin that provides `webfetch`, `websearch`, and the OpenCode-visible alias `improved_websearch`, plus a FastMCP wrapper for the same search/fetch logic.

## Install

```bash
cd /home/dzack/opencode-plugins/improved-webtools
just install
```

OpenCode plugin registration via `file:`:

```json
{
  "plugin": [
    "file:///home/dzack/opencode-plugins/improved-webtools/src/index.ts"
  ]
}
```

Sample local config: [`improved-webtools/.config/opencode.json`](/home/dzack/opencode-plugins/improved-webtools/.config/opencode.json)

MCP install:

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

## Tool Names

### `webfetch`

Description shown to the agent:

```text
Use when you need to read a webpage URL as plain text content.
```

Schema:

```text
url: string
prompt?: string
```

### `websearch`

Description shown to the agent:

```text
Use when you need to search the web. Optional categories for narrowing only: news, it, npm, pypi, st, gh, hf, ollama, hn, science, arx, cr, gos, se, aa, lg. Use offset and numResults to paginate.
```

### `improved_websearch`

Same description, schema, and runtime behavior as `websearch`.

This alias exists because the current OpenCode build suppresses a plugin tool named
`websearch` from the agent-visible tool list even though the plugin loads correctly.

Schema:

```text
query: string
category?: string
numResults?: number
num_results?: number
offset?: number
recency?: number
domains?: string[]
search_query?: Array<{
  q: string
  category?: string
  num_results?: number
  numResults?: number
  offset?: number
  recency?: number
  domains?: string[]
}>
```

## Dependencies

- Runtime: Bun, `@opencode-ai/plugin`, `js-tiktoken`
- External commands: `gh`, `w3m`, `curl`
- Handler-specific tools: `yt-dlp`, `uvx`, Apify CLI / actor access for Reddit
- MCP wrapper: Python 3.11+, `uv`, `fastmcp`

## Checks

```bash
just typecheck
just test
just mcp-test
```
