import { useState } from "react";
import {
  Layout,
  Space,
  Typography,
  Segmented,
  Card,
  Button,
  Upload,
  message,
  Tag
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { ImportWorkbench } from "../components/import";
import { CopilotCard } from "../components/CopilotCard";
import { ApiSettingsPage } from "../components/ApiSettingsPage";
import { useOcrProcess } from "../hooks";
import type { OcrLinkResponse } from "../types";

const { Header, Content } = Layout;

// OCR 上传组件
function OcrUploader() {
  const {
    ocrLoading,
    confirmingOcr,
    ocrResult,
    selectedUnitId,
    setSelectedUnitId,
    resetOcr,
    processOcr,
    confirmOcrLink
  } = useOcrProcess();

  const handleUpload = async (file: File) => {
    await processOcr(file);
  };

  return (
    <Card title="确认单 OCR 识别与房源关联">
      <Space direction="vertical" style={{ width: "100%" }}>
        <Upload
          accept=".pdf,.png,.jpg,.jpeg"
          showUploadList={false}
          beforeUpload={(file) => {
            const isValid =
              file.type === "application/pdf" ||
              file.type.startsWith("image/");
            if (!isValid) {
              message.error("请上传 PDF 或图片文件");
            }
            return isValid;
          }}
          customRequest={async ({ file, onSuccess, onError }) => {
            try {
              await handleUpload(file as File);
              onSuccess?.({}, new XMLHttpRequest());
            } catch {
              onError?.(new Error("OCR 处理失败"));
            }
          }}
        >
          <Button icon={<UploadOutlined />} loading={ocrLoading}>
            上传确认单（PDF/图片）
          </Button>
        </Upload>

        {ocrResult && (
          <Card size="small" title={`OCR 结果（置信度: ${ocrResult.ocr.confidence}）`}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {ocrResult.ocr.text || "(空文本)"}
              </pre>
              <Tag color={ocrResult.linked ? "green" : "orange"}>
                {ocrResult.linked ? "已自动关联" : "待人工确认"}
              </Tag>
              
              {ocrResult.unitCandidates.length > 1 && (
                <>
                  <Segmented
                    value={selectedUnitId}
                    onChange={(value) => setSelectedUnitId(value as string)}
                    options={ocrResult.unitCandidates.map((c: { unitCode: string; unitId: string }) => ({
                      label: c.unitCode,
                      value: c.unitId
                    }))}
                  />
                  <Button
                    type="primary"
                    loading={confirmingOcr}
                    disabled={!selectedUnitId || !ocrResult.fileId}
                    onClick={async () => {
                      const success = await confirmOcrLink();
                      if (success) {
                        resetOcr();
                      }
                    }}
                  >
                    确认关联
                  </Button>
                </>
              )}
            </Space>
          </Card>
        )}
      </Space>
    </Card>
  );
}

// 主应用组件
export default function App() {
  const [view, setView] = useState<"workbench" | "api-settings">("workbench");
  const [workbenchView, setWorkbenchView] = useState<
    "import" | "ocr" | "copilot"
  >("import");

  return (
    <Layout style={{ minHeight: "100vh", background: "#f4f6f8" }}>
      <Header style={{ background: "#1677ff", display: "flex", alignItems: "center" }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Title style={{ color: "#fff", margin: 0 }} level={4}>
            智能工抵台账管理系统
          </Typography.Title>
          <Segmented
            value={view}
            onChange={(value) => setView(value as "workbench" | "api-settings")}
            options={[
              { label: "工作台", value: "workbench" },
              { label: "API 设置", value: "api-settings" }
            ]}
          />
        </Space>
      </Header>

      <Content style={{ padding: 24 }}>
        {view === "api-settings" ? (
          <ApiSettingsPage />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <Segmented
              value={workbenchView}
              onChange={(value) =>
                setWorkbenchView(value as "import" | "ocr" | "copilot")
              }
              options={[
                { label: "导入与入库", value: "import" },
                { label: "OCR 识别", value: "ocr" },
                { label: "AI Copilot", value: "copilot" }
              ]}
            />

            {workbenchView === "import" && <ImportWorkbench />}
            {workbenchView === "ocr" && <OcrUploader />}
            {workbenchView === "copilot" && <CopilotCard />}
          </Space>
        )}
      </Content>
    </Layout>
  );
}
