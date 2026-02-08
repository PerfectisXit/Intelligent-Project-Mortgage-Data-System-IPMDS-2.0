CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  project_code VARCHAR(50) NOT NULL,
  project_name VARCHAR(200) NOT NULL,
  city VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_code)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (role IN ('admin', 'finance', 'sales', 'auditor'))
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(30),
  id_card_hash VARCHAR(128),
  id_card_masked VARCHAR(30),
  address TEXT,
  renamed_flag BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  unit_code VARCHAR(80) NOT NULL,
  unit_full_name VARCHAR(120),
  property_type VARCHAR(40) NOT NULL,
  area_m2 NUMERIC(12,2),
  listed_price NUMERIC(16,2),
  deal_price NUMERIC(16,2),
  status VARCHAR(30) NOT NULL,
  sale_status_raw VARCHAR(50),
  internal_external VARCHAR(20),
  current_customer_id UUID REFERENCES customers(id),
  dynamic_attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, unit_code),
  CHECK (status IN ('available','subscribed','signed','mortgage_offset_completed','cancelled'))
);

CREATE TABLE unit_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  reason VARCHAR(200),
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL UNIQUE,
  party_type VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (party_type IN ('subcontractor','general_contractor','payer','other'))
);

CREATE TABLE unit_counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  counterparty_id UUID NOT NULL REFERENCES counterparties(id),
  role_type VARCHAR(30) NOT NULL,
  UNIQUE (unit_id, counterparty_id, role_type),
  CHECK (role_type IN ('subcontractor','general_contractor','payer'))
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  txn_type VARCHAR(30) NOT NULL,
  installment_no INT,
  planned_date DATE,
  occurred_at TIMESTAMPTZ NOT NULL,
  amount NUMERIC(16,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  payment_method VARCHAR(30),
  ratio NUMERIC(8,6),
  note TEXT,
  source_import_log_id UUID,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (amount >= 0),
  CHECK (txn_type IN ('deposit','down_payment','installment','full_payment','refund','adjustment'))
);

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  file_type VARCHAR(30) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120),
  file_size BIGINT,
  sha256 VARCHAR(64),
  ocr_text TEXT,
  ocr_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  ocr_confidence NUMERIC(5,4),
  issue_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sha256),
  CHECK (file_type IN ('agreement','confirmation','id_card','other')),
  CHECK (issue_status IN ('pending','issued','rejected'))
);

CREATE TABLE import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID REFERENCES projects(id),
  source_file_name VARCHAR(255) NOT NULL,
  source_file_sha256 VARCHAR(64),
  import_type VARCHAR(30) NOT NULL DEFAULT 'excel',
  status VARCHAR(20) NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  new_rows INT NOT NULL DEFAULT 0,
  changed_rows INT NOT NULL DEFAULT 0,
  unchanged_rows INT NOT NULL DEFAULT 0,
  error_rows INT NOT NULL DEFAULT 0,
  header_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  diff_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_token UUID NOT NULL DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  CHECK (status IN ('uploaded','parsed','diffed','confirmed','rolled_back','failed'))
);

CREATE TABLE import_log_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_log_id UUID NOT NULL REFERENCES import_logs(id) ON DELETE CASCADE,
  row_no INT NOT NULL,
  action_type VARCHAR(20) NOT NULL,
  business_key VARCHAR(200),
  entity_type VARCHAR(30) NOT NULL,
  before_data JSONB,
  after_data JSONB,
  field_diffs JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  UNIQUE (import_log_id, row_no),
  CHECK (action_type IN ('NEW','CHANGED','UNCHANGED','ERROR')),
  CHECK (entity_type IN ('unit','customer','transaction'))
);

ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_import_log
  FOREIGN KEY (source_import_log_id) REFERENCES import_logs(id);

CREATE TABLE ai_interaction_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(80) NOT NULL,
  user_id UUID REFERENCES users(id),
  intent VARCHAR(50),
  request_payload JSONB NOT NULL,
  llm_model VARCHAR(80),
  llm_response JSONB,
  decision VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (decision IN ('confirmed','clarified','cancelled','failed'))
);

CREATE TABLE entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  entity_type VARCHAR(30) NOT NULL,
  alias_name VARCHAR(120) NOT NULL,
  canonical_name VARCHAR(200) NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, entity_type, alias_name)
);

CREATE INDEX idx_units_project_status ON units(project_id, status);
CREATE INDEX idx_transactions_unit_occurred ON transactions(unit_id, occurred_at DESC);
CREATE INDEX idx_import_logs_project_status ON import_logs(project_id, status);
CREATE INDEX idx_aliases_lookup ON entity_aliases(organization_id, entity_type, alias_name);
CREATE INDEX idx_counterparties_name_trgm ON counterparties USING GIN (name gin_trgm_ops);

COMMENT ON COLUMN units.unit_code IS '项目内唯一房号/车位号';
COMMENT ON COLUMN units.property_type IS '业态：住宅/办公/公寓/车位';
COMMENT ON COLUMN units.status IS '标准状态机状态';
COMMENT ON COLUMN units.dynamic_attrs IS '动态扩展字段，避免频繁改表';
COMMENT ON COLUMN transactions.txn_type IS '付款类型：定金/首付/分期/全款/退款/调整';
COMMENT ON COLUMN transactions.installment_no IS '分期序号，从1开始';
COMMENT ON COLUMN files.ocr_result IS 'OCR结构化结果(JSON)';
COMMENT ON COLUMN files.issue_status IS '文件开具状态';
COMMENT ON COLUMN import_logs.header_mapping IS '导入时表头映射关系';
COMMENT ON COLUMN import_log_rows.field_diffs IS '字段级差异，用于前端高亮';
