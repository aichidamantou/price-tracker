"""
JSON 文件持久化（线程安全）—— 替代 Redis 的轻量方案。

由于更新频率低（非每日），JSON 文件 I/O 性能完全足够。
每次上传 Excel → 读取 → 合并 → 写回（加 threading.Lock 防并发写入损坏）。
"""

import json
import os
import threading
from typing import Optional

DATA_DIR = os.environ.get("DATA_DIR", "/data")
PRICES_FILE = os.path.join(DATA_DIR, "prices.json")

_lock = threading.Lock()


def _normalize_date_in_data(raw: str) -> str:
    """
    将历史数据中的旧格式日期（"0621" MMDD）迁移为 ISO（"2026-06-21"）。
    不引入 parser 依赖，轻量实现。
    """
    s = str(raw).strip().replace("-", "").replace("/", "")
    if len(s) == 4:
        return f"2026-{s[:2]}-{s[2:]}"
    if len(s) == 6:
        return f"20{s[:2]}-{s[2:4]}-{s[4:]}"
    if len(s) == 8:
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return str(raw).strip()


def _migrate_dates(data: dict) -> dict:
    """将 prices.json 中所有旧格式日期迁移为 ISO 格式，原地修改并返回。"""
    migrated = False
    for brand in data.get("brands", []):
        for item in brand.get("items", []):
            for price_point in item.get("prices", []):
                old = price_point.get("date", "")
                new_date = _normalize_date_in_data(old)
                if new_date != old:
                    price_point["date"] = new_date
                    migrated = True
    return data, migrated


def _ensure_file():
    """Create prices.json if it doesn't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(PRICES_FILE):
        with open(PRICES_FILE, "w", encoding="utf-8") as f:
            json.dump({"brands": []}, f)


def load_all() -> dict:
    """Thread-safe read + auto-migrate old date formats."""
    _ensure_file()
    with _lock:
        with open(PRICES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        data, migrated = _migrate_dates(data)
        if migrated:
            with open(PRICES_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        return data


def save_all(data: dict):
    """Thread-safe write of the entire prices.json."""
    _ensure_file()
    with _lock:
        with open(PRICES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


# ── 与 SQLite 保持一致的增量变更（读-改-写在同一把锁内，原子完成）────────
# prices.json 结构：{"brands":[{"brand":..,"items":[{"name":..,"prices":[..]}]}]}
# 这些函数用于把 SQLite 侧的删除/改名/改品牌/改价同步到 JSON，避免下次上传时
# parser 以旧 JSON 为基线做 carry-over，把改动覆盖或把已删商品“复活”。

def _read_locked() -> dict:
    _ensure_file()
    with open(PRICES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_locked(data: dict):
    _ensure_file()
    with open(PRICES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def remove_item(item_name: str) -> bool:
    """按名称删除商品，顺带清空变空的品牌分组。返回是否发生改动。"""
    _ensure_file()
    with _lock:
        data = _read_locked()
        changed = False
        for brand in data.get("brands", []):
            items = brand.get("items", [])
            kept = [it for it in items if it.get("name") != item_name]
            if len(kept) != len(items):
                brand["items"] = kept
                changed = True
        data["brands"] = [b for b in data.get("brands", []) if b.get("items")]
        if changed:
            _write_locked(data)
        return changed


def rename_item(old_name: str, new_name: str) -> bool:
    """把商品 old_name 改名为 new_name（价格序列保留）。"""
    if not old_name or old_name == new_name:
        return False
    _ensure_file()
    with _lock:
        data = _read_locked()
        changed = False
        for brand in data.get("brands", []):
            for it in brand.get("items", []):
                if it.get("name") == old_name:
                    it["name"] = new_name
                    changed = True
        if changed:
            _write_locked(data)
        return changed


def move_item_brand(item_name: str, new_brand: str) -> bool:
    """把商品移动到新品牌分组下（价格序列保留），并清空变空的旧分组。"""
    if not item_name or not new_brand:
        return False
    _ensure_file()
    with _lock:
        data = _read_locked()
        brands = data.setdefault("brands", [])
        moved = None
        for brand in brands:
            kept = []
            for it in brand.get("items", []):
                if it.get("name") == item_name and moved is None:
                    moved = it  # 从原分组摘除（仅第一个匹配项）
                else:
                    kept.append(it)
            brand["items"] = kept
        if moved is None:
            return False
        target = next((b for b in brands if b.get("brand") == new_brand), None)
        if target is None:
            target = {"brand": new_brand, "items": []}
            brands.append(target)
        if not any(it.get("name") == item_name for it in target.get("items", [])):
            target.setdefault("items", []).append(moved)
        data["brands"] = [b for b in brands if b.get("items")]
        _write_locked(data)
        return True


def upsert_item_price(item_name: str, date_str: str, price) -> bool:
    """更新（或新增）某商品某日价格，与 SQLite 的 upsert_price 语义一致。"""
    if not item_name or not date_str:
        return False
    _ensure_file()
    with _lock:
        data = _read_locked()
        changed = False
        for brand in data.get("brands", []):
            for it in brand.get("items", []):
                if it.get("name") != item_name:
                    continue
                series = it.setdefault("prices", [])
                for p in series:
                    if p.get("date") == date_str:
                        if p.get("price") != price:
                            p["price"] = price
                            changed = True
                        break
                else:
                    series.append({"date": date_str, "price": price})
                    changed = True
        if changed:
            _write_locked(data)
        return changed
