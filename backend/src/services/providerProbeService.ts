import axios from "axios";
import type { ProviderConfig } from "../types/aiSettings.js";

export interface ProviderProbeResult {
  providerKey: ProviderConfig["providerKey"];
  available: boolean;
  latencyMs: number;
  statusCode?: number;
  message: string;
}

function resolveProbeUrl(provider: ProviderConfig): string {
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  if (provider.providerKey === "claude") {
    return `${baseUrl}/v1/messages`;
  }
  if (provider.providerKey === "zai_coding") {
    if (baseUrl.endsWith("/api/coding/paas/v4")) {
      return `${baseUrl}/chat/completions`;
    }
    return `${baseUrl}/api/coding/paas/v4/chat/completions`;
  }
  if (provider.providerKey === "zai") {
    if (baseUrl.endsWith("/api/coding/paas/v4")) {
      return `${baseUrl}/chat/completions`;
    }
    if (baseUrl.endsWith("/api/paas/v4")) {
      return `${baseUrl}/chat/completions`;
    }
    return `${baseUrl}/api/paas/v4/chat/completions`;
  }
  return `${baseUrl}/v1/chat/completions`;
}

function buildProbeHeaders(provider: ProviderConfig): Record<string, string> {
  if (provider.providerKey === "claude") {
    return {
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    };
  }

  return {
    Authorization: `Bearer ${provider.apiKey}`,
    "Content-Type": "application/json"
  };
}

function buildProbeBody(provider: ProviderConfig): Record<string, unknown> {
  if (provider.providerKey === "claude") {
    return {
      model: provider.defaultModel,
      max_tokens: 1,
      temperature: 0,
      messages: [{ role: "user", content: "ping" }]
    };
  }

  return {
    model: provider.defaultModel,
    max_tokens: 1,
    temperature: 0,
    messages: [{ role: "user", content: "ping" }]
  };
}

export async function probeProviderAvailability(provider: ProviderConfig): Promise<ProviderProbeResult> {
  const startedAt = Date.now();

  try {
    const response = await axios.post(resolveProbeUrl(provider), buildProbeBody(provider), {
      headers: buildProbeHeaders(provider),
      timeout: 15000,
      validateStatus: () => true
    });

    const latencyMs = Date.now() - startedAt;
    const statusCode = response.status;

    const bodyErrorMessage =
      typeof response.data?.error?.message === "string"
        ? response.data.error.message
        : typeof response.data?.message === "string"
          ? response.data.message
          : null;

    // Some providers may return HTTP 200 with an error payload.
    if (statusCode >= 200 && statusCode < 300 && !bodyErrorMessage) {
      return {
        providerKey: provider.providerKey,
        available: true,
        latencyMs,
        statusCode,
        message: "连接成功"
      };
    }

    const detail = bodyErrorMessage ?? "请求失败";

    return {
      providerKey: provider.providerKey,
      available: false,
      latencyMs,
      statusCode,
      message: detail
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "网络错误";
    return {
      providerKey: provider.providerKey,
      available: false,
      latencyMs,
      message
    };
  }
}
