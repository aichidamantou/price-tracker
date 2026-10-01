"""本地分析引擎 —— 趋势、近期趋势、拐点、连涨连跌、加速/减速。"""

from . import config as C
from .price_stats import valid_points, change_over_days, volatility, parse_date


def classify(change_pct):
    """涨跌幅 → up / down / stable。"""
    if change_pct is None:
        return "stable"
    if change_pct > C.TREND_STABLE_THRESHOLD:
        return "up"
    if change_pct < -C.TREND_STABLE_THRESHOLD:
        return "down"
    return "stable"


def strength(change_pct, cv, down_streak=0, up_streak=0):
    """趋势强度：strong / moderate / weak。

    综合 总涨跌幅 + 波动率 + 连续同向次数。
    """
    if change_pct is None:
        return "weak"
    mag = abs(change_pct)
    streak = max(down_streak, up_streak)
    if mag >= C.TREND_STRONG_THRESHOLD and cv <= C.CV_HIGH and streak >= 2:
        return "strong"
    if mag >= C.TREND_MODERATE_THRESHOLD or streak >= 3:
        return "moderate"
    return "weak"


def streaks(series):
    """最近连续同向的次数（基于相邻有效价差）。"""
    prices = [x["price"] for x in valid_points(series)]
    up = down = 0
    for i in range(len(prices) - 1, 0, -1):
        d = prices[i] - prices[i - 1]
        if d > 0:
            if down:
                break
            up += 1
        elif d < 0:
            if up:
                break
            down += 1
        else:
            break
    return {"up_streak": up, "down_streak": down}


def acceleration(series):
    """近期加速/减速：最近30天变化 vs 前30天变化。

    accelerating_down / accelerating_up / slowing_down / slowing_up / stable
    """
    last30 = change_over_days(series, 30)
    prev30 = change_over_days(series, 60)
    if last30 is None or prev30 is None:
        return "unknown"
    prev_only = prev30 - last30      # 前30天自身的幅度（近似）
    eps = C.TREND_STABLE_THRESHOLD
    if abs(last30) < eps and abs(prev_only) < eps:
        return "stable"
    if last30 < 0 and last30 < prev_only - eps:
        return "accelerating_down"
    if last30 > 0 and last30 > prev_only + eps:
        return "accelerating_up"
    if last30 < 0 and last30 > prev_only + eps:
        return "slowing_down"
    if last30 > 0 and last30 < prev_only - eps:
        return "slowing_up"
    return "stable"


def detect_inflections(series):
    """拐点检测：方向发生反转，且不是单次噪声。

    规则：
      - 相邻变化幅度 < INFLECTION_NOISE_PCT 视为噪声，跳过
      - 方向至少连续 INFLECTION_MIN_RUN 次才算成立
      - 之后方向反转 → 记一个拐点
    """
    pts = valid_points(series)
    if len(pts) < 4:
        return []
    dirs = []       # (index_in_pts, direction)
    for i in range(1, len(pts)):
        a, b = pts[i - 1]["price"], pts[i]["price"]
        if not a:
            continue
        pct = (b - a) / a * 100
        if abs(pct) < C.INFLECTION_NOISE_PCT:
            continue
        dirs.append((i, 1 if pct > 0 else -1))
    if len(dirs) < C.INFLECTION_MIN_RUN + 1:
        return []

    out = []
    run_dir = dirs[0][1]
    run_len = 1
    for k in range(1, len(dirs)):
        idx, d = dirs[k]
        if d == run_dir:
            run_len += 1
            continue
        if run_len >= C.INFLECTION_MIN_RUN:
            prev = pts[idx - 1]["price"]
            cur = pts[idx]["price"]
            pct = round((cur - prev) / prev * 100, 2) if prev else 0
            out.append({
                "date": pts[idx]["date"],
                "from": "up" if run_dir > 0 else "down",
                "to": "up" if d > 0 else "down",
                "price": cur,
                "change_pct": pct,
            })
        run_dir = d
        run_len = 1
    return out


def analyze(series, stats):
    """趋势相关全部指标。"""
    if not stats:
        return {}
    vol = volatility(series)
    cv = vol["coefficient_of_variation"]
    st = streaks(series)

    recent = {}
    for w in C.RECENT_WINDOWS:
        recent[f"change_pct_{w}d"] = change_over_days(series, w)
    r30 = recent.get("change_pct_30d")
    recent_trend = classify(r30)

    long_trend = classify(stats["change_pct"])
    acc = acceleration(series)

    return {
        "trend": long_trend,
        "recent_trend": recent_trend,
        "trend_strength": strength(stats["change_pct"], cv, st["down_streak"], st["up_streak"]),
        "trend_acceleration": acc,
        **recent,
        **st,
        "inflection_points": detect_inflections(series),
        # 长期跌但近期反弹 → 重点关注的趋势反转
        "trend_reversal": bool(long_trend == "down" and recent_trend == "up"),
        **vol,
    }
