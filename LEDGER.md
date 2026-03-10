# Ledger: Improved Web Tools

## Current State

- Shadowing: The plugin is confirmed to shadow `webfetch` and `websearch` in both local and remote modes.
- Debug Mode: A manual debug split is implemented in `src/index.ts`. It allows verifying code loading via `webfetch_debug` without shadowing.
- Passphrases: Shadowing is verified by the presence of `PASS_WEBFETCH_SHADOW_20260305_C3D2` in the output.

## Outstanding Gaps

- **Environment Propagation**: The `git+https` transport does not propagate `IMPROVED_WEBTOOLS_DEBUG_MODE=1` to the plugin runtime.
- **Verification**: Remote verification of the debug-split is currently impossible.

## Future Work

- Investigate OpenCode environment propagation for remote plugins.
- Add more domains to the webfetch handlers.

## Notes

- **Local git+**: Using `git+` with local git repos (e.g., `git+file://`, local `git+ssh://`) was never an intended route and DOES NOT WORK. Never even try it; it is totally irrelevant when the `file://` directive exists for local development. Use the `file://` directive instead.
