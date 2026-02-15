import React, { useState } from "react";
import {
  AutoComplete,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message
} from "antd";
import {
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { api, requestWithRetry } from "../api/client";
import type { AiProviderSettings, ProviderConfig, ProviderKey, ProviderProbeResult } from "../types";
import { ROLES } from "../constants";

type LocalSettings = AiProviderSettings;
const MODEL_OPTIONS: Record<ProviderKey, string[]> = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  zai: ["glm-4.7", "glm-4.5", "glm-4-plus"],
  zai_coding: ["glm-4.7", "glm-4.5", "glm-4-plus"],
  siliconflow: ["Qwen/Qwen2.5-72B-Instruct", "Qwen/Qwen2.5-32B-Instruct"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  claude: ["claude-3-5-sonnet", "claude-3-5-haiku"]
};

const BASE_URL_PRESETS: Record<ProviderKey, Array<{ label: string; value: string }>> = {
  openai: [
    { label: "OpenAI 标准 API", value: "https://api.openai.com" }
  ],
  siliconflow: [
    { label: "SiliconFlow 标准 API", value: "https://api.siliconflow.cn" }
  ],
  zai: [
    { label: "z.ai 常规 API", value: "https://api.z.ai" },
    { label: "z.ai 常规 API（完整前缀）", value: "https://api.z.ai/api/paas/v4" }
  ],
  zai_coding: [
    { label: "z.ai Coding Plan（专用）", value: "https://api.z.ai/api/coding/paas/v4" }
  ],
  deepseek: [
    { label: "DeepSeek 标准 API", value: "https://api.deepseek.com" }
  ],
  claude: [
    { label: "Anthropic 标准 API", value: "https://api.anthropic.com" }
  ]
};

const PROVIDER_SELECT_OPTIONS: Array<{
  value: string;
  label: string;
  providerKey: ProviderKey;
  apply?: Partial<ProviderConfig>;
}> = [
  {
    value: "openai:standard",
    label: "OpenAI（标准 API）",
    providerKey: "openai",
    apply: { baseUrl: "https://api.openai.com" }
  },
  {
    value: "siliconflow:standard",
    label: "SiliconFlow（标准 API）",
    providerKey: "siliconflow",
    apply: { baseUrl: "https://api.siliconflow.cn" }
  },
  {
    value: "zai:standard",
    label: "z.ai（常规 API）",
    providerKey: "zai",
    apply: { baseUrl: "https://api.z.ai", defaultModel: "glm-4.7" }
  },
  {
    value: "zai_coding:standard",
    label: "z.ai（Coding Plan）",
    providerKey: "zai_coding",
    apply: { baseUrl: "https://api.z.ai/api/coding/paas/v4", defaultModel: "glm-4.7" }
  },
  {
    value: "deepseek:standard",
    label: "DeepSeek（标准 API）",
    providerKey: "deepseek",
    apply: { baseUrl: "https://api.deepseek.com" }
  },
  {
    value: "claude:standard",
    label: "Claude（标准 API）",
    providerKey: "claude",
    apply: { baseUrl: "https://api.anthropic.com" }
  }
];

const defaultSettings: LocalSettings = {
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
      defaultModel: "glm-4.7",
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
      baseUrl: "https://api.openai.com",
      apiKey: "",
      defaultModel: "gpt-4.1",
      enabled: true
    },
    {
      providerKey: "deepseek",
      providerName: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      defaultModel: "deepseek-chat",
      enabled: false
    },
    {
      providerKey: "claude",
      providerName: "Claude",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      defaultModel: "claude-3-5-sonnet",
      enabled: false
    }
  ],
  defaultProvider: "openai",
  fallbackProviders: ["siliconflow", "zai"]
};

function loadLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem("ipmds_api_settings_v1");
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    if (!parsed?.providers?.length) return defaultSettings;
    return parsed;
  } catch {
    return defaultSettings;
  }
}

function normalizeSettingsForSave(settings: LocalSettings): LocalSettings {
  const enabledKeys = settings.providers.filter((p) => p.enabled).map((p) => p.providerKey);
  if (enabledKeys.length === 0) {
    throw new Error("至少启用一个服务商后再保存");
  }

  const defaultProvider = enabledKeys.includes(settings.defaultProvider)
    ? settings.defaultProvider
    : enabledKeys[0];

  const fallbackProviders = settings.fallbackProviders.filter(
    (key) => key !== defaultProvider && enabledKeys.includes(key)
  );

  return {
    ...settings,
    defaultProvider,
    fallbackProviders
  };
}

