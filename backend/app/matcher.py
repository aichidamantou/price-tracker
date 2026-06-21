"""
商品标准化匹配引擎 —— Phase 3-4。

匹配规则（按优先级）：
  1. 精确匹配（标准名完全一致）
  2. 别名匹配（用户的 alias 对照表，最优先）
  3. 标准名去括号匹配
  4. 关键词匹配（products.keywords）
  5. RapidFuzz 模糊匹配

评分策略：
  ≥ 90: 自动通过
  70-89: 待用户确认
  < 70: 未识别，人工处理
"""

import re
import json
from typing import Optional
from rapidfuzz import fuzz

MATCH_CONFIRM = "confirm"
MATCH_AUTO = "auto"
MATCH_MANUAL = "manual"


def load_match_data(session):
    """
    从 SQLite 加载所有匹配用数据到纯 Python 结构中。
    注意：返回的是纯字典/list，不是 ORM 对象——避免 session detached 问题。
    """
    from .database import Product, ProductAlias

    products = session.query(Product).all()
    aliases = session.query(ProductAlias).all()

    alias_map = {}        # alias → product_id
    for a in aliases:
        alias_map[a.alias] = a.product_id
        # Also add space-compressed version（如"熊  (典藏" → "熊(典藏"）
        compressed = re.sub(r'\s+', '', a.alias)
        if compressed != a.alias and compressed not in alias_map:
            alias_map[compressed] = a.product_id

    # 手动补充常见 OCR 变体（不在别名表中但经常出现）
    # "熊题" → "熊猫"（熊题细支 → 熊猫细支）
    for known_alias, target_id in list(alias_map.items()):
        if "熊 " in known_alias or "熊" in known_alias:
            if "熊题" not in alias_map:
                alias_map["熊题(细支门票"] = target_id
                break

    name_map = {}          # product_name → product_id
    product_names = {}     # product_id → product_name
    no_bracket_map = {}    # 去括号名称 → product_id
    keyword_map = {}       # keyword → product_id

    for p in products:
        name_map[p.name] = p.id
        product_names[p.id] = p.name
        no_bracket = re.sub(r'[（(）)\s]', '', p.name)
        no_bracket_map[no_bracket] = p.id

        if p.keywords:
            try:
                for kw in json.loads(p.keywords):
                    keyword_map[kw] = p.id
            except (json.JSONDecodeError, TypeError):
                pass

    return {
        "alias_map": alias_map,
        "name_map": name_map,
        "product_names": product_names,
        "no_bracket_map": no_bracket_map,
        "keyword_map": keyword_map,
        # 用于 fuzzy 匹配的纯字符串列表
        "all_names": [p.name for p in products],
    }


def match_item(session, raw_name: str, md: dict) -> dict:
    """
    对单个商品名执行多层匹配。
    返回：
      {"product_id": int|None, "product_name": str|None,
       "score": int, "source": str, "status": str}
    """
    alias_map = md["alias_map"]
    name_map = md["name_map"]
    product_names = md["product_names"]
    no_bracket_map = md["no_bracket_map"]
    keyword_map = md["keyword_map"]
    all_names = md["all_names"]

    # ── 第1层: 精确匹配 ──────────────────────────────────
    if raw_name in name_map:
        pid = name_map[raw_name]
        return {"product_id": pid, "product_name": product_names[pid],
                "score": 100, "source": "exact", "status": MATCH_AUTO}

    # ── 第2层: 别名匹配（你的 OCR 对照表）─────────────
    if raw_name in alias_map:
        pid = alias_map[raw_name]
        return {"product_id": pid, "product_name": product_names.get(pid),
                "score": 100, "source": "alias", "status": MATCH_AUTO}

    # ── 第3层: 去括号匹配 ────────────────────────────────
    no_bracket = re.sub(r'[（(）)\s]', '', raw_name)
    if no_bracket in name_map:
        pid = name_map[no_bracket]
        return {"product_id": pid, "product_name": product_names[pid],
                "score": 95, "source": "no_bracket", "status": MATCH_AUTO}
    if no_bracket in no_bracket_map:
        pid = no_bracket_map[no_bracket]
        return {"product_id": pid, "product_name": product_names[pid],
                "score": 95, "source": "no_bracket", "status": MATCH_AUTO}

    # ── 第4层: 关键词匹配 ────────────────────────────────
    if keyword_map:
        for kw, pid in keyword_map.items():
            if kw in raw_name or raw_name in kw:
                return {"product_id": pid, "product_name": product_names.get(pid),
                        "score": 85, "source": "keyword", "status": MATCH_CONFIRM}

    # ── 第5层: RapidFuzz 模糊匹配 ────────────────────────
    best_pid = None
    best_name = None
    best_score = 0
    for pname in all_names:
        score1 = fuzz.token_sort_ratio(raw_name, pname)
        score2 = fuzz.partial_ratio(raw_name, pname)
        score = int(score1 * 0.6 + score2 * 0.4)
        if score > best_score:
            best_score = score
            best_name = pname
            best_pid = name_map[pname]

    if best_pid and best_score >= 70:
        status = MATCH_AUTO if best_score >= 90 else MATCH_CONFIRM
        return {"product_id": best_pid, "product_name": best_name,
                "score": best_score, "source": "fuzzy", "status": status}

    # ── 未识别 ────────────────────────────────────────────
    return {"product_id": None, "product_name": None,
            "score": 0, "source": "unknown", "status": MATCH_MANUAL}
