import { afterEach, describe, expect, it, vi } from "vitest";

const requestOcrExtractMock = vi.fn();

vi.mock("../src/services/pythonClient.js", () => ({
  requestOcrExtract: (...args: unknown[]) => requestOcrExtractMock(...args)
}));

async function loadFileService() {
  process.env.MOCK_MODE = "true";
  vi.resetModules();
  const mod = await import("../src/services/fileOcrService.js");
  return mod;
}

afterEach(() => {
  requestOcrExtractMock.mockReset();
});

describe("fileOcrService in mock mode", () => {
  it("auto-links when single unit candidate", async () => {
    requestOcrExtractMock.mockResolvedValue({
      text: "unit: A1-1002",
      confidence: 0.91,
      unitCodes: ["A1-1002"],
      amountCandidates: [200000],
      dateCandidates: ["2026-02-08"],
      warnings: []
    });

    const svc = await loadFileService();
    const res = await svc.ocrAndLinkFile({
      projectId: "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa",
      filePath: "/tmp/a.pdf",
      originalFileName: "a.pdf"
    });

    expect(res.linked).toBe(true);
    expect(res.issueStatus).toBe("issued");
    expect(res.unitCandidates).toHaveLength(1);
  });

  it("stays pending when multi candidates", async () => {
    requestOcrExtractMock.mockResolvedValue({
      text: "unit: A1-1002 / A1-1003",
      confidence: 0.8,
      unitCodes: ["A1-1002", "A1-1003"],
      amountCandidates: [200000],
      dateCandidates: ["2026-02-08"],
      warnings: []
    });

    const svc = await loadFileService();
    const res = await svc.ocrAndLinkFile({
      projectId: "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa",
      filePath: "/tmp/b.pdf",
      originalFileName: "b.pdf"
    });

    expect(res.linked).toBe(false);
    expect(res.issueStatus).toBe("pending");
    expect(res.unitCandidates).toHaveLength(2);
  });
});
