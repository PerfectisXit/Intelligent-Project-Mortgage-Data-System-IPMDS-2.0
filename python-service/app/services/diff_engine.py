from __future__ import annotations

import pandas as pd
from datetime import datetime

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


def compute_diff(file_path: str, existing_rows: list[dict]):
    df = pd.read_excel(file_path, sheet_name="数据库")
    raw_headers = [str(c).strip() for c in df.columns.tolist()]
    header_mapping = map_headers(raw_headers)

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
