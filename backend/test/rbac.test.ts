import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("RBAC route guards", () => {
  it("denies sales role for import commit", async () => {
    const res = await request(app)
      .post("/api/v1/imports/non-existent-id/commit")
      .set("x-user-role", "sales")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body?.currentRole).toBe("sales");
  });

  it("allows sales role for copilot commit", async () => {
    const res = await request(app)
      .post("/api/v1/copilot/commit")
      .set("x-user-role", "sales")
      .send({
        confirmed: true,
        intent: "create_transaction",
        payload: { unit_code: "A1-1002", amount: 200000 }
      });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe("confirmed");
  });

  it("allows auditor role for copilot interpret", async () => {
    const res = await request(app)
      .post("/api/v1/copilot/interpret")
      .set("x-user-role", "auditor")
      .send({
        sessionId: "sess_test",
        input: "张三买了A1-1002，先付20万",
        projectId: "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa",
        attachments: []
      });

    expect(res.status).toBe(200);
    expect(["need_clarification", "ready_to_confirm"]).toContain(res.body?.status);
  });

  it("denies auditor role for file ocr-link", async () => {
    const res = await request(app)
      .post("/api/v1/files/ocr-link")
      .set("x-user-role", "auditor")
      .field("projectId", "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa");

    expect(res.status).toBe(403);
    expect(res.body?.currentRole).toBe("auditor");
  });

  it("denies auditor role for file confirm-link", async () => {
    const res = await request(app)
      .post("/api/v1/files/mock-file-1/confirm-link")
      .set("x-user-role", "auditor")
      .send({ unitId: "mock-unit-1" });

    expect(res.status).toBe(403);
    expect(res.body?.currentRole).toBe("auditor");
  });
});
