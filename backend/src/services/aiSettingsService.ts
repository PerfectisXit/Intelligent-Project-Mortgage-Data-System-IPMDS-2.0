import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import type { AiProviderSettings, ProviderConfig, ProviderKey } from "../types/aiSettings.js";

const providerKeys = ["siliconflow", "zai", "zai_coding", "openai", "deepseek", "claude"] as const;
const providerKeyEnum = z.enum(providerKeys);

const providerConfigSchema = z.object({
  providerKey: providerKeyEnum,
  providerName: z.string().min(1).max(80),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  defaultModel: z.string().min(1).max(120),
  enabled: z.boolean()
});

const aiProviderSettingsSchema = z
  .object({
    providers: z.array(providerConfigSchema).min(1),
    defaultProvider: providerKeyEnum,
    fallbackProviders: z.array(providerKeyEnum)
  })
  .superRefine((value, ctx) => {
    const seen = new Set<ProviderKey>();
    for (let i = 0; i < value.providers.length; i += 1) {
      const key = value.providers[i].providerKey;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["providers", i, "providerKey"],
          message: `Duplicate providerKey: ${key}`
        });
      }
      seen.add(key);
    }

    if (!seen.has(value.defaultProvider)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultProvider"],
        message: "defaultProvider must be present in providers"
      });
    }

    const enabledSet = new Set(value.providers.filter((p) => p.enabled).map((p) => p.providerKey));
    if (!enabledSet.has(value.defaultProvider)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultProvider"],
        message: "defaultProvider must be enabled"
      });
    }

    for (let i = 0; i < value.fallbackProviders.length; i += 1) {
      const key = value.fallbackProviders[i];
      if (!enabledSet.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fallbackProviders", i],
          message: `fallback provider ${key} must be enabled`
        });
      }
      if (key === value.defaultProvider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fallbackProviders", i],
          message: "fallback provider should not repeat defaultProvider"
        });
      }
    }
  });

const defaultSettings: AiProviderSettings = {
  providers: [
    {
      providerKey: "siliconflow",
      providerName: "硅基流动",
      baseUrl: "https://api.siliconflow.cn",
      apiKey: "",
      defaultModel: "Qwen/Qwen2.5-72B-Instruct",
      enabled: false
    },
    {
      providerKey: "zai",
      providerName: "z.ai",
      baseUrl: "https://api.z.ai",
      apiKey: "",
      defaultModel: "glm-4.5",
      enabled: false
    },
    {
      providerKey: "zai_coding",
      providerName: "z.ai Coding Plan",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      apiKey: "",
      defaultModel: "glm-4.7",
      enabled: false
    },
    {
      providerKey: "openai",
      providerName: "OpenAI",
      baseUrl: env.openaiBaseUrl,
      apiKey: env.openaiApiKey,
      defaultModel: normalizeDefaultModel(env.defaultModel, "openai", "gpt-4.1"),
      enabled: true
    },
    {
      providerKey: "deepseek",
      providerName: "DeepSeek",
      baseUrl: env.deepseekBaseUrl,
      apiKey: env.deepseekApiKey,
      defaultModel: "deepseek-chat",
      enabled: false
    },
    {
      providerKey: "claude",
      providerName: "Claude",
      baseUrl: env.claudeBaseUrl,
      apiKey: env.claudeApiKey,
      defaultModel: "claude-3-5-sonnet",
      enabled: false
    }
  ],
  defaultProvider: "openai",
  fallbackProviders: ["siliconflow", "zai"]
};

const inMemoryStore = new Map<string, AiProviderSettings>();
const mockStoreFile = path.join(process.cwd(), ".run", "ai-provider-settings.mock.json");

function normalizeDefaultModel(value: string, provider: ProviderKey, fallback: string) {
  const [providerRaw, ...modelParts] = value.split(":");
  const providerText = (providerRaw || "").trim().toLowerCase();
  if (providerText !== provider) return fallback;
  const model = modelParts.join(":").trim();
  return model || fallback;
}

async function readMockStoreFromDisk(): Promise<AiProviderSettings | null> {
  try {
    const raw = await fs.readFile(mockStoreFile, "utf-8");
    const parsed = JSON.parse(raw) as AiProviderSettings;
    return normalizeSettings(parsed);
  } catch {
    return null;
  }
}

