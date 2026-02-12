import { Router } from "express";
import { requireRoles } from "../middleware/auth.js";
import { commitCopilot, interpretCopilot, interpretSchema, validateCommitPayload } from "../services/copilotService.js";

export const copilotRouter = Router();

copilotRouter.post("/interpret", requireRoles(["admin", "finance", "sales", "auditor"]), async (req, res, next) => {
  try {
    const payload = interpretSchema.parse(req.body);
    const data = await interpretCopilot(payload);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

copilotRouter.post("/commit", requireRoles(["admin", "finance", "sales"]), async (req, res, next) => {
  try {
    const payload = validateCommitPayload(req.body);
    const result = await commitCopilot(payload, req.auth?.userId);
    res.json({
      ...result,
      committedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});
