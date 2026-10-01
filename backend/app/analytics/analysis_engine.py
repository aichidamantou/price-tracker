"""
本地分析引擎 —— 编排入口。

    raw products → 清洗 → 基础统计 → 趋势 → 倒挂 → 品类 → 异常 → 风险 → 预测
                 → 完整 local_analysis（AI 只读它，不再碰原始记录）

设计原则：
  1. 能确定性算出来的一律本地算
  2. 同一份数据每次结果完全一致（无随机、无时间依赖）
  3. 阈值全部集中在 config.py
"""

from datetime import datetime, timezone, timedelta

from . import config as C
from . import (
    price_stats, trend_analysis, inversion_analysis,
    category_analysis, risk_analysis, prediction, anomaly_detection,
)

BJT = timezone(timedelta(hours=8))


def _health_index(market):
    """0-100 健康指数：倒挂率占 60% 权重，大盘跌幅占 40%。"""
    inv_rate = market.get("inverted_rate") or 0
    avg = market.get("avg_change_pct") or 0
    score = 100 - inv_rate * 60 - max(0.0, -avg) * 4
    return int(round(max(0.0, min(100.0, score))))


def _market_index(rows):
    """大盘归一化指数：每个商品以区间首价为基准，逐日取均值 ×100。

    只纳入有 ≥2 个有效价的商品，避免单点商品扭曲指数。
    """
    by_date = {}
    for r in rows:
        pts = [x for x in r["series"] if x["price"] is not None]
        if len(pts) < 2:
            continue
        base = pts[0]["price"]
        if not base:
            continue
        for x in pts:
            by_date.setdefault(x["date"], []).append(x["price"] / base)
    dates = sorted(by_date)
    values = [round(sum(by_date[d]) / len(by_date[d]) * 100, 2) for d in dates]
    return {"dates": dates, "values": values}


def build_ai_payload(local, trend_limit=25, inv_limit=40, pred_limit=25, anomaly_limit=10):
    """把完整分析结果压成「给 AI 看」的精简载荷。

    规格书第 31 节：AI 主要需要 overview / market_stats / category_stats /
    inverted_products / risk_assessment / predictions，**不需要全量 price_trends**。
    这里只保留值得 AI 展开解释的部分，体积可降到 1/4 左右。
    """
    trends = local["price_trends"]
    notable = [t for t in trends if t.get("trend_reversal")][:trend_limit]
    if len(notable) < trend_limit:
        rest = [t for t in trends if t not in notable][:trend_limit - len(notable)]
        notable += rest

    def slim(t):
        return {
            "product_name": t["product_name"], "brand": t["brand"], "category": t["category"],
            "current_price": t["current_price"], "change_pct": t["change_pct"],
            "change_pct_30d": t["change_pct_30d"], "trend": t["trend"],
            "recent_trend": t["recent_trend"], "trend_strength": t["trend_strength"],
            "trend_acceleration": t["trend_acceleration"], "trend_reversal": t["trend_reversal"],
            "down_streak": t["down_streak"], "relative_performance": t["relative_performance"],
            "market_position": t["market_position"], "price_position": t["price_position"],
            "recovery_state": t["recovery_state"], "risk_score": t["risk_score"],
            "risk_level": t["risk_level"], "inflection_points": t["inflection_points"],
        }

    ra = local["risk_assessment"]
    risk_slim = {
        "high_risk": ra["high_risk"][:40],
        "medium_risk": ra["medium_risk"][:40],
        "low_risk_count": len(ra["low_risk"]),
        "structural_candidates": ra["structural_candidates"][:20],
    }

    return {
        "meta": local["meta"],
        "overview": local["overview"],
        "market_stats": local["market_stats"],
        "category_stats": local["category_stats"],
        "notable_trends": [slim(t) for t in notable],
        "inverted_products": local["inverted_products"][:inv_limit],
        "inversion_rankings": {
            "by_amount": local["inversion_rankings"]["by_amount"][:15],
            "by_pct": local["inversion_rankings"]["by_pct"][:15],
        },
        "risk_assessment": risk_slim,
        "predictions": local["predictions"][:pred_limit],
        "anomalies": {
            "count": len(local["anomalies"]),
            "samples": local["anomalies"][:anomaly_limit],
        },
        "data_quality": local["data_quality"],
        "_notes": [
            "以上全部数值均由本地分析引擎计算完成，为既定事实。",
            "你不得重新计算、修改或推测任何数值。",
            "inverted_pct > 0 表示售价低于进货价（倒挂）。",
            "relative_performance = 该商品涨跌幅 − 大盘平均涨跌幅。",
        ],
    }