async function writeMockStoreToDisk(settings: AiProviderSettings) {
  try {
    await fs.mkdir(path.dirname(mockStoreFile), { recursive: true });
    await fs.writeFile(mockStoreFile, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // ignore disk persistence errors in mock mode to avoid blocking API calls
  }
}

async function firstOrganizationId() {
  if (!pool || env.mockMode) return null;
  const res = await pool.query(`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
  if (!res.rowCount) return null;
  return res.rows[0].id as string;
}

export async function resolveOrganizationIdByProjectId(projectId: string) {
  if (!pool || env.mockMode) return null;
  const res = await pool.query(`SELECT organization_id FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
  if (!res.rowCount) return null;
  return res.rows[0].organization_id as string;
}

function normalizeSettings(value: AiProviderSettings): AiProviderSettings {
  const parsed = aiProviderSettingsSchema.parse(value);
  return {
    providers: parsed.providers.map((p) => ({
      providerKey: p.providerKey,
      providerName: p.providerName,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      defaultModel: p.defaultModel,
      enabled: p.enabled
    })),
    defaultProvider: parsed.defaultProvider,
    fallbackProviders: [...parsed.fallbackProviders]
  };
}

function mergeDefaultsWithStored(stored: AiProviderSettings): AiProviderSettings {
  const byKey = new Map<ProviderKey, ProviderConfig>(stored.providers.map((p) => [p.providerKey, p]));
  const providers = defaultSettings.providers.map((fallbackProvider) => {
    const hit = byKey.get(fallbackProvider.providerKey);
    return hit ? { ...fallbackProvider, ...hit } : fallbackProvider;
  });
  return normalizeSettings({
    providers,
    defaultProvider: stored.defaultProvider,
    fallbackProviders: stored.fallbackProviders
  });
}

export function validateAiSettingsPayload(payload: unknown) {
  return normalizeSettings(aiProviderSettingsSchema.parse(payload));
}

export function validateProviderConfigPayload(payload: unknown): ProviderConfig {
  return providerConfigSchema.parse(payload);
}

export async function getAiProviderSettings(organizationId?: string | null): Promise<AiProviderSettings> {
  const orgId = organizationId ?? (await firstOrganizationId());

  if (!pool || env.mockMode || !orgId) {
    const memory = inMemoryStore.get("default");
    if (memory) return mergeDefaultsWithStored(memory);

    const disk = await readMockStoreFromDisk();
    if (disk) {
      inMemoryStore.set("default", disk);
      return mergeDefaultsWithStored(disk);
    }

    return defaultSettings;
  }

  const res = await pool.query(
    `SELECT providers, default_provider, fallback_providers
     FROM ai_provider_settings
     WHERE organization_id = $1
     LIMIT 1`,
    [orgId]
  );

  if (!res.rowCount) return defaultSettings;

  const row = res.rows[0];
  const stored = normalizeSettings({
    providers: Array.isArray(row.providers) ? row.providers : [],
    defaultProvider: row.default_provider as ProviderKey,
    fallbackProviders: Array.isArray(row.fallback_providers) ? row.fallback_providers : []
  });
  return mergeDefaultsWithStored(stored);
}

export async function upsertAiProviderSettings(params: {
  organizationId?: string | null;
  settings: AiProviderSettings;
}) {
  const orgId = params.organizationId ?? (await firstOrganizationId());
  const settings = normalizeSettings(params.settings);

  if (!pool || env.mockMode || !orgId) {
    inMemoryStore.set("default", settings);
    await writeMockStoreToDisk(settings);
    return settings;
  }

  await pool.query(
    `INSERT INTO ai_provider_settings (
      organization_id, providers, default_provider, fallback_providers, updated_at
    ) VALUES ($1, $2::jsonb, $3, $4::jsonb, NOW())
    ON CONFLICT (organization_id)
    DO UPDATE SET
      providers = EXCLUDED.providers,
      default_provider = EXCLUDED.default_provider,
      fallback_providers = EXCLUDED.fallback_providers,
      updated_at = NOW()`,
    [orgId, JSON.stringify(settings.providers), settings.defaultProvider, JSON.stringify(settings.fallbackProviders)]
  );

  return settings;
}
