import { describe, expect, it } from "bun:test";
import { listTools, resolvedTool } from "./opencode-server";

describe("improved-webtools manual debug integration", () => {
  it("registers the non-shadowing debug aliases through OpenCode", async () => {
    const tools = await listTools();

    expect(resolvedTool(tools, "webfetch_debug").description).toContain(
      "explicitly debugging improved-webtools loading without shadowing",
    );
    expect(resolvedTool(tools, "websearch_debug").description).toContain(
      "explicitly debugging improved-webtools loading without shadowing",
    );
  }, 30_000);
});
