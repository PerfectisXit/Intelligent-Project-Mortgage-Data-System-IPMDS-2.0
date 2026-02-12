import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { requestExcelDiff } from "./pythonClient.js";
import type { DiffRow } from "../types/api.js";

type InMemoryImport = {
  rows: DiffRow[];
  summary: Record<string, number>;
  status: "diffed" | "confirmed" | "rolled_back";
};

type FieldDiff = { before: unknown; after: unknown };

const inMemoryStore = new Map<string, InMemoryImport>();
const phoneSplitRegex = /[，,;；/\s]+/;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuidOrNull(value?: string | null): string | null {
  if (!value) return null;
  return uuidRegex.test(value) ? value : null;
}

function normalizePaymentMethodValue(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (lowered === "一次性" || lowered === "全款") return "full_payment";
  if (lowered === "商贷" || lowered === "商业贷款" || lowered === "商业按揭") return "mortgage";
  if (lowered === "分期" || lowered === "分期付款") return "installment";
  return lowered === "other" ? "other" : "other";
}

function parsePrimaryPhone(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const parts = text
    .split(phoneSplitRegex)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts[0] ?? null;
}

function toRenameRequired(value: unknown): boolean | null {
  const text = asString(value);
  if (!text) return null;
  if (text.includes("否")) return false;
  if (text.includes("是") || text.includes("待定") || text.includes("流程")) return true;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function normalizeDateOnly(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}

function toUnitStatus(saleStatusRaw: unknown): string {
  const text = asString(saleStatusRaw) ?? "";
  if (text.includes("签约")) return "signed";
  if (text.includes("认购")) return "subscribed";
  if (text.includes("工抵完成")) return "mortgage_offset_completed";
  return "available";
}

function parseFieldDiffs(value: unknown): Record<string, FieldDiff> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, FieldDiff> = {};
  for (const [field, payload] of Object.entries(value as Record<string, unknown>)) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const obj = payload as Record<string, unknown>;
    result[field] = { before: obj.before, after: obj.after };
  }
  return result;
}