def run(products, date_from=None, date_to=None):
    """products: [{id, name, brand, aliases, cost_price, cost_effective_from, records}]"""
    rows = []

    # ── 第一遍：逐商品计算（除相对大盘外的全部指标）──
    for p in products:
        series = price_stats.clean_series(p.get("records"))
        stats = price_stats.basic_stats(series)
        trend = trend_analysis.analyze(series, stats) if stats else {}
        cost = p.get("cost_price")
        inv = inversion_analysis.analyze(cost, stats["current_price"]) if stats else None
        dur = inversion_analysis.duration(series, cost)
        inv_trend = inversion_analysis.trend(series, cost)
        rec = price_stats.recovery(series) if stats else {}

        rows.append({
            "product_id": p.get("id"),
            "product_name": p.get("name"),
            "brand": p.get("brand") or "",
            "aliases": p.get("aliases") or [],
            "category": category_analysis.classify(p.get("name")),
            "cost_price": cost,
            "cost_effective_from": p.get("cost_effective_from"),
            "series": series,
            "stats": stats,
            "trend": trend,
            "inversion": inv,
            "inversion_trend": inv_trend,
            "duration": dur,
            "recovery": rec,
            "avgs": {f"recent_{w}d_avg": price_stats.window_avg(series, w)
                     for w in C.SHORT_AVG_WINDOWS},
            "anomalies": anomaly_detection.detect(series),
            "prediction": prediction.predict(series),
        })

    # ── 市场基准 ──
    market = category_analysis.market_stats(rows)
    market_index = _market_index(rows)

    # ── 第二遍：相对大盘 + 风险评分 ──
    for r in rows:
        st = r["stats"]
        r["relative_performance"] = (
            round(st["change_pct"] - market["avg_change_pct"], 2)
            if st and market["avg_change_pct"] is not None else None
        )
        r["market_position"] = category_analysis.market_position(r["relative_performance"])
        r["price_position"] = price_stats.price_position(st)
        r["risk"] = risk_analysis.score(r)

    # ── 组装输出 ──
    price_trends = []
    for r in rows:
        st = r["stats"]
        if not st:
            continue
        price_trends.append({
            "product_name": r["product_name"],
            "brand": r["brand"],
            "category": r["category"],
            "current_price": st["current_price"],
            "first_price": st["first_price"],
            "min_price": st["min_price"],
            "max_price": st["max_price"],
            "avg_price": st["avg_price"],
            "median_price": st["median_price"],
            "price_range": st["price_range"],
            "change_amount": st["change_amount"],
            "change_pct": st["change_pct"],
            "change_pct_30d": r["trend"].get("change_pct_30d"),
            "change_pct_60d": r["trend"].get("change_pct_60d"),
            "change_pct_90d": r["trend"].get("change_pct_90d"),
            "trend": r["trend"].get("trend"),
            "recent_trend": r["trend"].get("recent_trend"),
            "trend_strength": r["trend"].get("trend_strength"),
            "trend_acceleration": r["trend"].get("trend_acceleration"),
            "trend_reversal": r["trend"].get("trend_reversal"),
            "up_streak": r["trend"].get("up_streak"),
            "down_streak": r["trend"].get("down_streak"),
            "volatility": r["trend"].get("volatility"),
            "coefficient_of_variation": r["trend"].get("coefficient_of_variation"),
            "price_std": r["trend"].get("price_std"),
            "relative_performance": r["relative_performance"],
            "market_position": r["market_position"],
            "price_position": r["price_position"],
            "recovery_rate": r["recovery"].get("recovery_rate"),
            "recovery_days": r["recovery"].get("recovery_days"),
            "recovery_state": r["recovery"].get("recovery_state"),
            "inflection_points": r["trend"].get("inflection_points"),
            "risk_score": r["risk"]["risk_score"],
            "risk_level": r["risk"]["level"],
            **r["avgs"],
        })
    price_trends.sort(key=lambda x: x["change_pct"])

    inverted_products = []
    for r in rows:
        inv = r["inversion"]
        if not inv or not inv.get("is_inverted"):
            continue
        inverted_products.append({
            "product_name": r["product_name"],
            "brand": r["brand"],
            "category": r["category"],
            "cost_price": inv["cost_price"],
            "sell_price": inv["sell_price"],
            "inverted_amount": inv["inverted_amount"],
            "inverted_pct": inv["inverted_pct"],
            "severity": inv["severity"],
            "inverted_days": r["duration"]["inverted_days"],
            "inverted_records": r["duration"]["inverted_records"],
            "continuous_inverted_records": r["duration"]["continuous_inverted_records"],
            "inverted_span": r["duration"]["inverted_span"],
            "inversion_trend": r["inversion_trend"],
        })
    inverted_products.sort(key=lambda x: -x["inverted_amount"])

    def _risk_row(r):
        return {
            "product_name": r["product_name"],
            "brand": r["brand"],
            "category": r["category"],
            "risk_score": r["risk"]["risk_score"],
            "score_breakdown": r["risk"]["score_breakdown"],
            "reasons": r["risk"]["reasons"],
            "structural_risk_candidate": r["risk"]["structural_risk_candidate"],
            "structural_hits": r["risk"]["structural_hits"],
        }

    ranked = sorted(rows, key=lambda r: -r["risk"]["risk_score"])
    risk_assessment = {
        "high_risk": [_risk_row(r) for r in ranked if r["risk"]["level"] == "high"],
        "medium_risk": [_risk_row(r) for r in ranked if r["risk"]["level"] == "medium"],
        "low_risk": [_risk_row(r) for r in ranked if r["risk"]["level"] == "low"],
        "structural_candidates": [_risk_row(r) for r in ranked
                                  if r["risk"]["structural_risk_candidate"]][:30],
    }

    predictions = []
    for r in rows:
        pd = r["prediction"]
        if not pd.get("prediction_available"):
            continue
        st = r["stats"]
        predictions.append({
            "product_name": r["product_name"],
            "brand": r["brand"],
            "category": r["category"],
            "current_price": st["current_price"],
            "predicted_price_30d": pd["predicted_price_30d"],
            "prediction_low": pd["prediction_low"],
            "prediction_high": pd["prediction_high"],
            "confidence": pd["confidence"],
            "direction": pd["direction"],
            "basis": pd["basis"],
        })
    predictions.sort(key=lambda x: -x["confidence"])

    anomalies = []
    for r in rows:
        for a in r["anomalies"]:
            anomalies.append({"product_name": r["product_name"], "brand": r["brand"], **a})

    without_price = [r for r in rows if not r["stats"]]
    insufficient = [r for r in rows if r["stats"] and r["stats"]["points"] < C.MIN_HISTORY_POINTS]
    no_cost = [r for r in rows if r["cost_price"] is None]
    total_records = sum(len(r["series"]) for r in rows)
    valid_records = sum(len(price_stats.valid_points(r["series"])) for r in rows)
    no_pred = [r for r in rows if not r["prediction"].get("prediction_available")]

    level = ("high" if market["inverted_rate"] >= 0.4 or (market["avg_change_pct"] or 0) <= -5
             else "medium" if market["inverted_rate"] >= 0.2 else "low")

    return {
        "meta": {
            "engine_version": C.ENGINE_VERSION,
            "generated_at": datetime.now(BJT).strftime("%Y-%m-%dT%H:%M:%S"),
            "date_range": {"from": date_from or "", "to": date_to or ""},
        },
        "overview": {
            "total_products": len(rows),
            "rising_count": market["rising_count"],
            "falling_count": market["falling_count"],
            "stable_count": market["stable_count"],
            "avg_change_pct": market["avg_change_pct"],
            "inverted_count": market["inverted_count"],
            "risk_level": level,
            "health_index": _health_index(market),
            "high_risk_count": len(risk_assessment["high_risk"]),
            "medium_risk_count": len(risk_assessment["medium_risk"]),
        },
        "market_stats": market,
        "market_index": market_index,
        "category_stats": category_analysis.stats(rows, market["avg_change_pct"]),
        "price_trends": price_trends,
        "inverted_products": inverted_products,
        "inversion_rankings": inversion_analysis.rankings([
            {"product_name": r["product_name"], "brand": r["brand"],
             **(r["inversion"] or {"is_inverted": False})}
            for r in rows
        ]),
        "risk_assessment": risk_assessment,
        "predictions": predictions,
        "anomalies": anomalies,
        "data_quality": {
            "total_products": len(rows),
            "products_with_price": len(rows) - len(without_price),
            "products_without_price": len(without_price),
            "products_without_price_names": [r["product_name"] for r in without_price][:30],
            "products_without_cost": len(no_cost),
            "products_with_insufficient_history": len(insufficient),
            "products_without_prediction": len(no_pred),
            "total_records": total_records,
            "valid_price_records": valid_records,
            "missing_price_records": total_records - valid_records,
        },
    }
