export type ProviderKey = "siliconflow" | "zai" | "zai_coding" | "openai" | "deepseek" | "claude";

export interface ProviderConfig {
  providerKey: ProviderKey;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

export interface AiProviderSettings {
  providers: ProviderConfig[];
  defaultProvider: ProviderKey;
  fallbackProviders: ProviderKey[];
}
