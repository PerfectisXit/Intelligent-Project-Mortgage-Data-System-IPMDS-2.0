export type ProviderKey = "siliconflow" | "zai" | "openai" | "deepseek" | "claude";

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
