from pydantic import BaseModel, Field


class OcrExtractRequest(BaseModel):
    filePath: str


class OcrExtractResponse(BaseModel):
    text: str
    confidence: float = 0.0
    unitCodes: list[str] = Field(default_factory=list)
    amountCandidates: list[float] = Field(default_factory=list)
    dateCandidates: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
