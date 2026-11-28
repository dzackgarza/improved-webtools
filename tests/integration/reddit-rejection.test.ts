import { expect, it } from "bun:test";
import { executePluginWebFetch } from "./opencode-server";

const postUrl = "https://www.reddit.com/r/OpenAI/comments/1hn44qh/post/";
const fixtureDirectory = new URL("../fixtures/real/reddit/", import.meta.url);
const postResponse = await Bun.file(new URL("arctic-shift-post-1hn44qh.json", fixtureDirectory)).text();
const collapsedResponse = await Bun.file(new URL("arctic-shift-tree-collapsed-1hn44qh.json", fixtureDirectory)).text();
const partialResponse = await Bun.file(new URL("arctic-shift-tree-1hn44qh.json", fixtureDirectory)).text();

for (const [label, body, reason] of [
  ["collapsed", collapsedResponse, "Arctic Shift collapsed 3 Reddit comments"],
  ["empty", JSON.stringify({ data: [] }), "Arctic Shift returned 0 of 43 reported Reddit comments"],
  ["short", partialResponse, "Arctic Shift returned 2 of 43 reported Reddit comments"],
] as const) {
  it(`rejects a ${label === "empty" ? "previously reported but empty" : label} Arctic Shift tree at the plugin tool boundary`, async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    Reflect.set(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname !== "arctic-shift.photon-reddit.com") return originalFetch(input, init);
      requestedUrls.push(url.href);
      if (url.pathname === "/api/posts/ids") return new Response(postResponse);
      if (url.pathname === "/api/comments/tree") return new Response(body);
      throw new Error(`Unexpected Arctic Shift request: ${url}`);
    });
    try {
      await expect(executePluginWebFetch(postUrl)).rejects.toThrow(reason);
      expect(requestedUrls).toEqual([
        "https://arctic-shift.photon-reddit.com/api/posts/ids?ids=1hn44qh",
        "https://arctic-shift.photon-reddit.com/api/comments/tree?link_id=t3_1hn44qh&limit=25000",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);
}
