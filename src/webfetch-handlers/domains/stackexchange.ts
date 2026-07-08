import type { WebFetchHandlerResult } from "../types.ts";

export const STACKEXCHANGE_DOMAINS = [
  "stackoverflow.com",
  "stackexchange.com",
  "serverfault.com",
  "superuser.com",
  "askubuntu.com",
  "mathoverflow.net",
] as const;

const STACKEXCHANGE_ANSWER_LIMIT = 4;

type StackExchangeQuestion = {
  title?: string;
  body?: string;
  link?: string;
  score?: number;
  tags?: string[];
  answer_count?: number;
  accepted_answer_id?: number;
};

type StackExchangeAnswer = {
  answer_id?: number;
  score?: number;
  body?: string;
  is_accepted?: boolean;
  owner?: {
    display_name?: string;
    user_id?: number;
  };
};

function assertRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function normalizeHtmlText(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replaceAll(/<\s*br\s*\/?\s*>/gi, "\n")
      .replaceAll(/<\/(p|div|li)>/gi, "\n")
      .replaceAll(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function resolveStackExchangeSite(url: URL): string | undefined {
  if (url.hostname === "stackoverflow.com" || url.hostname === "mathoverflow.net") {
    return url.hostname.replace(".com", "").replace(".net", "");
  }
  if (url.hostname === "serverfault.com" || url.hostname === "superuser.com" || url.hostname === "askubuntu.com") {
    return url.hostname.replace(".com", "");
  }
  if (url.hostname.endsWith(".stackexchange.com")) {
    return url.hostname.slice(0, -".stackexchange.com".length);
  }
  if (url.hostname === "stackexchange.com") {
    return undefined;
  }
  return undefined;
}

function extractStackExchangeQuestionId(url: URL): number | undefined {
  const segments = url.pathname.split("/").filter(Boolean);
  const markerIndex = segments.findIndex((segment) => segment === "questions");
  if (markerIndex < 0) {
    return undefined;
  }
  const id = segments[markerIndex + 1];
  if (!id || !/^\d+$/.test(id)) {
    return undefined;
  }
  const parsed = Number.parseInt(id, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "opencode-improved-webfetch/1.0",
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${label} request failed (HTTP ${response.status}): ${body.trim().slice(0, 2000)}`);
  }
  return JSON.parse(body) as T;
}

function pickQuestion(items: unknown): StackExchangeQuestion | undefined {
  if (!Array.isArray(items)) return undefined;
  const first = items[0];
  if (!assertRecord(first)) return undefined;
  return first as StackExchangeQuestion;
}

function pickAnswers(items: unknown): StackExchangeAnswer[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item): StackExchangeAnswer | undefined => {
      if (!assertRecord(item)) return undefined;
      return item as StackExchangeAnswer;
    })
    .filter((item): item is StackExchangeAnswer => item !== undefined);
}

export async function fetchStackExchangeMarkdown(input: {
  url: URL;
}): Promise<WebFetchHandlerResult> {
  const site = resolveStackExchangeSite(input.url);
  const questionId = extractStackExchangeQuestionId(input.url);
  if (!site || !questionId) {
    throw new Error("unsupported StackExchange URL shape: expected /questions/<id>/<slug> on a supported StackExchange site.");
  }

  const questionUrl = new URL(`https://api.stackexchange.com/2.3/questions/${questionId}`);
  questionUrl.searchParams.set("site", site);
  questionUrl.searchParams.set("filter", "withbody");
  questionUrl.searchParams.set("pagesize", "1");

  const answersUrl = new URL(`https://api.stackexchange.com/2.3/questions/${questionId}/answers`);
  answersUrl.searchParams.set("site", site);
  answersUrl.searchParams.set("order", "desc");
  answersUrl.searchParams.set("sort", "votes");
  answersUrl.searchParams.set("filter", "withbody");
  answersUrl.searchParams.set("pagesize", String(STACKEXCHANGE_ANSWER_LIMIT + 1));

  const [questionResponse, answersResponse] = await Promise.all([
    fetchJson<{ items: unknown[] }>(questionUrl.toString(), "StackExchange question"),
    fetchJson<{ items: unknown[] }>(answersUrl.toString(), "StackExchange answers"),
  ]);

  const question = pickQuestion(questionResponse.items);
  if (!question) {
    throw new Error(`StackExchange API returned no question for id ${questionId}.`);
  }

  const candidateAnswers = pickAnswers(answersResponse.items)
    .filter((answer) => answer.answer_id !== undefined)
    .sort((left, right) => (Number(right.score ?? 0) - Number(left.score ?? 0))
    );

  const selectedAnswers = [...candidateAnswers.slice(0, STACKEXCHANGE_ANSWER_LIMIT)];
  const byId = new Map(selectedAnswers.map((answer) => [Number(answer.answer_id), answer]));
  const acceptedAnswerId = Number(question.accepted_answer_id ?? Number.NaN);
  if (Number.isFinite(acceptedAnswerId)) {
    const accepted = candidateAnswers.find((answer) => Number(answer.answer_id) === acceptedAnswerId);
    if (accepted && !byId.has(acceptedAnswerId)) {
      selectedAnswers.push(accepted);
    }
  }

  const lines: string[] = [
    `# Stack Exchange: ${question.title ?? "Question"}`,
    "",
    `- Site: ${site}`,
    `- Source URL: ${question.link ?? input.url.toString()}`,
    `- Score: ${Number(question.score ?? 0).toString()}`,
    `- Total answers reported: ${Number(question.answer_count ?? selectedAnswers.length)}`,
  ];

  if (question.tags && question.tags.length > 0) {
    lines.push(`- Tags: ${question.tags.join(", ")}`);
  }

  lines.push("", "## Question", "", normalizeHtmlText(question.body ?? ""));

  if (selectedAnswers.length === 0) {
    lines.push("", "## Answers", "", "No answer body was returned by the API.");
  } else {
    lines.push("", "## Top answers / accepted");
    for (const [index, answer] of selectedAnswers.entries()) {
      const answerScore = Number(answer.score ?? 0);
      const author = answer.owner?.display_name ?? "unknown";
      const status = answer.is_accepted || answer.answer_id === acceptedAnswerId ? "accepted" : "top-voted";
      lines.push("");
      lines.push(`### Answer ${index + 1} (${status})`);
      lines.push(`- Author: ${author}`);
      lines.push(`- Score: ${answerScore}`);
      lines.push("");
      lines.push(normalizeHtmlText(answer.body ?? ""));
    }
  }

  return {
    routeName: "stackexchange",
    sourceUrl: input.url.toString(),
    content: lines.join("\n"),
  };
}

