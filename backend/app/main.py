import os
import io
import re
import tempfile
import uuid
import shutil
import glob
from pathlib import Path
from datetime import datetime, timezone, timedelta

BJT = timezone(timedelta(hours=8))
def now_bj() -> datetime:
    return datetime.now(BJT)

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .storage import load_all, save_all
from .parser import parse_upload, confirm_upload as json_confirm_upload, normalize_date
from .database import (
    db_session, Product, PriceHistory, ProductAlias, ProductCost, BrandOrder,
    upsert_price, get_product_id, get_product_name,
    upsert_cost, recalc_current_cost, get_cost_at_date,
)
from .migration import migrate_if_needed
from sqlalchemy import text as sa_text, func

app = FastAPI(title="Price Tracker")

# AI 分析模块（数据导出 + AI 结果导入 + 时间线管理）
from .ai_analysis import router as ai_router  # noqa: E402
app.include_router(ai_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_preview_sessions: dict[str, dict] = {}

DATA_DIR = os.environ.get("DATA_DIR", "/data")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")


# ── Startup hook ─────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Run data migration at first start."""
    migrated = migrate_if_needed()
    if migrated:
        print("[startup] Migration complete, system ready")
    else:
        print("[startup] System ready")


# ── SQLite helpers ───────────────────────────────────────────

def _db_to_brand_groups():
    """Read from SQLite and return the same brand→items structure for backward compat.
    Respects brand_order.sort_order and products.sort_order for ordering.
    """
    from collections import defaultdict
    brands_map = defaultdict(list)
    brand_order_map = {}
    with db_session() as session:
        # Load brand sort orders
        for bo in session.query(BrandOrder).all():
            brand_order_map[bo.brand] = bo.sort_order
        # Load products sorted by sort_order within brand
        products = session.query(Product).order_by(Product.sort_order, Product.id).all()
        for prod in products:
            records = session.query(PriceHistory).filter(
                PriceHistory.product_id == prod.id
            ).order_by(PriceHistory.price_date).all()
            prices = [{"date": r.price_date, "price": r.price} for r in records]
            brands_map[prod.brand or "未知"].append({
                "name": prod.name,
                "product_id": prod.id,
                # 公司价（烟草公司进货价）—— 卡片名称右侧展示 + 倒挂/盈利计算
                "cost": prod.current_cost,
                "cost_effective_from": prod.cost_effective_from,
                "prices": prices,
            })
    # Sort brands: by brand_order.sort_order if set, else alphabetical
    def brand_sort_key(name):
        order = brand_order_map.get(name)
        return (0, order) if order is not None else (1, name)
    brands = []
    for brand_name in sorted(brands_map.keys(), key=brand_sort_key):
        brands.append({"brand": brand_name, "items": brands_map[brand_name]})
    return brands


# ── Upload API (two-phase, writes to both SQLite + JSON) ─────

@app.post("/api/upload")
async def upload_legacy(file: UploadFile = File(...)):
    if not file.filename.endswith((".xlsx", ".xls")):
        return JSONResponse(status_code=400, content={"error": "Only .xlsx / .xls files accepted"})
    suffix = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        preview = parse_upload(tmp_path)
        result = json_confirm_upload(tmp_path, preview["date_str"], {})
        # Also write to SQLite
        _sync_json_to_sqlite(result)
        return {"status": "ok", "brands_count": len(result.get("brands", []))}
    finally:
        os.unlink(tmp_path)


@app.post("/api/upload/preview")
async def upload_preview(file: UploadFile = File(...)):
    if not file.filename.endswith((".xlsx", ".xls")):
        return JSONResponse(status_code=400, content={"error": "Only .xlsx / .xls files accepted"})
    suffix = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        result = parse_upload(tmp_path)
        session_id = uuid.uuid4().hex[:12]
        _preview_sessions[session_id] = {"filepath": tmp_path, "parsed_data": result["parsed_data"], "date_str": result["date_str"]}
        return {
            "session_id": session_id,
            "date_str": result["date_str"],
            "brands": result["parsed_data"].get("brands", []),
            "alerts": result["alerts"],
            "total_items": result["total_items"],
            "alert_count": len(result["alerts"]),
        }
    except Exception as e:
        os.unlink(tmp_path)
        raise


@app.post("/api/upload/confirm")
async def upload_confirm(session_id: str = Form(...), corrections: str = Form("{}")):
    import json
    session = _preview_sessions.get(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session expired or not found"})
    corrections_dict = json.loads(corrections) if corrections else {}
    result = json_confirm_upload(filepath=session["filepath"], date_str=session["date_str"], corrections=corrections_dict)
    _sync_json_to_sqlite(result)
    os.unlink(session["filepath"])
    del _preview_sessions[session_id]
    return {"status": "ok", "brands_count": len(result.get("brands", []))}


def _sync_json_to_sqlite(data: dict):
    """Sync JSON result into SQLite tables."""
    with db_session() as session:
        for brand_entry in data.get("brands", []):
            brand_name = brand_entry.get("brand", "")
            for item in brand_entry.get("items", []):
                item_name = item.get("name", "")
                pid = get_product_id(session, item_name)
                if pid is None:
                    prod = Product(name=item_name, brand=brand_name)
                    session.add(prod)
                    session.flush()
                    pid = prod.id
                for pp in item.get("prices", []):
                    upsert_price(session, pid, pp.get("price"), pp.get("date", ""), "excel_upload")


# ── Dashboard API (reads from SQLite) ────────────────────────

@app.get("/api/dashboard")
def get_dashboard():
    return {"brands": _db_to_brand_groups()}


# ── Backup / Restore API (SQLite .db files) ──────────────────

@app.get("/api/backups")
def list_backups():
    if not os.path.exists(BACKUP_DIR):
        return {"backups": []}
    files = sorted(glob.glob(os.path.join(BACKUP_DIR, "*.db")), reverse=True)
    backups = []
    for f in files:
        name = os.path.basename(f)
        backups.append({
            "name": name,
            "size": os.path.getsize(f),
            "time": datetime.fromtimestamp(os.path.getmtime(f), tz=BJT).strftime("%Y-%m-%d %H:%M:%S"),
        })
    return {"backups": backups}


@app.get("/api/backup/download/{backup_name:path}")
def download_backup(backup_name: str):
    backup_path = os.path.join(BACKUP_DIR, backup_name)
    if not os.path.exists(backup_path):
        return JSONResponse(status_code=404, content={"error": "Backup not found"})
    return FileResponse(backup_path, filename=backup_name, media_type="application/octet-stream")


@app.post("/api/backup")
def create_backup():
    from .database import DB_PATH, engine
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = now_bj().strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(BACKUP_DIR, f"backup_{ts}.db")
    if os.path.exists(DB_PATH):
        # Force WAL checkpoint so all data is in the main file
        with engine.connect() as conn:
            conn.execute(sa_text("PRAGMA wal_checkpoint(TRUNCATE)"))
        shutil.copy2(DB_PATH, dst)
        return {"status": "ok", "name": f"backup_{ts}.db"}
    return JSONResponse(status_code=404, content={"error": "No database to backup"})


@app.post("/api/restore/{backup_name:path}")
def restore_backup(backup_name: str):
    from .database import DB_PATH
    backup_path = os.path.join(BACKUP_DIR, backup_name)
    if not os.path.exists(backup_path):
        return JSONResponse(status_code=404, content={"error": "Backup not found"})
    # Close all connections by disposing engine
    from .database import engine
    engine.dispose()
    shutil.copy2(backup_path, DB_PATH)
    # Re-init
    from .database import init_db
    init_db()
    brands = _db_to_brand_groups()
    return {"status": "ok", "brands_count": len(brands)}


@app.post("/api/seed")
def trigger_seed():
    """Force re-seed products from template (idempotent)."""
    from .migration import seed_on_startup
    ok = seed_on_startup()
    from .database import db_session, Product
    with db_session() as s:
        count = s.query(Product).count()
        return {"status": "ok" if ok else "skipped", "products": count}


@app.post("/api/aliases/generate")
def generate_aliases():
    """Generate auto-aliases for products that don't have any yet."""
    from .seed_products import generate_aliases as gen
    from .database import db_session, ProductAlias
    with db_session() as s:
        count = gen(s)
    total = 0
    with db_session() as s:
        total = s.query(ProductAlias).count()
    return {"status": "ok", "generated": count, "total_aliases": total}


@app.post("/api/aliases/import")
def import_aliases():
    """Import aliases from user-provided JSON via file upload."""
    import tempfile, json
    file = UploadFile(...)  # placeholder — we'll read from disk instead
    return JSONResponse(status_code=400, content={"error": "Use POST /api/aliases/import/data with JSON body"})


@app.post("/api/aliases/import/data")
async def import_aliases_json(data: dict = {}):
    """Import aliases from JSON: [{\"standard\":\"云端之上\",\"alias\":\"云段之上门票\"}]"""
    from .seed_products import import_aliases as do_import
    items = data.get("aliases", [])
    if not items:
        return JSONResponse(status_code=400, content={"error": "No aliases in request"})
    with db_session() as s:
        count = do_import(s, items)
    total = 0
    with db_session() as s:
        from .database import ProductAlias
        total = s.query(ProductAlias).count()
    return {"status": "ok", "imported": count, "total_aliases": total}


@app.post("/api/aliases/import-from-template")
def import_aliases_from_template():
    """Import aliases from the template Excel file's column B."""
    import openpyxl
    from .seed_products import import_aliases as do_import

    KNOWN_BRANDS = {'云南','浙江','上海','湖北','湖南','河南','河北','广西',
        '江苏','内蒙','山东','江西','贵州','四川','福建','吉林',
        '广东','安徽','陕西','重庆','甘肃','哈尔滨','公司进口'}

    filepath = "/app/price_template.xlsx"
    if not os.path.exists(filepath):
        return JSONResponse(status_code=404, content={"error": "Template not found at /app/price_template.xlsx"})

    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active
    alias_list = []

    for row in ws.iter_rows(min_row=2, max_col=2, values_only=True):
        a, b = row[0], row[1]
        if a is None: continue
        text = str(a).strip()
        if not text or text in KNOWN_BRANDS: continue
        if b is not None and not isinstance(b, (int, float)):
            alias_text = str(b).strip()
            if alias_text and alias_text != text:
                alias_list.append({"standard": text, "alias": alias_text})

    with db_session() as s:
        count = do_import(s, alias_list)

    total = 0
    with db_session() as s:
        from .database import ProductAlias
        total = s.query(ProductAlias).count()
    return {"status": "ok", "found": len(alias_list), "imported": count, "total_aliases": total}


@app.post("/api/recover")
def recover_from_json():
    """Recover data from prices.json.bak into SQLite."""
    from .database import DB_PATH, init_db, engine
    import json
    bak_path = os.path.join(DATA_DIR, "prices.json.bak")
    if not os.path.exists(bak_path):
        return JSONResponse(status_code=404, content={"error": "No backup JSON found"})

    # Clear existing data
    engine.dispose()
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    init_db()

    with open(bak_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    with db_session() as session:
        for brand_entry in data.get("brands", []):
            brand_name = brand_entry.get("brand", "")
            for item in brand_entry.get("items", []):
                item_name = item.get("name", "")
                pid = get_product_id(session, item_name)
                if pid is None:
                    prod = Product(name=item_name, brand=brand_name)
                    session.add(prod)
                    session.flush()
                    pid = prod.id
                for pp in item.get("prices", []):
                    upsert_price(session, pid, pp.get("price"), pp.get("date", ""), "recovery")

    from .migration import seed_on_startup
    seed_on_startup()
    return {"status": "ok", "message": "Data recovered from JSON backup"}


# ── Item detail API ──────────────────────────────────────────

@app.get("/api/item/{item_name:path}")
def get_item(item_name: str):
    results = []
    with db_session() as session:
        prod = session.query(Product).filter(Product.name == item_name).first()
        if prod:
            records = session.query(PriceHistory).filter(
                PriceHistory.product_id == prod.id
            ).order_by(PriceHistory.price_date).all()
            prices = [{"date": r.price_date, "price": r.price} for r in records]
            results.append({"product_id": prod.id, "name": prod.name, "brand": prod.brand or "", "prices": prices})
    return {"items": results}


@app.post("/api/item/update-price")
async def update_price(data: dict = {}):
    """修改某商品某日期的价格。"""
    from .database import db_session, Product, PriceHistory, upsert_price
    from .storage import upsert_item_price
    product_id = data.get("product_id")
    price_date = data.get("date", "")
    new_price = data.get("price")
    if not product_id or not price_date:
        return JSONResponse(status_code=400, content={"error": "Missing product_id or date"})
    item_name = None
    with db_session() as s:
        prod = s.query(Product).filter(Product.id == product_id).first()
        item_name = prod.name if prod else None
        upsert_price(s, product_id, new_price, price_date, "manual_correction")
    # 同步到 prices.json，否则下次上传同步时会用 JSON 里的旧价覆盖本次手动修正
    if item_name:
        try:
            upsert_item_price(item_name, price_date, new_price)
        except Exception as e:
            print(f"[update_price] 同步 prices.json 失败: {e}")
    return {"status": "ok", "updated": {"product_id": product_id, "date": price_date, "price": new_price}}


# ── Template download ────────────────────────────────────────

@app.get("/api/template")
def download_template():
    import openpyxl
    from openpyxl.styles import PatternFill, Font

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Template"
    date_str = now_bj().strftime("%Y%m%d")
    ws.cell(row=1, column=1, value=date_str)

    brands = _db_to_brand_groups()
    row_num = 2
    brand_fill = PatternFill(start_color="E6F0FF", end_color="E6F0FF", fill_type="solid")
    brand_font = Font(bold=True, color="1677FF")

    for brand_group in brands:
        ws.cell(row=row_num, column=1, value=brand_group.get("brand", ""))
        ws.cell(row=row_num, column=1).fill = brand_fill
        ws.cell(row=row_num, column=1).font = brand_font
        row_num += 1
        for item in brand_group.get("items", []):
            prices = item.get("prices", [])
            sorted_prices = sorted(
                [p for p in prices if p.get("price") is not None],
                key=lambda x: x.get("date", ""),
            )
            latest_price = sorted_prices[-1]["price"] if sorted_prices else None
            ws.cell(row=row_num, column=1, value=item.get("name", ""))
            if latest_price is not None:
                ws.cell(row=row_num, column=2, value=latest_price)
            row_num += 1

    ws.column_dimensions['A'].width = 25
    ws.column_dimensions['B'].width = 12
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=price_template_{date_str}.xlsx"},
    )


# ── 粘贴文本上传 + DeepSeek AI 比对 API ─────────────────

@app.post("/api/paste/preview")
async def paste_preview(data: dict = {}):
    """解析粘贴文本，返回匹配引擎结果。"""
    from .text_parser import parse_text
    from .matcher import load_match_data, match_item
    from .database import db_session
    text = data.get("text", "")
    if not text:
        return JSONResponse(status_code=400, content={"error": "No text provided"})
    items = parse_text(text)
    results = []
    with db_session() as s:
        md = load_match_data(s)
        for item in items:
            r = match_item(None, item["name"], md)
            last_price = None
            if r["product_id"]:
                from .database import PriceHistory
                last_record = s.query(PriceHistory).filter(
                    PriceHistory.product_id == r["product_id"]
                ).order_by(PriceHistory.price_date.desc()).first()
                if last_record:
                    last_price = last_record.price
            results.append({
                "input": item["name"],
                "matched_name": r["product_name"],
                "matched_id": r["product_id"],
                "brand": item.get("brand", ""),
                "price": item.get("price"),
                "last_price": last_price,
                "score": r["score"],
                "source": r["source"],
                "status": r["status"],
            })
    return {"items": results, "total": len(results)}


@app.post("/api/paste/deepseek-compare")
async def paste_deepseek_compare(data: dict = {}):
    """DeepSeek AI 比对 — 用首选别名做参考。"""
    import requests, json, re
    raw = data.get("items", [])
    # Handle both array of strings and array of objects
    if isinstance(raw, list) and len(raw) > 0:
        if isinstance(raw[0], dict):
            names = [i.get("input", "") for i in raw if i.get("input")]
        else:
            names = [str(i) for i in raw]
    else:
        return JSONResponse(status_code=400, content={"error": "No items"})

    from .database import db_session, Product, ProductAlias
    with db_session() as s:
        alias_map = {}  # preferred alias -> product name
        for prod in s.query(Product).order_by(Product.id).all():
            pa = s.query(ProductAlias).filter(
                ProductAlias.product_id == prod.id
            ).order_by(ProductAlias.sort_order).first()
            if pa:
                alias_map[pa.alias] = prod.name

    # Build reference: just preferred alias -> product name (no IDs, AI doesn't know them)
    ref_lines = [f"{a} -> {n}" for a, n in alias_map.items()]
    ref_str = "\n".join(ref_lines)  # 全部发，不截断

    prompt = f"你是OCR商品名匹配专家。匹配以下名称到标准商品名。\n规则：1)优先精确匹配alias 2)谐音形近自动纠错 3)score≥90高,70-89中,<70低\n\n首选别名对照表（alias -> 标准名）：\n{ref_str}\n\n返回JSON数组：[{{\"input\":\"原始名称\",\"matched_name\":\"标准名称\",\"score\":0-100}}]\n\n待匹配：\n" + "\n".join(names)

    # Also get last prices for deviation check (attached to response)
    last_prices = {}
    with db_session() as s:
        for n in names:
            prod = s.query(Product).filter(Product.name == n).first()
            if not prod:
                # Try matching via alias
                pa = s.query(ProductAlias).filter(ProductAlias.alias == n).first()
                if pa:
                    prod = s.query(Product).filter(Product.id == pa.product_id).first()
            if prod:
                from .database import PriceHistory
                rec = s.query(PriceHistory).filter(
                    PriceHistory.product_id == prod.id
                ).order_by(PriceHistory.price_date.desc()).first()
                if rec:
                    last_prices[n] = rec.price

    try:
        resp = requests.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer REDACTED"},
            json={"model": "deepseek-chat",
                  "messages": [{"role": "user", "content": prompt}],
                  "max_tokens": 16384, "temperature": 0.05},
            timeout=60
        )
        content = resp.json()["choices"][0]["message"]["content"]
        match = re.search(r'\[.*\]', content, re.DOTALL)
        ds_results = json.loads(match.group()) if match else []
        # 验证 matched_name 是否真的在库中 + 附加品牌
        if ds_results:
            with db_session() as s:
                for r in ds_results:
                    mn = r.get("matched_name", "")
                    if mn:
                        prod = s.query(Product).filter(Product.name == mn).first()
                        if prod:
                            r["matched_id"] = prod.id
                            r["brand"] = prod.brand or ""  # 附上品牌
                        else:
                            r["matched_id"] = None
                            r["score"] = 0
                            r.pop("matched_name", None)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

    return {"items": ds_results, "last_prices": last_prices}


@app.post("/api/paste/confirm")
async def paste_confirm(data: dict = {}):
    """确认保存粘贴结果（含日期）— 新品自动创建。"""
    from .database import db_session, upsert_price, Product, ProductAlias
    items = data.get("items", [])
    price_date = data.get("price_date", "")
    brand = data.get("brand", "")
    if not price_date:
        price_date = now_bj().strftime("%Y-%m-%d")
    if not items:
        return JSONResponse(status_code=400, content={"error": "No items"})
    saved = 0
    with db_session() as s:
        for item in items:
            pid = item.get("matched_id")
            price = item.get("price")
            name = item.get("matched_name", "").strip()
            brand = item.get("brand", "")

            # 新品：有名称无 ID → 自动创建
            if not pid and name:
                existing = s.query(Product).filter(Product.name == name).first()
                if not existing:
                    prod = Product(name=name, brand=brand)
                    s.add(prod)
                    s.flush()
                    pid = prod.id
                    # 自动创建别名
                    s.add(ProductAlias(product_id=pid, alias=name, sort_order=0, source="manual"))
                else:
                    pid = existing.id

            if pid and price is not None:
                upsert_price(s, pid, price, price_date, "text_paste")
                saved += 1
    return {"status": "ok", "saved": saved, "date": price_date}


# ── 别名管理 API ─────────────────────────────────────────

def _detect_inversion(cost, current_price):
    """倒挂检测：进货价 > 售价即倒挂。

    倒挂幅度 = 进货价 - 售价；倒挂比例 = 幅度 / 进货价。
    level: critical(>5%) / warning(>0) / ok(<=0)
    """
    if cost is None:
        return {"status": "no_cost", "level": "unknown"}
    if current_price is None:
        return {"status": "no_price", "level": "unknown", "cost_price": cost}
    amount = round(cost - current_price, 2)
    pct = round(amount / cost * 100, 2) if cost else 0.0
    if pct > 5:
        level = "critical"
    elif pct > 0:
        level = "warning"
    else:
        level = "ok"
    return {
        "status": "ok",
        "cost_price": cost,
        "current_price": current_price,
        "inverted_amount": amount,
        "inverted_pct": pct,
        "level": level,
    }


@app.get("/api/aliases/manage")
def list_aliases_manage():
    """列出所有标准商品及其别名、进货价（按 brand_order / sort_order）。"""
    from .database import db_session, Product, ProductAlias
    result = []
    with db_session() as s:
        # Sort: brands by brand_order, then products by sort_order within brand
        brand_order_map = {}
        for bo in s.query(BrandOrder).all():
            brand_order_map[bo.brand] = bo.sort_order
        products = s.query(Product).order_by(Product.sort_order, Product.id).all()
        for prod in products:
            aliases = s.query(ProductAlias).filter(
                ProductAlias.product_id == prod.id
            ).order_by(ProductAlias.sort_order, ProductAlias.id).all()
            alias_list = [{"id": a.id, "alias": a.alias, "source": a.source,
                          "sort_order": a.sort_order} for a in aliases]
            # 最新有效报价 —— 供当前倒挂计算
            latest = s.query(PriceHistory).filter(
                PriceHistory.product_id == prod.id,
                PriceHistory.price.isnot(None),
            ).order_by(PriceHistory.price_date.desc()).first()
            current_price = latest.price if latest else None
            result.append({
                "product_id": prod.id,
                "name": prod.name,
                "brand": prod.brand or "",
                "sort_order": prod.sort_order or 0,
                "aliases": alias_list,
                "current_cost": prod.current_cost,
                "cost_effective_from": prod.cost_effective_from,
                "current_price": current_price,
                "current_price_date": latest.price_date if latest else None,
                "inversion": _detect_inversion(prod.current_cost, current_price),
            })
    # Sort result by brand_order
    def _brand_key(item):
        bo = brand_order_map.get(item.get("brand", ""))
        return (0, bo) if bo is not None else (1, item.get("brand", ""))
    result.sort(key=_brand_key)
    return {"products": result}


@app.post("/api/aliases/reorder")
async def reorder_aliases(data: dict = {}):
    """保存别名排序。"""
    from .database import db_session, ProductAlias
    product_id = data.get("product_id")
    alias_ids = data.get("alias_ids", [])
    if not product_id or not alias_ids:
        return JSONResponse(status_code=400, content={"error": "Missing product_id or alias_ids"})
    with db_session() as s:
        for i, aid in enumerate(alias_ids):
            a = s.query(ProductAlias).filter(
                ProductAlias.id == aid,
                ProductAlias.product_id == product_id,
            ).first()
            if a:
                a.sort_order = i
    return {"status": "ok", "sorted": len(alias_ids)}


@app.post("/api/aliases/add")
async def add_alias(data: dict = {}):
    """手动添加别名。"""
    from .database import db_session, Product, ProductAlias
    product_id = data.get("product_id")
    alias_text = data.get("alias", "").strip()
    if not product_id or not alias_text:
        return JSONResponse(status_code=400, content={"error": "Missing fields"})
    with db_session() as s:
        existing = s.query(ProductAlias).filter(ProductAlias.alias == alias_text).first()
        if existing:
            return JSONResponse(status_code=400, content={"error": "Alias already exists"})
        max_order = s.query(func.max(ProductAlias.sort_order)).filter(
            ProductAlias.product_id == product_id
        ).scalar() or 0
        a = ProductAlias(product_id=product_id, alias=alias_text,
                        sort_order=max_order + 1, source="manual")
        s.add(a)
        s.flush()
        alias_id = a.id
    return {"status": "ok", "alias_id": alias_id}


@app.post("/api/aliases/delete")
async def delete_alias(data: dict = {}):
    """删除别名。"""
    from .database import db_session, ProductAlias
    alias_id = data.get("alias_id")
    if not alias_id:
        return JSONResponse(status_code=400, content={"error": "Missing alias_id"})
    with db_session() as s:
        a = s.query(ProductAlias).filter(ProductAlias.id == alias_id).first()
        if a:
            s.delete(a)
    return {"status": "ok", "deleted": alias_id}


@app.get("/api/products/search/{query:path}")
def search_products(query: str):
    """Search products by name (for autocomplete)."""
    from .database import db_session, Product
    if len(query) < 1:
        return {"results": []}
    results = []
    with db_session() as s:
        products = s.query(Product).filter(Product.name.contains(query)).limit(20).all()
        for p in products:
            results.append({"id": p.id, "name": p.name, "brand": p.brand or ""})
    return {"results": results}


@app.post("/api/aliases/learn")
async def learn_alias(data: dict = {}):
    """用户确认匹配后自动学习别名。"""
    from .database import db_session, Product, ProductAlias
    input_name = data.get("input", "").strip()
    product_id = data.get("product_id")
    if not input_name or not product_id:
        return JSONResponse(status_code=400, content={"error": "Missing input or product_id"})
    with db_session() as s:
        existing = s.query(ProductAlias).filter(ProductAlias.alias == input_name).first()
        if not existing:
            max_order = s.query(func.max(ProductAlias.sort_order)).filter(
                ProductAlias.product_id == product_id
            ).scalar() or 0
            a = ProductAlias(product_id=product_id, alias=input_name,
                            sort_order=max_order + 1, source="user_correction")
            s.add(a)
    return {"status": "ok", "learned": input_name}


@app.post("/api/aliases/edit-product")
async def edit_product_name(data: dict = {}):
    """修改标准商品名称。"""
    from .database import db_session, Product, ProductAlias
    from .storage import rename_item
    product_id = data.get("product_id")
    new_name = data.get("name", "").strip()
    if not product_id or not new_name:
        return JSONResponse(status_code=400, content={"error": "Missing product_id or name"})
    with db_session() as s:
        prod = s.query(Product).filter(Product.id == product_id).first()
        if not prod:
            return JSONResponse(status_code=404, content={"error": "Product not found"})
        existing = s.query(Product).filter(Product.name == new_name, Product.id != product_id).first()
        if existing:
            return JSONResponse(status_code=400, content={"error": "Name already exists"})
        old_name = prod.name
        prod.name = new_name
    # 同步改名到 prices.json，否则下次上传会以旧名 carry-over 重建，造成新旧并存
    try:
        rename_item(old_name, new_name)
    except Exception as e:
        print(f"[edit_product_name] 同步 prices.json 失败: {e}")
    return {"status": "ok", "name": new_name}


@app.post("/api/aliases/edit-alias")
async def edit_alias(data: dict = {}):
    """编辑别名文本。"""
    from .database import db_session, ProductAlias
    alias_id = data.get("alias_id")
    new_alias = data.get("alias", "").strip()
    if not alias_id or not new_alias:
        return JSONResponse(status_code=400, content={"error": "Missing alias_id or alias"})
    with db_session() as s:
        a = s.query(ProductAlias).filter(ProductAlias.id == alias_id).first()
        if not a:
            return JSONResponse(status_code=404, content={"error": "Alias not found"})
        existing = s.query(ProductAlias).filter(ProductAlias.alias == new_alias, ProductAlias.id != alias_id).first()
        if existing:
            return JSONResponse(status_code=400, content={"error": "Alias already exists"})
        a.alias = new_alias
    return {"status": "ok", "alias": new_alias}


@app.post("/api/aliases/update-brand")
async def edit_product_brand(data: dict = {}):
    """修改商品品牌。"""
    from .database import db_session, Product
    from .storage import move_item_brand
    product_id = data.get("product_id")
    new_brand = data.get("brand", "").strip()
    if not product_id or not new_brand:
        return JSONResponse(status_code=400, content={"error": "Missing fields"})
    item_name = None
    with db_session() as s:
        prod = s.query(Product).filter(Product.id == product_id).first()
        if prod:
            item_name = prod.name
            prod.brand = new_brand
    # 同步把商品在 prices.json 中移动到新品牌分组，保持两侧一致
    if item_name:
        try:
            move_item_brand(item_name, new_brand)
        except Exception as e:
            print(f"[edit_product_brand] 同步 prices.json 失败: {e}")
    return {"status": "ok"}




@app.delete("/api/products/{product_id}")
async def delete_product(product_id: int):
    """删除商品及其别名和价格记录。

    注意：系统是 SQLite + prices.json 双存储，上传时 parser 会以 prices.json
    为历史基线做 carry-over 再同步回 SQLite。若只删 SQLite，被删商品会在下次
    上传时被 prices.json 重新“带回”（复活）。因此这里必须同步从 prices.json 移除。
    """
    from .database import db_session, Product, ProductAlias, PriceHistory
    from .storage import remove_item
    with db_session() as s:
        prod = s.query(Product).filter(Product.id == product_id).first()
        if not prod:
            return JSONResponse(status_code=404, content={"error": "Product not found"})
        deleted_name = prod.name
        s.query(PriceHistory).filter(PriceHistory.product_id == product_id).delete()
        s.query(ProductAlias).filter(ProductAlias.product_id == product_id).delete()
        s.query(ProductCost).filter(ProductCost.product_id == product_id).delete()
        s.delete(prod)

    # 同步删除旧版 JSON 存储中的同名商品，防止下次上传时被 carry-over 复活
    try:
        remove_item(deleted_name)
    except Exception as e:
        print(f"[delete_product] 同步 prices.json 失败: {e}")

    return {"status": "ok"}



@app.post("/api/aliases/reorder-brands")
async def reorder_brands(data: dict = {}):
    """保存地区(品牌)排序。brands: ["湖南", "云南", ...]"""
    brand_names = data.get("brands", [])
    if not brand_names:
        return JSONResponse(status_code=400, content={"error": "Missing brands list"})
    with db_session() as s:
        for i, name in enumerate(brand_names):
            bo = s.query(BrandOrder).filter(BrandOrder.brand == name).first()
            if bo:
                bo.sort_order = i
            else:
                s.add(BrandOrder(brand=name, sort_order=i))
        # Remove brands not in the list
        all_existing = s.query(BrandOrder).all()
        for bo in all_existing:
            if bo.brand not in brand_names:
                s.delete(bo)
    return {"status": "ok", "sorted": len(brand_names)}


@app.post("/api/aliases/reorder-products")
async def reorder_products(data: dict = {}):
    """保存某地区内商品排序。brand: "湖南", product_ids: [5, 12, 3, ...]"""
    brand = data.get("brand", "")
    product_ids = data.get("product_ids", [])
    if not brand or not product_ids:
        return JSONResponse(status_code=400, content={"error": "Missing brand or product_ids"})
    with db_session() as s:
        for i, pid in enumerate(product_ids):
            prod = s.query(Product).filter(Product.id == pid, Product.brand == brand).first()
            if prod:
                prod.sort_order = i
    return {"status": "ok", "sorted": len(product_ids)}


@app.get("/api/aliases/brand-order")
def get_brand_order():
    """获取地区排序。"""
    with db_session() as s:
        orders = s.query(BrandOrder).order_by(BrandOrder.sort_order).all()
        return {"brands": [o.brand for o in orders]}


# ═══════════════════════════════════════════════════════════
# 进货价管理 API
# ═══════════════════════════════════════════════════════════

def _today_str() -> str:
    return now_bj().strftime("%Y-%m-%d")


def _parse_cost_date(raw):
    """进货价生效日期归一化。

    返回 (date_str, error)。空值 → 今天（日常改价不填日期）。
    兼容 Excel 日期单元格 / 2025-12-01 / 20251201 / 251201 / 1201。
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return _today_str(), None
    if hasattr(raw, "strftime"):  # openpyxl 读出的 datetime
        return raw.strftime("%Y-%m-%d"), None
    s = str(raw).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s, None
    d = normalize_date(s)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d or ""):
        return None, f"无法识别日期 {s!r}"
    return d, None


def _coerce_price(raw):
    """→ (price, error)。"""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, "缺少进货价"
    try:
        price = float(raw)
    except (TypeError, ValueError):
        return None, "进货价必须是数字"
    if price < 0:
        return None, "进货价不能为负数"
    return price, None


def _fmt_dt(v) -> str:
    if v is None:
        return ""
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    return str(v)


def _cost_row_json(r) -> dict:
    return {
        "id": r.id,
        "product_id": r.product_id,
        "cost_price": r.cost_price,
        "effective_from": r.effective_from,
        "note": r.note or "",
        "created_at": _fmt_dt(r.created_at),
    }


@app.patch("/api/products/{product_id}/cost")
async def update_product_cost(product_id: int, data: dict = {}):
    """更新当前进货价。

    用户只填价格，系统自动以今天为生效日期写入历史表（同日覆盖），
    并同步 products 的冗余字段。
    """
    price, err = _coerce_price(data.get("cost_price"))
    if err:
        return JSONResponse(status_code=400, content={"error": err})
    effective, derr = _parse_cost_date(data.get("effective_from"))
    if derr:
        return JSONResponse(status_code=400, content={"error": derr})
    note = (data.get("note") or "手动更新").strip()
    with db_session() as s:
        prod = s.query(Product).filter(Product.id == product_id).first()
        if not prod:
            return JSONResponse(status_code=404, content={"error": "商品不存在"})
        upsert_cost(s, product_id, price, effective, note)
        return {
            "status": "ok",
            "product_id": product_id,
            "current_cost": prod.current_cost,
            "cost_effective_from": prod.cost_effective_from,
        }


@app.get("/api/products/{product_id}/cost/history")
def get_cost_history(product_id: int):
    """某商品的进货价历史（effective_from DESC）。"""
    with db_session() as s:
        rows = s.query(ProductCost).filter(
            ProductCost.product_id == product_id
        ).order_by(ProductCost.effective_from.desc(), ProductCost.id.desc()).all()
        return {"product_id": product_id, "history": [_cost_row_json(r) for r in rows]}


@app.post("/api/products/{product_id}/cost/history")
async def add_cost_history(product_id: int, data: dict = {}):
    """手动补录历史进货价。

    该日期已有记录时：默认返回 409（不静默覆盖），前端确认后传 overwrite=true 再写。
    """
    price, err = _coerce_price(data.get("cost_price"))
    if err:
        return JSONResponse(status_code=400, content={"error": err})
    effective, derr = _parse_cost_date(data.get("effective_from"))
    if derr:
        return JSONResponse(status_code=400, content={"error": derr})
    if effective == _today_str() and not data.get("effective_from"):
        return JSONResponse(status_code=400, content={"error": "补录需要填写生效日期"})
    note = (data.get("note") or "补录").strip()
    # 默认不覆盖：避免调用方未显式确认就冲掉已有历史
    overwrite = bool(data.get("overwrite", False))
    with db_session() as s:
        prod = s.query(Product).filter(Product.id == product_id).first()
        if not prod:
            return JSONResponse(status_code=404, content={"error": "商品不存在"})
        existing = s.query(ProductCost).filter(
            ProductCost.product_id == product_id,
            ProductCost.effective_from == effective,
        ).first()
        if existing and not overwrite:
            return JSONResponse(status_code=409, content={
                "error": f"{effective} 已有进货价 {existing.cost_price}，是否覆盖？",
                "existing": _cost_row_json(existing),
            })
        upsert_cost(s, product_id, price, effective, note)
        return {
            "status": "ok",
            "product_id": product_id,
            "current_cost": prod.current_cost,
            "cost_effective_from": prod.cost_effective_from,
        }


@app.patch("/api/products/cost/history/{cost_id}")
async def update_cost_history(cost_id: int, data: dict = {}):
    """修改一条进货价历史（价格 / 生效日期 / 备注）。

    改日期撞到同商品另一条记录时：默认 409，传 overwrite=true 则合并（删掉冲突那条）。
    """
    with db_session() as s:
        row = s.query(ProductCost).filter(ProductCost.id == cost_id).first()
        if not row:
            return JSONResponse(status_code=404, content={"error": "记录不存在"})
        pid = row.product_id

        if "cost_price" in data:
            price, perr = _coerce_price(data.get("cost_price"))
            if perr:
                return JSONResponse(status_code=400, content={"error": perr})
        else:
            price = row.cost_price

        if "effective_from" in data:
            raw_date = data.get("effective_from")
            if raw_date is None or (isinstance(raw_date, str) and not raw_date.strip()):
                return JSONResponse(status_code=400, content={"error": "请填写生效日期"})
            effective, derr = _parse_cost_date(raw_date)
            if derr:
                return JSONResponse(status_code=400, content={"error": derr})
        else:
            effective = row.effective_from

        if "note" in data:
            note = str(data.get("note") or "").strip()
        else:
            note = row.note or ""

        conflict = s.query(ProductCost).filter(
            ProductCost.product_id == pid,
            ProductCost.effective_from == effective,
            ProductCost.id != cost_id,
        ).first()
        if conflict:
            if not bool(data.get("overwrite", False)):
                return JSONResponse(status_code=409, content={
                    "error": f"{effective} 已有进货价 {conflict.cost_price}",
                    "conflict_id": conflict.id,
                    "conflict": _cost_row_json(conflict),
                })
            s.delete(conflict)
            s.flush()

        row.cost_price = price
        row.effective_from = effective
        row.note = note
        s.flush()
        recalc_current_cost(s, pid)
        prod = s.query(Product).filter(Product.id == pid).first()
        return {
            "status": "ok",
            "record": _cost_row_json(row),
            "product_id": pid,
            "current_cost": prod.current_cost if prod else None,
            "cost_effective_from": prod.cost_effective_from if prod else None,
        }


@app.delete("/api/products/cost/history/{cost_id}")
async def delete_cost_history(cost_id: int):
    """删除一条进货价历史，并重算当前进货价（取剩余最新；无则置空）。"""
    with db_session() as s:
        row = s.query(ProductCost).filter(ProductCost.id == cost_id).first()
        if not row:
            return JSONResponse(status_code=404, content={"error": "记录不存在"})
        pid = row.product_id
        s.delete(row)
        s.flush()
        recalc_current_cost(s, pid)
        prod = s.query(Product).filter(Product.id == pid).first()
        return {
            "status": "ok",
            "product_id": pid,
            "current_cost": prod.current_cost if prod else None,
            "cost_effective_from": prod.cost_effective_from if prod else None,
        }


@app.post("/api/products")
async def create_product(data: dict = {}):
    """新增标准商品（可顺带录入进货价）。"""
    name = (data.get("name") or "").strip()
    brand = (data.get("brand") or "").strip()
    if not name:
        return JSONResponse(status_code=400, content={"error": "缺少商品名"})
    if not brand:
        return JSONResponse(status_code=400, content={"error": "缺少品牌"})
    with db_session() as s:
        if s.query(Product).filter(Product.name == name).first():
            return JSONResponse(status_code=400, content={"error": "商品名已存在"})
        max_order = s.query(func.max(Product.sort_order)).filter(
            Product.brand == brand
        ).scalar()
        prod = Product(
            name=name, brand=brand,
            sort_order=(max_order + 1) if max_order is not None else 0,
        )
        s.add(prod)
        s.flush()
        pid = prod.id
        cost, _err = _coerce_price(data.get("cost_price"))
        if cost is not None:
            upsert_cost(s, pid, cost, _today_str(), "手动更新")
    return {"status": "ok", "product_id": pid, "name": name, "brand": brand}


@app.post("/api/products/cost/import")
async def import_cost_excel(file: UploadFile = File(...)):
    """Excel 批量导入进货价。

    列：A=标准商品名（或别名）, B=进货价, C=生效日期(可选，留空=今天)
    """
    if not file.filename.endswith((".xlsx", ".xls")):
        return JSONResponse(status_code=400, content={"error": "仅支持 .xlsx / .xls"})
    suffix = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        import openpyxl
        wb = openpyxl.load_workbook(tmp_path, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(min_row=1, max_col=3, values_only=True))

        success = 0
        failed: list[str] = []
        skipped: list[str] = []

        with db_session() as s:
            name_map = {p.name: p.id for p in s.query(Product).all()}
            alias_map = {a.alias: a.product_id for a in s.query(ProductAlias).all()}

            for idx, row in enumerate(rows):
                if not row or row[0] is None:
                    continue
                raw_name = str(row[0]).strip()
                if not raw_name:
                    continue
                raw_price = row[1] if len(row) > 1 else None
                # 跳过表头行
                if idx == 0 and (
                    raw_name in ("标准商品名", "商品名", "商品", "名称", "标准名")
                    or not isinstance(raw_price, (int, float))
                ):
                    continue
                if raw_price is None or (isinstance(raw_price, str) and not raw_price.strip()):
                    skipped.append(raw_name)
                    continue
                price, perr = _coerce_price(raw_price)
                if perr:
                    failed.append(f"{raw_name}（{perr}）")
                    continue
                pid = name_map.get(raw_name) or alias_map.get(raw_name)
                if not pid:
                    failed.append(raw_name)
                    continue
                effective, derr = _parse_cost_date(row[2] if len(row) > 2 else None)
                if derr:
                    failed.append(f"{raw_name}（{derr}）")
                    continue
                upsert_cost(s, pid, price, effective, "Excel导入")
                success += 1

        return {
            "status": "ok",
            "success_count": success,
            "failed": failed,
            "skipped": skipped,
            "total": success + len(failed),
        }
    finally:
        os.unlink(tmp_path)


@app.get("/api/products/cost/template")
def download_cost_template():
    """下载进货价导入模板（预填全部标准商品名 + 当前进货价）。"""
    import openpyxl
    from openpyxl.styles import PatternFill, Font

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "进货价"
    headers = ["标准商品名", "进货价", "生效日期(可选)"]
    fill = PatternFill(start_color="E6F0FF", end_color="E6F0FF", fill_type="solid")
    for i, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=i, value=h)
        cell.font = Font(bold=True, color="1677FF")
        cell.fill = fill

    with db_session() as s:
        brand_order_map = {bo.brand: bo.sort_order for bo in s.query(BrandOrder).all()}
        products = s.query(Product).order_by(Product.sort_order, Product.id).all()
        rows = [(p.brand or "", p.name, p.current_cost) for p in products]

    def _brand_key(r):
        bo = brand_order_map.get(r[0])
        return (0, bo) if bo is not None else (1, r[0])

    row_num = 2
    for _brand, name, cost in sorted(rows, key=_brand_key):
        ws.cell(row=row_num, column=1, value=name)
        if cost is not None:
            ws.cell(row=row_num, column=2, value=cost)
        row_num += 1

    ws.column_dimensions['A'].width = 28
    ws.column_dimensions['B'].width = 12
    ws.column_dimensions['C'].width = 16
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    date_str = now_bj().strftime("%Y%m%d")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=cost_template_{date_str}.xlsx"},
    )


@app.get("/api/export/analysis")
def export_analysis():
    """AI 分析用导出 —— 格式已冻结，后续只填充值不改结构。"""
    products_out = []
    with db_session() as s:
        brand_order_map = {bo.brand: bo.sort_order for bo in s.query(BrandOrder).all()}
        products = s.query(Product).order_by(Product.sort_order, Product.id).all()
        for prod in products:
            aliases = s.query(ProductAlias).filter(
                ProductAlias.product_id == prod.id
            ).order_by(ProductAlias.sort_order, ProductAlias.id).all()
            records = s.query(PriceHistory).filter(
                PriceHistory.product_id == prod.id
            ).order_by(PriceHistory.price_date).all()
            history = [
                {"date": r.price_date, "price": r.price, "source": r.source_name or ""}
                for r in records
            ]
            valid = [r.price for r in records if r.price is not None]
            latest = next((r for r in reversed(records) if r.price is not None), None)
            inversion = _detect_inversion(
                prod.current_cost, latest.price if latest else None
            )
            products_out.append({
                "id": prod.id,
                "name": prod.name,
                "brand": prod.brand or "",
                "aliases": [a.alias for a in aliases],
                "cost_info": {
                    "current_cost": prod.current_cost,
                    "cost_effective_from": prod.cost_effective_from,
                    "cost_source": "manual" if prod.current_cost is not None else "unknown",
                    "inverted_amount": inversion.get("inverted_amount"),
                    "inverted_pct": inversion.get("inverted_pct"),
                    "level": inversion.get("level"),
                },
                "price_history": history,
                "statistics": {
                    "points": len(valid),
                    "first_date": records[0].price_date if records else None,
                    "last_date": latest.price_date if latest else None,
                    "latest_price": latest.price if latest else None,
                    "min_price": min(valid) if valid else None,
                    "max_price": max(valid) if valid else None,
                    "avg_price": round(sum(valid) / len(valid), 2) if valid else None,
                },
            })
    return {
        "exported_at": now_bj().strftime("%Y-%m-%d %H:%M:%S"),
        "product_count": len(products_out),
        "products": products_out,
    }


# ── Frontend static files ────────────────────────────────────

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
    @app.get("/")
    async def serve_root():
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
