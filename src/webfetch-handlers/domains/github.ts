import { Buffer } from "node:buffer";

import type { RunCommand, WebFetchHandlerResult } from "../types.ts";

export const GITHUB_DOMAINS = ["github.com", "www.github.com"] as const;

export type GitHubCommandPlan = {
  args: string[];
  sourceUrl: string;
  responseFormat?: "plain" | "github-contents-json";
};

function normalizeGitHubRepo(repo: string): string {
  return repo.replace(/\.git$/i, "");
}

type GitHubContentsPayload = {
  type?: string;
  encoding?: string;
  content?: string;
};

function decodeGitHubContentsPayload(raw: string, sourceUrl: string): string {
  let parsed: GitHubContentsPayload;
  try {
    parsed = JSON.parse(raw) as GitHubContentsPayload;
  } catch {
    throw new Error(`gh contents response was not valid JSON for ${sourceUrl}`);
  }

  if (parsed.type !== "file") {
    throw new Error(`gh contents response did not resolve to a file for ${sourceUrl}`);
  }
  if (typeof parsed.content !== "string") {
    throw new Error(`gh contents response omitted file content for ${sourceUrl}`);
  }

  const encoding = (parsed.encoding ?? "").trim().toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(parsed.content.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  if (encoding === "utf-8" || encoding === "utf8") {
    return parsed.content;
  }

  throw new Error(`unsupported GitHub contents encoding: ${parsed.encoding ?? "unknown"}`);
}

export function buildGitHubCommandPlan(url: URL): GitHubCommandPlan {
  const rawSegments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (rawSegments.length >= 2) {
    const owner = rawSegments[0]!;
    const repo = normalizeGitHubRepo(rawSegments[1]!);
    const repoRef = `${owner}/${repo}`;
    const scope = rawSegments[2];
    const tail = rawSegments.slice(3);

    if (scope === "issues" && /^\d+$/.test(tail[0] ?? "")) {
      return {
        args: [
          "gh",
          "issue",
          "view",
          tail[0]!,
          "--repo",
          repoRef,
          "--json",
          "number,title,body,author,comments,state,url,labels",
        ],
        sourceUrl: `https://github.com/${repoRef}/issues/${tail[0]!}`,
      };
    }

    if (scope === "pull" && /^\d+$/.test(tail[0] ?? "")) {
      return {
        args: ["gh", "pr", "view", tail[0]!, "--repo", repoRef, "--comments"],
        sourceUrl: `https://github.com/${repoRef}/pull/${tail[0]!}`,
      };
    }

    if (scope === "blob" && tail.length >= 2) {
      const ref = tail[0]!;
      const filePath = tail.slice(1).join("/");
      return {
        args: ["gh", "api", `repos/${repoRef}/contents/${filePath}?ref=${encodeURIComponent(ref)}`],
        sourceUrl: `https://github.com/${repoRef}/blob/${ref}/${filePath}`,
        responseFormat: "github-contents-json",
      };
    }

    if (scope === "commit" && tail.length >= 1) {
      return {
        args: ["gh", "api", `repos/${repoRef}/commits/${tail[0]!}`],
        sourceUrl: `https://github.com/${repoRef}/commit/${tail[0]!}`,
      };
    }

    if (scope === "releases") {
      return {
        args: ["gh", "release", "list", "--repo", repoRef, "--limit", "20"],
        sourceUrl: `https://github.com/${repoRef}/releases`,
      };
    }

    if (scope === "issues") {
      return {
        args: ["gh", "issue", "list", "--repo", repoRef, "--limit", "30"],
        sourceUrl: `https://github.com/${repoRef}/issues`,
      };
    }

    if (scope === "pulls") {
      return {
        args: ["gh", "pr", "list", "--repo", repoRef, "--limit", "30"],
        sourceUrl: `https://github.com/${repoRef}/pulls`,
      };
    }

    return {
      args: ["gh", "api", `repos/${repoRef}/readme`],
      sourceUrl: `https://github.com/${repoRef}`,
      responseFormat: "github-contents-json",
    };
  }

  const fallbackQuery = rawSegments.join("/") || url.toString();
  return {
    args: ["gh", "search", "repos", fallbackQuery, "--limit", "20"],
    sourceUrl: url.toString(),
  };
}

export async function fetchGitHubContent(input: {
  url: URL;
  runCommand: RunCommand;
}): Promise<WebFetchHandlerResult> {
  const plan = buildGitHubCommandPlan(input.url);
  const result = await input.runCommand(plan.args);
  if (result.exitCode !== 0) {
    throw new Error(`gh command failed (exit ${result.exitCode}): ${result.stderrText.trim()}`);
  }
  const content = plan.responseFormat === "github-contents-json"
    ? decodeGitHubContentsPayload(result.stdoutText, plan.sourceUrl)
    : result.stdoutText;
  return {
    routeName: "github",
    sourceUrl: plan.sourceUrl,
    content,
  };
}
