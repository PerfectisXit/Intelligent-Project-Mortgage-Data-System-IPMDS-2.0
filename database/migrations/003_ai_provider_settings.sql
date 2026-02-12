CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  providers JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_provider VARCHAR(40) NOT NULL,
  fallback_providers JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_settings_org
  ON ai_provider_settings (organization_id);

COMMENT ON TABLE ai_provider_settings IS 'AI 提供商路由配置，支持前端设置页持久化并运行时生效';
COMMENT ON COLUMN ai_provider_settings.providers IS '提供商配置列表(JSON)：providerKey/baseUrl/apiKey/defaultModel/enabled';
COMMENT ON COLUMN ai_provider_settings.default_provider IS '主模型提供商标识';
COMMENT ON COLUMN ai_provider_settings.fallback_providers IS '回退提供商标识列表(JSON)';
