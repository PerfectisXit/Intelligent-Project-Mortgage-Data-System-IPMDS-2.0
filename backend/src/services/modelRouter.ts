import axios from "axios";
import { env } from "../config/env.js";

export interface LlmStructuredResponse {
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
  missingFields: string[];
  clarificationQuestion: string;
  candidateMatches: Array<{ canonical: string; score: number; reason: string }>;
  safeToWrite: boolean;
}

const amountWithUnitRegex = /([0-9]+(?:\.[0-9]+)?)\s*(万|万元|元)/g;
const amountKeywordRegex =
  /(?:付|付款|支付|先付|金额|收款|给|合计|总计)\s*([0-9]+(?:\.[0-9]+)?)/;
const unitRegex = /([A-Za-z]?\d?-?\d{3,4})/;

const structuredOutputInstruction = `
你是工抵台账录入助手。你必须只返回 JSON，不要输出 markdown。
JSON schema:
{
  "intent": "create_transaction|create_unit|query|link_file|unknown",
  "confidence": number,
  "entities": {
    "customer_name"?: string,
    "unit_code"?: string,
    "amount"?: number,
    "currency"?: "CNY",
    "txn_type"?: "deposit"|"down_payment"|"installment"|"full_payment",
    "occurred_at"?: "YYYY-MM-DD"
  },
  "missingFields": string[],
  "clarificationQuestion": string,
  "candidateMatches": [{"canonical": string, "score": number, "reason": string}],
  "safeToWrite": boolean
}
规则:
1) 信息不完整必须放入 missingFields，并 safeToWrite=false。
2) 不得臆造日期/金额/房号。
3) 仅输出 JSON。
`.trim();

interface ModelTarget {
  provider: "openai" | "deepseek" | "claude";
  model: string;
}

function localFallback(userInput: string): LlmStructuredResponse {
  let amountMatch: RegExpMatchArray | null = null;
  for (const match of userInput.matchAll(amountWithUnitRegex)) {
    amountMatch = match;
  }
  if (!amountMatch) {
    amountMatch = userInput.match(amountKeywordRegex);
  }
  const unitMatch = userInput.match(unitRegex);
  const amountRaw = amountMatch?.[1];
  const amountUnit = amountMatch?.[2] ?? "";
  const usesWan = amountUnit.includes("万");
  const amount = amountRaw ? Number(amountRaw) * (usesWan ? 10000 : 1) : undefined;

  const entities: Record<string, unknown> = {};
  if (unitMatch) entities.unit_code = unitMatch[1];
  if (amount) entities.amount = amount;
  entities.currency = "CNY";

  const missingFields: string[] = [];
  if (!entities.unit_code) missingFields.push("unit_code");
  if (!entities.amount) missingFields.push("amount");
  if (!/定金|首付|分期|全款/.test(userInput)) missingFields.push("txn_type");
  if (!/\d{4}-\d{2}-\d{2}|今天|昨日|上周/.test(userInput)) missingFields.push("occurred_at");

  return {
    intent: "create_transaction",
    confidence: missingFields.length === 0 ? 0.95 : 0.82,
    entities,
    missingFields,
    clarificationQuestion:
      "请补充付款类型（定金/首付/分期/全款）和到账日期（例如 2026-02-08）。",
    candidateMatches: [],
    safeToWrite: missingFields.length === 0
  };
}

function normalizeModelTarget(value: string): ModelTarget {
  const [providerRaw, ...modelParts] = value.split(":");
  const provider = providerRaw.trim().toLowerCase();
  const modelRaw = modelParts.join(":").trim();

  if (provider === "openai") {
    return { provider: "openai", model: modelRaw || "gpt-4.1" };
  }
  if (provider === "deepseek") {
    return { provider: "deepseek", model: modelRaw || "deepseek-chat" };
  }
  if (provider === "claude") {
    const mapped =
      modelRaw === "sonnet"
        ? "claude-3-7-sonnet-latest"
        : modelRaw === "haiku"
          ? "claude-3-5-haiku-latest"
          : modelRaw || "claude-3-7-sonnet-latest";
    return { provider: "claude", model: mapped };
  }
  return { provider: "openai", model: "gpt-4.1" };
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Model response is not valid JSON");
  }
}

