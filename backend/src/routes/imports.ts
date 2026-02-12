import fs from "fs";
import path from "path";
import { Router } from "express";
import type { Response } from "express";
import type { Request } from "express";
import multer from "multer";
import crypto from "crypto";
import { requireRoles } from "../middleware/auth.js";
import {
  commitImport,
  getCommittedPreview,
  createImportAndDiff,
  getImportAudits,
  getImportDiff,
  rollbackImport
} from "../services/importService.js";
import { requestExcelHeaderAnalyze } from "../services/pythonClient.js";
import { applyLlmHeaderReview } from "../services/headerMappingAdvisor.js";

const uploadDir = path.resolve("uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });
const uploadTokenStore = new Map<
  string,
  { filePath: string; sourceFileName: string; createdAt: number }
>();

function normalizeFileName(name: string) {
  // multer/busboy may decode filename as latin1; attempt to recover utf8.
  try {
    const recovered = Buffer.from(name, "latin1").toString("utf8");
    return recovered || name;
  } catch {
    return name;
  }
}

export const importsRouter = Router();

function sseInit(res: Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

function sseSend(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function handleImportMutationError(error: unknown, res: Response) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (message.includes("not found")) {
    res.status(404).json({ message });
    return true;
  }
  if (message.includes("Only")) {
    res.status(400).json({ message });
    return true;
  }
  return false;
}

const sensitiveKeys = new Set(["phone", "联系方式", "id_card", "id_card_masked", "身份证", "contact"]);

function maskValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function maskSensitiveDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSensitiveDeep);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKeys.has(k)) {
      result[k] = maskValue(v);
    } else {
      result[k] = maskSensitiveDeep(v);
    }
  }
  return result;
}

importsRouter.post("/excel", requireRoles(["admin", "finance"]), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    const projectId = String(req.body.projectId || "");
    const organizationId = String(req.body.organizationId || "");
    if (!projectId || !organizationId) {
      res.status(400).json({ error: "Missing projectId or organizationId" });
      return;
    }

    const diff = await createImportAndDiff({
      organizationId,
      projectId,
      userId: req.body.userId,
      sourceFileName: normalizeFileName(req.file.originalname),
      filePath: req.file.path
    });

    res.status(201).json(diff);
  } catch (error) {
    next(error);
  }
});

