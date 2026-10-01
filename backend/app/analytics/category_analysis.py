"""本地分析引擎 —— 品类统计与相对大盘表现。"""

from statistics import median

from . import config as C


def classify(name):
    """按商品名判定品类。实测 208 个商品：细 28 / 中支 15 / 其余常规 165，无交叉。"""
    n = name or ""
    if "细" in n:
        return C.CATEGORY_SLIM
    if "中支" in n:
        return C.CATEGORY_MEDIUM
    return C.CATEGORY_REGULAR


def _avg(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def _median(vals):
    vals = [v for v in vals if v is not None]
    return round(median(vals), 2) if vals else None


def stats(products, market_avg_change_pct):
    """按品类聚合。

    products: [{name, brand, stats, trend, inversion, risk, ...}]（引擎内部结构）
    """
    buckets = {c: [] for c in C.CATEGORY_ORDER}
    for p in products:
        buckets.setdefault(p["category"], []).append(p)

    out = {}
    for cat in C.CATEGORY_ORDER:
        rows = buckets.get(cat) or []
        scored = [r for r in rows if r.get("stats")]
        chgs = [r["stats"]["change_pct"] for r in scored]
        invs = [r for r in scored if (r.get("inversion") or {}).get("is_inverted")]

        rising = sum(1 for c in chgs if c > C.TREND_STABLE_THRESHOLD)
        falling = sum(1 for c in chgs if c < -C.TREND_STABLE_THRESHOLD)
        stable = len(chgs) - rising - falling

        avg_chg = _avg(chgs)
        out[cat] = {
            "product_count": len(rows),
            "scored_count": len(scored),
            "rising_count": rising,
            "falling_count": falling,
            "stable_count": stable,
            "avg_change_pct": avg_chg,
            "median_change_pct": _median(chgs),
            "avg_current_price": _avg([r["stats"]["current_price"] for r in scored]),
            "avg_price_change": _avg([r["stats"]["change_amount"] for r in scored]),
            "inverted_count": len(invs),
            "inverted_rate": round(len(invs) / len(scored), 4) if scored else 0.0,
            "avg_inverted_pct": _avg([r["inversion"]["inverted_pct"] for r in invs]),
            "avg_inverted_amount": _avg([r["inversion"]["inverted_amount"] for r in invs]),
            "high_risk_count": sum(1 for r in rows if (r.get("risk") or {}).get("level") == "high"),
            # 相对大盘
            "relative_to_market": (round(avg_chg - market_avg_change_pct, 2)
                                   if avg_chg is not None and market_avg_change_pct is not None
                                   else None),
        }
    return out


def market_position(relative):
    """相对大盘表现分类。"""
    if relative is None:
        return "unknown"
    if relative > C.RELATIVE_OUTPERFORM:
        return "outperform_market"
    if relative < C.RELATIVE_UNDERPERFORM:
        return "underperform_market"
    return "near_market"


def market_stats(products):
    """整体市场基准。"""
    scored = [p for p in products if p.get("stats")]
    chgs = [p["stats"]["change_pct"] for p in scored]
    inv = [p for p in scored if (p.get("inversion") or {}).get("is_inverted")]
    return {
        "scored_count": len(scored),
        "avg_change_pct": _avg(chgs),
        "median_change_pct": _median(chgs),
        "inverted_count": len(inv),
        "inverted_rate": round(len(inv) / len(scored), 4) if scored else 0.0,
        "avg_inverted_pct": _avg([p["inversion"]["inverted_pct"] for p in inv]),
        "rising_count": sum(1 for c in chgs if c > C.TREND_STABLE_THRESHOLD),
        "falling_count": sum(1 for c in chgs if c < -C.TREND_STABLE_THRESHOLD),
        "stable_count": sum(1 for c in chgs if abs(c) <= C.TREND_STABLE_THRESHOLD),
    }