async function insertAuditRows(params: {
  client: PoolClient;
  importLogId: string;
  rowNo: number;
  entityType: "unit" | "customer" | "transaction";
  businessKey: string | null;
  fieldDiffs: Record<string, FieldDiff>;
  applied: boolean;
  errorMessage?: string;
}) {
  const entries = Object.entries(params.fieldDiffs);
  if (entries.length === 0) return;
  for (const [fieldName, diff] of entries) {
    await params.client.query(
      `INSERT INTO import_change_audits (
         import_log_id, row_no, entity_type, business_key, field_name,
         before_value, after_value, applied, error_message
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
      [
        params.importLogId,
        params.rowNo,
        params.entityType,
        params.businessKey,
        fieldName,
        JSON.stringify(diff.before ?? null),
        JSON.stringify(diff.after ?? null),
        params.applied,
        params.errorMessage ?? null
      ]
    );
  }
}

async function findOrCreateCustomerId(params: {
  client: PoolClient;
  name: string;
  phone?: string | null;
  address?: string | null;
  idCard?: string | null;
}) {
  const existing = await params.client.query(
    `SELECT id FROM customers WHERE name = $1 ORDER BY created_at ASC LIMIT 1`,
    [params.name]
  );
  if (existing.rowCount) {
    return existing.rows[0].id as string;
  }
  const created = await params.client.query(
    `INSERT INTO customers (name, phone, address, id_card_masked)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [params.name, params.phone ?? null, params.address ?? null, params.idCard ?? null]
  );
  return created.rows[0].id as string;
}

async function findOrCreateCounterpartyId(params: {
  client: PoolClient;
  name: string;
  partyType: "subcontractor" | "general_contractor" | "other";
}) {
  const existing = await params.client.query(`SELECT id FROM counterparties WHERE name = $1 LIMIT 1`, [params.name]);
  if (existing.rowCount) return existing.rows[0].id as string;
  const created = await params.client.query(
    `INSERT INTO counterparties (name, party_type)
     VALUES ($1, $2)
     RETURNING id`,
    [params.name, params.partyType]
  );
  return created.rows[0].id as string;
}

async function bindUnitCounterparty(params: {
  client: PoolClient;
  unitId: string;
  counterpartyName: string | null;
  roleType: "subcontractor" | "general_contractor";
}) {
  const name = (params.counterpartyName ?? "").trim();
  if (!name) return;
  const counterpartyId = await findOrCreateCounterpartyId({
    client: params.client,
    name,
    partyType: params.roleType
  });
  await params.client.query(
    `INSERT INTO unit_counterparties (unit_id, counterparty_id, role_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (unit_id, counterparty_id, role_type) DO NOTHING`,
    [params.unitId, counterpartyId, params.roleType]
  );
}

function fileSha256(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function createImportAndDiff(params: {
  organizationId: string;
  projectId: string;
  userId?: string;
  sourceFileName: string;
  filePath: string;
  headerMappingOverride?: Record<string, string>;
}) {
  const fileHash = fileSha256(params.filePath);

  const existingRows: Array<Record<string, unknown>> = [];
  if (pool && !env.mockMode) {
    const result = await pool.query(
      `SELECT p.project_name as project,
              u.unit_code,
              u.property_type,
              u.area_m2,
              u.deal_price,
              u.sale_status_raw as sale_status,
              u.internal_external,
              NULLIF(u.dynamic_attrs->>'construction_unit', '') as construction_unit,
              NULLIF(u.dynamic_attrs->>'general_contractor_unit', '') as general_contractor_unit,
              NULLIF(u.dynamic_attrs->>'subcontractor_unit', '') as subcontractor_unit,
              NULLIF(u.dynamic_attrs->>'subscribe_date', '') as subscribe_date,
              NULLIF(u.dynamic_attrs->>'rename_status_raw', '') as rename_status_raw,
              NULLIF(u.dynamic_attrs->>'receipt_ratio_input', '') as receipt_ratio_input,
              NULLIF(u.dynamic_attrs->>'undelivered_note', '') as undelivered_note,
              COALESCE(NULLIF(u.dynamic_attrs->>'sign_date', ''), t.occurred_at::date::text) as sign_date,
              c.name as customer_name,
              c.phone as phone,
              c.address as address,
              c.id_card_masked as id_card,
              t.amount as actual_received,
              t.payment_method,
              t.occurred_at::date as latest_txn_date
       FROM units u
       JOIN projects p ON p.id = u.project_id
       LEFT JOIN customers c ON c.id = u.current_customer_id
       LEFT JOIN LATERAL (
         SELECT amount, payment_method, occurred_at
         FROM transactions tx
         WHERE tx.unit_id = u.id
         ORDER BY occurred_at DESC
         LIMIT 1
       ) t ON true
       WHERE u.project_id = $1`,
      [params.projectId]
    );
    existingRows.push(...result.rows);
  }

  const diff = await requestExcelDiff({
    filePath: path.resolve(params.filePath),
    existingRows,
    headerMappingOverride: params.headerMappingOverride ?? {}
  });

  if (!pool || env.mockMode) {
    const mockId = crypto.randomUUID();
    inMemoryStore.set(mockId, {
      rows: diff.rows,
      summary: {
        totalRows: diff.summary.totalRows,
        newRows: diff.summary.newRows,
        changedRows: diff.summary.changedRows,
        unchangedRows: diff.summary.unchangedRows,
        errorRows: diff.summary.errorRows
      },
      status: "diffed"
    });
    return { importLogId: mockId, ...diff };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const importLogInsert = await client.query(
      `INSERT INTO import_logs (
        organization_id, project_id, source_file_name, source_file_sha256,
        status, total_rows, new_rows, changed_rows, unchanged_rows, error_rows,
        header_mapping, diff_summary, created_by
      ) VALUES ($1,$2,$3,$4,'diffed',$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
      RETURNING id`,
      [
        params.organizationId,
        params.projectId,
        params.sourceFileName,
        fileHash,
        diff.summary.totalRows,
        diff.summary.newRows,
        diff.summary.changedRows,
        diff.summary.unchangedRows,
        diff.summary.errorRows,
        JSON.stringify(diff.headerMapping),
        JSON.stringify(diff.summary),
        params.userId ?? null
      ]
    );
    const importLogId = importLogInsert.rows[0].id as string;

    for (const row of diff.rows) {
      await client.query(
        `INSERT INTO import_log_rows (
          import_log_id, row_no, action_type, business_key, entity_type,
          before_data, after_data, field_diffs, error_message
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
        [
          importLogId,
          row.rowNo,
          row.actionType,
          row.businessKey,
          row.entityType,
          JSON.stringify(row.beforeData ?? null),
          JSON.stringify(row.afterData ?? null),
          JSON.stringify(row.fieldDiffs ?? {}),
          row.errorMessage ?? null
        ]
      );
    }

    await client.query("COMMIT");
    return { importLogId, ...diff };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getImportDiff(importLogId: string) {
  if (!pool || env.mockMode) {
    const value = inMemoryStore.get(importLogId);
    if (!value) {
      throw new Error("Import log not found");
    }
    return value;
  }

  const rows = await pool.query(
    `SELECT row_no, action_type, business_key, entity_type, before_data, after_data, field_diffs, error_message
     FROM import_log_rows WHERE import_log_id = $1 ORDER BY row_no ASC`,
    [importLogId]
  );
  return { rows: rows.rows };
}

export async function getImportAudits(importLogId: string) {
  if (!pool || env.mockMode) {
    const value = inMemoryStore.get(importLogId);
    if (!value) {
      throw new Error("Import log not found");
    }
    const audits = value.rows.flatMap((row) =>
      Object.entries(row.fieldDiffs ?? {}).map(([fieldName, diff]) => ({
        row_no: row.rowNo,
        entity_type: row.entityType,
        business_key: row.businessKey,
        field_name: fieldName,
        before_value: diff.before ?? null,
        after_value: diff.after ?? null,
        applied: value.status !== "rolled_back",
        error_message: null
      }))
    );
    return { rows: audits };
  }

  const rows = await pool.query(
    `SELECT row_no, entity_type, business_key, field_name, before_value, after_value, applied, error_message, created_at
     FROM import_change_audits
     WHERE import_log_id = $1
     ORDER BY row_no ASC, field_name ASC`,
    [importLogId]
  );
  return { rows: rows.rows };
}

export async function getCommittedPreview(importLogId: string) {
  if (!pool || env.mockMode) {
    const value = inMemoryStore.get(importLogId);
    if (!value) {
      throw new Error("Import log not found");
    }
    const rows = value.rows
      .filter((row) => row.actionType === "NEW" || row.actionType === "CHANGED")
      .map((row) => {
        const afterData = row.afterData ?? {};
        return {
          project_name: String(afterData.project ?? ""),
          unit_code: String(afterData.unit_code ?? ""),
          property_type: String(afterData.property_type ?? ""),
          area_m2: afterData.area_m2 ?? null,
          deal_price: afterData.deal_price ?? null,
          status: String(afterData.sale_status ?? ""),
          status_display:
            (afterData.subscribe_date ? (afterData.sign_date ? "已签约" : "认购未签约") : "未认购"),
          status_basis: `认购时间=${afterData.subscribe_date ?? "-"}；签约时间=${afterData.sign_date ?? "-"}；判定=${
            afterData.subscribe_date ? (afterData.sign_date ? "已签约" : "认购未签约") : "未认购"
          }`,
          sale_status_raw: String(afterData.sale_status ?? ""),
          internal_external: String(afterData.internal_external ?? ""),
          construction_unit: (afterData.construction_unit as string | null) ?? null,
          construction_unit_inferred: null,
          construction_unit_source: (afterData.construction_unit as string | null) ? "imported" : "missing",
          general_contractor_unit: (afterData.general_contractor_unit as string | null) ?? null,
          general_contractor_unit_inferred: null,
          general_contractor_unit_source: (afterData.general_contractor_unit as string | null)
            ? "imported"
            : "missing",
          subcontractor_unit: (afterData.subcontractor_unit as string | null) ?? null,
          subcontractor_unit_inferred: null,
          subcontractor_unit_source: (afterData.subcontractor_unit as string | null) ? "imported" : "missing",
          subscribe_date: (afterData.subscribe_date as string | null) ?? null,
          subscribe_date_inferred: null,
          subscribe_date_source: (afterData.subscribe_date as string | null) ? "imported" : "missing",
          sign_date: (afterData.sign_date as string | null) ?? null,
          sign_date_inferred: null,
          sign_date_source: (afterData.sign_date as string | null) ? "imported" : "missing",
          customer_name: String(afterData.customer_name ?? ""),
          phone: String(afterData.phone ?? ""),
          actual_received_latest: afterData.actual_received ?? null,
          total_received: afterData.actual_received ?? null,
          last_txn_type: null,
          last_txn_occurred_at: afterData.sign_date ?? null,
          last_txn_amount: afterData.actual_received ?? null,
          last_payment_method: afterData.payment_method ?? null,
          last_import_log_id: importLogId,
          updated_at: null,
          last_update_source: "excel_import",
          last_update_file_name: null,
          last_update_session_id: null
        };
      });
    return { rows };
  }

  const importLogRes = await pool.query(`SELECT project_id FROM import_logs WHERE id = $1`, [importLogId]);
  if (!importLogRes.rowCount) {
    throw new Error("Import log not found");
  }
  const projectId = importLogRes.rows[0].project_id as string;

  const rows = await pool.query(
    `WITH target_units AS (
       SELECT DISTINCT after_data->>'unit_code' AS unit_code
       FROM import_log_rows
       WHERE import_log_id = $1
         AND action_type IN ('NEW','CHANGED')
         AND COALESCE(after_data->>'unit_code', '') <> ''
     ),
     tx_agg AS (
       SELECT
         t.unit_id,
         SUM(CASE WHEN t.txn_type = 'refund' THEN -t.amount ELSE t.amount END) AS total_received
       FROM transactions t
       GROUP BY t.unit_id
     ),
     tx_last AS (
       SELECT DISTINCT ON (t.unit_id)
         t.unit_id,
         t.txn_type,
         t.occurred_at,
         t.amount,
         t.payment_method,
         t.note
       FROM transactions t
       ORDER BY t.unit_id, t.occurred_at DESC, t.created_at DESC
     )
     SELECT
       p.project_name,
       u.unit_code,
       u.property_type,
       u.area_m2,
       u.deal_price,
       u.status,
       CASE
         WHEN COALESCE(NULLIF(u.dynamic_attrs->>'subscribe_date', ''), '') <> ''
              AND COALESCE(NULLIF(u.dynamic_attrs->>'sign_date', ''), '') <> '' THEN '已签约'
         WHEN COALESCE(NULLIF(u.dynamic_attrs->>'subscribe_date', ''), '') <> '' THEN '认购未签约'
         ELSE '未认购'
       END AS status_display,
       CONCAT(
         '认购时间=',
         COALESCE(NULLIF(u.dynamic_attrs->>'subscribe_date', ''), '-'),
         '；签约时间=',
         COALESCE(NULLIF(u.dynamic_attrs->>'sign_date', ''), '-'),
         '；判定=',
         CASE
           WHEN COALESCE(NULLIF(u.dynamic_attrs->>'subscribe_date', ''), '') <> ''
                AND COALESCE(NULLIF(u.dynamic_attrs->>'sign_date', ''), '') <> '' THEN '已签约'
           WHEN COALESCE(NULLIF(u.dynamic_attrs->>'subscribe_date', ''), '') <> '' THEN '认购未签约'
           ELSE '未认购'
         END
       ) AS status_basis,
       u.sale_status_raw,
       u.internal_external,
       COALESCE(
         NULLIF(u.dynamic_attrs->>'construction_unit', ''),
         ''
       ) AS construction_unit,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'construction_unit', '') IS NOT NULL THEN ''
         WHEN COALESCE(u.internal_external, '') LIKE '%内%' THEN org.name
         ELSE ''
       END AS construction_unit_inferred,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'construction_unit', '') IS NOT NULL THEN 'imported'
         WHEN COALESCE(u.internal_external, '') LIKE '%内%' AND COALESCE(org.name, '') <> '' THEN 'inferred_internal'
         ELSE 'missing'
       END AS construction_unit_source,
       COALESCE(NULLIF(u.dynamic_attrs->>'general_contractor_unit', ''), '') AS general_contractor_unit,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'general_contractor_unit', '') IS NOT NULL THEN ''
         WHEN COALESCE(u.internal_external, '') LIKE '%内%' AND COALESCE(org.name, '') <> '' THEN org.name
         ELSE COALESCE(uc_roles.general_contractor_unit, '')
       END AS general_contractor_unit_inferred,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'general_contractor_unit', '') IS NOT NULL THEN 'imported'
         WHEN COALESCE(u.internal_external, '') LIKE '%内%' AND COALESCE(org.name, '') <> '' THEN 'inferred_internal'
         WHEN COALESCE(uc_roles.general_contractor_unit, '') <> '' THEN 'inferred_relation'
         ELSE 'missing'
       END AS general_contractor_unit_source,
       COALESCE(NULLIF(u.dynamic_attrs->>'subcontractor_unit', ''), '') AS subcontractor_unit,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'subcontractor_unit', '') IS NOT NULL THEN ''
         ELSE COALESCE(uc_roles.subcontractor_unit, '')
       END AS subcontractor_unit_inferred,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'subcontractor_unit', '') IS NOT NULL THEN 'imported'
         WHEN COALESCE(uc_roles.subcontractor_unit, '') <> '' THEN 'inferred_relation'
         ELSE 'missing'
       END AS subcontractor_unit_source,
       COALESCE(NULLIF(u.dynamic_attrs->>'subscribe_date', ''), '') AS subscribe_date,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'subscribe_date', '') IS NOT NULL THEN ''
         WHEN u.status = 'subscribed' AND tx_last.occurred_at IS NOT NULL THEN tx_last.occurred_at::date::text
         ELSE ''
       END AS subscribe_date_inferred,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'subscribe_date', '') IS NOT NULL THEN 'imported'
         WHEN u.status = 'subscribed' AND tx_last.occurred_at IS NOT NULL THEN 'inferred_txn'
         ELSE 'missing'
       END AS subscribe_date_source,
       COALESCE(NULLIF(u.dynamic_attrs->>'sign_date', ''), '') AS sign_date,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'sign_date', '') IS NOT NULL THEN ''
         WHEN u.status = 'signed' AND tx_last.occurred_at IS NOT NULL THEN tx_last.occurred_at::date::text
         ELSE ''
       END AS sign_date_inferred,
       CASE
         WHEN NULLIF(u.dynamic_attrs->>'sign_date', '') IS NOT NULL THEN 'imported'
         WHEN u.status = 'signed' AND tx_last.occurred_at IS NOT NULL THEN 'inferred_txn'
         ELSE 'missing'
       END AS sign_date_source,
       c.name AS customer_name,
       c.phone AS phone,
       tx_last.amount AS actual_received_latest,
       tx_agg.total_received,
       tx_last.txn_type AS last_txn_type,
       tx_last.occurred_at AS last_txn_occurred_at,
       tx_last.amount AS last_txn_amount,
       tx_last.payment_method AS last_payment_method,
       COALESCE(u.dynamic_attrs->>'last_import_log_id', '') AS last_import_log_id,
       u.updated_at,
       COALESCE(
         NULLIF(u.dynamic_attrs->>'last_update_source', ''),
         CASE
           WHEN COALESCE(u.dynamic_attrs->>'last_import_log_id', '') <> '' THEN 'excel_import'
           ELSE 'unknown'
         END
       ) AS last_update_source,
       COALESCE(NULLIF(u.dynamic_attrs->>'last_update_file_name', ''), il_last.source_file_name, '') AS last_update_file_name,
       COALESCE(NULLIF(u.dynamic_attrs->>'last_update_session_id', ''), '') AS last_update_session_id
     FROM units u
     JOIN target_units tu ON tu.unit_code = u.unit_code
     LEFT JOIN customers c ON c.id = u.current_customer_id
     LEFT JOIN projects p ON p.id = u.project_id
     LEFT JOIN organizations org ON org.id = p.organization_id
     LEFT JOIN import_logs il_last
       ON il_last.id = CASE
         WHEN COALESCE(u.dynamic_attrs->>'last_import_log_id', '') ~* '^[0-9a-f-]{36}$'
           THEN (u.dynamic_attrs->>'last_import_log_id')::uuid
         ELSE NULL
       END
     LEFT JOIN LATERAL (
       SELECT
         MAX(CASE WHEN uc.role_type = 'general_contractor' THEN cp.name END) AS general_contractor_unit,
         MAX(CASE WHEN uc.role_type = 'subcontractor' THEN cp.name END) AS subcontractor_unit
       FROM unit_counterparties uc
       JOIN counterparties cp ON cp.id = uc.counterparty_id
       WHERE uc.unit_id = u.id
     ) uc_roles ON TRUE
     LEFT JOIN tx_agg ON tx_agg.unit_id = u.id
     LEFT JOIN tx_last ON tx_last.unit_id = u.id
     WHERE u.project_id = $2
     ORDER BY u.unit_code ASC`,
    [importLogId, projectId]
  );

  return { rows: rows.rows };
}

export async function commitImport(importLogId: string, userId?: string) {
  if (!pool || env.mockMode) {
    const current = inMemoryStore.get(importLogId);
    if (!current) throw new Error("Import log not found");
    if (current.status !== "diffed") throw new Error("Only diffed imports can be committed");
    current.status = "confirmed";
    inMemoryStore.set(importLogId, current);
    return { status: "confirmed", committedRows: current.rows.length };
  }

  const client = await pool.connect();
  try {
    const userIdForDb = asUuidOrNull(userId ?? null);
    await client.query("BEGIN");
    const importLogRes = await client.query(
      `SELECT id, project_id, status, source_file_name FROM import_logs WHERE id = $1 FOR UPDATE`,
      [importLogId]
    );
    if (!importLogRes.rowCount) throw new Error("Import log not found");
    const importLog = importLogRes.rows[0];
    if (importLog.status !== "diffed") throw new Error("Only diffed imports can be committed");

    const orgNameRes = await client.query(
      `SELECT o.name
       FROM projects p
       JOIN organizations o ON o.id = p.organization_id
       WHERE p.id = $1
       LIMIT 1`,
      [importLog.project_id as string]
    );
    const organizationName = (orgNameRes.rows[0]?.name as string | undefined) ?? "";

    const rowsRes = await client.query(
      `SELECT row_no, action_type, business_key, entity_type, before_data, after_data, field_diffs
       FROM import_log_rows
       WHERE import_log_id = $1
       ORDER BY row_no ASC`,
      [importLogId]
    );

    let committedRows = 0;
    let preciseUpdatedRows = 0;
    let auditedFields = 0;
    let skippedRows = 0;
    for (const row of rowsRes.rows) {
      if (row.action_type === "UNCHANGED" || row.action_type === "ERROR") continue;
      const fieldDiffs = parseFieldDiffs(row.field_diffs);
      auditedFields += Object.keys(fieldDiffs).length;
      const afterData = (row.after_data ?? {}) as Record<string, unknown>;
      const unitCode = asString(afterData.unit_code);
      if (!unitCode) {
        skippedRows += 1;
        await insertAuditRows({
          client,
          importLogId,
          rowNo: row.row_no as number,
          entityType: "unit",
          businessKey: (row.business_key as string | null) ?? null,
          fieldDiffs: Object.keys(fieldDiffs).length
            ? fieldDiffs
            : { unit_code: { before: null, after: afterData.unit_code ?? null } },
          applied: false,
          errorMessage: "Missing unit_code"
        });
        continue;
      }

      const customerName = asString(afterData.customer_name);
      const customerPhoneRaw = asString(afterData.phone);
      const customerPhone = parsePrimaryPhone(customerPhoneRaw);
      const customerAddress = asString(afterData.address);
      const customerIdCard = asString(afterData.id_card);
      let customerId: string | null = null;
      if (customerName) {
        customerId = await findOrCreateCustomerId({
          client,
          name: customerName,
          phone: customerPhone,
          address: customerAddress,
          idCard: customerIdCard
        });
      }

      const actionType = row.action_type as string;
      let unitId: string;

      if (actionType === "NEW") {
        const propertyType = asString(afterData.property_type) ?? "住宅";
        const area = asNumber(afterData.area_m2);
        const dealPrice = asNumber(afterData.deal_price);
        const saleStatusRaw = asString(afterData.sale_status) ?? null;
        const internalExternal = asString(afterData.internal_external);
        const status = toUnitStatus(saleStatusRaw);
        const upsertUnitRes = await client.query(
          `INSERT INTO units (
            project_id, unit_code, property_type, area_m2, deal_price,
            status, sale_status_raw, internal_external, current_customer_id, dynamic_attrs
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
          ON CONFLICT (project_id, unit_code)
          DO UPDATE SET
            property_type = EXCLUDED.property_type,
            area_m2 = COALESCE(EXCLUDED.area_m2, units.area_m2),
            deal_price = COALESCE(EXCLUDED.deal_price, units.deal_price),
            status = EXCLUDED.status,
            sale_status_raw = EXCLUDED.sale_status_raw,
            internal_external = COALESCE(EXCLUDED.internal_external, units.internal_external),
            current_customer_id = COALESCE(EXCLUDED.current_customer_id, units.current_customer_id),
            dynamic_attrs = COALESCE(units.dynamic_attrs, '{}'::jsonb) || jsonb_build_object('last_import_log_id', $11::text),
            updated_at = NOW()
          RETURNING id`,
          [
            importLog.project_id as string,
            unitCode,
            propertyType,
            area,
            dealPrice,
            status,
            saleStatusRaw,
            internalExternal,
            customerId,
            JSON.stringify({
              created_import_log_id: importLogId,
              last_import_log_id: importLogId,
              last_update_source: "excel_import",
              last_update_file_name: importLog.source_file_name ?? null
            }),
            importLogId
          ]
        );
        unitId = upsertUnitRes.rows[0].id as string;
      } else {
        const unitRes = await client.query(
          `SELECT id FROM units WHERE project_id = $1 AND unit_code = $2 LIMIT 1`,
          [importLog.project_id as string, unitCode]
        );
        if (!unitRes.rowCount) {
          skippedRows += 1;
          await insertAuditRows({
            client,
            importLogId,
            rowNo: row.row_no as number,
            entityType: "unit",
            businessKey: (row.business_key as string | null) ?? null,
            fieldDiffs,
            applied: false,
            errorMessage: "CHANGED row cannot be applied because unit does not exist"
          });
          continue;
        }
        unitId = unitRes.rows[0].id as string;
        const updates: string[] = [];
        const values: Array<string | number | null> = [unitId];
        let idx = 2;
        if (fieldDiffs.property_type) {
          updates.push(`property_type = $${idx++}`);
          values.push(asString(afterData.property_type) ?? "住宅");
        }
        if (fieldDiffs.area_m2) {
          updates.push(`area_m2 = $${idx++}`);
          values.push(asNumber(afterData.area_m2));
        }
        if (fieldDiffs.deal_price) {
          updates.push(`deal_price = $${idx++}`);
          values.push(asNumber(afterData.deal_price));
        }
        if (fieldDiffs.internal_external) {
          updates.push(`internal_external = $${idx++}`);
          values.push(asString(afterData.internal_external));
        }
        if (fieldDiffs.sale_status) {
          const saleStatusRaw = asString(afterData.sale_status);
          updates.push(`sale_status_raw = $${idx++}`);
          values.push(saleStatusRaw);
          updates.push(`status = $${idx++}`);
          values.push(toUnitStatus(saleStatusRaw));
        }
        if (
          customerId &&
          (fieldDiffs.customer_name || fieldDiffs.phone || fieldDiffs.address || fieldDiffs.id_card)
        ) {
          updates.push(`current_customer_id = $${idx++}`);
          values.push(customerId);
        }
        updates.push(
          `dynamic_attrs = COALESCE(dynamic_attrs, '{}'::jsonb) || jsonb_build_object('last_import_log_id', $${idx++}::text)`
        );
        values.push(importLogId);
        updates.push(`updated_at = NOW()`);
        if (updates.length > 0) {
          await client.query(`UPDATE units SET ${updates.join(", ")} WHERE id = $1`, values);
          preciseUpdatedRows += 1;
        }
      }

      const actualReceived = asNumber(afterData.actual_received);
      const paymentMethod = normalizePaymentMethodValue(afterData.payment_method_std ?? afterData.payment_method);
      const signDate = normalizeDateOnly(afterData.sign_date);
      const subscribeDate = normalizeDateOnly(afterData.subscribe_date);
      const constructionUnitRaw = asString(afterData.construction_unit);
      const generalContractorRaw = asString(afterData.general_contractor_unit);
      const subcontractorRaw = asString(afterData.subcontractor_unit);
      const renameStatusRaw = asString(afterData.rename_status_raw);
      const renameRequired = toRenameRequired(renameStatusRaw);
      const undeliveredNote = asString(afterData.undelivered_note);
      const receiptRatioInput = asNumber(afterData.receipt_ratio_input);
      const dealPrice = asNumber(afterData.deal_price);
      const receiptRatioCalc = actualReceived != null && dealPrice != null && dealPrice > 0 ? actualReceived / dealPrice : null;
      const receiptRatioDelta =
        receiptRatioCalc != null && receiptRatioInput != null ? receiptRatioCalc - receiptRatioInput : null;
      const dealPricePerM2 = asNumber(afterData.deal_price_per_m2);
      const isInternal = (asString(afterData.internal_external) ?? "").includes("内");
      const constructionUnit = constructionUnitRaw ?? (isInternal ? organizationName : null);
      const generalContractorUnit = generalContractorRaw ?? (isInternal ? organizationName : null);
      const subcontractorUnit = subcontractorRaw;

      await client.query(
        `UPDATE units
         SET dynamic_attrs = COALESCE(dynamic_attrs, '{}'::jsonb) || jsonb_strip_nulls(
           jsonb_build_object(
             'construction_unit', $2::text,
             'general_contractor_unit', $3::text,
             'subcontractor_unit', $4::text,
             'subscribe_date', $5::text,
             'sign_date', $6::text,
             'last_import_log_id', $7::text,
             'rename_status_raw', $8::text,
             'rename_required', $9::boolean,
             'undelivered_note', $10::text,
             'receipt_ratio_input', $11::numeric,
             'receipt_ratio_calc', $12::numeric,
             'receipt_ratio_delta', $13::numeric,
             'contact_phones_raw', $14::text,
             'deal_price_per_m2', $15::numeric,
             'last_update_source', $16::text,
             'last_update_file_name', $17::text
           )
         ),
         updated_at = NOW()
         WHERE id = $1`,
        [
          unitId,
          constructionUnit,
          generalContractorUnit,
          subcontractorUnit,
          subscribeDate,
          signDate,
          importLogId,
          renameStatusRaw,
          renameRequired,
          undeliveredNote,
          receiptRatioInput,
          receiptRatioCalc,
          receiptRatioDelta,
          customerPhoneRaw,
          dealPricePerM2,
          "excel_import",
          (importLog.source_file_name as string | null) ?? null
        ]
      );

      await bindUnitCounterparty({
        client,
        unitId,
        counterpartyName: generalContractorUnit,
        roleType: "general_contractor"
      });
      await bindUnitCounterparty({
        client,
        unitId,
        counterpartyName: subcontractorUnit,
        roleType: "subcontractor"
      });

      if (actionType === "NEW" && actualReceived && actualReceived > 0) {
        await client.query(
          `INSERT INTO transactions (
            unit_id, txn_type, occurred_at, amount, payment_method, source_import_log_id, created_by, note
          ) VALUES ($1,'adjustment',COALESCE($2::timestamptz, NOW()),$3,$4,$5,$6,$7)`,
          [
            unitId,
            signDate ? `${signDate}T00:00:00+08:00` : null,
            actualReceived,
            paymentMethod,
            importLogId,
            userIdForDb,
            `Import commit row ${row.row_no}`
          ]
        );
      }
      if (actionType === "CHANGED" && fieldDiffs.actual_received) {
        const beforeAmount = asNumber(fieldDiffs.actual_received.before) ?? 0;
        const afterAmount = asNumber(fieldDiffs.actual_received.after) ?? 0;
        const delta = afterAmount - beforeAmount;
        if (delta !== 0) {
          const txnType = delta > 0 ? "adjustment" : "refund";
          await client.query(
            `INSERT INTO transactions (
              unit_id, txn_type, occurred_at, amount, payment_method, source_import_log_id, created_by, note
            ) VALUES ($1,$2,COALESCE($3::timestamptz, NOW()),$4,$5,$6,$7,$8)`,
            [
              unitId,
              txnType,
              signDate ? `${signDate}T00:00:00+08:00` : null,
              Math.abs(delta),
              paymentMethod,
              importLogId,
              userIdForDb,
              `Import ${txnType} row ${row.row_no}, delta=${delta}`
            ]
          );
        }
      }
      await insertAuditRows({
        client,
        importLogId,
        rowNo: row.row_no as number,
        entityType: (row.entity_type as "unit" | "customer" | "transaction") ?? "unit",
        businessKey: (row.business_key as string | null) ?? null,
        fieldDiffs,
        applied: true
      });
      committedRows += 1;
    }

    await client.query(
      `UPDATE import_logs
       SET status = 'confirmed',
           confirmed_at = NOW(),
           diff_summary = COALESCE(diff_summary, '{}'::jsonb) || jsonb_build_object('committed_rows', $2::int, 'precise_updated_rows', $3::int, 'audited_fields', $4::int, 'skipped_rows', $5::int, 'committed_at', NOW())
       WHERE id = $1`,
      [importLogId, committedRows, preciseUpdatedRows, auditedFields, skippedRows]
    );
    await client.query("COMMIT");
    return { status: "confirmed", committedRows, preciseUpdatedRows, auditedFields, skippedRows };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackImport(importLogId: string) {
  if (!pool || env.mockMode) {
    const current = inMemoryStore.get(importLogId);
    if (!current) throw new Error("Import log not found");
    if (current.status !== "confirmed") throw new Error("Only confirmed imports can be rolled back");
    current.status = "rolled_back";
    inMemoryStore.set(importLogId, current);
    return { status: "rolled_back", rolledBackRows: current.rows.length };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const importLogRes = await client.query(
      `SELECT id, project_id, status FROM import_logs WHERE id = $1 FOR UPDATE`,
      [importLogId]
    );
    if (!importLogRes.rowCount) throw new Error("Import log not found");
    const importLog = importLogRes.rows[0];
    if (importLog.status !== "confirmed") throw new Error("Only confirmed imports can be rolled back");

    const txDeleted = await client.query(`DELETE FROM transactions WHERE source_import_log_id = $1 RETURNING id`, [
      importLogId
    ]);

    const rowsRes = await client.query(
      `SELECT action_type, after_data
       FROM import_log_rows
       WHERE import_log_id = $1`,
      [importLogId]
    );

    let unitsDeleted = 0;
    for (const row of rowsRes.rows) {
      if (row.action_type !== "NEW") continue;
      const afterData = (row.after_data ?? {}) as Record<string, unknown>;
      const unitCode = asString(afterData.unit_code);
      if (!unitCode) continue;
      const delRes = await client.query(
        `DELETE FROM units u
         WHERE u.project_id = $1
           AND u.unit_code = $2
           AND COALESCE(u.dynamic_attrs->>'created_import_log_id', '') = $3
           AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.unit_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM files f WHERE f.unit_id = u.id)
         RETURNING u.id`,
        [importLog.project_id as string, unitCode, importLogId]
      );
      unitsDeleted += delRes.rowCount ?? 0;
    }

    await client.query(
      `UPDATE import_logs
       SET status = 'rolled_back',
           diff_summary = COALESCE(diff_summary, '{}'::jsonb) || jsonb_build_object('rollback_at', NOW(), 'rollback_deleted_transactions', $2::int, 'rollback_deleted_units', $3::int)
       WHERE id = $1`,
      [importLogId, txDeleted.rowCount ?? 0, unitsDeleted]
    );

    await client.query("COMMIT");
    return {
      status: "rolled_back",
      rollbackDeletedTransactions: txDeleted.rowCount ?? 0,
      rollbackDeletedUnits: unitsDeleted
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
