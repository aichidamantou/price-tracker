"""
AI 分析模块 —— 本地计算 + AI 解释。

核心原则（规格书第 38 节）：
    **本地负责「事实和数字」，AI 负责「解释和语言」。**

流程：
  1) POST /api/export/prices   本地引擎算出完整结构化结果 → 给用户复制给 AI
  2) AI 只返回文字字段（背景解释 / 原因归纳 / 建议 / 摘要），**不返回任何数字**
  3) POST /api/ai/import       本地重新计算一遍数字，与 AI 的文字合并入库
  4) GET  /api/ai/{id}/charts  图表直接读本地快照，不重算、不依赖 AI
  5) GET  /api/ai/list · GET /api/ai/{id} · DELETE /api/ai/{id}

导入侧对 AI 输出做容错解析（纯 JSON / ```json 围栏 / 夹带解释文字都能吃）。
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
from .analytics import analysis_engine

BJT = timezone(timedelta(hours=8))
router = APIRouter()

SOURCE_LABEL = {
    "excel_upload": "Excel上传",
    "text_paste": "粘贴上传",
    "migration": "迁移",
}

# ── 系统提示词 ────────────────────────────────────────

SYSTEM_PROMPT = """你是烟草行业数据分析师。下面的数据已经由本地分析引擎**全部计算完成**，你只负责解释。

## 你的职责
1. **市场背景解释** —— 解释整体价格变化、品类差异、倒挂情况、结构性风险候选反映了什么
2. **风险原因自然语言化** —— 本地已经给出结构化原因标签（如「倒挂24.53%」「近30天快速下跌-8.2%」），
   把它们组织成人话
3. **行业背景关联** —— 结合下面提供的行业背景做关联分析
4. **建议** —— 针对本地已识别的风险给出经营建议
5. **总结** —— 200 字以内的自然语言总结

## 绝对禁止（违反即为错误输出）
- 禁止重新计算任何数值
- 禁止修改本地计算结果
- 禁止自行生成不存在的价格
- 禁止自行修改风险等级、风险分
- 禁止自行修改倒挂金额和比例
- 禁止自行修改预测价格和置信度
- 禁止把市场背景推测描述成确定因果关系
- 如果数据不足，必须明确说明数据不足，不要编造

## 必须区分三种表述
- **数据事实**：直接引用本地给的数字（「208 个商品中 115 个倒挂」）
- **市场背景**：外部行业信息（「行业普遍反映高端烟倒挂面扩大」）
- **分析推测**：用「可能」「或与……有关」措辞（「或与礼品属性弱化有关」）
绝不能把推测写成事实。

## 行业背景（供关联分析）
- 价格倒挂是当前最大风险：2026 年初全国约 72% 的卷烟品种出现价格倒挂，零售终端毛利被压缩
- 高端烟礼品属性正在瓦解：公务接待不上烟后团购渠道基本断裂，依赖「节日溢价」的品规属**结构性风险**
- 消费决策从「面子」转向「里子」：细支烟贡献新品类近七成体量，中支占比提升但增幅不及细支
- 行业进入存量平台期：整体均价下行是趋势性的，不应把「全面下跌」解读为异常，
  而应聚焦**哪些品规跌得比大盘更快**（看 relative_performance）

## 输出格式（严格 JSON，不要 markdown 代码块，不要任何解释性文字）
{
  "analysis_version": "2.0",
  "analysis_date": "YYYY-MM-DD",
  "market_context": {
    "industry_trend": "整体价格变化说明什么",
    "policy_impact": "政策/渠道层面的影响",
    "consumer_shift": "消费结构变化"
  },
  "category_insights": [
    { "category": "细支|中支|常规", "comment": "该品类的表现说明了什么" }
  ],
  "risk_narratives": [
    { "product_name": "商品名", "narrative": "把本地 reasons 组织成一句话" }
  ],
  "structural_analysis": [
    { "product_name": "商品名", "hypothesis": "可能相关的行业因素（必须用'可能/或与…有关'措辞）" }
  ],
  "recommendations": [
    { "priority": "high|medium|low", "action": "具体动作",
      "affected_products": ["商品名"], "expected_benefit": "预期效果" }
  ],
  "summary": "200 字以内的总结"
}

