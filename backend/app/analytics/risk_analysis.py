"""本地分析引擎 —— 风险评分（100 分制，完全本地、可复现）。"""

from . import config as C


def _band(value, bands, default):
    """按阈值分档取值。bands 为 [(上界, 分值)] 升序。"""
    if value is None:
        return default
    for upper, score in bands:
        if value <= upper:
            return score
    return bands[-1][1] if bands else default


def _inversion_score(inv):
    if not inv or not inv.get("is_inverted"):
        return 0
    pct = inv["inverted_pct"]
    return _band(pct, [(2, 8), (5, 20), (10, 30), (20, 36)], 40)


def _trend_score(trend, stats):
    if not stats:
        return 0
    chg = stats["change_pct"]
    if chg >= 0:
        base = 0
    else:
        base = _band(-chg, [(2, 3), (5, 8), (10, 14), (20, 19)], 25)
    streak = trend.get("down_streak") or 0
    base += min(streak * 2, 4)
    acc = trend.get("trend_acceleration")
    if acc == "accelerating_down":
        base += 3
    elif acc == "slowing_down":
        base -= 3
    return max(0, min(int(round(base)), C.RISK_WEIGHTS["trend"]))


def _volatility_score(trend):
    cv = trend.get("coefficient_of_variation")
    return _band(cv, [(C.CV_LOW, 0), (0.04, 4), (C.CV_HIGH, 8), (0.15, 12)], 15)


def _duration_score(dur, inv):
    if not inv or not inv.get("is_inverted"):
        return 0
    cont = dur.get("continuous_inverted_records") or 0
    score = min(cont, 6) / 6 * 7
    if (dur.get("inverted_days") or 0) >= 60:
        score += 3
    return max(0, min(int(round(score)), C.RISK_WEIGHTS["duration"]))


def _relative_score(rel):
    if rel is None:
        return 0
    if rel >= 0:
        return 0
    return _band(-rel, [(2, 2), (5, 5), (10, 7)], 10)


def score(product):
    """商品级风险评分 + 标准化原因标签。

    product: 引擎内部结构 {stats, trend, inversion, duration, market_position, recovery}
    """
    stats = product.get("stats")
    trend = product.get("trend") or {}
    inv = product.get("inversion")
    dur = product.get("duration") or {}
    rel = product.get("relative_performance")
    pos = product.get("market_position")
    rec = product.get("recovery") or {}

    parts = {
        "inversion": _inversion_score(inv),
        "trend": _trend_score(trend, stats),
        "volatility": _volatility_score(trend),
        "duration": _duration_score(dur, inv),
        "relative": _relative_score(rel),
    }
    total = int(round(sum(parts.values())))
    total = max(0, min(total, 100))
    level = ("high" if total >= C.RISK_HIGH_THRESHOLD
             else "medium" if total >= C.RISK_MEDIUM_THRESHOLD else "low")

    # ── 原因标签（本地根据实际触发条件生成，AI 只做自然语言化）──
    reasons = []
    if inv and inv.get("is_inverted"):
        if inv["inverted_pct"] > C.INVERSION_CRITICAL_THRESHOLD:
            reasons.append(f"倒挂{inv['inverted_pct']}%")
        else:
            reasons.append(f"轻度倒挂{inv['inverted_pct']}%")
        if dur.get("inverted_span") in ("persistent", "long_term"):
            reasons.append("近期价格持续低于进货成本")
        if product.get("inversion_trend") == "expanding":
            reasons.append("倒挂幅度持续扩大")
    c30 = trend.get("change_pct_30d")
    if c30 is not None and c30 < -5:
        reasons.append(f"近30天快速下跌{c30}%")
    if stats and stats["change_pct"] < -8 and trend.get("trend") == "down":
        reasons.append(f"长期持续下跌{stats['change_pct']}%")
    if pos == "underperform_market":
        reasons.append("价格跌幅高于市场平均水平")
    if (trend.get("coefficient_of_variation") or 0) > C.CV_HIGH:
        reasons.append("价格波动显著")
    if trend.get("trend_acceleration") == "accelerating_down":
        reasons.append("跌势正在加速")
    if (trend.get("down_streak") or 0) >= 3:
        reasons.append(f"连续{trend['down_streak']}次下跌")

    # ── 结构性风险候选（本地先筛，AI 再解释，不写成因果）──
    hits = []
    if stats and trend.get("trend") == "down" and stats["change_pct"] < -8:
        hits.append("long_term_down")
    if dur.get("inverted_span") in ("persistent", "long_term"):
        hits.append("persistent_inverted")
    if pos == "underperform_market":
        hits.append("underperform_market")
    if rec.get("recovery_state") == "weak" or (
            rec.get("recovery_rate") is not None and rec["recovery_rate"] < C.RECOVERY_WEAK_THRESHOLD):
        hits.append("weak_recovery")

    return {
        "risk_score": total,
        "level": level,
        "score_breakdown": parts,
        "reasons": reasons,
        "structural_risk_candidate": len(hits) >= C.STRUCTURAL_RISK_MIN_HITS,
        "structural_hits": hits,
    }
