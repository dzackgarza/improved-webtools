# GAPS — improved-webtools

## Known Gaps

### `websearch` is suppressed by current OpenCode tool listing

On March 9, 2026, a minimal throwaway plugin proved that a plugin tool literally named
`websearch` is omitted from the agent-visible tool list in this OpenCode build, while the
same implementation under another name is visible. The package now exposes
`improved_websearch` as the proofable OpenCode-facing alias while keeping `websearch`
for compatibility and MCP use.

### SEARXNG_INSTANCE_URL not set in most environments

`websearch` falls back to an error response when `SEARXNG_INSTANCE_URL` is not set.
The pass code is still emitted on the error path, but real search results cannot be
confirmed without a live SearXNG instance.

### YouTube and Reddit handlers require external tools

The `youtube` handler calls `yt-dlp` + Whisper via `uvx`. The `reddit` handler calls
the Apify actor `spry_wholemeal/reddit-scraper`. Neither is available in CI. These
handlers are only tested against fixture data — real network behavior is untested.

### Token counting depends on js-tiktoken model availability

The `estimateTokens` function uses `js-tiktoken` with model `gpt-4o`. If the encoding
data for that model is unavailable at runtime, token counting silently falls back or
throws. No test covers this degraded-encoding path.
