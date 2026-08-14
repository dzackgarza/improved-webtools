import { strict as assert } from "node:assert";
import { z } from "zod";
import type { RunCommand, WebFetchHandlerResult } from "../types.ts";

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
  permalink: z.string(),
});

const arcticShiftCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  parent_id: z.string(),
  link_id: z.string(),
  body: z.string(),
  score: z.number(),
  created_utc: z.number(),
});

const arcticShiftPostResponseSchema = z.object({ data: z.tuple([arcticShiftPostSchema]) });
const arcticShiftCommentResponseSchema = z.object({ data: z.array(arcticShiftCommentSchema) });
const redditParentSchema = z.tuple([z.enum(["t1", "t3"]), z.string().min(1)]);

type ArcticShiftComment = z.infer<typeof arcticShiftCommentSchema>;
// Exhaustiveness pattern from the TypeScript Handbook:
// https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html#union-exhaustiveness-checking
function assertNever(value: never): never {
  return assert.fail(`Unhandled Reddit parent kind: ${value}`);
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

function parentKey(
  comment: ArcticShiftComment,
  commentsById: ReadonlyMap<string, ArcticShiftComment>,
  rootPostId: string,
): string {
  const [kind, id] = redditParentSchema.parse(comment.parent_id.split("_"));
  const normalizedId = id.toLowerCase();

  switch (kind) {
    case "t1":
      assert.ok(
        commentsById.has(normalizedId),
        `Reddit comment ${comment.id} references missing parent ${comment.parent_id}.`,
      );
      return normalizedId;
    case "t3":
      assert.equal(normalizedId, rootPostId);
      return rootPostId;
    default:
      return assertNever(kind satisfies never);
  }
}

function renderRedditCommentTree(comments: ArcticShiftComment[], postId: string): string[] {
  const rootPostId = postId.toLowerCase();
  const commentsById = new Map(
    comments.map((comment) => [normalizeRedditId(comment.id), comment] as const),
  );
  assert.equal(commentsById.size, comments.length, "Reddit comment IDs must be unique.");

  const children = new Map<string, ArcticShiftComment[]>();
  for (const comment of comments) {
    const key = parentKey(comment, commentsById, rootPostId);
    const siblings = children.get(key);
    if (siblings === undefined) {
      children.set(key, [comment]);
      continue;
    }
    siblings.push(comment);
  }

  const sortByScoreThenTime = (left: ArcticShiftComment, right: ArcticShiftComment) => {
    const scoreOrder = right.score - left.score;
    return scoreOrder === 0 ? left.created_utc - right.created_utc : scoreOrder;
  };

  const lines: string[] = [];
  const renderedIds = new Set<string>();

  const render = (currentParentId: string, depth: number) => {
    const items = children.get(currentParentId);
    if (items === undefined) {return;}

    for (const comment of [...items].sort(sortByScoreThenTime)) {
      const commentId = normalizeRedditId(comment.id);
      assert.ok(!renderedIds.has(commentId), `Reddit comment cycle includes ${commentId}.`);
      renderedIds.add(commentId);

      const indent = "  ".repeat(depth);
      const author = redditText(comment.author);
      const body = redditText(comment.body);
      lines.push(`${indent}- u/${author} (score ${comment.score}):`);

      const bodyLines = body.length === 0 ? ["[no text]"] : body.split(/\r?\n/);
      for (const line of bodyLines) {
        lines.push(`${indent}  ${line}`);
      }
      render(commentId, depth + 1);
    }
  };

  render(rootPostId, 0);
  assert.equal(
    renderedIds.size,
    comments.length,
    "Reddit comment rendering must include every fetched comment.",
  );
  return lines;
}

function buildArcticShiftPostUrl(postId: string): URL {
  const url = new URL("https://arctic-shift.photon-reddit.com/api/posts/ids");
  url.searchParams.set("ids", postId);
  return url;
}

function buildArcticShiftCommentUrl(postId: string): URL {
  const url = new URL("https://arctic-shift.photon-reddit.com/api/comments/search");
  url.searchParams.set("link_id", postId);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("fields", "id,author,parent_id,link_id,body,score,created_utc");
  return url;
}

async function requestArcticShift(runCommand: RunCommand, url: URL) {
  const result = await runCommand([
    "curl",
    "--fail-with-body",
    "--location",
    "--silent",
    "--show-error",
    "--max-time",
    "30",
    url.toString(),
  ]);
  assert.equal(
    result.exitCode,
    0,
    `Arctic Shift request failed for ${url.pathname}: ${result.stderrText.trim()}`,
  );
  return result.stdoutText;
}

export async function fetchRedditPostMarkdown(input: {
  url: URL;
  runCommand: RunCommand;
}): Promise<WebFetchHandlerResult> {
  const postId = extractRedditPostId(input.url);
  const [postPayload, commentPayload] = await Promise.all([
    requestArcticShift(input.runCommand, buildArcticShiftPostUrl(postId)),
    requestArcticShift(input.runCommand, buildArcticShiftCommentUrl(postId)),
  ]);

  const post = arcticShiftPostResponseSchema.parse(JSON.parse(postPayload)).data[0];
  const comments = arcticShiftCommentResponseSchema.parse(JSON.parse(commentPayload)).data;
  assert.equal(normalizeRedditId(post.id), postId);
  for (const comment of comments) {
    assert.equal(normalizeRedditId(comment.link_id), postId);
  }

  const permalink = new URL(post.permalink, "https://www.reddit.com").toString();
  const renderedComments = renderRedditCommentTree(comments, postId);
  const lines: string[] = [
    "# Reddit Post",
    "",
    `- URL: ${input.url.toString()}`,
    `- Permalink: ${permalink}`,
    `- Subreddit: r/${redditText(post.subreddit)}`,
    `- Author: u/${redditText(post.author)}`,
    `- Score: ${post.score}`,
    `- Comments extracted: ${comments.length}`,
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

  if (renderedComments.length === 0) {
    lines.push("[no comments]");
  }
  lines.push(...renderedComments);

  return {
    routeName: "reddit",
    sourceUrl: permalink,
    content: lines.join("\n"),
  };
}
