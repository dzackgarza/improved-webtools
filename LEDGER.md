# Ledger: Improved Web Tools

## Current State

- **Shadowing**: The plugin is confirmed to shadow `webfetch` and `websearch` in both local and remote modes.
- **Simplified Schema**: Standardized on `snake_case` and excised the braindead hand-rolled batching from `websearch`.
- **overwrite_cache**: Standardized the `overwrite_cache` boolean flag for `webfetch`, replacing the leaked `cache_mode` abstraction.
- **Passphrases**: Shadowing is verified by the presence of `PASS_WEBFETCH_SHADOW_20260305_C3D2` in the output.
- **Corrected Config**: Corrected placeholder paths in `.config/opencode.json` and `.config/opencode.debug.json` to enable reliable local testing.

## Outstanding Gaps

- **Environment Propagation**: The `git+https` transport does not propagate `IMPROVED_WEBTOOLS_DEBUG_MODE=1` to the plugin runtime.
- **GitHub Issues Filed**:
    - [#12 BUG: Security: Credential Leakage in youtube.ts](https://github.com/dzackgarza/opencode-improved-webtools-plugin/issues/12)
    - [#13 ENHANCEMENT: Pre-flight Checks for Missing Shell Dependencies](https://github.com/dzackgarza/opencode-improved-webtools-plugin/issues/13)
    - [#14 ENHANCEMENT: Parallelize Sequential websearch](https://github.com/dzackgarza/opencode-improved-webtools-plugin/issues/14)
    - [#15 ENHANCEMENT: Robust VTT Parsing for YouTube Subtitles](https://github.com/dzackgarza/opencode-improved-webtools-plugin/issues/15)
    - [#16 ENHANCEMENT: Encapsulate ArXiv logic in domain handler](https://github.com/dzackgarza/opencode-improved-webtools-plugin/issues/16)

## Future Work

- Investigate OpenCode environment propagation for remote plugins.
- Add more domains to the webfetch handlers.

## Notes

- **Local git+**: Using `git+` with local git repos (e.g., `git+file://`, local `git+ssh://`) was never an intended route and DOES NOT WORK. Never even try it; it is totally irrelevant when the `file://` directive exists for local development. Use the `file://` directive instead.