function mergeRemoteSettingsWithLocalSecrets(
  remote: LocalSettings,
  local: LocalSettings
): LocalSettings {
  const localByKey = new Map(local.providers.map((p) => [p.providerKey, p]));
  return {
    ...remote,
    providers: remote.providers.map((rp) => {
      const lp = localByKey.get(rp.providerKey);
      if (!lp) return rp;
      return {
        ...rp,
        apiKey: rp.apiKey?.trim() ? rp.apiKey : lp.apiKey
      };
    })
  };
}

function isProviderKey(value: string): value is ProviderKey {
  const validKeys: ProviderKey[] = [
    "siliconflow",
    "zai",
    "zai_coding",
    "openai",
    "deepseek",
    "claude"
  ];
  return validKeys.includes(value as any);
}

function isProviderConfigured(provider: ProviderConfig): boolean {
  return Boolean(provider.baseUrl?.trim() && provider.apiKey?.trim());
}

const StatsCard = React.memo(function StatsCard({
  enabled,
  available
}: {
  enabled: number;
  available: number;
}) {
  return (
    <Card size="small" title="服务商统计">
      <Row gutter={16}>
        <Col span={12}>
          <Space>
            <Tag color="green">已启用 {enabled}</Tag>
            <Typography.Text type="secondary">个服务商</Typography.Text>
          </Space>
        </Col>
        <Col span={12}>
          <Space>
            <Tag color={available > 0 ? "blue" : "default"}>
              可用 {available}
            </Tag>
            <Typography.Text type="secondary">个服务商</Typography.Text>
          </Space>
        </Col>
      </Row>
    </Card>
  );
});

const ProbeResultCard = React.memo(function ProbeResultCard({
  providerKey,
  result
}: {
  providerKey: ProviderKey;
  result: ProviderProbeResult | null;
}) {
  if (!result) return null;

  return (
    <Card size="small" title={`${providerKey} 探测结果`}>
      <Space direction="vertical">
        <Typography.Text>
          状态：
          <Tag color={result.available ? "green" : "red"}>
            {result.available ? "✅ 可用" : "❌ 不可用"}
          </Tag>
        </Typography.Text>
        <Typography.Text type="secondary">
          响应时间：{result.latencyMs}ms
        </Typography.Text>
        {result.statusCode && (
          <Typography.Text type="secondary">HTTP {result.statusCode}</Typography.Text>
        )}
        <Typography.Text type="secondary">{result.message}</Typography.Text>
      </Space>
    </Card>
  );
});

const ProviderForm = React.memo(function ProviderForm({
  config,
  modelOptions,
  baseUrlPresets,
  onChange
}: {
  config: ProviderConfig;
  modelOptions: string[];
  baseUrlPresets: Array<{ label: string; value: string }>;
  onChange: (
    providerKey: ProviderKey,
    patch: Partial<ProviderConfig>
  ) => void;
}) {
  return (
    <Card size="small" title={`${config.providerName} 配置`}>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Row gutter={16} align="middle">
          <Col span={8}>
            <Typography.Text strong>API Key：</Typography.Text>
          </Col>
          <Col span={16}>
            <Input.Password
              value={config.apiKey}
              onChange={(e) => onChange(config.providerKey, { apiKey: e.target.value.trim() })}
              placeholder="请输入 API Key"
            />
          </Col>
        </Row>

        <Row gutter={16} align="middle">
          <Col span={8}>
            <Typography.Text strong>Base URL：</Typography.Text>
          </Col>
          <Col span={16}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select
                placeholder="从预设中选择（可选）"
                options={baseUrlPresets}
                onChange={(value) => onChange(config.providerKey, { baseUrl: value })}
                allowClear
              />
              <Input
                value={config.baseUrl}
                onChange={(e) => onChange(config.providerKey, { baseUrl: e.target.value.trim() })}
                placeholder="https://api.example.com"
              />
            </Space>
          </Col>
        </Row>

        <Row gutter={16} align="middle">
          <Col span={8}>
            <Typography.Text strong>默认模型：</Typography.Text>
          </Col>
          <Col span={16}>
            <AutoComplete
              value={config.defaultModel}
              style={{ width: "100%" }}
              options={modelOptions.map((model) => ({ label: model, value: model }))}
              onChange={(value) => onChange(config.providerKey, { defaultModel: String(value).trim() })}
              placeholder="请选择模型"
              filterOption={(inputValue, option) =>
                String(option?.value ?? "")
                  .toLowerCase()
                  .includes(inputValue.toLowerCase())
              }
            />
          </Col>
        </Row>

        <Row gutter={16} align="middle">
          <Col span={8}>
            <Typography.Text>启用状态：</Typography.Text>
          </Col>
          <Col span={16}>
            <Switch
              checked={config.enabled}
              onChange={(checked) => onChange(config.providerKey, { enabled: checked })}
              checkedChildren="启用"
              unCheckedChildren="禁用"
            />
          </Col>
        </Row>
      </Space>
    </Card>
  );
});