function normalizeLlmPayload(payload: unknown): LlmStructuredResponse {
  const fallback = localFallback("");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
  const obj = payload as Record<string, unknown>;

  const intent = typeof obj.intent === "string" ? obj.intent : "unknown";
  const confidence = typeof obj.confidence === "number" ? obj.confidence : 0.5;
  const entities =
    obj.entities && typeof obj.entities === "object" && !Array.isArray(obj.entities)
      ? (obj.entities as Record<string, unknown>)
      : {};
  const missingFields = Array.isArray(obj.missingFields)
    ? obj.missingFields.filter((v): v is string => typeof v === "string")
    : [];
  const clarificationQuestion =
    typeof obj.clarificationQuestion === "string" && obj.clarificationQuestion.trim()
      ? obj.clarificationQuestion
      : "请补充缺失字段后再提交。";
  const candidateMatches = Array.isArray(obj.candidateMatches)
    ? obj.candidateMatches
        .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object"))
        .map((v) => ({
          canonical: typeof v.canonical === "string" ? v.canonical : "",
          score: typeof v.score === "number" ? v.score : 0.5,
          reason: typeof v.reason === "string" ? v.reason : "model_candidate"
        }))
        .filter((v) => v.canonical)
    : [];
  const safeToWrite = typeof obj.safeToWrite === "boolean" ? obj.safeToWrite : missingFields.length === 0;

  return {
    intent,
    confidence,
    entities,
    missingFields,
    clarificationQuestion,
    candidateMatches,
    safeToWrite
  };
}

async function callOpenAiLike(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  userInput: string;
}) {
  const response = await axios.post(
    `${params.baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
    {
      model: params.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: structuredOutputInstruction },
        { role: "user", content: params.userInput }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 20000
    }
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenAI-like provider returned empty message content");
  }
  return normalizeLlmPayload(tryParseJson(content));
}

async function callClaude(params: { baseUrl: string; apiKey: string; model: string; userInput: string }) {
  const response = await axios.post(
    `${params.baseUrl.replace(/\/$/, "")}/v1/messages`,
    {
      model: params.model,
      max_tokens: 1000,
      temperature: 0.1,
      system: structuredOutputInstruction,
      messages: [{ role: "user", content: params.userInput }]
    },
    {
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      timeout: 20000
    }
  );
  const contentArr = response.data?.content;
  const text =
    Array.isArray(contentArr) && contentArr.length
      ? contentArr.find((x: { type?: string }) => x?.type === "text")?.text
      : null;
  if (typeof text !== "string") {
    throw new Error("Claude provider returned empty text content");
  }
  return normalizeLlmPayload(tryParseJson(text));
}

export async function parseWithModel(userInput: string): Promise<LlmStructuredResponse> {
  if (env.mockMode) {
    return localFallback(userInput);
  }

  const pipeline = [env.defaultModel, ...env.fallbackModels].map(normalizeModelTarget);
  const failures: string[] = [];

  for (const target of pipeline) {
    try {
      if (target.provider === "openai") {
        if (!env.openaiApiKey) throw new Error("OPENAI_API_KEY is empty");
        return await callOpenAiLike({
          baseUrl: env.openaiBaseUrl,
          apiKey: env.openaiApiKey,
          model: target.model,
          userInput
        });
      }
      if (target.provider === "deepseek") {
        if (!env.deepseekApiKey) throw new Error("DEEPSEEK_API_KEY is empty");
        const model = target.model === "chat" ? "deepseek-chat" : target.model;
        return await callOpenAiLike({
          baseUrl: env.deepseekBaseUrl,
          apiKey: env.deepseekApiKey,
          model,
          userInput
        });
      }
      if (target.provider === "claude") {
        if (!env.claudeApiKey) throw new Error("CLAUDE_API_KEY is empty");
        return await callClaude({
          baseUrl: env.claudeBaseUrl,
          apiKey: env.claudeApiKey,
          model: target.model,
          userInput
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${target.provider}:${target.model} => ${message}`);
    }
  }

  const fallback = localFallback(userInput);
  fallback.clarificationQuestion = `${fallback.clarificationQuestion}（模型调用失败，已启用本地规则解析）`;
  fallback.candidateMatches = failures.map((reason, idx) => ({
    canonical: `fallback_${idx + 1}`,
    score: 0.1,
    reason
  }));
  return fallback;
}
