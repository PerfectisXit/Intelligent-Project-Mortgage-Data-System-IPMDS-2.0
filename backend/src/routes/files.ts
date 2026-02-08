import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { requireRoles } from "../middleware/auth.js";
import { confirmFileLink, ocrAndLinkFile } from "../services/fileOcrService.js";

const uploadDir = path.resolve("uploads/files");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

export const filesRouter = Router();

filesRouter.post("/ocr-link", requireRoles(["admin", "finance", "sales"]), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "Missing file" });
      return;
    }
    const projectId = String(req.body.projectId || "");
    if (!projectId) {
      res.status(400).json({ message: "Missing projectId" });
      return;
    }
    const result = await ocrAndLinkFile({
      projectId,
      filePath: req.file.path,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      fileType: req.body.fileType,
      uploadedBy: req.auth?.userId
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

filesRouter.post("/:id/confirm-link", requireRoles(["admin", "finance", "sales"]), async (req, res, next) => {
  try {
    const unitId = String(req.body?.unitId || "");
    if (!unitId) {
      res.status(400).json({ message: "Missing unitId" });
      return;
    }
    const result = await confirmFileLink({ fileId: req.params.id, unitId });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      res.status(404).json({ message });
      return;
    }
    next(error);
  }
});
