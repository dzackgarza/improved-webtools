import { describe, expect, it } from "bun:test";
import { PASSPHRASE_WEBFETCH } from "../../src/passphrases";
import { executePluginWebFetch, listTools, resolvedTool } from "./opencode-server";

describe("improved-webtools live integration", () => {
  it("resolves the normal file plugin over the built-in web tools", async () => {
    const tools = await listTools();

    expect(resolvedTool(tools, "webfetch").description).toBe(
      "Use when you need to read a webpage URL as plain text content.",
    );
    expect(resolvedTool(tools, "websearch").description).toContain(
      "Optional categories for narrowing only",
    );
  }, 30_000);

  it("fetches the exact Reddit permalink through the plugin webfetch tool", async () => {
    const output = await executePluginWebFetch(
      "https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/",
    );

    expect(output).toContain(PASSPHRASE_WEBFETCH);
    expect(output).toContain("- Author: u/Thinklikeachef");
    expect(output).toMatch(/^- Comments extracted: [1-9][0-9]*$/m);
    expect(output).toMatch(/^  - u\/[^\n]+ \(score -?[0-9]+\):$/m);
    expect(output).not.toContain("[no comments]");
  }, 200_000);
});
