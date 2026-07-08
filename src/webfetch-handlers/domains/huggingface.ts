import type { WebFetchHandlerResult } from "../types.ts";

export const HUGGINGFACE_DOMAINS = ["huggingface.co", "www.huggingface.co"] as const;

type HfCardData = {
  license?: string;
  base_model?: string | string[];
  downloads?: number;
};

type HfModelPayload = {
  id?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  library_name?: string;
  pipeline_tag?: string;
  modelIndex?: HfCardData;
  cardData?: HfCardData;
};

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function cleanNumber(value: unknown): string {
  if (typeof value !== "number") return "";
  return Number.isFinite(value) ? String(value) : "";
}

function assertRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function extractTarget(url: URL): { id: string; kind: "model" | "dataset" } | undefined {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length < 2) return undefined;

  let kind: "model" | "dataset" = "model";
  let cursor = 0;
  if (segments[0] === "datasets") {
    kind = "dataset";
    cursor = 1;
  } else if (segments[0] === "models") {
    cursor = 1;
  }

  if (segments.length - cursor < 2) return undefined;
  return {
    kind,
    id: `${segments[cursor]}/${segments[cursor + 1]}`,
  };
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "opencode-improved-webfetch/1.0" },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${label} request failed (HTTP ${response.status}): ${body.trim().slice(0, 2000)}`);
  }
  return JSON.parse(body) as T;
}

function toLines(target: { id: string; kind: "model" | "dataset" }, payload: Record<string, unknown>): string[] {
  const cardData = assertRecord(payload.cardData) ? (payload.cardData as Record<string, unknown>) : {};
  const modelPayload = payload as HfModelPayload;
  const modelId = cleanText(payload.id) || target.id;
  const downloads = cleanNumber(modelPayload.downloads) || "unspecified";
  const likes = cleanNumber((payload as Record<string, unknown>).likes);
  const pipelineTag = cleanText(modelPayload.pipeline_tag);
  const libraryName = cleanText(modelPayload.library_name);
  const tags = Array.isArray(modelPayload.tags)
    ? modelPayload.tags.map((tag) => cleanText(tag)).filter(Boolean)
    : [];
  const baseModel = cleanText(cardData.base_model) || "";
  const license = cleanText(cardData.license) || cleanText((payload as HfCardData).license) || "unspecified";

  const lines: string[] = [
    `# Hugging Face ${target.kind}`,
    "",
    `- ID: ${modelId}`,
    `- Type: ${target.kind}`,
    `- URL: https://huggingface.co/${target.id}`,
    `- Downloads: ${downloads}`,
    `- Likes: ${likes || "unspecified"}`,
    `- License: ${license}`,
  ];

  if (pipelineTag) lines.push(`- Pipeline: ${pipelineTag}`);
  if (libraryName) lines.push(`- Library: ${libraryName}`);
  if (tags.length > 0) lines.push(`- Tags: ${tags.join(", ")}`);
  if (baseModel) lines.push(`- Base model: ${baseModel}`);

  lines.push("");
  lines.push("## README");
  return lines;
}

export async function fetchHuggingFaceCardMarkdown(input: { url: URL }): Promise<WebFetchHandlerResult> {
  const target = extractTarget(input.url);
  if (!target) {
    throw new Error("unsupported Hugging Face URL shape: expected /{org}/{repo} or /models|datasets/{org}/{repo}.");
  }

  const apiUrl = new URL(`https://huggingface.co/api/${target.kind === "dataset" ? "datasets" : "models"}/${target.id}`);
  const payload = (await fetchJson<Record<string, unknown>>(apiUrl.toString(), "Hugging Face API")) as Record<
    string,
    unknown
  >;

  const readmeUrl = `https://huggingface.co/${target.id}/resolve/main/README.md`;
  let readme = "";
  try {
    const readmeResponse = await fetch(readmeUrl, {
      headers: { "user-agent": "opencode-improved-webfetch/1.0" },
    });
    if (readmeResponse.ok) {
      readme = decodeHtml((await readmeResponse.text()).trim());
    }
  } catch {
    readme = "";
  }

  const lines = toLines(target, payload);
  if (!readme) {
    lines.push("README not available from Hugging Face assets.");
  } else {
    lines.push(readme);
  }

  return {
    routeName: "huggingface",
    sourceUrl: `https://huggingface.co/${target.id}`,
    content: lines.join("\n"),
  };
}
