import path from "path";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { requestOcrExtract } from "./pythonClient.js";

const allowedFileTypes = new Set(["agreement", "confirmation", "id_card", "other"]);

function normalizeFileType(input: string | undefined) {
  if (!input) return "confirmation";
  const value = input.trim();
  return allowedFileTypes.has(value) ? value : "other";
}

export async function ocrAndLinkFile(params: {
  projectId: string;
  filePath: string;
  originalFileName: string;
  mimeType?: string;
  fileSize?: number;
  fileType?: string;
  uploadedBy?: string;
}) {
  const ocr = await requestOcrExtract({ filePath: params.filePath });
  const unitCodes = ocr.unitCodes;

  if (!pool || env.mockMode) {
    const fileId = `mock-file-${Date.now()}`;
    const candidates = unitCodes.map((unitCode, idx) => ({
      unitId: `mock-unit-${idx + 1}`,
      unitCode
    }));
    return {
      fileId,
      linked: candidates.length === 1,
      linkedUnitId: candidates.length === 1 ? candidates[0].unitId : null,
      issueStatus: candidates.length === 1 ? "issued" : "pending",
      unitCandidates: candidates,
      ocr
    };
  }

  const unitRes =
    unitCodes.length > 0
      ? await pool.query(
          `SELECT id, unit_code
           FROM units
           WHERE project_id = $1
             AND unit_code = ANY($2::text[])
           ORDER BY unit_code ASC`,
          [params.projectId, unitCodes]
        )
      : { rows: [] as Array<{ id: string; unit_code: string }> };

  const candidates = unitRes.rows.map((r) => ({ unitId: r.id, unitCode: r.unit_code }));
  const linkedUnitId = candidates.length === 1 ? candidates[0].unitId : null;
  const issueStatus = linkedUnitId ? "issued" : "pending";

  const fileInsert = await pool.query(
    `INSERT INTO files (
       project_id, unit_id, file_type, storage_key, file_name,
       mime_type, file_size, ocr_text, ocr_result, ocr_confidence, issue_status, uploaded_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
     RETURNING id`,
    [
      params.projectId,
      linkedUnitId,
      normalizeFileType(params.fileType),
      path.resolve(params.filePath),
      params.originalFileName,
      params.mimeType ?? null,
      params.fileSize ?? null,
      ocr.text,
      JSON.stringify({
        unitCodes: ocr.unitCodes,
        amountCandidates: ocr.amountCandidates,
        dateCandidates: ocr.dateCandidates,
        warnings: ocr.warnings
      }),
      ocr.confidence,
      issueStatus,
      params.uploadedBy ?? null
    ]
  );

  return {
    fileId: fileInsert.rows[0].id as string,
    linked: Boolean(linkedUnitId),
    linkedUnitId,
    issueStatus,
    unitCandidates: candidates,
    ocr
  };
}

export async function confirmFileLink(params: { fileId: string; unitId: string }) {
  if (!pool || env.mockMode) {
    return {
      fileId: params.fileId,
      linkedUnitId: params.unitId,
      issueStatus: "issued",
      status: "confirmed"
    };
  }

  const updated = await pool.query(
    `UPDATE files
     SET unit_id = $2,
         issue_status = 'issued'
     WHERE id = $1
     RETURNING id, unit_id, issue_status`,
    [params.fileId, params.unitId]
  );
  if (!updated.rowCount) {
    throw new Error("File not found");
  }
  return {
    fileId: updated.rows[0].id as string,
    linkedUnitId: updated.rows[0].unit_id as string,
    issueStatus: updated.rows[0].issue_status as string,
    status: "confirmed"
  };
}
