# improved-webtools MCP server

FastMCP wrapper for `webfetch` and `websearch`.

## Install

```bash
cd /home/dzack/opencode-plugins/improved-webtools/mcp-server
uv sync --dev
```

Local run:

```bash
uv run improved-webtools-mcp
```

Remote-style OpenCode config using `uvx` from GitHub:

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

## MCP Tools

### `webfetch`

```text
url: string
```

### `websearch`

```text
query: string
category?: string
num_results?: number
offset?: number
recency?: number
```

The wrapper delegates to the TypeScript plugin through [`mcp-shim/run-tool.ts`](/home/dzack/opencode-plugins/mcp-shim/run-tool.ts).
