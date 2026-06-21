"""
数据迁移脚本：从 prices.json 迁移到 SQLite。

首次启动时运行：
  1. 检测 /data/prices.json 是否存在
  2. 读取所有品牌/商品/价格数据
  3. 写入 products + price_history 表
  4. 重命名 prices.json → prices.json.bak

后续启动时：检测 prices.db 已存在则跳过。
"""

import os
import json
import shutil
from datetime import datetime

from .database import (
    init_db, db_session, Product, PriceHistory,
    upsert_price, get_product_id,
)
from .seed_products import seed_products

DATA_DIR = os.environ.get("DATA_DIR", "/data")
JSON_PATH = os.path.join(DATA_DIR, "prices.json")
DB_PATH = os.path.join(DATA_DIR, "prices.db")
BAK_PATH = os.path.join(DATA_DIR, "prices.json.bak")


def migrate_if_needed():
    """
    Migrate prices.json → SQLite + seed standard products.
    Seeds from template on every startup if products table is empty.
    """
    if os.path.exists(DB_PATH):
        init_db()
        seed_on_startup()
        return False

    if not os.path.exists(JSON_PATH):
        init_db()
        seed_on_startup()
        return False

    init_db()
    print(f"[migrate] Found {JSON_PATH}, migrating to SQLite...")

    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    brands = data.get("brands", [])
    total_items = 0
    total_prices = 0

    with db_session() as session:
        for brand_entry in brands:
            brand_name = brand_entry.get("brand", "")
            for item in brand_entry.get("items", []):
                item_name = item.get("name", "")
                prices = item.get("prices", [])

                pid = get_product_id(session, item_name)
                if pid is None:
                    prod = Product(name=item_name, brand=brand_name)
                    session.add(prod)
                    session.flush()
                    pid = prod.id
                    total_items += 1

                for pp in prices:
                    date_str = pp.get("date", "")
                    price_val = pp.get("price")
                    upsert_price(session, pid, price_val, date_str, "migration")
                    total_prices += 1

    shutil.move(JSON_PATH, BAK_PATH)
    print(f"[migrate] Done! Migrated {total_items} products, {total_prices} price records")
    seed_on_startup()
    return True


def seed_on_startup():
    """Run product seeding if products table is empty (idempotent)."""
    with db_session() as session:
        existing = session.query(Product).count()
        if existing > 0:
            print(f"[seed] Products already seeded ({existing} products), skipping")
            return False
        seeded = seed_products(session)
        if seeded > 0:
            print(f"[seed] Added {seeded} standard products from template")
        else:
            print(f"[seed] Products already up to date")
        return True
