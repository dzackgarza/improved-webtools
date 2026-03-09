# improved-webtools

OpenCode plugin that provides `webfetch` and `websearch`, plus a FastMCP wrapper for the same search/fetch logic.

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