export function ApiSettingsPage() {
  const [settings, setSettings] = useState<LocalSettings>(() => loadLocalSettings());
  const [selectedProviderValue, setSelectedProviderValue] = useState<string>("openai:standard");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const enabledProviders = settings.providers.filter((p) => p.enabled);
  const selectedProviderKey =
    PROVIDER_SELECT_OPTIONS.find((opt) => opt.value === selectedProviderValue)?.providerKey ??
    settings.defaultProvider;
  const selectedProvider =
    settings.providers.find((p) => p.providerKey === selectedProviderKey) ??
    settings.providers[0];
  const [probing, setProbing] = useState<Record<ProviderKey, boolean>>({
    siliconflow: false,
    zai: false,
    zai_coding: false,
    openai: false,
    deepseek: false,
    claude: false
  });
  const [probeResults, setProbeResults] = useState<Partial<Record<ProviderKey, ProviderProbeResult>>>({});
  const [loadingProviders, setLoadingProviders] = useState<Set<ProviderKey>>(new Set());

  const refreshSettings = async () => {
    setLoading(true);
    try {
      const settingsRes = await requestWithRetry<AiProviderSettings>(() =>
        api.get("/settings/ai-providers", {
          headers: { "x-user-role": ROLES.ADMIN, "x-user-id": "u_admin_1" }
        })
      );
      const merged = mergeRemoteSettingsWithLocalSecrets(settingsRes, loadLocalSettings());
      setSettings(merged);
      localStorage.setItem("ipmds_api_settings_v1", JSON.stringify(merged));
    } catch {
      message.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const payload = normalizeSettingsForSave(settings);
      await requestWithRetry(() =>
        api.put("/settings/ai-providers", payload, {
          headers: { "x-user-role": ROLES.ADMIN, "x-user-id": "u_admin_1" }
        })
      );
      setSettings(payload);
      localStorage.setItem("ipmds_api_settings_v1", JSON.stringify(payload));
      message.success("配置已保存");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "保存配置失败";
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const probeProvider = async (
    providerKey: ProviderKey
  ) => {
    const provider = settings.providers.find((p) => p.providerKey === providerKey);
    if (!provider || !isProviderConfigured(provider)) {
      message.warning(`${provider?.providerName ?? providerKey} 请先配置 API Key 和 Base URL`);
      return;
    }

    setLoadingProviders((prev) => new Set(prev).add(providerKey));
    setProbing((prev) => ({ ...prev, [providerKey]: true }));

    try {
      const result = await requestWithRetry(() =>
        api.post<ProviderProbeResult>("/settings/ai-providers/probe", {
          provider: {
            providerKey,
            providerName: provider.providerName,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            defaultModel: provider.defaultModel,
            enabled: provider.enabled
          }
        })
      );

      setProbeResults((prev) => ({ ...prev, [providerKey]: result }));
      if (result.available) {
        message.success(`${provider.providerName} 探测成功`);
      } else {
        message.error(`${provider.providerName} 探测失败：${result.message || "服务不可用"}`);
      }
    } catch {
      setProbeResults((prev) => ({
        ...prev,
        [providerKey]: {
          providerKey,
          available: false,
          latencyMs: 0,
          message: "探测失败",
          statusCode: 0
        }
      }));
      message.error(`${provider.providerName} 探测失败`);
    } finally {
      setProbing((prev) => ({ ...prev, [providerKey]: false }));
      setLoadingProviders((prev) => {
        const newSet = new Set(prev);
        newSet.delete(providerKey);
        return newSet;
      });
    }
  };

  const updateProvider = (
    providerKey: ProviderKey,
    patch: Partial<ProviderConfig>
  ) => {
    setSettings((prev) => {
      return {
        ...prev,
        providers: prev.providers.map((p) => (p.providerKey === providerKey ? { ...p, ...patch } : p))
      };
    });
  };

  const probeAll = async () => {
    const enabled = settings.providers.filter((p) => p.enabled);
    const readyProviders = enabled.filter(isProviderConfigured);
    const skippedProviders = enabled.filter((p) => !isProviderConfigured(p));

    if (readyProviders.length === 0) {
      message.warning("没有可探测的已启用服务商，请先补全 API Key 和 Base URL");
      return;
    }

    if (skippedProviders.length > 0) {
      message.info(`已跳过未配置服务商：${skippedProviders.map((p) => p.providerName).join("、")}`);
    }

    for (const provider of readyProviders) {
      await probeProvider(provider.providerKey);
    }
  };

  React.useEffect(() => {
    void refreshSettings();
  }, []);

  React.useEffect(() => {
    const availableKeys = new Set(settings.providers.map((p) => p.providerKey));
    const current = PROVIDER_SELECT_OPTIONS.find((opt) => opt.value === selectedProviderValue);
    if (!current || !availableKeys.has(current.providerKey)) {
      const next = PROVIDER_SELECT_OPTIONS.find((opt) => availableKeys.has(opt.providerKey));
      if (next) {
        setSelectedProviderValue(next.value);
      }
    }
  }, [settings.providers, selectedProviderValue]);

  return (
    <div>
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        <Typography.Title level={3}>AI 提供商配置</Typography.Title>

        <Space style={{ width: "100%" }}>
          <Button type="primary" loading={loading} onClick={refreshSettings} icon={<ReloadOutlined />}>
            刷新配置
          </Button>
          <Button loading={saving} onClick={saveSettings} icon={<SaveOutlined />}>
            保存配置
          </Button>
          <Button loading={loadingProviders.size > 0} onClick={probeAll} icon={<ThunderboltOutlined />}>
            一键探测
          </Button>
        </Space>

        <StatsCard
          enabled={enabledProviders.length}
          available={Object.values(probeResults).filter((r) => r?.available).length}
        />

        <Card size="small" title="服务商选择">
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Select
              value={selectedProviderValue}
              onChange={(value) => {
                setSelectedProviderValue(value);
                const option = PROVIDER_SELECT_OPTIONS.find((opt) => opt.value === value);
                if (option?.apply) {
                  updateProvider(option.providerKey, option.apply);
                }
              }}
              options={PROVIDER_SELECT_OPTIONS.filter((opt) =>
                settings.providers.some((p) => p.providerKey === opt.providerKey)
              ).map((opt) => ({
                label: opt.label,
                value: opt.value
              }))}
              style={{ width: "100%" }}
              placeholder="请选择服务商"
            />
            <Button
              icon={<ThunderboltOutlined />}
              loading={probing[selectedProviderKey]}
              onClick={() => void probeProvider(selectedProviderKey)}
            >
              探测当前服务商
            </Button>
          </Space>
        </Card>

        {selectedProvider ? (
          <ProviderForm
            key={selectedProvider.providerKey}
            config={selectedProvider}
            modelOptions={MODEL_OPTIONS[selectedProvider.providerKey] ?? []}
            baseUrlPresets={BASE_URL_PRESETS[selectedProvider.providerKey] ?? []}
            onChange={updateProvider}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无服务商配置" />
        )}

        {Object.entries(probeResults).length > 0 && (
          <Row gutter={[16, 16]}>
            {Object.entries(probeResults).map(([providerKey, result]) => (
              <Col span={12} key={providerKey}>
                {isProviderKey(providerKey) ? (
                  <ProbeResultCard
                    providerKey={providerKey}
                    result={result ?? null}
                  />
                ) : null}
              </Col>
            ))}
          </Row>
        )}

        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无配置提示信息"
        />
      </Space>
    </div>
  );
}
