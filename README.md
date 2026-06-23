# 📊 价格追踪看板 (Price Tracker Dashboard)

商品价格管理与智能匹配系统，运行于群晖 NAS Docker 环境。

---

## 一、项目结构

```
price-tracker/
├── docker-compose.yml       # 部署配置 + 完整架构注释
├── Dockerfile               # 单阶段构建 (python:3.11-slim)
├── README.md                # ← 本文件
├── .gitignore
│
├── backend/                 # Python FastAPI 后端
│   ├── requirements.txt
│   └── app/
│       ├── main.py          # FastAPI 入口 — 所有路由
│       ├── database.py      # SQLite ORM (SQLAlchemy 2.x)
│       ├── parser.py        # Excel 解析 + Upsert
│       ├── matcher.py       # 四层匹配引擎
│       ├── text_parser.py   # 粘贴文本解析
│       ├── migration.py     # JSON→SQLite 迁移
│       ├── seed_products.py # 商品库导入 + 别名生成
│       ├── storage.py       # JSON 持久化（旧版）
│       └── models.py        # Pydantic 模型
│
├── frontend/                # React + Vite + Ant Design
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx          # 主布局（侧栏 + 路由）
│       ├── main.jsx
│       ├── store/priceStore.js
│       └── components/
│           ├── DashboardGrid.jsx      # 价格看板（8列网格）
│           ├── ItemCard.jsx           # 商品卡片（迷你曲线）
│           ├── DetailModal.jsx        # 详情弹窗（曲线+编辑）
│           ├── SearchBar.jsx          # 搜索栏
│           ├── PasteReviewModal.jsx   # 粘贴上传入口
│           ├── AIMatcher.jsx          # AI 匹配入口
│           ├── ReviewPanel.jsx        # ← 共享数据导入模块
│           ├── PriceReviewModal.jsx   # Excel 上传核对
│           ├── BackupRestoreModal.jsx # 备份还原
│           └── AliasManager.jsx       # 别名管理
│
└── data/                    # 群晖挂载（不在 git 中）
    └── prices.db            # SQLite 数据库
    └── backups/             # 自动备份
```

---

## 二、技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.11 + FastAPI + SQLAlchemy 2.x |
| 前端 | React 18 + Vite 5 + Ant Design 5 + ECharts 5 |
| 状态 | Zustand |
| 图表 | ECharts SVG 渲染器（非 Canvas，低内存） |
| 数据库 | SQLite (WAL 模式，线程安全) |
| AI | DeepSeek API (可选，手动触发) |
| 模糊匹配 | RapidFuzz |
| 容器 | Docker 单容器 (群晖) |

---

## 三、数据库设计

```
┌──────────────────┐    ┌─────────────────────┐    ┌──────────────────────┐
│   products       │    │   product_aliases   │    │   price_history       │
├──────────────────┤    ├─────────────────────┤    ├──────────────────────┤
│ id (PK)          │    │ id (PK)             │    │ id (PK)              │
│ name (UNIQUE)    │───→│ product_id (FK)     │───→│ product_id (FK)      │
│ brand            │    │ alias (UNIQUE)      │    │ price (FLOAT)        │
│ keywords         │    │ sort_order          │    │ price_date (DATE)    │
│ created_at       │    │ source              │    │ source_name          │
└──────────────────┘    │ created_at          │    │ UNIQUE(prod, date)   │
                        └─────────────────────┘    └──────────────────────┘
```

- **products**: 标准商品库 (初始 200 条，从模板 Excel 导入)
- **product_aliases**: 别名表（`sort_order=0` = 首选别名）
- **price_history**: 价格记录（同一商品+日期不重复）

---

## 四、API 路由

### 商品管理
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/dashboard` | 全量数据（品牌→商品→价格） |
| GET | `/api/item/{name}` | 单个商品历史 |
| POST | `/api/item/update-price` | 修改某日价格 |

### Excel 上传
| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/upload` | 一键上传+保存 |
| POST | `/api/upload/preview` | 解析+异常检测 |
| POST | `/api/upload/confirm` | 确认保存 |

### 粘贴文本
| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/paste/preview` | 引擎匹配 |
| POST | `/api/paste/deepseek-compare` | DeepSeek AI 匹配 |
| POST | `/api/paste/confirm` | 确认保存（含新品自动创建） |

### 别名管理
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/aliases/manage` | 列表（按 sort_order） |
| POST | `/api/aliases/reorder` | 拖拽排序 |
| POST | `/api/aliases/add` | 添加 |
| POST | `/api/aliases/delete` | 删除 |
| POST | `/api/aliases/learn` | 自动学习 |
| POST | `/api/aliases/edit-product` | 编辑标准名 |
| POST | `/api/aliases/edit-alias` | 编辑别名 |

