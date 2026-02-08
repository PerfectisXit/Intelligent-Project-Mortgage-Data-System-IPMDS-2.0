from fastapi import FastAPI

from app.schemas.diff import ExcelDiffRequest, ExcelDiffResponse
from app.schemas.ocr import OcrExtractRequest, OcrExtractResponse
from app.services.diff_engine import compute_diff
from app.services.ocr_engine import compute_ocr_extract

app = FastAPI(title="IPMDS Python Data Service", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok", "service": "python-data-service"}


@app.post("/excel/diff", response_model=ExcelDiffResponse)
def excel_diff(payload: ExcelDiffRequest):
    return compute_diff(payload.filePath, payload.existingRows)


@app.post("/ocr/extract", response_model=OcrExtractResponse)
def ocr_extract(payload: OcrExtractRequest):
    return compute_ocr_extract(payload.filePath)
