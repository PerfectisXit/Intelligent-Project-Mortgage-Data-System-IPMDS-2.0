from pydantic import BaseModel, Field
from typing import Any


class ExcelDiffRequest(BaseModel):
    filePath: str
    existingRows: list[dict[str, Any]] = Field(default_factory=list)
    headerMappingOverride: dict[str, str] = Field(default_factory=dict)


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


class HeaderCandidate(BaseModel):
    field: str
    score: float


class HeaderSuggestion(BaseModel):
    rawHeader: str
    suggestedField: str | None = None
    confidence: float = 0.0
    candidates: list[HeaderCandidate] = Field(default_factory=list)
    needsConfirm: bool = True


class ExcelHeaderAnalyzeRequest(BaseModel):
    filePath: str


class ExcelHeaderAnalyzeResponse(BaseModel):
    rawHeaders: list[str]
    standardFields: list[str]
    suggestions: list[HeaderSuggestion]
