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
              c.name as customer_name,
              t.amount as actual_received,
              t.payment_method,
              t.occurred_at::date as sign_date
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
    existingRows
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
    await client.query("BEGIN");
    const importLogRes = await client.query(
      `SELECT id, project_id, status FROM import_logs WHERE id = $1 FOR UPDATE`,
      [importLogId]
    );
    if (!importLogRes.rowCount) throw new Error("Import log not found");
    const importLog = importLogRes.rows[0];
    if (importLog.status !== "diffed") throw new Error("Only diffed imports can be committed");

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
      const customerPhone = asString(afterData.phone);
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
              last_import_log_id: importLogId
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
      const paymentMethod = asString(afterData.payment_method);
      const signDate = normalizeDateOnly(afterData.sign_date);
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
            userId ?? null,
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
              userId ?? null,
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
