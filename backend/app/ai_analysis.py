"""
AI 分析模块 —— 数据导出 + AI 结果导入 + 时间线管理。

流程（全手动，不自动调用任何 AI 接口）：
  1) POST /api/export/prices   按时间范围导出价格数据（含统计 + 公司价倒挂）
  2) 用户把「提示词 + 导出数据」贴给 DeepSeek / 其他 AI
  3) POST /api/ai/import       把 AI 返回的 JSON 粘回来 → 解析 → 存一条时间线
  4) GET  /api/ai/list         时间线列表（import_time 倒序）
  5) GET  /api/ai/{id}         详情（结构化 analysis_data）
  6) DELETE /api/ai/{id}
  7) GET  /api/ai/prompt       取系统提示词（供前端「复制提示词」）

设计参考 wechat-ai-lite：把分析指令与格式说明**内嵌进导出内容**，
用户复制一次即可直接投喂给 AI；导入侧对 AI 输出做**容错解析**
（纯 JSON / ```json 围栏 / 夹带解释文字都能吃）。
"""

import hashlib
import json
import re
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from .database import (
    db_session, Product, ProductAlias, PriceHistory, AiAnalysis,
)

BJT = timezone(timedelta(hours=8))
router = APIRouter()

SOURCE_LABEL = {
    "excel_upload": "Excel上传",
    "text_paste": "粘贴上传",
}

# ── 系统提示词（可整体复制给 AI）───────────────────────────

SYSTEM_PROMPT = """你是一个烟草行业数据分析专家。请分析我提供给你的卷烟价格数据，并**严格按照下面给定的 JSON 格式**返回分析结果。

## 分析重点（按优先级）
1. **价格倒挂检测**（第一优先级）：对比 cost_info.current_cost（烟草公司进货价）与最新售价，
   计算倒挂幅度与比例。倒挂幅度 >5% 视为 critical，>0 视为 warning。
2. **趋势拐点识别**：找出价格走势发生方向性变化的日期。
3. **风险评级**：综合倒挂幅度、跌幅、波动性给出红/黄/绿评级与风险分。
4. **短期预测**：基于历史走势给出 30 天后的价格预测与置信度。

## 必须结合的市场背景
- 价格倒挂是当前最大风险：2026 年初全国约 72% 的卷烟品种出现价格倒挂，零售终端毛利空间被持续压缩。
- 高端烟礼品属性正在瓦解：公务接待不上烟后团购渠道基本断裂，依赖「节日溢价」的品规应标记为**结构性风险**而非短期波动。
- 消费决策从「面子」转向「里子」：细支烟贡献新品类近七成体量，中支烟占比提升但增幅不及细支。
  请**按品类（细支/中支/常规）分别统计涨跌**，而不是只看单商品。
- 行业进入存量平台期：整体均价下行是趋势性的，不要把「全面下跌」解读为异常，
  而应聚焦于**哪些品规跌得比大盘更快**。

## 输出格式（严格 JSON，不要任何多余文字、不要 markdown 代码块）
{
  "analysis_version": "1.0",
  "analysis_date": "YYYY-MM-DD",
  "date_range": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "overview": {
    "total_products": 0, "rising_count": 0, "falling_count": 0, "stable_count": 0,
    "avg_change_pct": 0, "inverted_count": 0, "risk_level": "high|medium|low"
  },
  "price_trends": [
    { "product_name": "", "brand": "", "current_price": 0, "min_price": 0, "max_price": 0,
      "change_pct": 0, "trend": "up|down|stable", "trend_strength": "strong|moderate|weak",
      "inflection_points": ["YYYY-MM-DD"] }
  ],
  "inverted_products": [
    { "product_name": "", "brand": "", "cost_price": 0, "sell_price": 0,
      "inverted_amount": 0, "inverted_pct": 0, "severity": "critical|warning" }
  ],
  "risk_assessment": {
    "high_risk":   [ { "product_name": "", "risk_score": 0, "reasons": ["", ""] } ],
    "medium_risk": [ { "product_name": "", "risk_score": 0, "reasons": [""] } ],
    "low_risk":    [ { "product_name": "", "risk_score": 0, "reasons": [""] } ]
  },
  "predictions": [
    { "product_name": "", "current_price": 0, "predicted_price_30d": 0,
      "confidence": 0.0, "direction": "up|down|stable", "basis": "" }
  ],
  "market_context": { "industry_trend": "", "policy_impact": "", "consumer_shift": "" },
  "recommendations": [
    { "priority": "high|medium|low", "action": "", "affected_products": [""], "expected_benefit": "" }
  ],
  "summary": "一段 200 字以内的自然语言总结"
}

再次强调：**只返回 JSON 本体**，不要 ``` 代码块，不要任何解释性文字。"""


