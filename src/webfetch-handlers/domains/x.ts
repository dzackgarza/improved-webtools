import type { WebFetchHandlerResult } from "../types.ts";

export const X_DOMAINS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com"] as const;

function extractStatusId(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter(Boolean);
  const statusIndex = segments.findIndex((segment) => segment === "status");
  const candidate =
    statusIndex >= 0 && statusIndex + 1 < segments.length ? segments[statusIndex + 1] : segments.at(-1);
  if (!candidate) return undefined;
  return /^\d+$/.test(candidate) ? candidate : undefined;
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function fetchXPostMarkdown(input: { url: URL }): Promise<WebFetchHandlerResult> {
  const statusId = extractStatusId(input.url);
  if (!statusId) {
    throw new Error("unsupported X URL shape: expected /status/<tweet-id> path.");
  }

  const mirrorUrl = new URL(`https://r.jina.ai/http://x.com/i/web/status/${statusId}?conversation=1`);
  const response = await fetch(mirrorUrl.toString(), {
    headers: { accept: "text/plain", "user-agent": "opencode-improved-webfetch/1.0" },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`X mirror request failed (HTTP ${response.status}): ${body.trim().slice(0, 2000)}`);
  }

  const content = cleanText(body);
  if (!content) {
    throw new Error("X mirror returned an empty response.");
  }

  return {
    routeName: "x",
    sourceUrl: input.url.toString(),
    content: [
      "# X / Twitter post",
      "",
      `- Tweet ID: ${statusId}`,
      `- Mirror source: ${mirrorUrl.toString()}`,
      "",
      content,
    ].join("\n"),
  };
}

