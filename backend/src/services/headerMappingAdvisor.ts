import axios from "axios";
import { getAiProviderSettings, resolveOrganizationIdByProjectId } from "./aiSettingsService.js";
import { headerReviewSystemPrompt, headerReviewUserPayloadTemplate } from "./promptTemplates.js";
import type { ProviderKey } from "../types/aiSettings.js";

const HEADER_REVIEW_TIMEOUT_MS = Number(process.env.HEADER_REVIEW_TIMEOUT_MS ?? 90000);

type HeaderSuggestion = {
  rawHeader: string;
  suggestedField: string | null;
  confidence: number;
  candidates: Array<{ field: string; score: number }>;
  needsConfirm: boolean;
  llmSuggestedField?: string | null;
  llmConfidence?: number;
  llmReason?: string;
  llmReasoningProcess?: string[];
  llmFullOpinion?: string;
};

type LlmReviewItem = {
  rawHeader: string;
  suggestedField: string | null;
  confidence: number;
  reason: string;
  reasoningProcess: string[];
  fullOpinion: string;
  needsConfirm: boolean;
};

type LlmReviewResponse = {
  reviews: LlmReviewItem[];
  globalNotes: string[];
  overallOpinion: string;
};

type LlmAttempt = {
  providerKey: ProviderKey;
  model: string;
  status: "success" | "failed";
  latencyMs: number;
  error?: string;
};

type RuntimeModel = {
  providerKey: ProviderKey;
  apiStyle: "openai" | "claude";
  baseUrl: string;
  apiKey: string;
  model: string;
};

type LlmReviewCallbacks = {
  onAttemptStart?: (payload: { providerKey: ProviderKey; model: string }) => void;
  onAttemptResult?: (payload: LlmAttempt) => void;
  onReviewOutput?: (payload: LlmReviewResponse) => void;
};

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value <= 1) return Math.round(value * 10000) / 100;
  return Math.round(value * 100) / 100;
}

function normalizeReviewPayload(payload: unknown): LlmReviewResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { reviews: [], globalNotes: [], overallOpinion: "" };
  }
  const obj = payload as Record<string, unknown>;
  const reviewsRaw = Array.isArray(obj.reviews) ? obj.reviews : [];
  const reviews: LlmReviewItem[] = reviewsRaw
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
    .map((r) => ({
      rawHeader: typeof r.rawHeader === "string" ? r.rawHeader : "",
      suggestedField: typeof r.suggestedField === "string" ? r.suggestedField : null,
      confidence: normalizeConfidence(r.confidence),
      reason: typeof r.reason === "string" ? r.reason : "",
      reasoningProcess: Array.isArray(r.reasoningProcess)
        ? r.reasoningProcess.filter((x): x is string => typeof x === "string")
        : [],
      fullOpinion: typeof r.fullOpinion === "string" ? r.fullOpinion : "",
      needsConfirm: typeof r.needsConfirm === "boolean" ? r.needsConfirm : true
    }))
    .filter((r) => r.rawHeader);
  const globalNotes = Array.isArray(obj.globalNotes)
    ? obj.globalNotes.filter((v): v is string => typeof v === "string")
    : [];
  const overallOpinion = typeof obj.overallOpinion === "string" ? obj.overallOpinion : "";
  return { reviews, globalNotes, overallOpinion };
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

