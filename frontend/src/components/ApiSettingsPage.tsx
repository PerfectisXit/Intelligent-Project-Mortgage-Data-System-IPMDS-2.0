import { Alert, Button, Card, Col, Input, Row, Space, Switch, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";

interface ProviderConfig {
  providerKey: "siliconflow" | "zai" | "openai";
  providerName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

interface ApiSettingsState {
  providers: ProviderConfig[];
  defaultProvider: ProviderConfig["providerKey"];
  fallbackProviders: ProviderConfig["providerKey"][];
}

const STORAGE_KEY = "ipmds_api_settings_v1";

const defaultSettings: ApiSettingsState = {
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
      providerKey: "openai",
      providerName: "OpenAI",
      baseUrl: "https://api.openai.com",
      apiKey: "",
      defaultModel: "gpt-4.1",
      enabled: true
    }
  ],
  defaultProvider: "openai",
  fallbackProviders: ["siliconflow", "zai"]
};

function loadSettings(): ApiSettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as ApiSettingsState;
    if (!parsed?.providers?.length) return defaultSettings;
    return parsed;
  } catch {
    return defaultSettings;
  }
}

export function ApiSettingsPage() {
  const [settings, setSettings] = useState<ApiSettingsState>(() => loadSettings());

  const enabledProviders = useMemo(
    () => settings.providers.filter((p) => p.enabled).map((p) => p.providerName),
    [settings.providers]
  );

  const updateProvider = (providerKey: ProviderConfig["providerKey"], patch: Partial<ProviderConfig>) => {
    setSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) => (p.providerKey === providerKey ? { ...p, ...patch } : p))
    }));
  };

  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    message.success("API 设置已保存到本地浏览器");
  };

  const resetSettings = () => {
    setSettings(defaultSettings);
    localStorage.removeItem(STORAGE_KEY);
    message.info("已恢复默认设置");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card
        title="LLM API 设置"
        extra={
          <Space>
            <Button onClick={resetSettings}>恢复默认</Button>
            <Button type="primary" onClick={saveSettings}>
              保存设置
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="提示：当前仅保存到浏览器本地（localStorage）。生产环境建议接入后端加密存储。"
        />
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>已启用提供商：</Typography.Text>
          <Space style={{ marginLeft: 8 }}>
            {enabledProviders.length ? enabledProviders.map((name) => <Tag key={name}>{name}</Tag>) : <Tag>无</Tag>}
          </Space>
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        {settings.providers.map((provider) => (
          <Col xs={24} md={12} xl={8} key={provider.providerKey}>
            <Card
              title={provider.providerName}
              extra={
                <Space>
                  <Typography.Text>启用</Typography.Text>
                  <Switch
                    checked={provider.enabled}
                    onChange={(checked) => updateProvider(provider.providerKey, { enabled: checked })}
                  />
                </Space>
              }
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                <div>
                  <Typography.Text type="secondary">Base URL</Typography.Text>
                  <Input
                    value={provider.baseUrl}
                    placeholder="https://..."
                    onChange={(e) => updateProvider(provider.providerKey, { baseUrl: e.target.value })}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary">API Key</Typography.Text>
                  <Input.Password
                    value={provider.apiKey}
                    placeholder="sk-..."
                    onChange={(e) => updateProvider(provider.providerKey, { apiKey: e.target.value })}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary">默认模型</Typography.Text>
                  <Input
                    value={provider.defaultModel}
                    placeholder="model name"
                    onChange={(e) => updateProvider(provider.providerKey, { defaultModel: e.target.value })}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary">路由角色</Typography.Text>
                  <div>
                    <Button
                      size="small"
                      type={settings.defaultProvider === provider.providerKey ? "primary" : "default"}
                      onClick={() => setSettings((prev) => ({ ...prev, defaultProvider: provider.providerKey }))}
                    >
                      设为主模型
                    </Button>
                    <Button
                      size="small"
                      style={{ marginLeft: 8 }}
                      type={settings.fallbackProviders.includes(provider.providerKey) ? "primary" : "default"}
                      onClick={() =>
                        setSettings((prev) => {
                          const exists = prev.fallbackProviders.includes(provider.providerKey);
                          return {
                            ...prev,
                            fallbackProviders: exists
                              ? prev.fallbackProviders.filter((k) => k !== provider.providerKey)
                              : [...prev.fallbackProviders, provider.providerKey]
                          };
                        })
                      }
                    >
                      设为回退
                    </Button>
                  </div>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="当前路由配置预览">
        <Typography.Paragraph>
          <Typography.Text strong>主模型：</Typography.Text>
          {settings.defaultProvider}
        </Typography.Paragraph>
        <Typography.Paragraph>
          <Typography.Text strong>回退链路：</Typography.Text>
          {settings.fallbackProviders.join(" -> ") || "(空)"}
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