### 其他
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/template` | 下载价格模板 Excel |
| GET | `/api/products/search/{q}` | 商品搜索（自动完成） |
| GET | `/api/backups` | 备份列表 |
| POST | `/api/backup` | 创建备份 |
| POST | `/api/restore/{name}` | 还原备份 |
| POST | `/api/recover` | JSON→SQLite 恢复 |
| POST | `/api/seed` | 重新种子商品库 |
| GET | `/` | 前端 SPA |

---

## 五、匹配引擎（四层）

```
用户粘贴文本 → text_parser.py → 商品名+价格提取
                                    ↓
                          matcher.py 匹配引擎
                        ┌────────────────────┐
                        │ 第1层: 精确匹配     │
                        │ 第2层: 别名匹配     │ ← 你的OCR对照表
                        │ 第3层: 关键词匹配   │
                        │ 第4层: RapidFuzz    │
                        └────────────────────┘
评分: ≥90 自动通过 | 70-89 待确认 | <70 未识别
```

### DeepSeek AI 匹配（可选）

```
点击"AI 比对" → 发送原始文本 + 200条首选别名到 DeepSeek
                → 返回匹配结果（并列显示在引擎右侧）
                → 引擎/AI 任一评分 ≥70 即算识别成功
```

---

## 六、前端交互流程

### 粘贴上传
```
① 选日期 → 粘贴文本 → 解析
② ReviewPanel 显示引擎匹配结果
③ 每行：品牌输入框 | 商品名输入框 | 价格 | 状态
④ 修正、删除、回车输入新品
⑤ 确认保存
```

### AI 匹配
```
① 选日期 → 粘贴文本 → AI 匹配
② ReviewPanel 显示 AI 匹配结果（与粘贴上传共用）
③ 其余同上
```

### 价格看板
```
① 响应式 8 列网格
② 每个商品卡片：迷你曲线（涨红色/跌绿色）+ 最新日期价格
③ 点击 → DetailModal（全历史曲线+dataZoom+可编辑价格列表）
```

---

## 七、核心设计决策

| 决策 | 方案 | 理由 |
|------|------|------|
| 数据库 | SQLite (WAL) | 单容器，无需额外服务 |
| 持久化 | JSON 文件 → SQLite | 第一阶段兼容，后续迁移 |
| 品牌识别 | 仅 KNOWN_BRANDS 硬编码 | 防止误解析永久污染 |
| 别名 | sort_order 排序 | 首选别名优先匹配 |
| 价格检测 | 偏差 ≥20 元预警 | OCR/手误自动提醒 |
| 新品创建 | 有名无 ID 自动创建 | 零手动操作 |
| AI 比对 | DeepSeek 可选 | 97% 引擎匹配率已够用 |
| 图表渲染 | SVG | 群晖低内存适配 |
| 备份 | SQLite WAL checkpoint | 确保备份数据完整 |

---

## 八、部署

### 群晖
```bash
# 构建部署
cd /volume1/docker/price-tracker
echo 'Wm258008' | sudo -S /usr/local/bin/docker compose up -d --build

# 访问
http://192.168.1.250:8889
```

### Mac 本地测试
```bash
cd frontend && npm run build
rm -rf ../backend/static && cp -r dist/* ../backend/static/
cd ../backend && DATA_DIR=/tmp/data uvicorn app.main:app
```

### SSH 更新
```bash
# 从 Mac 传文件到群晖
tar czf /tmp/p.tar.gz Dockerfile docker-compose.yml backend/ frontend/dist frontend/package.json
ssh wm8551590@192.168.1.250 "cd /volume1/docker/price-tracker && find . -not -path './data/*' -delete; tar xzf -" < /tmp/p.tar.gz
ssh wm8551590@192.168.1.250 "cd /volume1/docker/price-tracker && echo 'Wm258008' | sudo -S /usr/local/bin/docker compose up -d --build"
```

---

## 九、版本历史

| 版本 | 日期 | 改动 |
|------|------|------|
| v1 | 06-21 | 初始版本，JSON+37列 |
| v2 | 06-21 | 日期归一化/品牌识别/8列/涨跌色 |
| v3 | 06-21 | SQLite/匹配引擎/别名管理/两阶段上传 |
| v3.1 | 06-22 | ReviewPanel/AI弹窗/架构重构 |
| v3.2 | 06-22 | 新品自动创建/手机响应式/价格编辑 |