再次强调：**只返回 JSON 本体**，不要 ``` 代码块，不要任何数字重算。"""


# ── 数据采集与本地计算 ────────────────────────────────

def collect_products(date_from=None, date_to=None, product_ids=None):
    """从库里取原始数据（供引擎消费）。"""
    out = []
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

            out.append({
                "id": prod.id,
                "name": prod.name,
                "brand": prod.brand or "",
                "aliases": [a.alias for a in aliases],
                "cost_price": prod.current_cost,
                "cost_effective_from": prod.cost_effective_from,
                "records": [
                    {"date": r.price_date, "price": r.price,
                     "source": SOURCE_LABEL.get(r.source_name, r.source_name or "")}
                    for r in records
                ],
            })
    return out


def run_local(date_from=None, date_to=None, product_ids=None):
    products = collect_products(date_from, date_to, product_ids)
    return analysis_engine.run(products, date_from, date_to)


# ── 容错 JSON 解析 ────────────────────────────────────

def extract_json(text: str):
    """从 AI 输出里抠出 JSON：纯 JSON / ```json 围栏 / 夹带解释文字。

    → (dict, error)
    """
    if not text or not text.strip():
        return None, "内容为空"
    s = text.strip()

    m = re.search(r"```(?:json)?\s*(.*?)```", s, re.DOTALL | re.IGNORECASE)
    if m:
        s = m.group(1).strip()

    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj, None
    except Exception:
        pass

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
                    try:
                        obj = json.loads(s[start:i + 1])
                        if isinstance(obj, dict):
                            return obj, None
                    except Exception as e:
                        return None, f"JSON 语法错误：{e}"
    return None, "未能在内容中找到合法的 JSON 对象"


REQUIRED_AI_KEYS = ["summary"]


def _fingerprint(obj) -> str:
    dr = obj.get("date_range") or {}
    key = f"{dr.get('from', '')}|{dr.get('to', '')}|{(obj.get('summary') or '').strip()}"
    return hashlib.md5(key.encode("utf-8")).hexdigest()


KEEP_RAW = 50


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
        "risk_level": r.risk_level or "",
        "inverted_count": r.inverted_count,
        "avg_change_pct": r.avg_change_pct,
        "has_local": bool(r.local_data),
    }
    if with_data:
        try:
            d["analysis_data"] = json.loads(r.analysis_data) if r.analysis_data else None
        except Exception:
            d["analysis_data"] = None
        d["raw_len"] = len(r.raw_json or "")
    return d


def _merge(local, ai):
    """本地数字 + AI 文字 = 最终结果。数字永远以本地为准。"""
    return {
        "analysis_version": "2.0",
        "generated_by": {
            "numbers": f"local_engine_v{local['meta']['engine_version']}",
            "text": "ai",
        },
        "date_range": local["meta"]["date_range"],
        "engine_generated_at": local["meta"]["generated_at"],
        # ── 本地计算（AI 无权修改）──
        "overview": local["overview"],
        "market_stats": local["market_stats"],
        "category_stats": local["category_stats"],
        "price_trends": local["price_trends"],
        "inverted_products": local["inverted_products"],
        "inversion_rankings": local["inversion_rankings"],
        "risk_assessment": local["risk_assessment"],
        "predictions": local["predictions"],
        "anomalies": local["anomalies"],
        "data_quality": local["data_quality"],
        # ── AI 文字（只解释，不含数字）──
        "market_context": ai.get("market_context") or {},
        "category_insights": ai.get("category_insights") or [],
        "risk_narratives": ai.get("risk_narratives") or [],
        "structural_analysis": ai.get("structural_analysis") or [],
        "recommendations": ai.get("recommendations") or [],
        "summary": ai.get("summary") or "",
    }


# ── 路由 ─────────────────────────────────────────────

@router.post("/api/export/prices")
async def export_prices(data: dict = {}):
    """本地算完 → 返回可复制给 AI 的精简载荷 + 系统提示词。"""
    date_from = (data.get("date_from") or "").strip() or None
    date_to = (data.get("date_to") or "").strip() or None
    product_ids = data.get("product_ids") or None
    fmt = (data.get("format") or "json").lower()
    if fmt != "json":
        return JSONResponse(status_code=400, content={"error": f"暂不支持格式 {fmt}（当前仅 json）"})
    for label, v in (("date_from", date_from), ("date_to", date_to)):
        if v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            return JSONResponse(status_code=400, content={"error": f"{label} 需为 YYYY-MM-DD"})

    local = run_local(date_from, date_to, product_ids)
    payload = analysis_engine.build_ai_payload(local)
    ov = local["overview"]

    return {
        "export_time": datetime.now(BJT).strftime("%Y-%m-%dT%H:%M:%S"),
        "date_range": local["meta"]["date_range"],
        "product_count": ov["total_products"],
        "total_records": local["data_quality"]["total_records"],
        "summary": {
            "rising_count": ov["rising_count"],
            "falling_count": ov["falling_count"],
            "stable_count": ov["stable_count"],
            "avg_change_pct": ov["avg_change_pct"],
            "inverted_count": ov["inverted_count"],
            "health_index": ov["health_index"],
        },
        "inverted_summary": {
            "count": len(local["inverted_products"]),
            "top": local["inverted_products"][:30],
        },
        "ai_payload": payload,
        "prompt": SYSTEM_PROMPT,
    }


@router.get("/api/ai/prompt")
def get_prompt():
    return {"prompt": SYSTEM_PROMPT}


@router.post("/api/ai/import")
async def import_analysis(data: dict = {}):
    """粘贴 AI 结果 → 本地重算数字 → 合并入库。"""
    text = data.get("text") or ""
    if not text.strip():
        return JSONResponse(status_code=400, content={"error": "内容为空"})

    ai, err = extract_json(text)
    if err:
        return JSONResponse(status_code=400, content={"error": err})

    missing = [k for k in REQUIRED_AI_KEYS if k not in ai]
    if missing:
        return JSONResponse(status_code=400, content={
            "error": f"AI 返回的 JSON 缺少必需字段：{', '.join(missing)}",
            "got_keys": sorted(ai.keys()),
        })

    # 日期区间：优先用请求里显式给的，否则用 AI 回显的
    dr = ai.get("date_range") or {}
    date_from = (data.get("date_from") or dr.get("from") or "").strip() or None
    date_to = (data.get("date_to") or dr.get("to") or "").strip() or None

    # ★ 数字一律本地重算，不采信 AI 回显的任何数值
    local = run_local(date_from, date_to, data.get("product_ids") or None)
    merged = _merge(local, ai)

    fp = _fingerprint({"date_range": {"from": date_from or "", "to": date_to or ""},
                       "summary": merged["summary"]})

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
            date_range_from=date_from or "",
            date_range_to=date_to or "",
            product_count=local["overview"]["total_products"],
            raw_json=text,
            analysis_data=json.dumps(merged, ensure_ascii=False),
            local_data=json.dumps(local, ensure_ascii=False),
            summary=merged["summary"],
            source="manual_paste",
            title=(data.get("title") or "").strip(),
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

        stale = s.query(AiAnalysis).filter(
            AiAnalysis.raw_json.isnot(None)
        ).order_by(AiAnalysis.import_time.desc(), AiAnalysis.id.desc()).offset(KEEP_RAW).all()
        for r in stale:
            r.raw_json = None

    optional = ("market_context", "recommendations", "category_insights", "risk_narratives")
    warnings = []
    if not all(k in ai for k in optional):
        warnings.append(f"AI 结果缺少可选字段：{', '.join(k for k in optional if k not in ai)}")
    if dup:
        warnings.append("检测到内容相同的旧记录，本次为强制重复导入")

    return {"status": "ok", "id": rid, "record": saved, "warnings": warnings,
            "local_overview": local["overview"]}


@router.get("/api/ai/list")
def list_analysis():
    with db_session() as s:
        rows = s.query(AiAnalysis).order_by(
            AiAnalysis.import_time.desc(), AiAnalysis.id.desc()).all()
        return {"records": [_row_json(r) for r in rows]}


def _load_local(r):
    """取本地分析快照；老记录没有就现算一份。"""
    if r.local_data:
        try:
            return json.loads(r.local_data)
        except Exception:
            pass
    return run_local(r.date_range_from or None, r.date_range_to or None)


@router.get("/api/ai/{record_id}/charts")
def get_charts(record_id: int):
    """图表数据 —— 直接读本地快照，不重算、不依赖 AI。"""
    with db_session() as s:
        r = s.query(AiAnalysis).filter(AiAnalysis.id == record_id).first()
        if not r:
            return JSONResponse(status_code=404, content={"error": "记录不存在"})
        local = _load_local(r)
        try:
            merged = json.loads(r.analysis_data) if r.analysis_data else {}
        except Exception:
            merged = {}

    ov = local["overview"]
    trends = local["price_trends"]

    # 品牌涨跌排行
    bm = {}
    for t in trends:
        bm.setdefault(t["brand"] or "未分类", []).append(t["change_pct"])
    brand_rank = sorted(
        ({"brand": b, "avg": round(sum(v) / len(v), 2), "n": len(v)} for b, v in bm.items()),
        key=lambda x: x["avg"],
    )

    # 风险热力（品牌 × 风险等级）
    name_to_brand = {t["product_name"]: (t["brand"] or "未分类") for t in trends}
    ra = local["risk_assessment"]
    levels = [("high_risk", "高风险"), ("medium_risk", "中风险"), ("low_risk", "低风险")]
    counts = {}
    for li, (key, _lbl) in enumerate(levels):
        for it in ra.get(key) or []:
            b = name_to_brand.get(it["product_name"], "未匹配")
            counts.setdefault(b, [0, 0, 0])[li] += 1
    heat_brands = sorted(counts)
    cells = [[li, bi, c] for bi, b in enumerate(heat_brands)
             for li, c in enumerate(counts[b]) if c > 0]

    return {
        "record_id": record_id,
        "date_range": local["meta"]["date_range"],
        "engine_version": local["meta"]["engine_version"],
        "product_count": ov["total_products"],
        "total_records": local["data_quality"]["total_records"],
        "kpi": {
            "total": ov["total_products"],
            "avg_change_pct": ov["avg_change_pct"],
            "inverted_count": ov["inverted_count"],
            "high_risk": len(ra["high_risk"]),
            "medium_risk": len(ra["medium_risk"]),
            "low_risk": len(ra["low_risk"]),
            "risk_level": ov["risk_level"],
            "health_index": ov["health_index"],
        },
        "market_index": local.get("market_index") or {"dates": [], "values": []},
        "brand_rank": brand_rank,
        "category_stats": local["category_stats"],
        "risk_heat": {"brands": heat_brands, "cells": cells,
                      "max": max((c[2] for c in cells), default=0)},
        "predictions": local["predictions"][:8],
        "inverted_top": [
            {**x, "severity": "critical" if x["inverted_pct"] > 5 else "warning"}
            for x in local["inverted_products"][:20]
        ],
        "inversion_rankings": local["inversion_rankings"],
        "data_quality": local["data_quality"],
        # AI 文字部分（前端底部两块用）
        "ai_text": {
            "summary": merged.get("summary") or "",
            "market_context": merged.get("market_context") or {},
            "recommendations": merged.get("recommendations") or [],
            "category_insights": merged.get("category_insights") or [],
            "risk_narratives": merged.get("risk_narratives") or [],
            "structural_analysis": merged.get("structural_analysis") or [],
        },
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
