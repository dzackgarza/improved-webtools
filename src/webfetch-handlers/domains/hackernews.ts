import type { WebFetchHandlerResult } from "../types.ts";

export const HACKERNEWS_DOMAINS = ["news.ycombinator.com", "hn.algolia.com"] as const;

type HnComment = {
  id?: number;
  author?: string;
  text?: string;
  created_at?: string;
  points?: number;
  children?: unknown[];
  comments?: unknown[];
};

type HnItem = {
  id?: number;
  title?: string;
  points?: number;
  author?: string;
  text?: string;
  created_at?: string;
  url?: string;
  children?: unknown[];
  comment_text?: string;
};

function cleanText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

function assertRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractItemId(url: URL): number | undefined {
  const idParam = cleanText(url.searchParams.get("id"));
  if (/^\d+$/.test(idParam)) {
    const parsed = Number.parseInt(idParam, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const marker = segments.findIndex((segment) => segment === "item");
  if (marker >= 0 && marker + 1 < segments.length && /^\d+$/.test(segments[marker + 1] ?? "")) {
    const parsed = Number.parseInt(segments[marker + 1]!, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const last = segments.at(-1);
  if (/^\d+$/.test(last ?? "")) {
    const parsed = Number.parseInt(last!, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function decodeHtml(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function normalizeContent(rawText: string): string {
  if (!rawText) return "No text content returned.";
  return decodeHtml(
    rawText
      .replaceAll(/<\s*br\s*\/?\s*>/gi, "\n")
      .replaceAll(/<\/(p|div|li)>/gi, "\n")
      .replaceAll(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

async function fetchItem(itemId: number): Promise<HnItem> {
  const response = await fetch(`https://hn.algolia.com/api/v1/items/${itemId}`, {
    headers: { accept: "application/json", "user-agent": "opencode-improved-webfetch/1.0" },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HN API request failed (HTTP ${response.status}): ${body.trim().slice(0, 2000)}`);
  }
  const payload = (await response.json()) as unknown;
  if (!assertRecord(payload)) {
    throw new Error("HN API response is not an object.");
  }
  const item = payload as HnItem;
  if (!item.id) {
    throw new Error("HN API response is missing top-level item id.");
  }
  return item;
}

function renderCommentTree(comments: unknown[], depth = 0): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  for (const raw of comments) {
    if (!assertRecord(raw)) continue;
    const comment = raw as HnComment;
    const id = Number(comment.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) continue;
    const author = cleanText(comment.author) || "unknown";
    const points = Number.isFinite(Number(comment.points)) ? Number(comment.points) : 0;
    const text = normalizeContent(cleanText(comment.text) || cleanText(comment.comment_text));
    lines.push(`${indent}- u/${author} (${points} pts)`);
    if (text) {
      for (const line of text.split(/\r?\n/)) {
        lines.push(`${indent}  ${line}`);
      }
    }
    const nested = extractChildren(comment);
    if (nested.length > 0) {
      lines.push(...renderCommentTree(nested, depth + 1));
    }
  }
  return lines;
}

function extractChildren(record: HnComment): unknown[] {
  if (Array.isArray(record.children)) return record.children;
  if (Array.isArray(record.comments)) return record.comments;
  return [];
}

export async function fetchHackerNewsItemMarkdown(input: { url: URL }): Promise<WebFetchHandlerResult> {
  const itemId = extractItemId(input.url);
  if (!itemId) {
    throw new Error("unsupported HN URL shape: expected /item?id=<item-id>.");
  }

  const item = await fetchItem(itemId);
  const contentText = normalizeContent(
    cleanText(item.text) ||
      `No top-level story text included. Story title: ${cleanText(item.title) || "untitled"}.`,
  );
  const lines: string[] = [
    "# Hacker News item",
    "",
    `- Item ID: ${item.id ?? itemId}`,
    `- Title: ${cleanText(item.title) || "untitled"}`,
    `- Author: ${cleanText(item.author) || "unknown"}`,
    `- URL: ${cleanText(item.url) || "self"}`,
    `- Score: ${Number.isFinite(Number(item.points)) ? Number(item.points) : 0}`,
    `- Created: ${cleanText(item.created_at) || "unknown"}`,
    "",
    "## Content",
    "",
    contentText,
    "",
    "## Comments (nested)",
    "",
  ];
  const comments = extractChildren(item);
  const renderedComments = renderCommentTree(comments);
  if (renderedComments.length > 0) {
    lines.push(...renderedComments);
  } else {
    lines.push("No comments returned by the Algolia API.");
  }

  return {
    routeName: "hackernews",
    sourceUrl: input.url.toString(),
    content: lines.join("\n"),
  };
}

