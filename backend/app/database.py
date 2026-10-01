"""
SQLite 数据库层 —— 价格追踪 V3 持久化方案。

五张表：
  products          标准商品库（从模板 Excel 导入）+ 进货价冗余字段
  product_aliases   商品别名（自动生成 + 用户补充 + 系统学习）
  product_cost      进货价历史（按 effective_from 生效日期留存）
  price_history     价格历史（替代旧 prices.json）
  ai_analysis       AI 分析批次（每次导入/自动分析一条时间线记录）

线程安全：SQLite WAL 模式 + 单 engine
"""

import os
import json
from datetime import datetime
from contextlib import contextmanager

from sqlalchemy import (
    create_engine, event, Column, Integer, String, Float, Text,
    DateTime, UniqueConstraint, Computed, text,
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
    sort_order = Column(Integer, default=0)  # within-brand ordering
    # 进货价冗余字段：冗余自 product_cost 中 effective_from 最新的一条，
    # 列表页与当前倒挂计算直接读，避免 JOIN 历史表
    current_cost = Column(Float)
    cost_effective_from = Column(String(10))  # YYYY-MM-DD
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





class BrandOrder(Base):
    """品牌(地区)排序表"""
    __tablename__ = "brand_order"

    id = Column(Integer, primary_key=True, autoincrement=True)
    brand = Column(String(100), nullable=False, unique=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class ProductCost(Base):
    """进货价历史表。

    同一商品同一天只允许一条记录（UNIQUE product_id + effective_from），
    重复写入即覆盖，避免冗余记录。
    """
    __tablename__ = "product_cost"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, nullable=False)
    cost_price = Column(Float, nullable=False)
    effective_from = Column(String(10), nullable=False)  # YYYY-MM-DD 生效日期
    note = Column(String(255))  # 手动更新 | Excel导入 | 补录
    created_at = Column(DateTime, default=datetime.now)  # 容器 TZ=Asia/Shanghai

    __table_args__ = (
        UniqueConstraint("product_id", "effective_from", name="uq_product_cost_date"),
    )


class AiAnalysis(Base):
    """AI 分析批次表。

    每次「粘贴导入」或「一键 AI 分析」生成一条记录，前端按 import_time 倒序
    做成时间线，用于对比不同时期的分析结论。
    """
    __tablename__ = "ai_analysis"

    id = Column(Integer, primary_key=True, autoincrement=True)
    import_time = Column(DateTime, default=datetime.now)  # 容器 TZ=Asia/Shanghai
    date_range_from = Column(String(10))  # YYYY-MM-DD
    date_range_to = Column(String(10))
    product_count = Column(Integer, default=0)
    raw_json = Column(Text)         # 原始粘贴内容（留档，便于排查）
    analysis_data = Column(Text)    # 解析后的结构化 JSON
    summary = Column(Text)          # AI 摘要（列表页直接展示）
    source = Column(String(20), default="manual_paste")  # manual_paste | deepseek_auto
    title = Column(String(120))     # 可选备注标题
    fingerprint = Column(String(64))  # 导入幂等判重（date_range + summary 的 md5）
    # 以下三列由 SQLite 生成列自动维护，ORM 只读不写（Computed 会被排除在 INSERT 外）
    risk_level = Column(Text, Computed(
        "json_extract(analysis_data, '$.overview.risk_level')", persisted=False))
    inverted_count = Column(Integer, Computed(
        "json_extract(analysis_data, '$.overview.inverted_count')", persisted=False))
    avg_change_pct = Column(Float, Computed(
        "json_extract(analysis_data, '$.overview.avg_change_pct')", persisted=False))


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


def _ensure_cost_schema(c, conn, tag: str):
    """进货价相关的幂等迁移：products 冗余列 + product_cost 表 + 索引。

    用原生 SQL 建表，保证老库（create_all 不会补列）也能平滑升级。
    """
    c.execute("PRAGMA table_info(products)")
    prod_cols = [r[1] for r in c.fetchall()]
    if 'current_cost' not in prod_cols:
        c.execute("ALTER TABLE products ADD COLUMN current_cost REAL")
        print(f'[{tag}] Added products.current_cost')
    if 'cost_effective_from' not in prod_cols:
        c.execute("ALTER TABLE products ADD COLUMN cost_effective_from TEXT")
        print(f'[{tag}] Added products.cost_effective_from')
    c.execute("""CREATE TABLE IF NOT EXISTS product_cost (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        cost_price REAL NOT NULL,
        effective_from TEXT NOT NULL,
        note TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(product_id, effective_from)
    )""")
    c.execute("""CREATE INDEX IF NOT EXISTS idx_product_cost_pid_date
                 ON product_cost(product_id, effective_from DESC)""")
    conn.commit()


def _ensure_ai_schema(c, conn, tag: str):
    """AI 分析表的幂等迁移。

    除了基础列，还建 3 个 **VIRTUAL 生成列**（从 analysis_data 里抽 overview 关键字段）
    + 索引，这样「查所有 risk_level=high 的批次」这类聚合能走索引，不必全表读出再在
    Python 里过滤。fingerprint 唯一索引用于导入幂等判重。
    """
    c.execute("""CREATE TABLE IF NOT EXISTS ai_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_time TEXT DEFAULT (datetime('now','localtime')),
        date_range_from TEXT,
        date_range_to TEXT,
        product_count INTEGER DEFAULT 0,
        raw_json TEXT,
        analysis_data TEXT,
        summary TEXT,
        source TEXT DEFAULT 'manual_paste',
        title TEXT,
        fingerprint TEXT,
        risk_level TEXT GENERATED ALWAYS AS
            (json_extract(analysis_data, '$.overview.risk_level')) VIRTUAL,
        inverted_count INTEGER GENERATED ALWAYS AS
            (json_extract(analysis_data, '$.overview.inverted_count')) VIRTUAL,
        avg_change_pct REAL GENERATED ALWAYS AS
            (json_extract(analysis_data, '$.overview.avg_change_pct')) VIRTUAL
    )""")
    # 老表补列（SQLite 只允许 ALTER 加 VIRTUAL 生成列，STORED 不行）
    # 必须用 table_xinfo —— table_info 不返回生成列（生成列算 hidden 列），
    # 用 table_info 会导致「新建表后再 ALTER 一次」→ duplicate column name 报错
    c.execute("PRAGMA table_xinfo(ai_analysis)")
    cols = [r[1] for r in c.fetchall()]
    for name, ddl in (
        ("fingerprint", "ALTER TABLE ai_analysis ADD COLUMN fingerprint TEXT"),
        ("risk_level",
         "ALTER TABLE ai_analysis ADD COLUMN risk_level TEXT GENERATED ALWAYS AS "
         "(json_extract(analysis_data, '$.overview.risk_level')) VIRTUAL"),
        ("inverted_count",
         "ALTER TABLE ai_analysis ADD COLUMN inverted_count INTEGER GENERATED ALWAYS AS "
         "(json_extract(analysis_data, '$.overview.inverted_count')) VIRTUAL"),
        ("avg_change_pct",
         "ALTER TABLE ai_analysis ADD COLUMN avg_change_pct REAL GENERATED ALWAYS AS "
         "(json_extract(analysis_data, '$.overview.avg_change_pct')) VIRTUAL"),
    ):
        if name not in cols:
            c.execute(ddl)
            print(f'[{tag}] Added ai_analysis.{name}')
    c.execute("""CREATE INDEX IF NOT EXISTS idx_ai_analysis_time
                 ON ai_analysis(import_time DESC)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_ai_risk ON ai_analysis(risk_level)")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_fingerprint ON ai_analysis(fingerprint)")
    conn.commit()


def init_db():
    """创建所有表（幂等）。先迁移再建表。"""
    # Pre-create columns that might be missing (before ORM tries to query them)
    import sqlite3
    if os.path.exists(DB_PATH):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("PRAGMA table_info(products)")
        cols = [r[1] for r in c.fetchall()]
        if 'sort_order' not in cols:
            c.execute("ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0")
            c.execute("UPDATE products SET sort_order = id")
            conn.commit()
            print('[init_db] Added products.sort_order')
        # Create brand_order table
        c.execute("""CREATE TABLE IF NOT EXISTS brand_order (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand TEXT NOT NULL UNIQUE,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )""")
        conn.commit()
        _ensure_cost_schema(c, conn, 'init_db')
        _ensure_ai_schema(c, conn, 'init_db')
        conn.close()
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

    # Add products.sort_order
    c.execute("PRAGMA table_info(products)")
    cols = [r[1] for r in c.fetchall()]
    if 'sort_order' not in cols:
        c.execute("ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0")
        c.execute("UPDATE products SET sort_order = id")
        conn.commit()
        print('[migrate_schema] Added products.sort_order')
    # Create brand_order table
    c.execute("""CREATE TABLE IF NOT EXISTS brand_order (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand TEXT NOT NULL UNIQUE,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )""")
    conn.commit()
    _ensure_cost_schema(c, conn, 'migrate_schema')
    _ensure_ai_schema(c, conn, 'migrate_schema')
    conn.close()


# ── 进货价 Helpers ──────────────────────────────────────────


def upsert_cost(session, product_id: int, cost_price: float,
                effective_from: str, note: str = ""):
    """写入/覆盖某商品某生效日的进货价，并同步 products 冗余字段。

    同一天重复写入 → 覆盖 cost_price 与 note（不新增记录）。
    """
    row = session.query(ProductCost).filter(
        ProductCost.product_id == product_id,
        ProductCost.effective_from == effective_from,
    ).first()
    if row:
        row.cost_price = cost_price
        if note:
            row.note = note
    else:
        session.add(ProductCost(
            product_id=product_id,
            cost_price=cost_price,
            effective_from=effective_from,
            note=note,
        ))
    session.flush()
    recalc_current_cost(session, product_id)


def recalc_current_cost(session, product_id: int):
    """按历史表最新一条重算 products.current_cost。

    无历史记录 → 两个冗余字段置 NULL。
    """
    latest = session.query(ProductCost).filter(
        ProductCost.product_id == product_id
    ).order_by(ProductCost.effective_from.desc(), ProductCost.id.desc()).first()
    prod = session.query(Product).filter(Product.id == product_id).first()
    if not prod:
        return None
    if latest:
        prod.current_cost = latest.cost_price
        prod.cost_effective_from = latest.effective_from
    else:
        prod.current_cost = None
        prod.cost_effective_from = None
    return prod.current_cost


def get_cost_at_date(session, product_id: int, target_date: str):
    """取某商品在 target_date 当日生效的进货价（<= 该日期的最近一条）。"""
    row = session.query(ProductCost).filter(
        ProductCost.product_id == product_id,
        ProductCost.effective_from <= target_date,
    ).order_by(ProductCost.effective_from.desc()).first()
    return row.cost_price if row else None
