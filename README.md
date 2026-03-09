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
cacheMode?: "default" | "refresh"
cache_mode?: "default" | "refresh"
```

Special handling:

- `arxiv.org/abs/...`, `arxiv.org/pdf/...`, `arxiv.org/src/...`, and `arxiv.org/html/...` are routed through a local artifact library instead of plain `w3m`
- the library stores `pdf`, source archive, extracted source, BibTeX, `metadata.yaml`, `SUMMARY.md`, and best-effort markdown/html conversions
- `metadata.yaml` records both `processed_at` and `last_accessed_at`
- `cacheMode: "refresh"` is the stale-result lever: it bypasses cached reads and forces a fresh fetch when you suspect the current result is outdated
- for arXiv URLs, that same mode also rebuilds the local artifact directory from scratch

Environment:

- `WEBFETCH_ARXIV_LIBRARY_DIR` overrides the default artifact root at `~/.cache/opencode-arxiv-library`
- `YTDLP_COOKIES_FILE` optionally points at a Netscape-format cookie jar for `yt-dlp` when YouTube bot-checks gate spoken/informational videos
- `YOUTUBE_VERIFY_TIMEOUT_MS` optionally increases the per-command timeout used by `just youtube-live-verify` on slow CPU hosts during Whisper transcription

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
YTDLP_COOKIES_FILE=/abs/path/to/youtube.cookies just youtube-live-verify
```

`just youtube-live-verify` preflights `uvx`, `yt-dlp` via `uvx`, and `openai-whisper` via `uvx` before running a caption-backed TED proof, a no-subtitles Whisper proof, and an invalid-video failure check. On CPU-only hosts, the Whisper leg can take several minutes; set `YOUTUBE_VERIFY_TIMEOUT_MS` higher if it times out before transcription completes.