# ── 统计工具 ──────────────────────────────────────────────

def _stats(pairs):
    """pairs: [(date, price)] 已按日期升序，price 可能为 None。"""
    prices = [p for _, p in pairs if p is not None and p > 0]
    if not prices:
        return None
    n = len(prices)
    avg = sum(prices) / n
    var = sum((p - avg) ** 2 for p in prices) / n
    std = var ** 0.5
    first, last = prices[0], prices[-1]
    change_pct = round((last - first) / first * 100, 2) if first else 0.0
    if change_pct > 1:
        trend = "up"
    elif change_pct < -1:
        trend = "down"
    else:
        trend = "stable"
    return {
        "min_price": min(prices),
        "max_price": max(prices),
        "avg_price": round(avg, 2),
        "volatility": round(std / avg, 4) if avg else 0.0,
        "trend": trend,
        "change_pct": change_pct,
    }


def build_export(date_from=None, date_to=None, product_ids=None):
    """组装导出数据结构（纯读，不写库）。"""
    out_products = []
    total_records = 0

    with db_session() as s:
        q = s.query(Product).order_by(Product.brand, Product.sort_order, Product.id)
        products = q.all()
        if product_ids:
            keep = set(int(i) for i in product_ids)
            products = [p for p in products if p.id in keep]

        for prod in products:
            aliases = s.query(ProductAlias).filter(
                ProductAlias.product_id == prod.id
            ).order_by(ProductAlias.sort_order, ProductAlias.id).all()

            pq = s.query(PriceHistory).filter(PriceHistory.product_id == prod.id)
            if date_from:
                pq = pq.filter(PriceHistory.price_date >= date_from)
            if date_to:
                pq = pq.filter(PriceHistory.price_date <= date_to)
            records = pq.order_by(PriceHistory.price_date).all()

            history = [
                {
                    "date": r.price_date,
                    "price": r.price,
                    "source": SOURCE_LABEL.get(r.source_name, r.source_name or ""),
                }
                for r in records
            ]
            total_records += len(history)
            stats = _stats([(r.price_date, r.price) for r in records])

            item = {
                "id": prod.id,
                "name": prod.name,
                "brand": prod.brand or "",
                "aliases": [a.alias for a in aliases],
                "cost_info": {
                    "current_cost": prod.current_cost,
                    "cost_effective_from": prod.cost_effective_from,
                    "cost_source": "manual" if prod.current_cost is not None else "unknown",
                },
                "price_history": history,
                "statistics": stats,
            }
            out_products.append(item)

    # 倒挂概览（给 AI 一个直接可用的抓手）
    inverted = []
    for it in out_products:
        cost = it["cost_info"]["current_cost"]
        st = it["statistics"]
        if cost is None or not st:
            continue
        # 用窗口内最后一个有效价作为当前售价
        prices = [p["price"] for p in it["price_history"] if p["price"] and p["price"] > 0]
        if not prices:
            continue
        sell = prices[-1]
        amount = round(cost - sell, 2)
        if amount > 0:
            inverted.append({
                "product_name": it["name"],
                "brand": it["brand"],
                "cost_price": cost,
                "sell_price": sell,
                "inverted_amount": amount,
                "inverted_pct": round(amount / cost * 100, 2) if cost else 0,
            })
    inverted.sort(key=lambda x: -x["inverted_amount"])

    return {
        "export_time": datetime.now(BJT).strftime("%Y-%m-%dT%H:%M:%S"),
        "date_range": {"from": date_from or "", "to": date_to or ""},
        "product_count": len(out_products),
        "total_records": total_records,
        "inverted_summary": {
            "count": len(inverted),
            "top": inverted[:30],
        },
        "products": out_products,
    }


