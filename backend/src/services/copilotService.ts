import { z } from "zod";
import { parseWithModel } from "./modelRouter.js";
import { resolveAlias } from "./aliasResolver.js";
import type { CopilotInterpretRequest, CopilotInterpretResponse } from "../types/api.js";

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

export async function interpretCopilot(
  payload: CopilotInterpretRequest
): Promise<CopilotInterpretResponse> {
  const llm = await parseWithModel(payload.input);
  const aliasCandidates = resolveAlias(payload.input);

  const needsClarify = llm.missingFields.length > 0 || aliasCandidates.length > 1;
  return {
    status: needsClarify ? "need_clarification" : "ready_to_confirm",
    draftAction: {
      intent: llm.intent,
      payload: llm.entities
    },
    question: needsClarify ? llm.clarificationQuestion : undefined,
    options: needsClarify ? ["deposit", "down_payment", "installment", "full_payment"] : undefined,
    candidateMatches: aliasCandidates.length ? aliasCandidates : llm.candidateMatches
  };
}

const commitSchema = z.object({
  confirmed: z.literal(true),
  intent: z.string().min(1),
  payload: z.record(z.unknown())
});

export type CommitPayload = z.infer<typeof commitSchema>;

export function validateCommitPayload(input: unknown): CommitPayload {
  return commitSchema.parse(input);
}
