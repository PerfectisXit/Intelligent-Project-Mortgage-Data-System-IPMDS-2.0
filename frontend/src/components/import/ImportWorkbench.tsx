import React, { useCallback } from "react";
import {
  Card,
  Collapse,
  Descriptions,
  Space,
  Badge,
  Button,
  Segmented,
  Tag,
  Upload,
  message
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import {
  useHeaderMapping,
  useImportActions,
  useStreamingAnalyze
} from "../../hooks";
import {
  StreamLogPanel
} from "./StreamLogPanel";
import {
  HeaderMappingCard
} from "./HeaderMappingCard";
import {
  ImportActions
} from "./ImportActions";
import {
  ImportDiffTable
} from "../ImportDiffTable";
import { CommittedPreviewTable } from "../CommittedPreviewTable";

// 文件上传前验证
const beforeUpload = (file: File): boolean => {
  const isExcel =
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel";
  if (!isExcel) {
    message.error("请上传 Excel 文件 (.xlsx, .xls)");
    return false;
  }
  const isLt10M = file.size / 1024 / 1024 < 10;
  if (!isLt10M) {
    message.error("文件大小不能超过 10MB");
    return false;
  }
  return true;
};

export function ImportWorkbench() {
  const {
    uploadToken,
    headerSuggestions,
    standardFields,
    headerMappingOverride,
    headerReviewMode,
    headerReviewNotes,
    llmOutput,
    llmOverallOpinion,
    llmTrace,
    stageStatus,
    confirmingMapping,
    resetMapping,
    updateMappingOverride,
    setAnalyzeResult,
    commitMappingAndDiff
  } = useHeaderMapping();

  const {
    importLogId,
    rows,
    summary,
    headerMapping,
    audits,
    previewRows,
    committing,
    rollingBack,
    loadingAudits,
    loadingPreview,
    fixingRow,
    setImportResult,
    resetImportResult,
    commitImport,
    rollbackImport,
    loadAudits,
    loadCommittedPreview,
    manualFixErrorRow
  } = useImportActions();

  const { streamingAnalyze, streamEvents, loading, startAnalyze } =
    useStreamingAnalyze(setAnalyzeResult);

  const handleConfirmMapping = useCallback(async () => {
    const result = await commitMappingAndDiff();
    if (result) {
      setImportResult(
        result.importLogId,
        result.headerMapping,
        result.rows,
        result.summary
      );
      resetMapping();
    }
  }, [commitMappingAndDiff, setImportResult, resetMapping]);

  const handleCommitRollback = useCallback(async () => {
    await commitImport();
    await loadAudits();
    await loadCommittedPreview();
  }, [commitImport, rollbackImport, loadAudits, loadCommittedPreview]);

  // 关键字段检查
  const criticalHeaders = [
    "unit_code",
    "internal_external",
    "construction_unit",
    "general_contractor_unit",
    "subcontractor_unit",
    "subscribe_date",
    "sign_date"
  ];

  const mappedStdHeaders = new Set(Object.values(headerMapping || {}));
  const missingCriticalHeaders = criticalHeaders.filter(
    (h) => !mappedStdHeaders.has(h)
  );

  const handleManualFixRow = useCallback(
    async (rowNo: number, afterData: Record<string, unknown>, actionType?: "NEW" | "CHANGED") => {
      return manualFixErrorRow(rowNo, afterData, actionType);
    },
    [manualFixErrorRow]
  );

  return (
    <div>
      <Card title="智能导入与比对">
        <Upload
          accept=".xlsx,.xls"
          showUploadList={false}
          beforeUpload={beforeUpload}
          customRequest={async ({ file, onSuccess, onError }) => {
            if (!(file instanceof File)) {
              onError?.(new Error("无效文件对象"));
              return;
            }
            const success = await startAnalyze(file);
            if (success) {
              onSuccess?.({}, new XMLHttpRequest());
            } else {
              onError?.(new Error("上传失败"));
            }
          }}
        >
          <Button icon={<UploadOutlined />} loading={loading} type="primary" size="large">
            上传 Excel 并解析表头
          </Button>
        </Upload>

        <StreamLogPanel streaming={streamingAnalyze} events={streamEvents} />

        <ImportActions
          importLogId={importLogId}
          committing={committing}
          rollingBack={rollingBack}
          loadingAudits={loadingAudits}
          loadingPreview={loadingPreview}
          onCommit={handleCommitRollback}
          onRollback={rollbackImport}
          onLoadAudits={loadAudits}
          onLoadPreview={loadCommittedPreview}
        />
      </Card>

      <HeaderMappingCard
        uploadToken={uploadToken}
        headerSuggestions={headerSuggestions}
        standardFields={standardFields}
        headerMappingOverride={headerMappingOverride}
        headerReviewMode={headerReviewMode}
        headerReviewNotes={headerReviewNotes}
        llmOutput={llmOutput}
        llmOverallOpinion={llmOverallOpinion}
        llmTrace={llmTrace}
        stageStatus={stageStatus}
        confirmingMapping={confirmingMapping}
        onMappingChange={updateMappingOverride}
        onCancel={resetMapping}
        onConfirm={handleConfirmMapping}
      />

      {summary && (
        <Card title="导入摘要" style={{ marginTop: 16 }}>
          <Descriptions column={5}>
            <Descriptions.Item label="总行数">{summary.totalRows}</Descriptions.Item>
            <Descriptions.Item label="新增">
              <Badge count={summary.newRows} style={{ backgroundColor: "#52c41a" }} />
            </Descriptions.Item>
            <Descriptions.Item label="变更">
              <Badge count={summary.changedRows} style={{ backgroundColor: "#faad14" }} />
            </Descriptions.Item>
            <Descriptions.Item label="无变化">
              <Badge count={summary.unchangedRows} style={{ backgroundColor: "#d9d9d9" }} />
            </Descriptions.Item>
            <Descriptions.Item label="错误">
              <Badge count={summary.errorRows} style={{ backgroundColor: "#ff4d4f" }} />
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {Object.keys(headerMapping).length > 0 && (
        <Collapse style={{ marginTop: 16 }}>
          <Collapse.Panel header="表头诊断（导入识别）" key="1">
            <div style={{ marginBottom: 16 }}>
              <strong>关键字段识别状态：</strong>
              <div style={{ marginTop: 8 }}>
                {criticalHeaders.map((key) =>
                  mappedStdHeaders.has(key) ? (
                    <Tag key={key} color="green">{key}</Tag>
                  ) : (
                    <Tag key={key} color="red">{key} (未识别)</Tag>
                  )
                )}
              </div>
            </div>

            {missingCriticalHeaders.length > 0 ? (
              <Tag color="error">
                未识别关键字段：{missingCriticalHeaders.join(", ")}。
                这会导致入库明细对应列为空。
              </Tag>
            ) : (
              <Tag color="success">关键字段已全部识别。</Tag>
            )}

            <div style={{ marginTop: 16 }}>
              <strong>原始列 → 标准列 映射：</strong>
              <div style={{ marginTop: 8 }}>
                {Object.entries(headerMapping).map(([raw, std]) => (
                  <Tag key={`${raw}-${std}`} style={{ marginBottom: 4 }}>
                    {raw} → {std}
                  </Tag>
                ))}
              </div>
            </div>
          </Collapse.Panel>
        </Collapse>
      )}

      {rows.length > 0 && (
        <ImportDiffTable
          rows={rows}
          fixingRow={fixingRow}
          onManualFixRow={handleManualFixRow}
        />
      )}

      {audits.length > 0 && (
        <Card title="字段级审计明细" style={{ marginTop: 16 }}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Tag color="warning">审计明细已加载</Tag>
          </Space>
        </Card>
      )}

      {previewRows.length > 0 && <CommittedPreviewTable rows={previewRows} />}
    </div>
  );
}