# ── 容错 JSON 解析 ────────────────────────────────────────

def extract_json(text: str):
    """从 AI 输出里抠出 JSON：支持纯 JSON / ```json 围栏 / 夹带解释文字。

    → (dict, error)
    """
    if not text or not text.strip():
        return None, "内容为空"
    s = text.strip()

    # 1) ```json ... ``` 或 ``` ... ```
    m = re.search(r"```(?:json)?\s*(.*?)```", s, re.DOTALL | re.IGNORECASE)
    if m:
        s = m.group(1).strip()

    # 2) 直接解析
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj, None
    except Exception:
        pass

    # 3) 抓最外层平衡的 {...}
    start = s.find("{")
    if start >= 0:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(s)):
            ch = s[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    chunk = s[start:i + 1]
                    try:
                        obj = json.loads(chunk)
                        if isinstance(obj, dict):
                            return obj, None
                    except Exception as e:
                        return None, f"JSON 语法错误：{e}"
    return None, "未能在内容中找到合法的 JSON 对象"


REQUIRED_KEYS = ["overview", "price_trends", "summary"]

KEEP_RAW = 50  # raw_json 只保留最近 N 条，避免 DB 无限膨胀


def _fingerprint(obj) -> str:
    """导入幂等指纹：日期区间 + 摘要。同一份 AI 结果重复粘贴会被识别。"""
    dr = obj.get("date_range") or {}
    key = f"{dr.get('from', '')}|{dr.get('to', '')}|{(obj.get('summary') or '').strip()}"
    return hashlib.md5(key.encode("utf-8")).hexdigest()


def _row_json(r: AiAnalysis, with_data=False):
    d = {
        "id": r.id,
        "import_time": r.import_time.strftime("%Y-%m-%d %H:%M:%S") if r.import_time else "",
        "date_range_from": r.date_range_from or "",
        "date_range_to": r.date_range_to or "",
        "product_count": r.product_count or 0,
        "summary": r.summary or "",
        "source": r.source or "manual_paste",
        "title": r.title or "",
        # 生成列（由 analysis_data 自动派生，可用于列表直接展示/过滤）
        "risk_level": r.risk_level or "",
        "inverted_count": r.inverted_count,
        "avg_change_pct": r.avg_change_pct,
    }
    if with_data:
        try:
            d["analysis_data"] = json.loads(r.analysis_data) if r.analysis_data else None
        except Exception:
            d["analysis_data"] = None
        d["raw_len"] = len(r.raw_json or "")
    return d


# ── 路由 ─────────────────────────────────────────────────

@router.post("/api/export/prices")
async def export_prices(data: dict = {}):
    """导出价格数据（AI 分析输入源）。"""
    date_from = (data.get("date_from") or "").strip() or None
    date_to = (data.get("date_to") or "").strip() or None
    product_ids = data.get("product_ids") or None
    fmt = (data.get("format") or "json").lower()
    if fmt != "json":
        return JSONResponse(status_code=400, content={"error": f"暂不支持格式 {fmt}（当前仅 json）"})
    for label, v in (("date_from", date_from), ("date_to", date_to)):
        if v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            return JSONResponse(status_code=400, content={"error": f"{label} 需为 YYYY-MM-DD"})
    payload = build_export(date_from, date_to, product_ids)
    payload["prompt"] = SYSTEM_PROMPT
    return payload


@router.get("/api/ai/prompt")
def get_prompt():
    """取系统提示词。"""
    return {"prompt": SYSTEM_PROMPT}


@router.post("/api/ai/import")
async def import_analysis(data: dict = {}):
    """粘贴 AI 返回结果 → 解析 → 存为一条时间线记录。"""
    text = data.get("text") or ""
    if not text.strip():
        return JSONResponse(status_code=400, content={"error": "内容为空"})

    obj, err = extract_json(text)
    if err:
        return JSONResponse(status_code=400, content={"error": err})

    missing = [k for k in REQUIRED_KEYS if k not in obj]
    if missing:
        return JSONResponse(status_code=400, content={
            "error": f"JSON 缺少必需字段：{', '.join(missing)}",
            "got_keys": sorted(obj.keys()),
        })

    dr = obj.get("date_range") or {}
    ov = obj.get("overview") or {}
    summary = obj.get("summary") or ""
    fp = _fingerprint(obj)

    with db_session() as s:
        dup = s.query(AiAnalysis).filter(AiAnalysis.fingerprint == fp).first()
        if dup and not data.get("force"):
            return JSONResponse(status_code=409, content={
                "error": "这条分析结果已经导入过了",
                "duplicate": True,
                "id": dup.id,
                "import_time": dup.import_time.strftime("%Y-%m-%d %H:%M:%S") if dup.import_time else "",
            })

        row = AiAnalysis(
            import_time=datetime.now(),
            date_range_from=(dr.get("from") or "").strip(),
            date_range_to=(dr.get("to") or "").strip(),
            product_count=int(ov.get("total_products") or 0),
            raw_json=text,
            analysis_data=json.dumps(obj, ensure_ascii=False),
            summary=summary,
            source="manual_paste",
            title=(data.get("title") or "").strip(),
            # 强制重复导入时不再写指纹 —— fingerprint 有 UNIQUE 索引，
            # 且 SQLite 允许多个 NULL，正好让 force 行不参与判重
            fingerprint=None if dup else fp,
        )
        s.add(row)
        try:
            s.flush()
        except IntegrityError:
            s.rollback()
            return JSONResponse(status_code=409, content={
                "error": "这条分析结果已经导入过了", "duplicate": True,
            })
        rid = row.id
        saved = _row_json(row)

        # raw_json 保留策略：只留最近 KEEP_RAW 条
        stale = s.query(AiAnalysis).filter(
            AiAnalysis.raw_json.isnot(None)
        ).order_by(AiAnalysis.import_time.desc(), AiAnalysis.id.desc()).offset(KEEP_RAW).all()
        for r in stale:
            r.raw_json = None

    optional = ("inverted_products", "risk_assessment", "predictions", "recommendations")
    warnings = []
    if not all(k in obj for k in optional):
        warnings.append(f"缺少可选字段：{', '.join(k for k in optional if k not in obj)}")
    if dup:
        warnings.append("检测到内容相同的旧记录，本次为强制重复导入")

    return {"status": "ok", "id": rid, "record": saved, "warnings": warnings}


@router.get("/api/ai/list")
def list_analysis():
    """时间线列表（import_time 倒序）。"""
    with db_session() as s:
        rows = s.query(AiAnalysis).order_by(AiAnalysis.import_time.desc(), AiAnalysis.id.desc()).all()
        return {"records": [_row_json(r) for r in rows]}


@router.get("/api/ai/{record_id}/charts")
def get_charts(record_id: int):
    """聚合好的图表数据。

    前端不再拉全量导出（2MB）自己遍历计算，这里一次算完返回。
    大盘指数/品牌排行/风险热力全部来自真实价格数据，KPI 优先取 AI 的 overview。
    """
    with db_session() as s:
        r = s.query(AiAnalysis).filter(AiAnalysis.id == record_id).first()
        if not r:
            return JSONResponse(status_code=404, content={"error": "记录不存在"})
        try:
            obj = json.loads(r.analysis_data) if r.analysis_data else {}
        except Exception:
            obj = {}
        dr_from, dr_to = r.date_range_from, r.date_range_to

    exp = build_export(dr_from or None, dr_to or None)
    products = exp["products"]

    # ── 大盘归一化指数（各商品以区间首价为基准，逐日取均值 ×100）──
    by_date: dict[str, list] = {}
    for p in products:
        hist = [h for h in p["price_history"] if h["price"] and h["price"] > 0]
        if len(hist) < 2:
            continue
        base = hist[0]["price"]
        for h in hist:
            by_date.setdefault(h["date"], []).append(h["price"] / base)
    dates = sorted(by_date.keys())
    values = [round(sum(by_date[d]) / len(by_date[d]) * 100, 2) for d in dates]

    # ── 品牌涨跌排行 ──
    bm: dict[str, list] = {}
    for p in products:
        st = p["statistics"]
        if not st:
            continue
        bm.setdefault(p["brand"] or "未分类", []).append(st["change_pct"])
    brand_rank = sorted(
        ({"brand": b, "avg": round(sum(v) / len(v), 2), "n": len(v)} for b, v in bm.items()),
        key=lambda x: x["avg"],
    )

    # ── 风险热力（品牌 × 风险等级）──
    name_to_brand = {p["name"]: (p["brand"] or "未分类") for p in products}
    risk = obj.get("risk_assessment") or {}
    levels = [("high_risk", "高风险"), ("medium_risk", "中风险"), ("low_risk", "低风险")]
    counts: dict[str, list] = {}
    for li, (key, _label) in enumerate(levels):
        for it in (risk.get(key) or []):
            b = name_to_brand.get(it.get("product_name", ""), "未匹配")
            counts.setdefault(b, [0, 0, 0])[li] += 1
    heat_brands = sorted(counts.keys())
    cells = [[li, bi, c] for bi, b in enumerate(heat_brands)
             for li, c in enumerate(counts[b]) if c > 0]

    # ── KPI + 健康指数 ──
    ov = obj.get("overview") or {}
    total = ov.get("total_products") or len(products)
    inverted = ov.get("inverted_count")
    if inverted is None:
        inverted = exp["inverted_summary"]["count"]
    avg_chg = ov.get("avg_change_pct")
    if avg_chg is None and products:
        chgs = [p["statistics"]["change_pct"] for p in products if p["statistics"]]
        avg_chg = round(sum(chgs) / len(chgs), 2) if chgs else 0
    inv_ratio = (inverted / total) if total else 0
    health = round(max(0.0, min(100.0, 100 - inv_ratio * 60 - max(0.0, -(avg_chg or 0)) * 4)))

    high = risk.get("high_risk") or []
    mid = risk.get("medium_risk") or []
    low = risk.get("low_risk") or []

    return {
        "record_id": record_id,
        "date_range": exp["date_range"],
        "product_count": len(products),
        "total_records": exp["total_records"],
        "kpi": {
            "total": total,
            "avg_change_pct": avg_chg,
            "inverted_count": inverted,
            "high_risk": len(high),
            "medium_risk": len(mid),
            "low_risk": len(low),
            "risk_level": ov.get("risk_level") or "",
            "health_index": health,
        },
        "market_index": {"dates": dates, "values": values},
        "brand_rank": brand_rank,
        "risk_heat": {"brands": heat_brands, "cells": cells,
                      "max": max((c[2] for c in cells), default=0)},
        "predictions": (obj.get("predictions") or [])[:8],
        "inverted_top": [
            {**x, "severity": "critical" if x["inverted_pct"] > 5 else "warning"}
            for x in exp["inverted_summary"]["top"][:20]
        ],
    }


@router.get("/api/ai/{record_id}")
def get_analysis(record_id: int):
    with db_session() as s:
        r = s.query(AiAnalysis).filter(AiAnalysis.id == record_id).first()
        if not r:
            return JSONResponse(status_code=404, content={"error": "记录不存在"})
        return _row_json(r, with_data=True)


@router.delete("/api/ai/{record_id}")
def delete_analysis(record_id: int):
    with db_session() as s:
        r = s.query(AiAnalysis).filter(AiAnalysis.id == record_id).first()
        if not r:
            return JSONResponse(status_code=404, content={"error": "记录不存在"})
        s.delete(r)
    return {"status": "ok", "deleted": record_id}
