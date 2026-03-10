# improved-webtools task completion

Before considering work complete:
- Run focused Bun tests for the touched handler/tool paths.
- Run `bunx tsc --noEmit` for TypeScript changes.
- Run `just check` when the change affects both plugin and wrapper behavior or when broad verification is warranted.
- Push the branch before resolving PR review threads so discussions point at the current remote state.
- Keep `.serena/` local; do not commit it.