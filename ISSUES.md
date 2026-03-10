# Issues: Improved Web Tools

## P0: Security & Reliability

### 1. Security: Credential Leakage in `youtube.ts`
The YouTube handler pipes raw `stderr` directly into the tool output on failure. If `YTDLP_COOKIES_FILE` is used for authentication, its absolute path may be leaked in the error report visible to the model.
- **Location**: `src/webfetch-handlers/domains/youtube.ts`
- **Fix**: Sanitize `stderrText` before returning it in the `WebFetchHandlerResult`.

### 2. Silent Failures: Missing Shell Dependencies
The plugin depends on several external CLI tools (`w3m`, `uvx`, `yt-dlp`, `ffmpeg`, `gh`) and a Python script for Wikipedia conversion. There is no pre-flight check, leading to opaque failures when a dependency is missing.
- **Fix**: Implement a pre-flight check or return specific error messages identifying the missing dependency.

## P1: Architecture & Performance

### 3. Performance: Sequential "Slow-Motion" Search
The `websearch` implementation processes multiple queries and multiple pages within each query sequentially. This leads to high latency (30-60s) for complex searches.
- **Location**: `src/index.ts`
- **Fix**: Parallelize query execution and page fetching where possible.

### 4. Brittle Scraping: Hand-Rolled VTT Parsing
The `vttToPlainText` function uses basic regex/string hacks to clean subtitles, which is prone to breaking on non-standard VTT formats.
- **Location**: `src/webfetch-handlers/domains/youtube.ts`
- **Fix**: Use a specialized VTT parsing library or more robust normalization logic.

### 5. Logic Leakage: ArXiv logic in main entrypoint
ArXiv-specific formatting and fallback logic is scattered in the main `src/index.ts` rather than being fully encapsulated in the ArXiv handler.
- **Location**: `src/index.ts`
- **Fix**: Move `formatArxivServiceMessage` and `buildArxivFallbackUrl` into `src/webfetch-handlers/domains/arxiv.ts`.
