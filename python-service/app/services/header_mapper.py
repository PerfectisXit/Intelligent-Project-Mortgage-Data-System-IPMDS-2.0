from difflib import SequenceMatcher
from rapidfuzz import fuzz

STANDARD_HEADERS = {
    "project": ["项目", "项目名称", "项目案名"],
    "property_type": ["业态", "物业类型"],
    "unit_code": ["房间全称/车位号", "房号", "房间号"],
    "customer_name": ["客户", "客户名称", "买受人"],
    "sale_status": ["销售状态"],
    "subscribe_date": ["认购日期"],
    "sign_date": ["签约日期"],
    "area_m2": ["实测面积", "面积"],
    "deal_price": ["现房成交总价", "成交总价"],
    "payment_method": ["付款方式"],
    "actual_received": ["实际收款", "已收款"],
    "undelivered_amount": ["未达款"],
    "internal_external": ["内外部"]
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
