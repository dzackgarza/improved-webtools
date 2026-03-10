# Agent Guidelines: Improved Web Tools

This plugin exists for the **sole purpose** of shadowing and overriding the default OpenCode built-in tools.

## Shadowing Mandate

The intention of this plugin **IS TO SHADOW** the OpenCode built-ins. Any other behavior is a deviation from the core design.

### Target Built-ins
In the current OpenCode build used in this workspace, the built-ins being shadowed are:
- **`webfetch`**: Fetches raw content from a URL.
- **`websearch`**: Performs a general web search.

### Manual Debug Mode
Debug mode is **off by default**. In normal operation the plugin exports the real shadowing tool ids:
- **`webfetch`**
- **`websearch`**

When `IMPROVED_WEBTOOLS_DEBUG_MODE=1`, the plugin exports **non-shadowing debug aliases instead**:
- **`webfetch_debug`**
- **`websearch_debug`**

Use `.config/opencode.debug.json` or an equivalent config that allows the debug tool ids.
Do not treat the debug aliases as normal product behavior.

| Feature | Normal shadowing id | Manual debug id |
| :--- | :--- | :--- |
| **Web Fetch** | `webfetch` | `webfetch_debug` |
| **Web Search** | `websearch` | `websearch_debug` |

### Local git+ transport
Using `git+` with local git repos (e.g., `git+file://`, local `git+ssh://`) was never an intended route and DOES NOT WORK. Never even try it; it is totally irrelevant when the `file://` directive exists for local development.

### Test Order
When debugging loading or shadowing, use this order:
1. Prove the plugin loads in debug mode via `file://`
2. Prove the plugin shadows in normal mode via `file://`
3. Prove the plugin loads in debug mode via `git+`
4. Prove the plugin shadows in normal mode via `git+`

**DO NOT** treat the non-shadowing names as standard tools. They are internal debug hooks only.
