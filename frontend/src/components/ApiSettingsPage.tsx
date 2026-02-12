import { Alert, Button, Card, Col, Input, Row, Space, Spin, Switch, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { AiPromptTemplates, AiProviderSettings, ProviderConfig, ProviderKey, ProviderProbeResult } from "../types";

const STORAGE_KEY = "ipmds_api_settings_v1";

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

function loadLocalSettings(): AiProviderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as AiProviderSettings;
    if (!parsed?.providers?.length) return defaultSettings;
    return parsed;
  } catch {
    return defaultSettings;
  }
}

export function ApiSettingsPage() {
  const [settings, setSettings] = useState<AiProviderSettings>(() => loadLocalSettings());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState<Record<ProviderKey, boolean>>({
    siliconflow: false,
    zai: false,
    openai: false,
    deepseek: false,
    claude: false
  });
  const [probeResults, setProbeResults] = useState<Partial<Record<ProviderKey, ProviderProbeResult>>>({});
  const [prompts, setPrompts] = useState<AiPromptTemplates | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadRemote = async () => {
      setLoading(true);
      try {
        const headers = { "x-user-role": "admin", "x-user-id": "u_admin_1" };
        const [settingsRes, promptsRes] = await Promise.all([
          api.get<AiProviderSettings>("/settings/ai-providers", { headers }),
          api.get<AiPromptTemplates>("/settings/ai-prompts", { headers })
        ]);
        if (!mounted) return;
        setSettings(settingsRes.data);
        setPrompts(promptsRes.data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsRes.data));
      } catch {
        message.warning("后端配置读取失败，已使用本地缓存配置");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void loadRemote();
    return () => {
      mounted = false;
    };
  }, []);

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

  const setProviderEnabled = (providerKey: ProviderConfig["providerKey"], checked: boolean) => {
    setSettings((prev) => {
      const providers = prev.providers.map((p) => (p.providerKey === providerKey ? { ...p, enabled: checked } : p));
      const enabledKeys = providers.filter((p) => p.enabled).map((p) => p.providerKey);
      const fallbackProviders = prev.fallbackProviders.filter((key) => key !== providerKey || checked);
      const defaultProvider = enabledKeys.includes(prev.defaultProvider)
        ? prev.defaultProvider
        : enabledKeys[0] || prev.defaultProvider;
      return { ...prev, providers, fallbackProviders, defaultProvider };
    });
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await api.put<AiProviderSettings>("/settings/ai-providers", settings, {
        headers: { "x-user-role": "admin", "x-user-id": "u_admin_1" }
      });
      setSettings(res.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(res.data));
      message.success("API 设置已保存并实时生效");
    } catch {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      message.error("后端保存失败，已保留本地缓存");
    } finally {
      setSaving(false);
    }
  };

  const resetSettings = () => {
    setSettings(defaultSettings);
    localStorage.removeItem(STORAGE_KEY);
    message.info("已恢复默认设置");
  };

  const probeProvider = async (provider: ProviderConfig) => {
    setProbing((prev) => ({ ...prev, [provider.providerKey]: true }));
    try {
      const res = await api.post<ProviderProbeResult>(
        "/settings/ai-providers/probe",
        { provider },
        { headers: { "x-user-role": "admin", "x-user-id": "u_admin_1" } }
      );
      setProbeResults((prev) => ({ ...prev, [provider.providerKey]: res.data }));
      if (res.data.available) {
        message.success(`${provider.providerName} 检测通过 (${res.data.latencyMs}ms)`);
      } else {
        message.warning(`${provider.providerName} 检测失败: ${res.data.message}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "检测请求失败";
      setProbeResults((prev) => ({
        ...prev,
        [provider.providerKey]: {
          providerKey: provider.providerKey,
          available: false,
          latencyMs: 0,
          message: detail
        }
      }));
      message.error(`${provider.providerName} 检测失败: ${detail}`);
    } finally {
      setProbing((prev) => ({ ...prev, [provider.providerKey]: false }));
    }
  };

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" style={{ width: "100%" }} size={16}>
        <Card
          title="LLM API 设置"
          extra={
            <Space>
              <Button onClick={resetSettings}>恢复默认</Button>
              <Button type="primary" loading={saving} onClick={saveSettings}>
                保存设置
              </Button>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            message="配置将保存到后端数据库并立即生效；浏览器本地只作为离线兜底缓存。"
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
                      onChange={(checked) => setProviderEnabled(provider.providerKey, checked)}
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
                              providers: prev.providers.map((p) =>
                                p.providerKey === provider.providerKey ? { ...p, enabled: true } : p
                              ),
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
                  <div>
                    <Space>
                      <Button loading={probing[provider.providerKey]} onClick={() => void probeProvider(provider)}>
                        检测可用性
                      </Button>
                      {probeResults[provider.providerKey] ? (
                        probeResults[provider.providerKey]?.available ? (
                          <Tag color="green">
                            可用 {probeResults[provider.providerKey]?.latencyMs}ms
                            {probeResults[provider.providerKey]?.statusCode
                              ? ` / ${probeResults[provider.providerKey]?.statusCode}`
                              : ""}
                          </Tag>
                        ) : (
                          <Tag color="red">
                            不可用
                            {probeResults[provider.providerKey]?.statusCode
                              ? ` / ${probeResults[provider.providerKey]?.statusCode}`
                              : ""}
                          </Tag>
                        )
                      ) : null}
                    </Space>
                    {probeResults[provider.providerKey]?.available === false ? (
                      <Typography.Paragraph type="danger" style={{ marginTop: 8, marginBottom: 0 }}>
                        {probeResults[provider.providerKey]?.message}
                      </Typography.Paragraph>
                    ) : null}
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

        <Card title="大模型提示词（只读）">
          {prompts ? (
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <div>
                <Typography.Text strong>Copilot 解析 System Prompt</Typography.Text>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, background: "#f7f7f7", padding: 12 }}>
                  {prompts.copilotInterpret.systemPrompt}
                </pre>
              </div>
              <div>
                <Typography.Text strong>表头复核 System Prompt</Typography.Text>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, background: "#f7f7f7", padding: 12 }}>
                  {prompts.headerReview.systemPrompt}
                </pre>
              </div>
              <div>
                <Typography.Text strong>表头复核 User Payload 模板</Typography.Text>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, background: "#f7f7f7", padding: 12 }}>
                  {JSON.stringify(prompts.headerReview.userPayloadTemplate, null, 2)}
                </pre>
              </div>
            </Space>
          ) : (
            <Typography.Text type="secondary">提示词加载失败或未返回。</Typography.Text>
          )}
        </Card>
      </Space>
    </Spin>
  );
}
