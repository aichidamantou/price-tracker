"""本地分析引擎 —— 异常价格检测。

⚠️ **只标记，不删除。** 价格突变可能正是真实市场变化。
"""

from . import config as C
from .price_stats import valid_points, parse_date


def _quartiles(vals):
    s = sorted(vals)
    n = len(s)

    def q(p):
        k = (n - 1) * p
        lo, hi = int(k), min(int(k) + 1, n - 1)
        return s[lo] + (s[hi] - s[lo]) * (k - lo)

    return q(0.25), q(0.75)


def detect(series):
    """IQR 法 + 相邻跳变检测。→ [{date, price, expected_low, expected_high, method}]"""
    pts = valid_points(series)
    if len(pts) < C.ANOMALY_MIN_SAMPLES:
        return []
    prices = [x["price"] for x in pts]
    q1, q3 = _quartiles(prices)
    iqr = q3 - q1
    lo = q1 - C.ANOMALY_IQR_MULTIPLIER * iqr
    hi = q3 + C.ANOMALY_IQR_MULTIPLIER * iqr

    out = []
    for x in pts:
        if x["price"] < lo or x["price"] > hi:
            out.append({
                "date": x["date"],
                "price": x["price"],
                "expected_low": round(lo, 2),
                "expected_high": round(hi, 2),
                "method": "iqr",
            })

    # 相邻跳变（相对前一有效价，且不是首次记录）
    for i in range(1, len(pts)):
        a, b = pts[i - 1]["price"], pts[i]["price"]
        if not a:
            continue
        pct = (b - a) / a * 100
        if abs(pct) >= 30:      # 单次跳变 30% 以上，值得看一眼
            if not any(o["date"] == pts[i]["date"] for o in out):
                out.append({
                    "date": pts[i]["date"],
                    "price": b,
                    "prev_price": a,
                    "jump_pct": round(pct, 2),
                    "method": "adjacent_jump",
                })
    return out
