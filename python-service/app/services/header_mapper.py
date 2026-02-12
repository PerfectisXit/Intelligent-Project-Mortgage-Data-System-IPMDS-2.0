from difflib import SequenceMatcher
from rapidfuzz import fuzz

STANDARD_HEADERS = {
    "project": ["项目", "项目名称", "项目案名"],
    "property_type": ["业态", "物业类型"],
    "unit_code": ["房间全称/车位号", "房号", "房间号"],
    "customer_name": ["客户", "客户名称", "买受人"],
    "rename_status_raw": ["是否更名", "更名状态", "更名需求"],
    "sale_status": ["销售状态"],
    "subscribe_date": ["认购日期", "认购时间", "认购时间点"],
    "sign_date": ["签约日期", "签约时间", "签约时间点"],
    "area_m2": ["实测面积", "面积"],
    "deal_price_per_m2": ["现房成交单价", "成交单价", "单价"],
    "deal_price": ["现房成交总价", "成交总价"],
    "payment_method": ["付款方式"],
    "actual_received": ["实际收款", "已收款"],
    "receipt_ratio_input": ["收款比例"],
    "undelivered_amount": ["未达款"],
    "undelivered_note": ["未达款情况说明", "未达款说明"],
    "internal_external": ["内外部"],
    "construction_unit": [
        "建设单位",
        "建设单位名称",
        "开发单位",
        "甲方单位",
        "建设方",
        "建设方单位",
        "支付工程款的单位",
    ],
    "general_contractor_unit": ["总包单位", "总包单位名称", "总包", "总承包单位", "总承包", "总包方"],
    "subcontractor_unit": [
        "分包单位",
        "分包单位名称",
        "分包",
        "分包方",
        "施工单位",
        "承接单位",
        "分包（拿走房子的单位）",
    ],
    "phone": ["联系方式", "电话", "手机号", "联系电话"],
    "id_card": ["身份证", "证件号码", "身份证号"],
    "address": ["地址", "联系地址"],
}


def score_header(raw: str, aliases: list[str]) -> float:
    if raw in aliases:
        return 100.0
    seq = max(SequenceMatcher(None, raw, a).ratio() * 100 for a in aliases)
    rfz = max(fuzz.ratio(raw, a) for a in aliases)
    return max(seq, float(rfz))


def map_headers(raw_headers: list[str], threshold: float = 72.0) -> dict[str, str]:
    mapped: dict[str, str] = {}
    for raw in raw_headers:
      if not raw:
          continue
      best_key = None
      best_score = 0.0
      for key, aliases in STANDARD_HEADERS.items():
          score = score_header(str(raw).strip(), aliases)
          if score > best_score:
              best_score = score
              best_key = key
      if best_key and best_score >= threshold:
          mapped[str(raw).strip()] = best_key
    return mapped


def suggest_headers(raw_headers: list[str]) -> list[dict]:
    suggestions: list[dict] = []
    for raw in raw_headers:
        normalized_raw = str(raw).strip()
        if not normalized_raw:
            continue
        scored: list[tuple[str, float]] = []
        for key, aliases in STANDARD_HEADERS.items():
            score = score_header(normalized_raw, aliases)
            scored.append((key, float(round(score, 2))))
        scored.sort(key=lambda x: x[1], reverse=True)
        top = scored[:3]
        best_field, best_score = top[0]
        suggestions.append(
            {
                "rawHeader": normalized_raw,
                "suggestedField": best_field if best_score >= 72.0 else None,
                "confidence": best_score,
                "candidates": [{"field": field, "score": score} for field, score in top],
                "needsConfirm": best_score < 90.0,
            }
        )
    return suggestions
