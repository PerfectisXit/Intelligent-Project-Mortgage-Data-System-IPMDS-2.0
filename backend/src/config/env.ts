import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  claudeApiKey: process.env.CLAUDE_API_KEY ?? "",
  claudeBaseUrl: process.env.CLAUDE_BASE_URL ?? "https://api.anthropic.com",
  defaultModel: process.env.DEFAULT_MODEL ?? "openai:gpt-4.1",
  fallbackModels: (process.env.FALLBACK_MODELS ?? "deepseek:chat,claude:sonnet")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  mockMode: (process.env.MOCK_MODE ?? "true") === "true"
};
