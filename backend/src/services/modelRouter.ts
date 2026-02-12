import axios from "axios";
import { env } from "../config/env.js";
import { getAiProviderSettings, resolveOrganizationIdByProjectId } from "./aiSettingsService.js";
import { copilotStructuredOutputInstruction } from "./promptTemplates.js";
import type { ProviderKey } from "../types/aiSettings.js";

const COPILOT_TIMEOUT_MS = Number(process.env.COPILOT_TIMEOUT_MS ?? 60000);

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

type ApiStyle = "openai" | "claude";

interface RuntimeTarget {
  providerKey: ProviderKey;
  model: string;
  baseUrl: string;
  apiKey: string;
  apiStyle: ApiStyle;
}

function providerStyle(providerKey: ProviderKey): ApiStyle {
  return providerKey === "claude" ? "claude" : "openai";
}

function defaultModelForProvider(providerKey: ProviderKey): string {
  if (providerKey === "openai") return "gpt-4.1";
  if (providerKey === "deepseek") return "deepseek-chat";
  if (providerKey === "claude") return "claude-3-7-sonnet-latest";
  if (providerKey === "siliconflow") return "Qwen/Qwen2.5-72B-Instruct";
  return "glm-4.5";
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

function normalizeModelTarget(value: string): { providerKey: ProviderKey; model: string } {
  const [providerRaw, ...modelParts] = value.split(":");
  const providerText = providerRaw.trim().toLowerCase();
  const modelRaw = modelParts.join(":").trim();

  if (
    providerText === "openai" ||
    providerText === "deepseek" ||
    providerText === "claude" ||
    providerText === "siliconflow" ||
    providerText === "zai"
  ) {
    return {
      providerKey: providerText,
      model: modelRaw || defaultModelForProvider(providerText)
    };
  }

  return { providerKey: "openai", model: "gpt-4.1" };
}

function modelBaseUrl(providerKey: ProviderKey): string {
  if (providerKey === "openai") return env.openaiBaseUrl;
  if (providerKey === "deepseek") return env.deepseekBaseUrl;
  if (providerKey === "claude") return env.claudeBaseUrl;
  if (providerKey === "siliconflow") return "https://api.siliconflow.cn";
  return "https://api.z.ai";
}

function modelApiKey(providerKey: ProviderKey): string {
  if (providerKey === "openai") return env.openaiApiKey;
  if (providerKey === "deepseek") return env.deepseekApiKey;
  if (providerKey === "claude") return env.claudeApiKey;
  return "";
}

function buildEnvPipeline() {
  const pipeline = [env.defaultModel, ...env.fallbackModels].map(normalizeModelTarget);
  return pipeline.map((target) => ({
    providerKey: target.providerKey,
    model:
      target.providerKey === "deepseek" && target.model === "chat"
        ? "deepseek-chat"
        : target.model,
    baseUrl: modelBaseUrl(target.providerKey),
    apiKey: modelApiKey(target.providerKey),
    apiStyle: providerStyle(target.providerKey)
  }));
}

async function buildRuntimePipeline(projectId?: string): Promise<RuntimeTarget[]> {
  const organizationId = projectId ? await resolveOrganizationIdByProjectId(projectId) : null;
  const settings = await getAiProviderSettings(organizationId);

  const enabled = settings.providers.filter((p) => p.enabled);
  if (!enabled.length) return buildEnvPipeline();

  const byKey = new Map(enabled.map((p) => [p.providerKey, p]));
  const pipelineOrder: ProviderKey[] = [settings.defaultProvider, ...settings.fallbackProviders];
  const targets: RuntimeTarget[] = [];
  const used = new Set<ProviderKey>();
  for (const key of pipelineOrder) {
    if (used.has(key)) continue;
    const config = byKey.get(key);
    if (!config) continue;
    used.add(key);
    targets.push({
      providerKey: key,
      model: config.defaultModel || defaultModelForProvider(key),
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      apiStyle: providerStyle(key)
    });
  }

  // If default/fallbacks are incomplete, append enabled providers deterministically.
  for (const config of enabled) {
    if (used.has(config.providerKey)) continue;
    used.add(config.providerKey);
    targets.push({
      providerKey: config.providerKey,
      model: config.defaultModel || defaultModelForProvider(config.providerKey),
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      apiStyle: providerStyle(config.providerKey)
    });
  }

  return targets.length ? targets : buildEnvPipeline();
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
        { role: "system", content: copilotStructuredOutputInstruction },
        { role: "user", content: params.userInput }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: COPILOT_TIMEOUT_MS
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
      system: copilotStructuredOutputInstruction,
      messages: [{ role: "user", content: params.userInput }]
    },
    {
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      timeout: COPILOT_TIMEOUT_MS
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

export async function parseWithModel(
  userInput: string,
  options?: { projectId?: string }
): Promise<LlmStructuredResponse> {
  if (env.mockMode) {
    return localFallback(userInput);
  }

  const pipeline = await buildRuntimePipeline(options?.projectId);
  const failures: string[] = [];

  for (const target of pipeline) {
    try {
      if (!target.apiKey) {
        throw new Error(`${target.providerKey.toUpperCase()} API key is empty`);
      }
      if (target.apiStyle === "openai") {
        return await callOpenAiLike({
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          model: target.model,
          userInput
        });
      }
      return await callClaude({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        model: target.model,
        userInput
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${target.providerKey}:${target.model} => ${message}`);
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
