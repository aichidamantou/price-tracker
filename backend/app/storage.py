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
