from __future__ import annotations

import pandas as pd
from datetime import datetime
import re

from app.services.header_mapper import map_headers


def normalize_value(value):
    if pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.date().isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, float):
        return round(value, 6)
    return value


def build_business_key(row: dict) -> str:
    return f"{row.get('project','')}|{row.get('unit_code','')}"


PHONE_SPLIT_RE = re.compile(r"[，,;；/\s]+")
MOBILE_RE = re.compile(r"^1\d{10}$")
LANDLINE_RE = re.compile(r"^0\d{2,3}-?\d{7,8}$")


def normalize_phone_tokens(value: str) -> list[str]:
    return [token for token in PHONE_SPLIT_RE.split(value) if token]


def is_valid_phone(value: str) -> bool:
    return bool(MOBILE_RE.match(value) or LANDLINE_RE.match(value))


def validate_row(row: dict) -> list[str]:
    errors: list[str] = []

    sign_date_raw = row.get("sign_date")
    if isinstance(sign_date_raw, str) and re.fullmatch(r"\d{4}", sign_date_raw.strip()):
        errors.append("签约日期仅有年份，需补全为 YYYY-MM-DD")

    phone_raw = row.get("phone")
    if isinstance(phone_raw, str) and phone_raw.strip():
        tokens = normalize_phone_tokens(phone_raw.strip())
        if not tokens:
            errors.append("联系方式为空或格式不可识别")
        else:
            invalid = [token for token in tokens if not is_valid_phone(token)]
            if invalid:
                errors.append(f"联系方式格式不合法: {', '.join(invalid)}")

    amount = row.get("actual_received")
    deal_price = row.get("deal_price")
    ratio_input = row.get("receipt_ratio_input")
    if amount is not None and deal_price is not None and ratio_input is not None:
        try:
            a = float(amount)
            d = float(deal_price)
            r = float(ratio_input)
            if d > 0:
                ratio_calc = a / d
                if abs(ratio_calc - r) > 0.01:
                    errors.append(
                        f"收款比例偏差过大: 输入={round(r,6)} 计算={round(ratio_calc,6)}"
                    )
        except Exception:
            errors.append("收款比例校验失败（数值格式异常）")

    internal_external = str(row.get("internal_external") or "").strip()
    construction_unit = str(row.get("construction_unit") or "").strip()
    general_contractor_unit = str(row.get("general_contractor_unit") or "").strip()
    if "外" in internal_external:
        if not construction_unit:
            errors.append("外部工抵缺少建设单位（支付工程款的单位）")
        if not general_contractor_unit:
            errors.append("外部工抵缺少总包单位")

    return errors


def compute_diff(file_path: str, existing_rows: list[dict], header_mapping_override: dict[str, str] | None = None):
    df = pd.read_excel(file_path, sheet_name="数据库")
    raw_headers = [str(c).strip() for c in df.columns.tolist()]
    header_mapping = map_headers(raw_headers)
    if header_mapping_override:
        for raw, std in header_mapping_override.items():
            raw_key = str(raw).strip()
            std_key = str(std).strip()
            if raw_key and std_key:
                header_mapping[raw_key] = std_key

    normalized_df = pd.DataFrame()
    for raw, std in header_mapping.items():
        normalized_df[std] = df[raw]

    normalized_rows: list[dict] = []
    for _, rec in normalized_df.iterrows():
        row = {k: normalize_value(v) for k, v in rec.to_dict().items()}
        if not row.get("unit_code"):
            continue
        normalized_rows.append(row)

    existing_index = {}
    for item in existing_rows:
        key = f"{item.get('project','')}|{item.get('unit_code','')}"
        existing_index[key] = item

    rows = []
    summary = {"totalRows": 0, "newRows": 0, "changedRows": 0, "unchangedRows": 0, "errorRows": 0}

    for idx, row in enumerate(normalized_rows, start=2):
        summary["totalRows"] += 1
        key = build_business_key(row)
        before = existing_index.get(key)
        row_errors = validate_row(row)
        if row_errors:
            summary["errorRows"] += 1
            rows.append(
                {
                    "rowNo": idx,
                    "actionType": "ERROR",
                    "businessKey": key,
                    "entityType": "unit",
                    "beforeData": before,
                    "afterData": row,
                    "fieldDiffs": {},
                    "errorMessage": "；".join(row_errors),
                }
            )
            continue

        if not before:
            action = "NEW"
            field_diffs = {k: {"before": None, "after": row.get(k)} for k in row.keys()}
            summary["newRows"] += 1
        else:
            field_diffs = {}
            for field, after_value in row.items():
                before_value = before.get(field)
                if normalize_value(before_value) != normalize_value(after_value):
                    field_diffs[field] = {"before": before_value, "after": after_value}
            if field_diffs:
                action = "CHANGED"
                summary["changedRows"] += 1
            else:
                action = "UNCHANGED"
                summary["unchangedRows"] += 1

        rows.append(
            {
                "rowNo": idx,
                "actionType": action,
                "businessKey": key,
                "entityType": "unit",
                "beforeData": before,
                "afterData": row,
                "fieldDiffs": field_diffs,
            }
        )

    return {"headerMapping": header_mapping, "rows": rows, "summary": summary}
