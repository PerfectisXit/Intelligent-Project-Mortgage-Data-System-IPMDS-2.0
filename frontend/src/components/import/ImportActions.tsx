import { Space, Tag, Button } from "antd";
import {
  CheckCircleOutlined,
  RollbackOutlined,
  EyeOutlined,
  FileDoneOutlined
} from "@ant-design/icons";

interface ImportActionsProps {
  importLogId: string;
  committing: boolean;
  rollingBack: boolean;
  loadingAudits: boolean;
  loadingPreview: boolean;
  onCommit: () => void;
  onRollback: () => void;
  onLoadAudits: () => void;
  onLoadPreview: () => void;
}

export function ImportActions({
  importLogId,
  committing,
  rollingBack,
  loadingAudits,
  loadingPreview,
  onCommit,
  onRollback,
  onLoadAudits,
  onLoadPreview
}: ImportActionsProps) {
  if (!importLogId) return null;

  return (
    <Space style={{ marginLeft: 12 }}>
      <Tag color="processing">批次: {importLogId}</Tag>
      <Button
        type="primary"
        icon={<CheckCircleOutlined />}
        loading={committing}
        onClick={onCommit}
      >
        提交入库
      </Button>
      <Button
        danger
        icon={<RollbackOutlined />}
        loading={rollingBack}
        onClick={onRollback}
      >
        回滚批次
      </Button>
      <Button
        icon={<EyeOutlined />}
        loading={loadingAudits}
        onClick={onLoadAudits}
      >
        查看审计明细
      </Button>
      <Button
        icon={<FileDoneOutlined />}
        loading={loadingPreview}
        onClick={onLoadPreview}
      >
        查看入库明细
      </Button>
    </Space>
  );
}
