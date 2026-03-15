# Improved Web Tools CLI and MCP

This package ships two entrypoints:

- `improved-webtools` for the Typer CLI
- `improved-webtools-mcp` for the FastMCP server

Both call the same bundled canonical bridge.

## Local Development

From the repo root:

```bash
just install
uv run --directory mcp-server improved-webtools doctor
uv run --directory mcp-server improved-webtools fetch https://example.com
uv run --directory mcp-server improved-webtools-mcp
```

If you update the TypeScript bridge directly, rebuild the vendored bundle before running the CLI or MCP server:

```bash
just --justfile justfile bundle-bridge
```

## Remote Usage

CLI:

```bash
uvx --from git+https://github.com/dzackgarza/opencode-plugin-improved-webtools.git#subdirectory=mcp-server improved-webtools doctor
```

MCP server:

```bash
uvx --from git+https://github.com/dzackgarza/opencode-plugin-improved-webtools.git#subdirectory=mcp-server improved-webtools-mcp
```

## Required Setup

- `bun` must be on `PATH`
- `SEARXNG_INSTANCE_URL` must be set for `search`

Handler-specific commands:

- `curl` and `w3m` for default fetches
- `gh` for GitHub fetches
- `apify` for Reddit fetches
- `uvx` for Wikipedia and YouTube fetches

Run `improved-webtools doctor` first when the environment is unclear.
