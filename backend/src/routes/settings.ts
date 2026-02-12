import { Router } from "express";
import { requireRoles } from "../middleware/auth.js";
import {
  getAiProviderSettings,
  upsertAiProviderSettings,
  validateAiSettingsPayload,
  validateProviderConfigPayload
} from "../services/aiSettingsService.js";
import { probeProviderAvailability } from "../services/providerProbeService.js";
import { getPromptTemplates } from "../services/promptTemplates.js";

export const settingsRouter = Router();

settingsRouter.get("/ai-providers", requireRoles(["admin", "finance"]), async (req, res, next) => {
  try {
    const orgId = req.header("x-organization-id");
    const data = await getAiProviderSettings(orgId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

settingsRouter.put("/ai-providers", requireRoles(["admin", "finance"]), async (req, res, next) => {
  try {
    const orgId = req.header("x-organization-id");
    const payload = validateAiSettingsPayload(req.body);
    const data = await upsertAiProviderSettings({ organizationId: orgId, settings: payload });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

settingsRouter.post("/ai-providers/probe", requireRoles(["admin", "finance"]), async (req, res, next) => {
  try {
    const provider = validateProviderConfigPayload(req.body?.provider);
    const result = await probeProviderAvailability(provider);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

settingsRouter.get("/ai-prompts", requireRoles(["admin", "finance"]), async (_req, res, next) => {
  try {
    res.json(getPromptTemplates());
  } catch (error) {
    next(error);
  }
});
