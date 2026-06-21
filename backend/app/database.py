"""
SQLite 数据库层 —— 价格追踪 V3 持久化方案。

三张表：
  products          标准商品库（从模板 Excel 导入）
  product_aliases   商品别名（自动生成 + 用户补充 + 系统学习）
  price_history     价格历史（替代旧 prices.json）

线程安全：SQLite WAL 模式 + 单 engine
"""

import os
import json
from datetime import datetime
from contextlib import contextmanager

from sqlalchemy import (
    create_engine, event, Column, Integer, String, Float,
    DateTime, UniqueConstraint, text,
)
from sqlalchemy.orm import sessionmaker, declarative_base

DATA_DIR = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "prices.db")

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


# ── Models ──────────────────────────────────────────────────


class Product(Base):
    """标准商品表"""
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, unique=True)
    brand = Column(String(100))
    keywords = Column(String(500))  # JSON array as string
    created_at = Column(DateTime, default=datetime.utcnow)


class ProductAlias(Base):
    """商品别名表"""
    __tablename__ = "product_aliases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, nullable=False)
    alias = Column(String(255), nullable=False, unique=True)
    source = Column(String(50))  # auto_generated | manual | user_correction
    sort_order = Column(Integer, default=0)  # 同一 product 下的排序
    created_at = Column(DateTime, default=datetime.utcnow)


class PriceHistory(Base):
    """价格历史表"""
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, nullable=False)
    price = Column(Float)
    price_date = Column(String(10), nullable=False)  # YYYY-MM-DD
    source_name = Column(String(100))  # excel_upload | text_paste
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("product_id", "price_date", name="uq_product_date"),
    )


# ── Helpers ─────────────────────────────────────────────────


def init_db():
    """创建所有表（幂等）。"""
    Base.metadata.create_all(engine)


@contextmanager
def db_session():
    """安全的事务上下文。"""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_product_id(session, name: str):
    p = session.query(Product).filter(Product.name == name).first()
    return p.id if p else None


def get_product_name(session, pid: int):
    p = session.query(Product).filter(Product.id == pid).first()
    return p.name if p else None


def upsert_price(session, product_id: int, price, price_date: str, source: str = ""):
    """插入或更新一条价格记录。"""
    existing = session.query(PriceHistory).filter(
        PriceHistory.product_id == product_id,
        PriceHistory.price_date == price_date,
    ).first()
    if existing:
        existing.price = price
    else:
        session.add(PriceHistory(
            product_id=product_id,
            price=price,
            price_date=price_date,
            source_name=source,
        ))


def migrate_schema():
    """添加新列（幂等，针对已有数据库）。"""
    import sqlite3
    if not os.path.exists(DB_PATH):
        return
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Check if sort_order exists
    c.execute("PRAGMA table_info(product_aliases)")
    cols = [r[1] for r in c.fetchall()]
    if 'sort_order' not in cols:
        c.execute("ALTER TABLE product_aliases ADD COLUMN sort_order INTEGER DEFAULT 0")
        # Set default sort_order = id
        c.execute("UPDATE product_aliases SET sort_order = id")
        conn.commit()
        print("[migrate_schema] Added sort_order column")
    conn.close()
