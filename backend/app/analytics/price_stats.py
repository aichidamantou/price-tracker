"""本地分析引擎 —— 数据清洗 + 基础统计。"""

from datetime import date, datetime
from statistics import median

from . import config as C


# ── 清洗 ──────────────────────────────────────────────

def parse_date(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def clean_series(records):
    """原始价格记录 → 标准序列。

    规则（对应规格书第三节）：
      - 只保留合法 ISO 日期
      - 价格 None / <=0 视为"无报价"，保留占位但不参与数学计算
      - 按日期升序；同一天多条时取最后一条
      - **不补 0，不插值**
    → [{"date": "YYYY-MM-DD", "price": float|None, "source": str}]
    """
    by_date = {}
    for r in records or []:
        d = str(r.get("date") or r.get("price_date") or "")[:10]
        if not parse_date(d):
            continue
        p = r.get("price")
        try:
            p = float(p) if p is not None else None
        except (TypeError, ValueError):
            p = None
        if p is not None and p <= 0:
            p = None
        by_date[d] = {
            "date": d,
            "price": p,
            "source": r.get("source") or r.get("source_name") or "",
        }
    return [by_date[k] for k in sorted(by_date)]


def valid_points(series):
    """只取有报价的点。"""
    return [x for x in series if x["price"] is not None]


def as_of(series, ref=None):
    """取 <= ref 的点（默认全部）。"""
    if ref is None:
        return series
    return [x for x in series if x["date"] <= ref]


# ── 基础统计 ──────────────────────────────────────────

def basic_stats(series):
    """current / first / min / max / avg / median / range / change。

    没有任何有效报价时返回 None（该商品不进入趋势与预测计算）。
    """
    pts = valid_points(series)
    if not pts:
        return None
    prices = [x["price"] for x in pts]
    first, current = prices[0], prices[-1]
    change_amount = round(current - first, 4)
    change_pct = round((current - first) / first * 100, 2) if first else 0.0
    return {
        "first_date": pts[0]["date"],
        "current_date": pts[-1]["date"],
        "first_price": first,
        "current_price": current,
        "min_price": min(prices),
        "max_price": max(prices),
        "avg_price": round(sum(prices) / len(prices), 2),
        "median_price": round(median(prices), 2),
        "price_range": round(max(prices) - min(prices), 2),
        "change_amount": change_amount,
        "change_pct": change_pct,
        "points": len(prices),
    }


def window_avg(series, days, ref=None):
    """最近 N 天的均价。数据不足时用现有数据，不补。"""
    pts = valid_points(as_of(series, ref))
    if not pts:
        return None
    end = parse_date(pts[-1]["date"])
    if end is None:
        return None
    start = end.toordinal() - days
    sel = [x["price"] for x in pts if parse_date(x["date"]).toordinal() > start]
    if not sel:
        sel = [pts[-1]["price"]]
    return round(sum(sel) / len(sel), 2)


def change_over_days(series, days, ref=None):
    """最近 N 天的涨跌幅：窗口内首价 → 末价。数据不足返回 None。"""
    pts = valid_points(as_of(series, ref))
    if len(pts) < 2:
        return None
    end = parse_date(pts[-1]["date"])
    start = end.toordinal() - days
    sel = [x for x in pts if parse_date(x["date"]).toordinal() >= start]
    if len(sel) < 2:
        return None
    a, b = sel[0]["price"], sel[-1]["price"]
    if not a:
        return None
    return round((b - a) / a * 100, 2)


def std_dev(prices):
    if len(prices) < 2:
        return 0.0
    avg = sum(prices) / len(prices)
    var = sum((p - avg) ** 2 for p in prices) / len(prices)
    return var ** 0.5


def volatility(series):
    """波动性：price_std / coefficient_of_variation。"""
    prices = [x["price"] for x in valid_points(series)]
    if len(prices) < 2:
        return {"price_std": 0.0, "coefficient_of_variation": 0.0, "volatility": 0.0}
    sd = std_dev(prices)
    avg = sum(prices) / len(prices)
    cv = sd / avg if avg else 0.0
    return {
        "price_std": round(sd, 4),
        "coefficient_of_variation": round(cv, 4),
        "volatility": round(cv, 4),   # 保留旧字段名，口径 = 变异系数
    }


def price_position(stats):
    """当前价在历史区间的位置：0=最低附近，1=最高附近。"""
    if not stats:
        return None
    lo, hi = stats["min_price"], stats["max_price"]
    if hi == lo:
        return 1.0
    return round((stats["current_price"] - lo) / (hi - lo), 4)


def recovery(series):
    """历史高点之后的恢复情况。

    recovery_rate = (当前 - 最低) / (历史高点 - 最低)
    recovery_days = 最低点距今天数
    """
    pts = valid_points(series)
    if len(pts) < 3:
        return {"recovery_rate": None, "recovery_days": None, "recovery_state": "unknown"}
    prices = [x["price"] for x in pts]
    peak = max(prices)
    peak_i = prices.index(peak)
    after = pts[peak_i:]
    if len(after) < 2:
        return {"recovery_rate": None, "recovery_days": None, "recovery_state": "unknown"}
    lowest = min(x["price"] for x in after)
    low_i = next(i for i, x in enumerate(after) if x["price"] == lowest)
    current = pts[-1]["price"]
    drop = peak - lowest
    if drop <= 0:
        return {"recovery_rate": 1.0, "recovery_days": 0, "recovery_state": "no_drop"}
    rate = round((current - lowest) / drop, 4)
    days = (parse_date(pts[-1]["date"]) - parse_date(after[low_i]["date"])).days
    if rate >= 0.7:
        state = "strong"
    elif rate >= 0.3:
        state = "partial"
    else:
        state = "weak"
    return {"recovery_rate": rate, "recovery_days": days, "recovery_state": state}
