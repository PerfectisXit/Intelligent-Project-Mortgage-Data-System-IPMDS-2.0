// 超时配置
export const TIMEOUT = {
  ANALYZE_WAIT_MS: 30000,
  COPILOT_WAIT_MS: 20000
} as const;

// 默认项目配置
export const DEFAULTS = {
  PROJECT_ID: "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa",
  ORGANIZATION_ID: "9f4af2dc-7f29-4e91-aa74-68db4f9e6f9b"
} as const;

// 用户角色
export const ROLES = {
  ADMIN: "admin",
  FINANCE: "finance",
  SALES: "sales",
  AUDITOR: "auditor"
} as const;

// 上传配置
export const UPLOAD = {
  MAX_SIZE_MB: 10,
  ACCEPT_TYPES: ".xlsx,.xls",
  MAX_SIZE_BYTES: 10 * 1024 * 1024
} as const;

// 关键字段
export const CRITICAL_HEADERS = [
  "unit_code",
  "internal_external",
  "construction_unit",
  "general_contractor_unit",
  "subcontractor_unit",
  "subscribe_date",
  "sign_date"
] as const;

// API 状态
export const API_STATUS = {
  SUCCESS: 200,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  PAYLOAD_TOO_LARGE: 413,
  SERVER_ERROR: 500
} as const;
