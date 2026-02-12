import { z } from "zod";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { parseWithModel } from "./modelRouter.js";
import { resolveAlias } from "./aliasResolver.js";
import type { CopilotInterpretRequest, CopilotInterpretResponse } from "../types/api.js";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const interpretSchema = z.object({
  sessionId: z.string().min(1),
  input: z.string().min(1),
  projectId: z.string().uuid(),
  attachments: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["pdf", "image"]),
      url: z.string().url()
    })
  ),
  clientContext: z
    .object({
      currentPage: z.string().optional(),
      timezone: z.string().optional()
    })
    .optional()
});

function normalizeInput(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

async function queryLatestImport(projectId: string) {
  if (!pool || env.mockMode) return null;
  const res = await pool.query(
    `SELECT id, created_at, total_rows, new_rows, changed_rows, unchanged_rows, error_rows,
            COALESCE((diff_summary->>'committed_rows')::int, 0) AS committed_rows
     FROM import_logs
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [projectId]
  );
  return res.rowCount ? res.rows[0] : null;
}

async function queryLatestImportAmount(projectId: string) {
  if (!pool || env.mockMode) return null;
  const latest = await queryLatestImport(projectId);
  if (!latest?.id) return null;
  const amountRes = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN txn_type = 'refund' THEN -amount ELSE amount END), 0) AS net_amount,
       COALESCE(SUM(CASE WHEN txn_type <> 'refund' THEN amount ELSE 0 END), 0) AS added_amount
     FROM transactions
     WHERE source_import_log_id = $1`,
    [latest.id]
  );
  return {
    importId: latest.id as string,
    createdAt: String(latest.created_at),
    netAmount: Number(amountRes.rows[0]?.net_amount ?? 0),
    addedAmount: Number(amountRes.rows[0]?.added_amount ?? 0)
  };
}

async function queryProjectSummary(projectId: string) {
  if (!pool || env.mockMode) return null;
  const res = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM units WHERE project_id = $1) AS units_count,
       (SELECT COUNT(*) FROM customers c
         JOIN units u ON u.current_customer_id = c.id
         WHERE u.project_id = $1) AS customers_count,
       (SELECT COUNT(*) FROM transactions t
         JOIN units u ON u.id = t.unit_id
         WHERE u.project_id = $1) AS transactions_count,
       (SELECT COUNT(*) FROM import_logs WHERE project_id = $1) AS imports_count,
       (SELECT COALESCE(SUM(deal_price),0) FROM units WHERE project_id = $1) AS total_deal_price,
       (SELECT COALESCE(SUM(CASE WHEN t.txn_type = 'refund' THEN -t.amount ELSE t.amount END),0)
        FROM transactions t
        JOIN units u ON u.id = t.unit_id
        WHERE u.project_id = $1) AS total_received`,
    [projectId]
  );
  return res.rowCount ? res.rows[0] : null;
}

async function tryHandleAnalyticsQuery(payload: CopilotInterpretRequest) {
  const text = normalizeInput(payload.input);

  const wantsLatestImport =
    text.includes("这次导入") || text.includes("最近导入") || text.includes("本次导入");
  const asksRows =
    text.includes("多少") &&
    (text.includes("条") || text.includes("行") || text.includes("笔") || text.includes("数据"));
  const asksImportAmount = text.includes("新增") && text.includes("金额");
  const asksDbSummary =
    text.includes("库里") || text.includes("数据库") || text.includes("总数") || text.includes("总额");

  if (wantsLatestImport && asksRows) {
    const latest = await queryLatestImport(payload.projectId);
    if (!latest) {
      return {
        status: "ready_to_confirm" as const,
        draftAction: { intent: "query", payload: {} },
        answer: "当前项目还没有导入记录。"
      };
    }
    return {
      status: "ready_to_confirm" as const,
      draftAction: {
        intent: "query",
        payload: {
          importLogId: latest.id,
          totalRows: Number(latest.total_rows ?? 0),
          newRows: Number(latest.new_rows ?? 0),
          changedRows: Number(latest.changed_rows ?? 0),
          unchangedRows: Number(latest.unchanged_rows ?? 0),
          errorRows: Number(latest.error_rows ?? 0),
          committedRows: Number(latest.committed_rows ?? 0)
        }
      },
      answer:
        `最近一次导入（${String(latest.id).slice(0, 8)}）共 ${latest.total_rows} 行，` +
        `新增 ${latest.new_rows}，变更 ${latest.changed_rows}，无变化 ${latest.unchanged_rows}，错误 ${latest.error_rows}，已入库 ${latest.committed_rows} 行。`
    };
  }

  if (wantsLatestImport && asksImportAmount) {
    const amount = await queryLatestImportAmount(payload.projectId);
    if (!amount) {
      return {
        status: "ready_to_confirm" as const,
        draftAction: { intent: "query", payload: {} },
        answer: "当前项目没有可统计的导入金额记录。"
      };
    }
    return {
      status: "ready_to_confirm" as const,
      draftAction: {
        intent: "query",
        payload: {
          importLogId: amount.importId,
          addedAmount: amount.addedAmount,
          netAmount: amount.netAmount
        }
      },
      answer:
        `最近一次导入新增金额（不含退款）为 ¥${amount.addedAmount.toLocaleString("zh-CN")}，` +
        `净变动金额为 ¥${amount.netAmount.toLocaleString("zh-CN")}。`
    };
  }

  if (asksDbSummary) {
    const summary = await queryProjectSummary(payload.projectId);
    if (!summary) {
      return {
        status: "ready_to_confirm" as const,
        draftAction: { intent: "query", payload: {} },
        answer: "当前处于 MOCK 模式或数据库不可用，无法统计库内数据。"
      };
    }
    return {
      status: "ready_to_confirm" as const,
      draftAction: {
        intent: "query",
        payload: {
          unitsCount: Number(summary.units_count ?? 0),
          customersCount: Number(summary.customers_count ?? 0),
          transactionsCount: Number(summary.transactions_count ?? 0),
          importsCount: Number(summary.imports_count ?? 0),
          totalDealPrice: Number(summary.total_deal_price ?? 0),
          totalReceived: Number(summary.total_received ?? 0)
        }
      },
      answer:
        `当前库内：房源 ${summary.units_count} 套，客户 ${summary.customers_count} 个，` +
        `资金流水 ${summary.transactions_count} 笔，导入批次 ${summary.imports_count} 个；` +
        `总成交额 ¥${Number(summary.total_deal_price ?? 0).toLocaleString("zh-CN")}，` +
        `累计回款 ¥${Number(summary.total_received ?? 0).toLocaleString("zh-CN")}。`
    };
  }

  return null;
}

export async function interpretCopilot(
  payload: CopilotInterpretRequest
): Promise<CopilotInterpretResponse> {
  const analyticsResult = await tryHandleAnalyticsQuery(payload);
  if (analyticsResult) return analyticsResult;

  const llm = await parseWithModel(payload.input, { projectId: payload.projectId });
  const aliasCandidates = resolveAlias(payload.input);

  const needsClarify = llm.missingFields.length > 0 || aliasCandidates.length > 1;
  return {
    status: needsClarify ? "need_clarification" : "ready_to_confirm",
    draftAction: {
      intent: llm.intent,
      payload: llm.entities
    },
    answer: llm.intent === "query" ? "已识别为查询请求，请确认后执行。当前可直接问：这次导入多少条、新增了多少金额、库里总数。" : undefined,
    question: needsClarify ? llm.clarificationQuestion : undefined,
    options: needsClarify ? ["deposit", "down_payment", "installment", "full_payment"] : undefined,
    candidateMatches: aliasCandidates.length ? aliasCandidates : llm.candidateMatches
  };
}

const commitSchema = z.object({
  confirmed: z.literal(true),
  intent: z.string().min(1),
  sessionId: z.string().optional(),
  payload: z.record(z.unknown())
});

export type CommitPayload = z.infer<typeof commitSchema>;

export function validateCommitPayload(input: unknown): CommitPayload {
  return commitSchema.parse(input);
}

function asUuidOrNull(value?: string | null): string | null {
  if (!value) return null;
  return uuidRegex.test(value) ? value : null;
}

export async function commitCopilot(payload: CommitPayload, userId?: string) {
  if (!pool || env.mockMode) {
    return {
      status: "confirmed",
      message: "Draft action committed (mock).",
      intent: payload.intent,
      payload: payload.payload
    };
  }

  if (payload.intent !== "create_transaction") {
    return {
      status: "confirmed",
      message: "Draft action committed.",
      intent: payload.intent,
      payload: payload.payload
    };
  }

  const unitCode = typeof payload.payload.unit_code === "string" ? payload.payload.unit_code.trim() : "";
  const amountRaw = payload.payload.amount;
  const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
  const txnType = typeof payload.payload.txn_type === "string" ? payload.payload.txn_type.trim() : "adjustment";
  const occurredAtText =
    typeof payload.payload.occurred_at === "string" && payload.payload.occurred_at.trim()
      ? payload.payload.occurred_at.trim()
      : null;
  const paymentMethod =
    typeof payload.payload.payment_method === "string" ? payload.payload.payment_method.trim() : null;
  const projectId =
    typeof payload.payload.project_id === "string" && payload.payload.project_id.trim()
      ? payload.payload.project_id.trim()
      : null;

  if (!unitCode || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("create_transaction requires unit_code and positive amount");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const unitRes = projectId
      ? await client.query(`SELECT id FROM units WHERE project_id = $1 AND unit_code = $2 LIMIT 1`, [projectId, unitCode])
      : await client.query(`SELECT id FROM units WHERE unit_code = $1 ORDER BY updated_at DESC LIMIT 1`, [unitCode]);
    if (!unitRes.rowCount) throw new Error("Unit not found for copilot commit");
    const unitId = unitRes.rows[0].id as string;

    await client.query(
      `INSERT INTO transactions (
        unit_id, txn_type, occurred_at, amount, payment_method, created_by, note
      ) VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4, $5, $6, $7)`,
      [
        unitId,
        txnType || "adjustment",
        occurredAtText ? `${occurredAtText}T00:00:00+08:00` : null,
        amount,
        paymentMethod,
        asUuidOrNull(userId ?? null),
        "copilot_commit"
      ]
    );

    await client.query(
      `UPDATE units
       SET dynamic_attrs = COALESCE(dynamic_attrs, '{}'::jsonb) || jsonb_strip_nulls(
         jsonb_build_object(
           'last_update_source', 'ai_copilot',
           'last_update_session_id', $2::text
         )
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [unitId, payload.sessionId ?? null]
    );

    await client.query("COMMIT");
    return {
      status: "confirmed",
      message: "Draft action committed.",
      intent: payload.intent,
      payload: payload.payload
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
