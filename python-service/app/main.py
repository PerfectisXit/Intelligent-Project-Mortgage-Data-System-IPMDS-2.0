from fastapi import FastAPI

import pandas as pd
from app.schemas.diff import (
    ExcelDiffRequest,
    ExcelDiffResponse,
    ExcelHeaderAnalyzeRequest,
    ExcelHeaderAnalyzeResponse,
)
from app.schemas.ocr import OcrExtractRequest, OcrExtractResponse
from app.services.diff_engine import compute_diff
from app.services.header_mapper import STANDARD_HEADERS, suggest_headers
from app.services.ocr_engine import compute_ocr_extract

app = FastAPI(title="IPMDS Python Data Service", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok", "service": "python-data-service"}


@app.post("/excel/diff", response_model=ExcelDiffResponse)
def excel_diff(payload: ExcelDiffRequest):
    return compute_diff(payload.filePath, payload.existingRows, payload.headerMappingOverride)


@app.post("/excel/analyze-headers", response_model=ExcelHeaderAnalyzeResponse)
def excel_analyze_headers(payload: ExcelHeaderAnalyzeRequest):
    df = pd.read_excel(payload.filePath, sheet_name="数据库", nrows=0)
    raw_headers = [str(c).strip() for c in df.columns.tolist()]
    suggestions = suggest_headers(raw_headers)
    return {
        "rawHeaders": raw_headers,
        "standardFields": list(STANDARD_HEADERS.keys()),
        "suggestions": suggestions,
    }


@app.post("/ocr/extract", response_model=OcrExtractResponse)
def ocr_extract(payload: OcrExtractRequest):
    return compute_ocr_extract(payload.filePath)
