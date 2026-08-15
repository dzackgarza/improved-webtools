import { strict as assert } from "node:assert";
import { z } from "zod";
import type { WebFetchHandlerResult } from "../types.ts";

export const REDDIT_DOMAINS = ["reddit.com", "www.reddit.com", "old.reddit.com", "api.reddit.com"] as const;

const redditPostPathSchema = z
  .tuple([
    z.literal("r"),
    z.string().min(1),
    z.literal("comments"),
    z.string().regex(/^[a-z0-9]+$/i),
  ])
  .rest(z.string());

const arcticShiftPostSchema = z.object({
  id: z.string(),
  author: z.string(),
  subreddit: z.string(),
  title: z.string(),
  selftext: z.string(),
  score: z.number(),
  num_comments: z.number().int().nonnegative(),
  permalink: z.string(),
});

type ArcticShiftListing = {
  kind: "Listing";
  data: {
    children: ArcticShiftTreeNode[];
  };
};

type ArcticShiftCommentNode = {
  kind: "t1";
  data: {
    id: string;
    author: string;
    parent_id: string;
    link_id: string;
    body: string;
    score: number;
    replies: "" | ArcticShiftListing;
  };
};

type ArcticShiftMoreNode = {
  kind: "more";
  data: {
    children: string[];
  };
};

type ArcticShiftTreeNode = ArcticShiftCommentNode | ArcticShiftMoreNode;
type HttpFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const arcticShiftListingSchema: z.ZodType<ArcticShiftListing> = z.lazy(() =>
  z.object({
    kind: z.literal("Listing"),
    data: z.object({
      children: z.array(arcticShiftTreeNodeSchema),
    }),
  }),
);

const arcticShiftCommentNodeSchema: z.ZodType<ArcticShiftCommentNode> = z.object({
  kind: z.literal("t1"),
  data: z.object({
    id: z.string(),
    author: z.string(),
    parent_id: z.string(),
    link_id: z.string(),
    body: z.string(),
    score: z.number(),
    replies: z.union([z.literal(""), arcticShiftListingSchema]),
  }),
});

const arcticShiftMoreNodeSchema: z.ZodType<ArcticShiftMoreNode> = z.object({
  kind: z.literal("more"),
  data: z.object({
    children: z.array(z.string()),
  }),
});

const arcticShiftTreeNodeSchema: z.ZodType<ArcticShiftTreeNode> = z.lazy(() =>
  z.union([arcticShiftCommentNodeSchema, arcticShiftMoreNodeSchema]),
);

const arcticShiftPostResponseSchema = z.object({ data: z.tuple([arcticShiftPostSchema]) });
const arcticShiftTreeResponseSchema = z.object({ data: z.array(arcticShiftTreeNodeSchema) });
const redditParentSchema = z.tuple([z.enum(["t1", "t3"]), z.string().min(1)]);

export function isRedditPostPermalink(url: URL): boolean {
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  return redditPostPathSchema.safeParse(segments).success;
}

function extractRedditPostId(url: URL): string {
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const path = redditPostPathSchema.parse(segments);
  return path[3].toLowerCase();
}

function normalizeRedditId(value: string): string {
  const separator = value.indexOf("_");
  return (separator === -1 ? value : value.slice(separator + 1)).toLowerCase();
}

function redditText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function renderRedditCommentTree(
  nodes: ArcticShiftTreeNode[],
  postId: string,
): { lines: string[]; commentCount: number } {
  const lines: string[] = [];
  const renderedIds = new Set<string>();

  const render = (
    children: ArcticShiftTreeNode[],
    expectedParentKind: "t1" | "t3",
    expectedParentId: string,
    depth: number,
  ) => {
    for (const node of children) {
      if (node.kind === "more") {
        assert.fail(
          `Arctic Shift collapsed ${node.data.children.length} Reddit comments. The complete tree is unavailable.`,
        );
      }

      const comment = node.data;
      const commentId = normalizeRedditId(comment.id);
      const [parentKind, parentId] = redditParentSchema.parse(comment.parent_id.split("_"));
      assert.equal(parentKind, expectedParentKind, `Reddit comment ${comment.id} has the wrong parent kind.`);
      assert.equal(
        parentId.toLowerCase(),
        expectedParentId,
        `Reddit comment ${comment.id} references the wrong parent.`,
      );
      assert.equal(normalizeRedditId(comment.link_id), postId);
      assert.ok(!renderedIds.has(commentId), `Reddit comment cycle includes ${commentId}.`);
      renderedIds.add(commentId);

      const indent = "  ".repeat(depth);
      lines.push(`${indent}- u/${redditText(comment.author)} (score ${comment.score}):`);
      const body = redditText(comment.body);
      const bodyLines = body.length === 0 ? ["[no text]"] : body.split("\n");
      for (const line of bodyLines) {
        lines.push(`${indent}  ${line}`);
      }

      if (comment.replies !== "") {
        render(comment.replies.data.children, "t1", commentId, depth + 1);
      }
    }
  };

  render(nodes, "t3", postId, 0);
  return { lines, commentCount: renderedIds.size };
}

function buildArcticShiftPostUrl(postId: string): URL {
  const url = new URL("https://arctic-shift.photon-reddit.com/api/posts/ids");
  url.searchParams.set("ids", postId);
  return url;
}

function buildArcticShiftCommentTreeUrl(postId: string): URL {
  const url = new URL("https://arctic-shift.photon-reddit.com/api/comments/tree");
  url.searchParams.set("link_id", `t3_${postId}`);
  url.searchParams.set("limit", "25000");
  return url;
}

async function requestArcticShift(fetchImpl: HttpFetch, url: URL): Promise<string> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Arctic Shift request failed for ${url.pathname} with HTTP ${response.status}: ${body.trim()}`,
    );
  }
  return body;
}

export async function fetchRedditPostMarkdown(input: {
  url: URL;
  fetchImpl: HttpFetch;
}): Promise<WebFetchHandlerResult> {
  const postId = extractRedditPostId(input.url);
  const [postPayload, commentPayload] = await Promise.all([
    requestArcticShift(input.fetchImpl, buildArcticShiftPostUrl(postId)),
    requestArcticShift(input.fetchImpl, buildArcticShiftCommentTreeUrl(postId)),
  ]);

  const post = arcticShiftPostResponseSchema.parse(JSON.parse(postPayload)).data[0];
  const commentNodes = arcticShiftTreeResponseSchema.parse(JSON.parse(commentPayload)).data;
  assert.equal(normalizeRedditId(post.id), postId);

  const permalink = new URL(post.permalink, "https://www.reddit.com").toString();
  const renderedComments = renderRedditCommentTree(commentNodes, postId);
  const lines: string[] = [
    "# Reddit Post",
    "",
    `- URL: ${input.url.toString()}`,
    `- Permalink: ${permalink}`,
    `- Subreddit: r/${redditText(post.subreddit)}`,
    `- Author: u/${redditText(post.author)}`,
    `- Score: ${post.score}`,
    `- Comments reported by post: ${post.num_comments}`,
    `- Comments extracted: ${renderedComments.commentCount}`,
    "",
    "## Title",
    "",
    redditText(post.title),
    "",
    "## Body",
    "",
    redditText(post.selftext),
    "",
    "## Comments (nested)",
    "",
  ];

  if (renderedComments.lines.length === 0) {
    lines.push("[no comments]");
  }
  lines.push(...renderedComments.lines);

  return {
    routeName: "reddit",
    sourceUrl: permalink,
    content: lines.join("\n"),
  };
}
