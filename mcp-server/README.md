
# Improved Web Tools MCP Server

FastMCP wrapper providing `webfetch` and `websearch` capabilities.

## Installation

Set up the environment and install dependencies:

```bash
cd ./improved-webtools/mcp-server
uv sync --dev
```

### Local Run

Execute the MCP server locally:

```bash
uv run improved-webtools-mcp
```

### Configuration

Add the server to your OpenCode configuration:

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

Fetches the text content of a URL.

- `url`: (string) The target URL.

### `websearch`

Searches the web using specific query parameters.

- `query`: (string) Search terms.
- `category?`: (string) Narrow search to specific categories.
- `num_results?`: (number) Number of results to return.
- `offset?`: (number) Result pagination offset.
- `recency?`: (number) Filter by recency.

The server delegates tool execution to the TypeScript plugin through `opencode-plugin-mcp-shim/run-tool.ts`.
