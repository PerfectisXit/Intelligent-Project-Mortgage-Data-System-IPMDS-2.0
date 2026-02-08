CREATE TABLE IF NOT EXISTS import_change_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_log_id UUID NOT NULL REFERENCES import_logs(id) ON DELETE CASCADE,
  row_no INT NOT NULL,
  entity_type VARCHAR(30) NOT NULL,
  business_key VARCHAR(200),
  field_name VARCHAR(80) NOT NULL,
  before_value JSONB,
  after_value JSONB,
  applied BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (entity_type IN ('unit','customer','transaction'))
);

CREATE INDEX IF NOT EXISTS idx_import_change_audits_log_row
  ON import_change_audits(import_log_id, row_no);

CREATE INDEX IF NOT EXISTS idx_import_change_audits_field
  ON import_change_audits(import_log_id, field_name);
