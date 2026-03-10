# Agent Guidelines: Improved Web Tools

This plugin exists for the **sole purpose** of shadowing and overriding the default OpenCode built-in tools.

## Shadowing Mandate

The intention of this plugin **IS TO SHADOW** the OpenCode built-ins. Any other behavior is a deviation from the core design.

### Target Built-ins
The known OpenCode built-ins being shadowed are:
- **`web_fetch`**: Fetches raw content from a URL.
- **`web_search`**: Performs a general web search.

### Debugging and Non-Shadowing
The **ONLY** reason non-shadowing names (`webfetch` and `websearch` without underscores) exist is to **DEBUG THE SHADOWING**. These names are not an intentional feature or an "alternative choice." They are strictly for development and diagnostic use to verify plugin logic without system-level interference.

| Feature | OpenCode Built-in (Shadow Target) | Current Plugin Tool (Debug Name) |
| :--- | :--- | :--- |
| **Web Fetch** | `web_fetch` | `webfetch` |
| **Web Search** | `web_search` | `websearch` |

**DO NOT** treat the non-shadowing names as standard tools. They are internal debug hooks only.
