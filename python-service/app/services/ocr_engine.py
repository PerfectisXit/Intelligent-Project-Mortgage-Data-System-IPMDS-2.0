from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader


UNIT_REGEX = re.compile(r"\b(?:[A-Za-z]\d?-?\d{4}|\d-\d{4})\b")
AMOUNT_REGEX = re.compile(r"([0-9]+(?:\.[0-9]+)?)\s*(万|万元|元)")
AMOUNT_KEYWORD_REGEX = re.compile(r"(?:金额|amount|收款|实收|付款)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
DATE_REGEX = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")


def _extract_text_from_pdf(file_path: Path) -> str:
    reader = PdfReader(str(file_path))
    texts: list[str] = []
    for page in reader.pages:
        texts.append(page.extract_text() or "")
    return "\n".join(texts).strip()


def _extract_text(file_path: Path):
    suffix = file_path.suffix.lower()
    is_pdf = suffix == ".pdf"
    if not is_pdf:
        try:
            with file_path.open("rb") as f:
                header = f.read(5)
            is_pdf = header == b"%PDF-"
        except Exception:
            is_pdf = False
    warnings: list[str] = []
    if is_pdf:
        return _extract_text_from_pdf(file_path), warnings
    warnings.append("当前仅对可提取文本的 PDF 提供高质量识别，图片 OCR 待接入。")
    return "", warnings


def _extract_amounts(text: str):
    amounts: list[float] = []
    for m in AMOUNT_REGEX.finditer(text):
        raw = float(m.group(1))
        unit = m.group(2)
        value = raw * 10000 if "万" in unit else raw
        amounts.append(round(value, 2))
    if not amounts:
        for m in AMOUNT_KEYWORD_REGEX.finditer(text):
            raw = float(m.group(1))
            amounts.append(round(raw, 2))
    return amounts


def compute_ocr_extract(file_path: str):
    p = Path(file_path)
    if not p.exists():
        return {
            "text": "",
            "confidence": 0.0,
            "unitCodes": [],
            "amountCandidates": [],
            "dateCandidates": [],
            "warnings": ["文件不存在"],
        }

    text, warnings = _extract_text(p)
    unit_codes = sorted(set(UNIT_REGEX.findall(text)))
    amount_candidates = _extract_amounts(text)
    date_candidates = sorted(set(DATE_REGEX.findall(text)))

    confidence = 0.15
    if text:
        confidence = 0.55
    if unit_codes:
        confidence += 0.2
    if amount_candidates:
        confidence += 0.15
    confidence = min(confidence, 0.95)

    return {
        "text": text,
        "confidence": round(confidence, 4),
        "unitCodes": unit_codes,
        "amountCandidates": amount_candidates[:10],
        "dateCandidates": date_candidates[:10],
        "warnings": warnings,
    }
