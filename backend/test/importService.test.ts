import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const requestExcelDiffMock = vi.fn();

vi.mock("../src/services/pythonClient.js", () => ({
  requestExcelDiff: (...args: unknown[]) => requestExcelDiffMock(...args)
}));

async function loadImportService() {
  process.env.MOCK_MODE = "true";
  vi.resetModules();
  const mod = await import("../src/services/importService.js");
  return mod;
}

function tempFile() {
  const p = path.join(os.tmpdir(), `ipmds-test-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
  fs.writeFileSync(p, "dummy");
  return p;
}

afterEach(() => {
  requestExcelDiffMock.mockReset();
});

describe("importService in mock mode", () => {
  it("runs create -> get diff -> commit -> rollback", async () => {
    requestExcelDiffMock.mockResolvedValue({
      headerMapping: { "房号": "unit_code" },
      rows: [
        {
          rowNo: 2,
          actionType: "NEW",
          businessKey: "合锦观澜|A1-1002",
          entityType: "unit",
          beforeData: null,
          afterData: { project: "合锦观澜", unit_code: "A1-1002", deal_price: 2000000 },
          fieldDiffs: { deal_price: { before: null, after: 2000000 } }
        }
      ],
      summary: {
        totalRows: 1,
        newRows: 1,
        changedRows: 0,
        unchangedRows: 0,
        errorRows: 0
      }
    });

    const svc = await loadImportService();
    const f = tempFile();
    const created = await svc.createImportAndDiff({
      organizationId: "9f4af2dc-7f29-4e91-aa74-68db4f9e6f9b",
      projectId: "9fd9e5f8-9f7f-4ae5-b041-3ec1d55d6aaa",
      sourceFileName: "test.xlsx",
      filePath: f
    });

    expect(created.summary.totalRows).toBe(1);
    expect(created.rows).toHaveLength(1);

    const diff = await svc.getImportDiff(created.importLogId);
    expect(diff.rows).toHaveLength(1);

    const committed = await svc.commitImport(created.importLogId, "u_finance_1");
    expect(committed.status).toBe("confirmed");
    expect(committed.committedRows).toBe(1);

    const rolledBack = await svc.rollbackImport(created.importLogId);
    expect(rolledBack.status).toBe("rolled_back");
    expect(rolledBack.rolledBackRows).toBe(1);

    await expect(svc.rollbackImport(created.importLogId)).rejects.toThrow(
      "Only confirmed imports can be rolled back"
    );
  });
});
