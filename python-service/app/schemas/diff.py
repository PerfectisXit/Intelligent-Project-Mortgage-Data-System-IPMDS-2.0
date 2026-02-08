from pydantic import BaseModel, Field
from typing import Any


class ExcelDiffRequest(BaseModel):
    filePath: str
    existingRows: list[dict[str, Any]] = Field(default_factory=list)


class DiffCell(BaseModel):
    before: Any
    after: Any


class DiffRow(BaseModel):
    rowNo: int
    actionType: str
    businessKey: str
    entityType: str
    beforeData: dict[str, Any] | None
    afterData: dict[str, Any] | None
    fieldDiffs: dict[str, DiffCell]
    errorMessage: str | None = None


class ExcelDiffResponse(BaseModel):
    headerMapping: dict[str, str]
    rows: list[DiffRow]
    summary: dict[str, int]
