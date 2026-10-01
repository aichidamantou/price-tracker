"""本地分析引擎 —— 30 天预测（简单线性趋势 + 区间 + 置信度）。

第一版刻意只用一个透明、可复现的模型：对最近 N 个有效价格点做最小二乘线性回归。
不引入任何机器学习依赖。
"""

from . import config as C
from .price_stats import valid_points, parse_date


def _unavailable(reason):
    return {
        "predicted_price_30d": None,
        "prediction_low": None,
        "prediction_high": None,
        "confidence": 0.0,
        "direction": "unknown",
        "prediction_available": False,
        "unavailable_reason": reason,
    }


def predict(series):
    pts = valid_points(series)
    if len(pts) < C.PREDICTION_MIN_POINTS:
        return _unavailable(f"有效价格点不足（{len(pts)} < {C.PREDICTION_MIN_POINTS}）")

    pts = pts[-C.PREDICTION_RECENT_POINTS:]
    dates = [parse_date(p["date"]) for p in pts]
    if any(d is None for d in dates):
        return _unavailable("日期解析失败")

    span = (dates[-1] - dates[0]).days
    if span < C.PREDICTION_MIN_SPAN_DAYS:
        return _unavailable(f"历史跨度过短（{span} 天 < {C.PREDICTION_MIN_SPAN_DAYS}）")

    gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
    if gaps and max(gaps) > C.PREDICTION_MAX_GAP_DAYS:
        return _unavailable(f"数据不连续（最大间隔 {max(gaps)} 天）")

    xs = [(d - dates[0]).days for d in dates]
    ys = [p["price"] for p in pts]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return _unavailable("价格无变化，无法拟合趋势")
    slope = sum((xs[i] - mx) * (ys[i] - my) for i in range(n)) / sxx
    intercept = my - slope * mx

    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((ys[i] - (intercept + slope * xs[i])) ** 2 for i in range(n))
    r2 = max(0.0, 1 - ss_res / ss_tot) if ss_tot > 0 else 0.0
    resid_std = (ss_res / (n - 2)) ** 0.5 if n > 2 else 0.0

    horizon = C.PREDICTION_HORIZON_DAYS
    pred = intercept + slope * (xs[-1] + horizon)
    avg_interval = span / (n - 1) if n > 1 else horizon
    steps = horizon / avg_interval if avg_interval else 1
    half = C.PREDICTION_INTERVAL_Z * resid_std * (steps ** 0.5)

    current = ys[-1]
    low, high = pred - half, pred + half
    pct = (pred - current) / current * 100 if current else 0
    direction = ("up" if pct > C.TREND_STABLE_THRESHOLD
                 else "down" if pct < -C.TREND_STABLE_THRESHOLD else "stable")

    # 置信度：样本量 + 趋势一致性(r²) + 波动 + 数据新鲜度
    cv_resid = (resid_std / my) if my else 1.0
    recency = 1 - min((dates[-1].toordinal() - dates[-1].toordinal()) / 30, 1)
    conf = (min(n / 20, 1) * 0.35
            + r2 * 0.30
            + max(0.0, 1 - cv_resid / 0.15) * 0.20
            + recency * 0.15)

    return {
        "predicted_price_30d": round(pred, 2),
        "prediction_low": round(low, 2),
        "prediction_high": round(high, 2),
        "confidence": round(max(0.0, min(conf, 1.0)), 2),
        "direction": direction,
        "prediction_available": True,
        "basis": {
            "method": "linear_regression",
            "points_used": n,
            "span_days": span,
            "slope_per_day": round(slope, 4),
            "r2": round(r2, 4),
            "residual_std": round(resid_std, 4),
        },
    }