importsRouter.post(
  "/excel/analyze-headers",
  requireRoles(["admin", "finance"]),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Missing file" });
        return;
      }
      const pythonStartedAt = Date.now();
      const analysis = await requestExcelHeaderAnalyze({ filePath: req.file.path });
      const pythonDurationMs = Date.now() - pythonStartedAt;
      const organizationId = String(req.body.organizationId || "");
      const projectId = String(req.body.projectId || "");
      const llmStartedAt = Date.now();
      const review = await applyLlmHeaderReview({
        organizationId: organizationId || undefined,
        projectId: projectId || undefined,
        rawHeaders: analysis.rawHeaders,
        standardFields: analysis.standardFields,
        ruleSuggestions: analysis.suggestions
      });
      const llmDurationMs = Date.now() - llmStartedAt;
      const token = crypto.randomUUID();
      uploadTokenStore.set(token, {
        filePath: req.file.path,
        sourceFileName: normalizeFileName(req.file.originalname),
        createdAt: Date.now()
      });
      res.status(201).json({
        uploadToken: token,
        rawHeaders: analysis.rawHeaders,
        standardFields: analysis.standardFields,
        suggestions: review.suggestions,
        reviewMode: review.reviewMode,
        reviewNotes: review.reviewNotes,
        llmOutput: review.llmOutput,
        llmOverallOpinion: review.llmOverallOpinion,
        llmTrace: review.llmTrace,
        stageStatus: {
          pythonDataStage: {
            status: "done",
            durationMs: pythonDurationMs,
            message: `表头读取完成（${analysis.rawHeaders.length} 列）`
          },
          llmReviewStage: {
            status:
              review.llmTrace.status === "success"
                ? "done"
                : review.llmTrace.status === "fallback_rules_only"
                  ? "warning"
                  : "skipped",
            durationMs: llmDurationMs,
            message:
              review.llmTrace.status === "success"
                ? "大模型复核完成"
                : review.llmTrace.status === "fallback_rules_only"
                  ? "大模型复核失败，已回退规则结果"
                  : "未配置可用模型，跳过大模型复核"
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

importsRouter.post(
  "/excel/analyze-headers-stream",
  requireRoles(["admin", "finance"]),
  upload.single("file"),
  async (req: Request, res: Response) => {
    sseInit(res);
    try {
      if (!req.file) {
        sseSend(res, "error", { message: "Missing file" });
        res.end();
        return;
      }

      sseSend(res, "stage", {
        stage: "python_data",
        status: "process",
        message: "开始读取 Excel 并执行规则映射..."
      });

      const pythonStartedAt = Date.now();
      const analysis = await requestExcelHeaderAnalyze({ filePath: req.file.path });
      const pythonDurationMs = Date.now() - pythonStartedAt;

      sseSend(res, "stage", {
        stage: "python_data",
        status: "done",
        durationMs: pythonDurationMs,
        message: `规则映射完成，识别 ${analysis.rawHeaders.length} 个表头`
      });

      const organizationId = String(req.body.organizationId || "");
      const projectId = String(req.body.projectId || "");

      sseSend(res, "stage", {
        stage: "llm_review",
        status: "process",
        message: "开始大模型复核映射建议..."
      });

      const llmStartedAt = Date.now();
      const review = await applyLlmHeaderReview({
        organizationId: organizationId || undefined,
        projectId: projectId || undefined,
        rawHeaders: analysis.rawHeaders,
        standardFields: analysis.standardFields,
        ruleSuggestions: analysis.suggestions,
        callbacks: {
          onAttemptStart: ({ providerKey, model }) => {
            sseSend(res, "llm_attempt_start", {
              providerKey,
              model,
              message: `尝试调用 ${providerKey}:${model}`
            });
          },
          onAttemptResult: (attempt) => {
            sseSend(res, "llm_attempt_result", attempt);
          },
          onReviewOutput: (payload) => {
            sseSend(res, "llm_review_output", payload);
          }
        }
      });
      const llmDurationMs = Date.now() - llmStartedAt;

      const llmStageStatus =
        review.llmTrace.status === "success"
          ? "done"
          : review.llmTrace.status === "fallback_rules_only"
            ? "warning"
            : "skipped";
      sseSend(res, "stage", {
        stage: "llm_review",
        status: llmStageStatus,
        durationMs: llmDurationMs,
        message:
          llmStageStatus === "done"
            ? "大模型复核完成"
            : llmStageStatus === "warning"
              ? "大模型复核失败，已回退规则结果"
              : "未配置可用模型，跳过大模型复核"
      });

      const token = crypto.randomUUID();
      uploadTokenStore.set(token, {
        filePath: req.file.path,
        sourceFileName: normalizeFileName(req.file.originalname),
        createdAt: Date.now()
      });

      sseSend(res, "final_result", {
        uploadToken: token,
        rawHeaders: analysis.rawHeaders,
        standardFields: analysis.standardFields,
        suggestions: review.suggestions,
        reviewMode: review.reviewMode,
        reviewNotes: review.reviewNotes,
        llmOutput: review.llmOutput,
        llmOverallOpinion: review.llmOverallOpinion,
        llmTrace: review.llmTrace,
        stageStatus: {
          pythonDataStage: {
            status: "done",
            durationMs: pythonDurationMs,
            message: `表头读取完成（${analysis.rawHeaders.length} 列）`
          },
          llmReviewStage: {
            status: llmStageStatus,
            durationMs: llmDurationMs,
            message:
              llmStageStatus === "done"
                ? "大模型复核完成"
                : llmStageStatus === "warning"
                  ? "大模型复核失败，已回退规则结果"
                  : "未配置可用模型，跳过大模型复核"
          }
        }
      });
      sseSend(res, "done", { ok: true });
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "analyze stream failed";
      sseSend(res, "error", { message });
      res.end();
    }
  }
);

importsRouter.post("/excel/confirm-mapping", requireRoles(["admin", "finance"]), async (req, res, next) => {
  try {
    const token = String(req.body?.uploadToken || "");
    const projectId = String(req.body?.projectId || "");
    const organizationId = String(req.body?.organizationId || "");
    const headerMappingOverride =
      req.body?.headerMappingOverride && typeof req.body.headerMappingOverride === "object"
        ? (req.body.headerMappingOverride as Record<string, string>)
        : {};

    if (!token || !projectId || !organizationId) {
      res.status(400).json({ error: "Missing uploadToken/projectId/organizationId" });
      return;
    }
    const fileMeta = uploadTokenStore.get(token);
    if (!fileMeta) {
      res.status(404).json({ error: "Upload token expired or invalid" });
      return;
    }
    const diff = await createImportAndDiff({
      organizationId,
      projectId,
      userId: req.body.userId,
      sourceFileName: fileMeta.sourceFileName,
      filePath: fileMeta.filePath,
      headerMappingOverride
    });
    uploadTokenStore.delete(token);
    res.status(201).json(diff);
  } catch (error) {
    next(error);
  }
});

importsRouter.get("/:id/diff", requireRoles(["admin", "finance", "sales", "auditor"]), async (req, res, next) => {
  try {
    const result = await getImportDiff(req.params.id);
    if (req.auth?.role === "auditor") {
      const masked = maskSensitiveDeep(result);
      res.json(masked);
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

importsRouter.get(
  "/:id/audits",
  requireRoles(["admin", "finance", "auditor"]),
  async (req, res, next) => {
    try {
      const result = await getImportAudits(req.params.id);
      if (req.auth?.role === "auditor") {
        const masked = maskSensitiveDeep(result);
        res.json(masked);
        return;
      }
      res.json(result);
    } catch (error) {
      if (handleImportMutationError(error, res)) return;
      next(error);
    }
  }
);

importsRouter.post("/:id/commit", requireRoles(["admin", "finance"]), async (req, res, next) => {
  try {
    const result = await commitImport(req.params.id, req.auth?.userId);
    res.json({ ...result, committedAt: new Date().toISOString() });
  } catch (error) {
    if (handleImportMutationError(error, res)) return;
    next(error);
  }
});

importsRouter.get(
  "/:id/committed-preview",
  requireRoles(["admin", "finance", "sales", "auditor"]),
  async (req, res, next) => {
    try {
      const result = await getCommittedPreview(req.params.id);
      if (req.auth?.role === "auditor") {
        const masked = maskSensitiveDeep(result);
        res.json(masked);
        return;
      }
      res.json(result);
    } catch (error) {
      if (handleImportMutationError(error, res)) return;
      next(error);
    }
  }
);

importsRouter.post("/:id/rollback", requireRoles(["admin", "finance"]), async (req, res, next) => {
  try {
    const result = await rollbackImport(req.params.id);
    res.json({ ...result, rolledBackAt: new Date().toISOString() });
  } catch (error) {
    if (handleImportMutationError(error, res)) return;
    next(error);
  }
});
