"""
文本解析模块 —— 将用户粘贴的长文本解析为结构化数据。

输入：
  软中 680
  荷花 320
  细荷花 420
  黄鹤楼奇景 260
  软九五 980

输出：
  [{"name":"软中","price":680}, {"name":"荷花","price":320}]

支持格式：
  "商品名 价格"
  "商品名~价格"
  "商品名～价格"
  "商品名/价格"
  "商品名"  (无价格)
  "商品名门票~价格"  (含"门票"等噪音词自动去除)
"""

import re
from typing import Optional


def clean_name(raw: str) -> str:
    """清理商品名称中的噪音词和符号。

    注意：不清除"门票"等词，因为它们是别名的一部分。
    别名表中存储的就是完整OCR文本（如"云段之上门票"）
    """
    s = raw.strip()
    # 去除"/"或"/本"结尾（无价格的标志）
    s = re.sub(r'[/／](本|议价)?\s*$', '', s)
    s = re.sub(r'议价\s*$', '', s)
    # 去除结尾及内部的 ~ ～ 符号
    s = re.sub(r'[～~]\s*$', '', s)
    s = re.sub(r'[～~]\s*[/／](本|不限)?', '', s)
    # 去除末尾特殊标记符号
    s = re.sub(r'[√✓✗×,，]', '', s)
    # 去除"本不烫"等无关文字
    s = re.sub(r'本不烫|本码|不烫|本不限|不限|红线|白线', '', s)
    # 标准化括号
    s = s.replace('（', '(').replace('）', ')')
    # 压缩多余空格
    s = re.sub(r'\s+', '', s)
    return s.strip()


def parse_line(line: str) -> Optional[dict]:
    """解析单行文本，返回 {"name":..., "price":...} 或 None。"""
    line = line.strip()
    if not line:
        return None

    # 过滤非商品行
    if any(kw in line for kw in ['回收', '诚信', '此号', '出货', '写上', '所有货', '更多品种', '长期', '只发交流', '合作共赢', '微信收藏']):
        return None
    # 过滤纯装饰行
    if re.match(r'^[?？!！。，、\[\]【】《》""''\s]+$', line):
        return None
    if line.startswith('招') and len(line) < 10:
        return None

    # 尝试提取价格
    price = None

    # 模式1: "商品名~123" 或 "商品名～123" 或 "商品名~123元"
    price_match = re.search(r'[~～]+(\d+(?:\.\d+)?)', line)
    if price_match:
        price = float(price_match.group(1))
        line = line[:price_match.start()]  # 去掉价格部分

    # 模式2: "商品名 123" (空格分隔)
    if price is None:
        price_match = re.search(r'[（(]?\s*(\d+(?:\.\d+)?)\s*[）)]?$', line)
        if price_match:
            price = float(price_match.group(1))
            line = line[:price_match.start()].strip()

    # 模式3: "商品名/123"
    if price is None:
        price_match = re.search(r'[/／](\d+(?:\.\d+)?)\s*$', line)
        if price_match:
            price = float(price_match.group(1))
            line = line[:price_match.start()].strip()

    name = clean_name(line)
    if not name:
        return None

    return {"name": name, "price": price}


def parse_text(text: str) -> list[dict]:
    """解析整段粘贴文本，返回商品列表。"""
    results = []
    current_brand = ""
    known_brands = ['云南', '浙江', '上海', '湖北', '湖南', '河南', '河北', '广西',
                    '江苏', '内蒙', '山东', '江西', '贵州', '四川', '福建', '吉林',
                    '广东', '安徽', '陕西', '重庆', '甘肃', '哈尔滨', '公司进口']

    for raw_line in text.split('\n'):
        line = raw_line.strip()
        if not line:
            continue

        # 检测品牌行: 【】或纯品牌名
        brand_match = re.match(r'[【［\[](.+?)[】］\]]', line)
        if brand_match:
            potential_brand = brand_match.group(1).replace('一日游', '').replace('日游', '').strip()
            if potential_brand in known_brands:
                current_brand = potential_brand
                continue

        # 纯品牌名行
        if line in known_brands:
            current_brand = line
            continue

        item = parse_line(line)
        if item:
            item['brand'] = current_brand
            results.append(item)

    return results
