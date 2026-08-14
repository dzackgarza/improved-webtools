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

const pullPushPostSchema = z.object({
  id: z.string(),
  author: z.string(),
  subreddit: z.string(),
  title: z.string(),
  selftext: z.string(),
  score: z.number(),
  permalink: z.string(),
});

const pullPushCommentBaseSchema = z.object({
  id: z.string(),
  author: z.string(),
  parent_id: z.string(),
  link_id: z.string(),
  body: z.string(),
  score: z.number(),
  created_utc: z.number(),
});

const pullPushCommentSchema = z.union([
  pullPushCommentBaseSchema
    .extend({ retrieved_on: z.number() })
    .transform(({ retrieved_on, ...comment }) => ({ ...comment, snapshotTime: retrieved_on })),
  pullPushCommentBaseSchema.transform((comment) => ({
    ...comment,
    snapshotTime: comment.created_utc,
  })),
]);

const pullPushPostResponseSchema = z.object({ data: z.tuple([pullPushPostSchema]) });
const pullPushCommentResponseSchema = z.object({ data: z.array(pullPushCommentSchema) });
const redditParentSchema = z.tuple([z.enum(["t1", "t3"]), z.string().min(1)]);

type PullPushComment = z.infer<typeof pullPushCommentSchema>;
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

function selectLatestCommentSnapshots(comments: PullPushComment[]): PullPushComment[] {
  const latestById = new Map<string, PullPushComment>();

  for (const comment of comments) {
    const id = normalizeRedditId(comment.id);
    const current = latestById.get(id);
    if (current === undefined) {
      latestById.set(id, comment);
      continue;
    }

    assert.equal(comment.parent_id, current.parent_id);
    assert.equal(comment.link_id, current.link_id);
    const currentTime = current.snapshotTime;
    const nextTime = comment.snapshotTime;
    assert.notEqual(nextTime, currentTime, `Reddit comment ${id} has ambiguous snapshots.`);
    if (nextTime > currentTime) {
      latestById.set(id, comment);
    }
  }

  return [...latestById.values()];
}

function parentKey(
  comment: PullPushComment,
  commentsById: ReadonlyMap<string, PullPushComment>,
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

function renderRedditCommentTree(comments: PullPushComment[], postId: string): string[] {
  const rootPostId = postId.toLowerCase();
  const commentsById = new Map(
    comments.map((comment) => [normalizeRedditId(comment.id), comment] as const),
  );
  assert.equal(commentsById.size, comments.length, "Reddit comment IDs must be unique.");

  const children = new Map<string, PullPushComment[]>();
  for (const comment of comments) {
    const key = parentKey(comment, commentsById, rootPostId);
    const siblings = children.get(key);
    if (siblings === undefined) {
      children.set(key, [comment]);
      continue;
    }
    siblings.push(comment);
  }

  const sortByScoreThenTime = (left: PullPushComment, right: PullPushComment) => {
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

function buildPullPushSubmissionUrl(postId: string): URL {
  const url = new URL("https://api.pullpush.io/reddit/search/submission/");
  url.searchParams.set("ids", postId);
  url.searchParams.set("size", "1");
  return url;
}

function buildPullPushCommentUrl(postId: string): URL {
  const url = new URL("https://api.pullpush.io/reddit/search/comment/");
  url.searchParams.set("link_id", postId);
  url.searchParams.set("size", "100");
  url.searchParams.set("sort", "asc");
  return url;
}

async function requestPullPush(runCommand: RunCommand, url: URL) {
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
    `PullPush request failed for ${url.pathname}: ${result.stderrText.trim()}`,
  );
  return result.stdoutText;
}

export async function fetchRedditPostMarkdown(input: {
  url: URL;
  runCommand: RunCommand;
}): Promise<WebFetchHandlerResult> {
  const postId = extractRedditPostId(input.url);
  const [postPayload, commentPayload] = await Promise.all([
    requestPullPush(input.runCommand, buildPullPushSubmissionUrl(postId)),
    requestPullPush(input.runCommand, buildPullPushCommentUrl(postId)),
  ]);

  const post = pullPushPostResponseSchema.parse(JSON.parse(postPayload)).data[0];
  const commentSnapshots = pullPushCommentResponseSchema.parse(JSON.parse(commentPayload)).data;
  const comments = selectLatestCommentSnapshots(commentSnapshots);
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
