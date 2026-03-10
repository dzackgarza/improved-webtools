# improved-webtools suggested commands

- Install JS deps: `cd /home/dzack/opencode-plugins/improved-webtools && bun install`
- Install MCP wrapper deps: `cd /home/dzack/opencode-plugins/improved-webtools/mcp-server && uv sync --dev`
- Full local install: `cd /home/dzack/opencode-plugins/improved-webtools && just install`
- Typecheck: `cd /home/dzack/opencode-plugins/improved-webtools && bunx tsc --noEmit`
- Run TS tests: `cd /home/dzack/opencode-plugins/improved-webtools && bun test`
- Run MCP tests: `cd /home/dzack/opencode-plugins/improved-webtools && just mcp-test`
- Run all checks: `cd /home/dzack/opencode-plugins/improved-webtools && just check`
- Inspect git state: `cd /home/dzack/opencode-plugins/improved-webtools && git status --short`
- Push branch: `cd /home/dzack/opencode-plugins/improved-webtools && git push`
- Review PR threads: `cd /home/dzack/opencode-plugins/improved-webtools && gh api graphql ...`