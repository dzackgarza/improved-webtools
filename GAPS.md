# GAPS — improved-webtools

## Known Gaps

### Override behavior not confirmed via real-agent test

The `webfetch` and `websearch` tools registered here shadow the OpenCode built-ins.
Whether OpenCode actually routes calls to this plugin vs the built-in has not been
confirmed via live agent invocation.

**Status:** ❌ Not yet tested  
**Test (webfetch):** From `.config/`, run:

```bash
cd /home/dzack/opencode-plugins/improved-webtools/.config
/home/dzack/.opencode/bin/opencode run \
  "Fetch https://example.com using the webfetch tool. Report the exact pass code from the tool output. It starts with PASS_WEBFETCH."
```

Expected in output: `PASS_WEBFETCH_SHADOW_20260305_C3D2`

**Test (websearch):** From `.config/`, run:

```bash
cd /home/dzack/opencode-plugins/improved-webtools/.config
/home/dzack/.opencode/bin/opencode run \
  "Search for 'openai' using the websearch tool. Report the exact pass code from the tool output. It starts with PASS_WEB_SEARCH."
```

Expected in output: `PASS_WEB_SEARCH_SHADOW_20260305_6A9F`

### SEARXNG_INSTANCE_URL not set in most environments

`websearch` falls back to an error response when `SEARXNG_INSTANCE_URL` is not set.
The pass code is still emitted on the error path, but real search results cannot be
confirmed without a live SearXNG instance.

### YouTube and Reddit handlers require external tools

The `youtube` handler calls `yt-dlp` + Whisper via `uvx`. The `reddit` handler calls
the Apify actor `spry_wholemeal/reddit-scraper`. Neither is available in CI. These
handlers are only tested against fixture data — real network behavior is untested.

### MCP server tests require Python environment

The `mcp-server/` subdirectory has its own Python venv and pytest suite. These tests
are not run by `bun test`. They must be run separately via:

```bash
cd improved-webtools/mcp-server
uv run pytest tests/
```

They have not been run in this session.

### Token counting depends on js-tiktoken model availability

The `estimateTokens` function uses `js-tiktoken` with model `gpt-4o`. If the encoding
data for that model is unavailable at runtime, token counting silently falls back or
throws. No test covers this degraded-encoding path.
