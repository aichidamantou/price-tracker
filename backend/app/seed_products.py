"""
标准商品库导入脚本 —— Phase 2。

从模板 Excel 读取所有商品名，写入 products 表，自动生成初始别名。
支持从 JSON 导入用户提供的别名对照表。
"""

import os
import re
import json
import openpyxl
from pathlib import Path

TEMPLATE_PATH = "/app/price_template.xlsx"
DATA_DIR = os.environ.get("DATA_DIR", "/data")
BAK_PATH = os.path.join(DATA_DIR, "prices.json.bak")

KNOWN_BRANDS = {
    '云南', '浙江', '上海', '湖北', '湖南', '河南', '河北', '广西',
    '江苏', '内蒙', '山东', '江西', '贵州', '四川', '福建', '吉林',
    '广东', '安徽', '陕西', '重庆', '甘肃', '哈尔滨', '公司进口',
}


def _clean(text):
    text = re.sub(r'[～~]', '', text)
    text = re.sub(r'[（(]\s*[）)]', '', text)
    return text.strip()


def _auto_aliases(standard_name: str) -> list[str]:
    results = []
    name = standard_name.strip()
    no_bracket = re.sub(r'[（(）)\s]', '', name)
    if no_bracket != name:
        results.append(no_bracket)
    bracket_match = re.search(r'[（(]([^）)]+)[）)]', name)
    if bracket_match:
        inner = bracket_match.group(1).strip()
        results.append(inner)
        brand_part = re.split(r'[（(]', name)[0].strip()
        for token in re.split(r'[，,、\s]', inner):
            token = token.strip()
            if token:
                results.append(token)
                combined = brand_part + token
                if combined != name and combined != no_bracket:
                    results.append(combined)
    num_match = re.search(r'(\d+)毫克', name)
    if num_match:
        num = num_match.group(1)
        results.append(name.replace(f'{num}毫克', f'{num}mg'))
    if '中华' in name:
        results.append('软中')
    if '九五' in name:
        results.append('软九五')
        results.append('95')
    if '荷花' in name:
        results.append('荷花')
        results.append('软荷花')
    if '天叶' in name:
        results.append('大天叶')
        results.append('小天叶')
    if '和天下' in name:
        results.append('和天下')
    if '利群' in name:
        results.append('利群')
    for prefix in ['硬', '软', '细', '中', '金', '银', '铂金']:
        if name.startswith(prefix):
            suffix = name[len(prefix):]
            results.append(suffix)
    seen = set()
    cleaned = []
    for a in results:
        a = _clean(a)
        if a and a != standard_name and a not in seen and len(a) >= 1:
            seen.add(a)
            cleaned.append(a)
    return cleaned


def generate_aliases(session):
    """Generate aliases for all existing products that don't have any yet."""
    from .database import ProductAlias, Product
    count = 0
    products = session.query(Product).all()
    for prod in products:
        existing_aliases = session.query(ProductAlias).filter(
            ProductAlias.product_id == prod.id
        ).count()
        if existing_aliases > 0:
            continue
        for alias in _auto_aliases(prod.name):
            existing = session.query(ProductAlias).filter(
                ProductAlias.alias == alias
            ).first()
            if not existing:
                session.add(ProductAlias(
                    product_id=prod.id,
                    alias=alias,
                    source="auto_generated",
                ))
                count += 1
    return count


def import_aliases(session, alias_list: list[dict]):
    """Import user-provided aliases: [{\"standard\":\"云端之上\",\"alias\":\"云段之上门票\"}, ...]"""
    from .database import ProductAlias, Product
    count = 0
    for item in alias_list:
        standard = item.get("standard", "").strip()
        alias_text = item.get("alias", "").strip()
        if not standard or not alias_text:
            continue
        prod = session.query(Product).filter(Product.name == standard).first()
        if not prod:
            continue
        existing = session.query(ProductAlias).filter(
            ProductAlias.alias == alias_text
        ).first()
        if not existing:
            session.add(ProductAlias(
                product_id=prod.id,
                alias=alias_text,
                source="manual",
            ))
            count += 1
        elif existing.product_id != prod.id:
            # Different mapping — add as alternative
            dup = session.query(ProductAlias).filter(
                ProductAlias.alias == alias_text,
                ProductAlias.product_id == prod.id,
            ).first()
            if not dup:
                session.add(ProductAlias(
                    product_id=prod.id,
                    alias=alias_text,
                    source="manual",
                ))
                count += 1
    return count


def seed_products(session):
    """Seed from template, update aliases from col B."""
    from .database import Product, ProductAlias

    filepath = TEMPLATE_PATH
    if not os.path.exists(filepath):
        alt = Path(__file__).resolve().parent.parent.parent / "static" / "price_template.xlsx"
        filepath = str(alt)
        if not os.path.exists(filepath):
            print(f"[seed] Template not found, skipping")
            return 0

    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active

    current_brand = ""
    count = 0

    for row in ws.iter_rows(min_row=2, max_col=2, values_only=True):
        a, b = row[0], row[1]
        if a is None:
            continue
        text = str(a).strip()
        if not text:
            continue
        if text in KNOWN_BRANDS:
            current_brand = text
            continue

        item_name = text
        existing = session.query(Product).filter(Product.name == item_name).first()
        if existing:
            if not existing.brand and current_brand:
                existing.brand = current_brand
            _process_alias_col(session, existing.id, b, item_name)
            continue

        prod = Product(name=item_name, brand=current_brand)
        session.add(prod)
        session.flush()
        count += 1
        _process_alias_col(session, prod.id, b, item_name)

    return count


def _process_alias_col(session, product_id, col_b, product_name):
    """Process column B as alias if it's text."""
    from .database import ProductAlias
    if col_b is not None and not isinstance(col_b, (int, float)):
        alias_text = str(col_b).strip()
        if alias_text and alias_text != product_name:
            existing = session.query(ProductAlias).filter(
                ProductAlias.alias == alias_text
            ).first()
            if not existing:
                session.add(ProductAlias(
                    product_id=product_id,
                    alias=alias_text,
                    source="manual",
                ))
