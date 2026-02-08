import { Router } from "express";
import { requireRoles } from "../middleware/auth.js";
import { interpretCopilot, interpretSchema, validateCommitPayload } from "../services/copilotService.js";

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

    // TODO: replace with transactional persistence based on payload.intent.
    res.json({
      status: "confirmed",
      message: "Draft action committed.",
      committedAt: new Date().toISOString(),
      intent: payload.intent,
      payload: payload.payload
    });
  } catch (error) {
    next(error);
  }
});