async function callOpenAiLike(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
}) {
  const response = await axios.post(
    `${params.baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
    {
      model: params.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: HEADER_REVIEW_TIMEOUT_MS
    }
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI-like response content empty");
  return normalizeReviewPayload(tryParseJson(content));
}

async function callClaude(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
}) {
  const response = await axios.post(
    `${params.baseUrl.replace(/\/$/, "")}/v1/messages`,
    {
      model: params.model,
      max_tokens: 1200,
      temperature: 0.1,
      system: params.system,
      messages: [{ role: "user", content: params.user }]
    },
    {
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      timeout: HEADER_REVIEW_TIMEOUT_MS
    }
  );
  const contentArr = response.data?.content;
  const text =
    Array.isArray(contentArr) && contentArr.length
      ? contentArr.find((x: { type?: string }) => x?.type === "text")?.text
      : null;
  if (typeof text !== "string") throw new Error("Claude response content empty");
  return normalizeReviewPayload(tryParseJson(text));
}

function buildRuntimeModels(settings: Awaited<ReturnType<typeof getAiProviderSettings>>) {
  const enabled = settings.providers.filter((p) => p.enabled && p.apiKey);
  const byKey = new Map(enabled.map((p) => [p.providerKey, p]));
  const order: ProviderKey[] = [settings.defaultProvider, ...settings.fallbackProviders];
  const used = new Set<ProviderKey>();
  const models: RuntimeModel[] = [];
  for (const key of order) {
    if (used.has(key)) continue;
    const hit = byKey.get(key);
    if (!hit) continue;
    used.add(key);
    models.push({
      providerKey: key,
      apiStyle: key === "claude" ? "claude" : "openai",
      baseUrl: hit.baseUrl,
      apiKey: hit.apiKey,
      model: hit.defaultModel
    });
  }
  for (const p of enabled) {
    if (used.has(p.providerKey)) continue;
    used.add(p.providerKey);
    models.push({
      providerKey: p.providerKey,
      apiStyle: p.providerKey === "claude" ? "claude" : "openai",
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.defaultModel
    });
  }
  return models;
}

async function runLlmReview(params: {
  organizationId?: string;
  projectId?: string;
  rawHeaders: string[];
  standardFields: string[];
  ruleSuggestions: HeaderSuggestion[];
  callbacks?: LlmReviewCallbacks;
}) {
  const organizationId =
    params.organizationId ?? (params.projectId ? await resolveOrganizationIdByProjectId(params.projectId) : null);
  const settings = await getAiProviderSettings(organizationId ?? undefined);
  const models = buildRuntimeModels(settings);
  if (!models.length) {
    return {
      reviews: [],
      globalNotes: ["未找到可用模型密钥，跳过大模型复核。"],
      overallOpinion: "",
      attempts: [] as LlmAttempt[],
      selectedModel: null as string | null
    };
  }

  const system = headerReviewSystemPrompt;
  const user = JSON.stringify(
    {
      ...headerReviewUserPayloadTemplate,
      standardFields: params.standardFields,
      rawHeaders: params.rawHeaders,
      ruleSuggestions: params.ruleSuggestions.map((s) => ({
        rawHeader: s.rawHeader,
        suggestedField: s.suggestedField,
        confidence: s.confidence,
        needsConfirm: s.needsConfirm
      }))
    },
    null,
    2
  );

  const attempts: LlmAttempt[] = [];
  for (const model of models) {
    const startedAt = Date.now();
    params.callbacks?.onAttemptStart?.({
      providerKey: model.providerKey,
      model: model.model
    });
    try {
      const result =
        model.apiStyle === "openai"
          ? await callOpenAiLike({
              baseUrl: model.baseUrl,
              apiKey: model.apiKey,
              model: model.model,
              system,
              user
            })
          : await callClaude({
              baseUrl: model.baseUrl,
              apiKey: model.apiKey,
              model: model.model,
              system,
              user
            });
      const successAttempt = {
        providerKey: model.providerKey,
        model: model.model,
        status: "success",
        latencyMs: Date.now() - startedAt
      } as LlmAttempt;
      attempts.push(successAttempt);
      params.callbacks?.onAttemptResult?.(successAttempt);
      params.callbacks?.onReviewOutput?.(result);
      return {
        ...result,
        attempts,
        selectedModel: `${model.providerKey}:${model.model}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAttempt = {
        providerKey: model.providerKey,
        model: model.model,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        error: message
      } as LlmAttempt;
      attempts.push(failedAttempt);
      params.callbacks?.onAttemptResult?.(failedAttempt);
    }
  }
  return {
    reviews: [],
    globalNotes: ["大模型复核失败，已仅使用规则建议。"],
    overallOpinion: "",
    attempts,
    selectedModel: null
  };
}

export async function applyLlmHeaderReview(params: {
  organizationId?: string;
  projectId?: string;
  rawHeaders: string[];
  standardFields: string[];
  ruleSuggestions: HeaderSuggestion[];
  callbacks?: LlmReviewCallbacks;
}) {
  const llm = await runLlmReview(params);
  const allowed = new Set(params.standardFields);
  const llmMap = new Map(llm.reviews.map((r) => [r.rawHeader, r]));

  const suggestions = params.ruleSuggestions.map((rule) => {
    const review = llmMap.get(rule.rawHeader);
    if (!review) return rule;

    const llmField = review.suggestedField && allowed.has(review.suggestedField) ? review.suggestedField : null;
    let suggestedField = rule.suggestedField;
    let confidence = rule.confidence;
    let needsConfirm = rule.needsConfirm;

    if (!suggestedField && llmField) {
      suggestedField = llmField;
      confidence = Math.max(confidence, review.confidence);
      needsConfirm = true;
    } else if (suggestedField && llmField && suggestedField !== llmField) {
      needsConfirm = true;
    } else if (suggestedField && llmField && suggestedField === llmField) {
      confidence = Math.max(confidence, review.confidence);
      needsConfirm = needsConfirm || review.needsConfirm;
    }

    return {
      ...rule,
      suggestedField,
      confidence,
      needsConfirm,
      llmSuggestedField: llmField,
      llmConfidence: review.confidence,
      llmReason: review.reason,
      llmReasoningProcess: review.reasoningProcess,
      llmFullOpinion: review.fullOpinion
    };
  });

  return {
    suggestions,
    reviewMode: llm.reviews.length ? "rules_plus_llm" : "rules_only",
    reviewNotes: llm.globalNotes,
    llmOutput: llm.reviews,
    llmOverallOpinion: llm.overallOpinion,
    llmTrace: {
      selectedModel: llm.selectedModel,
      attempts: llm.attempts,
      status: llm.reviews.length ? "success" : llm.attempts.length ? "fallback_rules_only" : "skipped_no_model"
    }
  };
}
