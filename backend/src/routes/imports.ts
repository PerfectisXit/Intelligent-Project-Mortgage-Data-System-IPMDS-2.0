import fs from "fs";
import path from "path";
import { Router } from "express";
import type { Response } from "express";
import multer from "multer";
import { requireRoles } from "../middleware/auth.js";
import {
  commitImport,
  createImportAndDiff,
  getImportAudits,
  getImportDiff,
  rollbackImport
} from "../services/importService.js";

const uploadDir = path.resolve("uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

export const importsRouter = Router();

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
      sourceFileName: req.file.originalname,
      filePath: req.file.path
    });

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

importsRouter.post("/:id/rollback", requireRoles(["admin", "finance"]), async (req, res, next) => {
  try {
    const result = await rollbackImport(req.params.id);
    res.json({ ...result, rolledBackAt: new Date().toISOString() });
  } catch (error) {
    if (handleImportMutationError(error, res)) return;
    next(error);
  }
});
