"""本地分析引擎 —— 倒挂计算（第一优先级）。"""

from . import config as C
from .price_stats import valid_points, parse_date


def analyze(cost_price, current_price):
    """单点倒挂：只有 售价 < 成本 才算倒挂。

    inverted_amount = cost - sell
    inverted_pct    = (cost - sell) / cost * 100
    """
    if cost_price is None or current_price is None:
        return None
    amount = round(cost_price - current_price, 4)
    if amount <= 0:
        return {
            "cost_price": cost_price,
            "sell_price": current_price,
            "inverted_amount": 0.0,
            "inverted_pct": 0.0,
            "is_inverted": False,
            "severity": "none",
        }
    pct = round(amount / cost_price * 100, 2) if cost_price else 0.0
    return {
        "cost_price": cost_price,
        "sell_price": current_price,
        "inverted_amount": amount,
        "inverted_pct": pct,
        "is_inverted": True,
        "severity": "critical" if pct > C.INVERSION_CRITICAL_THRESHOLD else "warning",
    }


def duration(series, cost_price):
    """倒挂持续时间。

    口径说明：统一用**当前进货价**回算整段历史（与规格书示例一致）。
    商品若有多次调价，这里不做分段成本回溯。
    """
    if cost_price is None:
        return {"inverted_days": 0, "inverted_records": 0,
                "continuous_inverted_records": 0, "inverted_span": "none"}
    pts = valid_points(series)
    if not pts:
        return {"inverted_days": 0, "inverted_records": 0,
                "continuous_inverted_records": 0, "inverted_span": "none"}

    flags = [x["price"] < cost_price for x in pts]
    inverted_idx = [i for i, f in enumerate(flags) if f]
    if not inverted_idx:
        return {"inverted_days": 0, "inverted_records": 0,
                "continuous_inverted_records": 0, "inverted_span": "none"}

    # 从末尾往前数连续倒挂
    cont = 0
    for f in reversed(flags):
        if f:
            cont += 1
        else:
            break

    first_d = parse_date(pts[inverted_idx[0]]["date"])
    last_d = parse_date(pts[-1]["date"])
    days = (last_d - first_d).days if first_d and last_d else 0

    if cont >= 4 or days >= 60:
        span = "long_term"
    elif cont >= 2 or days >= 14:
        span = "persistent"
    else:
        span = "short_term"

    return {
        "inverted_days": days,
        "inverted_records": len(inverted_idx),
        "continuous_inverted_records": cont,
        "inverted_span": span,
    }


def trend(series, cost_price):
    """倒挂扩大 / 收窄：比较首个倒挂点与当前点的倒挂比例。"""
    if cost_price is None:
        return "not_inverted"
    pts = valid_points(series)
    if not pts:
        return "not_inverted"
    cur = pts[-1]["price"]
    if cur >= cost_price:
        return "not_inverted"
    cur_pct = (cost_price - cur) / cost_price * 100

    first_inv = next((x for x in pts if x["price"] < cost_price), None)
    if first_inv is None:
        return "not_inverted"
    first_pct = (cost_price - first_inv["price"]) / cost_price * 100

    diff = cur_pct - first_pct
    if diff > C.INVERSION_TREND_EPS:
        return "expanding"
    if diff < -C.INVERSION_TREND_EPS:
        return "narrowing"
    return "stable"


def rankings(items):
    """倒挂排名：金额榜 + 比例榜（两个问题分别回答）。"""
    inv = [x for x in items if x.get("is_inverted")]
    by_amount = sorted(inv, key=lambda x: -x["inverted_amount"])[:20]
    by_pct = sorted(inv, key=lambda x: -x["inverted_pct"])[:20]
    pick = lambda lst: [
        {"product_name": x["product_name"], "brand": x["brand"],
         "inverted_amount": x["inverted_amount"], "inverted_pct": x["inverted_pct"],
         "severity": x["severity"]}
        for x in lst
    ]
    return {"by_amount": pick(by_amount), "by_pct": pick(by_pct)}
