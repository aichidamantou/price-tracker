# 📊 价格追踪看板 (Price Tracker Dashboard)

商品价格管理 · 进货价与倒挂监控 · AI 分析驾驶舱，运行于群晖 NAS Docker 环境。

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
│   ├── price_template.xlsx  # 价格模板
│   └── app/
│       ├── main.py          # FastAPI 入口 — 商品/价格/别名/备份/上传路由
│       ├── ai_analysis.py   # ★ AI 分析模块（数据导出 + 结果导入 + 时间线）
│       ├── database.py      # SQLite ORM (SQLAlchemy 2.x) + 幂等迁移
│       ├── parser.py        # Excel 解析 + Upsert
│       ├── matcher.py       # 四层匹配引擎
│       ├── text_parser.py   # 粘贴文本解析
│       ├── migration.py     # JSON→SQLite 迁移
│       ├── seed_products.py # 商品库导入 + 别名生成
│       ├── storage.py       # JSON 持久化（旧版）
│       └── models.py        # Pydantic 模型
│
├── frontend/                # React + Vite + Ant Design（全站深色）
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx          # 主布局（侧栏 + 视图切换 + 深色主题）
│       ├── main.jsx
│       ├── store/priceStore.js
│       ├── utils/
│       │   ├── theme.js         # ★ 全站颜色 token（换肤只改这里）
│       │   └── priceStatus.js   # 涨跌状态判定（卡片/汇总共用口径）
│       └── components/
│           ├── DashboardGrid.jsx      # 价格看板（8列网格）
│           ├── ItemCard.jsx           # 商品卡片（迷你曲线 + 公司价）
│           ├── SummaryBar.jsx         # 顶部汇总条
│           ├── DetailModal.jsx        # 详情弹窗（曲线 + 编辑价格）
│           ├── CostEntryModal.jsx     # ★ 公司价录入弹窗
│           ├── ProductManager.jsx     # ★ 商品管理（进货价 + 三层排序）
│           ├── AIAnalysis.jsx         # ★ AI 分析数据墙
│           ├── SearchBar.jsx          # 搜索栏
│           ├── PasteReviewModal.jsx   # 粘贴上传入口
│           ├── AIMatcher.jsx          # AI 匹配入口
│           ├── ReviewPanel.jsx        # ← 共享数据导入模块
│           ├── PriceReviewModal.jsx   # Excel 上传核对
│           ├── BackupRestoreModal.jsx # 备份还原
│           └── AliasManager.jsx       # ⚠️ 已废弃（被 ProductManager 取代，保留未删）
│
└── data/                    # 群晖挂载（不在 git 中）
    ├── prices.db            # SQLite 数据库
    ├── prices.json          # 旧版 JSON（双存储，上传时作基线）
    └── backups/             # 自动备份
```

---

## 二、技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.11 + FastAPI + SQLAlchemy 2.x |
| 前端 | React 18 + Vite 5 + Ant Design 5 + ECharts 5 |
| 状态 | Zustand |
| 主题 | **全站深色驾驶舱**（antd darkAlgorithm + 自定义 token） |
| 图表 | 卡片迷你图用 Canvas（208 张，省 DOM）；详情/AI 用 SVG（低内存） |
| 数据库 | SQLite 3.46 (WAL 模式 + 生成列 + JSON1) |
| AI | DeepSeek（**手动导入导出**，不在服务端自动调用） |
| 模糊匹配 | RapidFuzz |
| 容器 | Docker 单容器 (群晖) |

---

## 三、数据库设计

```
┌──────────────────────┐   ┌─────────────────────┐   ┌──────────────────────┐
│     products         │   │  product_aliases    │   │    price_history     │
├──────────────────────┤   ├─────────────────────┤   ├──────────────────────┤
│ id (PK)              │←──│ product_id          │   │ id (PK)              │
│ name (UNIQUE)        │   │ alias (UNIQUE)      │   │ product_id           │
│ brand                │   │ sort_order          │   │ price (FLOAT)        │
│ keywords             │   │ source              │   │ price_date (TEXT)    │
│ sort_order           │   │ created_at          │   │ source_name          │
│ current_cost      ★  │   └─────────────────────┘   │ UNIQUE(prod, date)   │
│ cost_effective_from ★│                             └──────────────────────┘
│ created_at           │   ┌─────────────────────┐   ┌──────────────────────┐
└──────────────────────┘   │     brand_order     │   │    product_cost   ★  │
                           ├─────────────────────┤   ├──────────────────────┤
                           │ id (PK)             │   │ id (PK)              │
                           │ brand (UNIQUE)      │   │ product_id           │
                           │ sort_order          │   │ cost_price (FLOAT)   │
                           └─────────────────────┘   │ effective_from (TEXT)│
                                                     │ note                 │
                                                     │ created_at           │
                                                     │ UNIQUE(prod, 日期)   │
                                                     └──────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                           ai_analysis  ★                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ id (PK) · import_time · date_range_from · date_range_to · product_count  │
│ raw_json（原始粘贴内容，只留最近 50 条）                                  │
│ analysis_data（结构化 JSON）· summary · source · title                   │
│ fingerprint（UNIQUE，导入幂等判重）                                       │
│ risk_level        ┐                                                      │
│ inverted_count    ├─ VIRTUAL 生成列，从 analysis_data 自动派生            │
│ avg_change_pct    ┘   （可直接 SQL 过滤，走 idx_ai_risk 索引）            │
└──────────────────────────────────────────────────────────────────────────┘
```

**要点**
- **双存储**：SQLite 为主，`prices.json` 保留作上传基线。改商品名/品牌/删除**必须同步两边**，
  否则下次上传时 parser 会以 prices.json 为基线 carry-over，把删掉的商品"复活"。
- **排序三层**：`brand_order.sort_order`（地区）→ `products.sort_order`（同地区内商品）
  → `product_aliases.sort_order`（别名，0 = 首选）
- **进货价冗余**：`products.current_cost` / `cost_effective_from` 冗余自 `product_cost` 最新一条，
  列表页与倒挂计算直接读，不走 JOIN。写入/删除历史后由 `recalc_current_cost()` 重算。
- **生成列**：`ai_analysis` 的三个派生列是 **VIRTUAL 生成列**（SQLite 的 `ALTER TABLE` 只支持 VIRTUAL，STORED 加不了）。
  ⚠️ 检测列是否存在必须用 `PRAGMA table_xinfo` —— **`table_info` 不返回生成列**（生成列算 hidden 列），
  用错会导致「新建表后又 ALTER 一次」→ `duplicate column name` → 容器启动崩溃。

---

## 四、API 路由

### 价格看板
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/dashboard` | 全量数据（品牌→商品→价格 + 公司价） |
| GET | `/api/item/{name}` | 单个商品历史 |
| POST | `/api/item/update-price` | 修改某日价格 |
| GET | `/api/template` | 下载价格模板 Excel |

### Excel / 粘贴上传
| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/upload` | 一键上传+保存 |
| POST | `/api/upload/preview` | 解析+异常检测（偏差 ≥20 元） |
| POST | `/api/upload/confirm` | 确认保存 |
| POST | `/api/paste/preview` | 粘贴文本 → 引擎匹配 |
| POST | `/api/paste/deepseek-compare` | 粘贴文本 → DeepSeek 比对 |
| POST | `/api/paste/confirm` | 确认保存（含新品自动创建） |

### 商品与别名管理
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/aliases/manage` | 列表（含公司价、当前售价、倒挂、sort_order） |
| POST | `/api/products` | 新增标准商品（可带进货价） |
| DELETE | `/api/products/{id}` | 删除商品（连带价格/别名/进货价，并同步 prices.json） |
| GET | `/api/products/search/{q}` | 商品搜索（自动完成） |
| POST | `/api/aliases/reorder` | 别名排序 |
| POST | `/api/aliases/reorder-brands` | 地区（品牌）排序 |
| POST | `/api/aliases/reorder-products` | 同地区内商品排序 |
| POST | `/api/aliases/add` · `/delete` · `/learn` | 别名增删/自动学习 |
| POST | `/api/aliases/edit-product` · `/edit-alias` · `/update-brand` | 编辑标准名/别名/品牌 |

### 进货价（公司价）★
| 方法 | 路由 | 说明 |
|------|------|------|
| PATCH | `/api/products/{id}/cost` | 更新当前进货价（自动以今天为生效日写历史） |
| GET | `/api/products/{id}/cost/history` | 进货价历史（按生效日倒序） |
| POST | `/api/products/{id}/cost/history` | 补录历史（同日默认 409，`overwrite=true` 覆盖） |
| PATCH | `/api/products/cost/history/{id}` | **修改某条历史**（价格/日期/备注，撞日可合并） |
| DELETE | `/api/products/cost/history/{id}` | 删除某条历史并重算当前价 |
| POST | `/api/products/cost/import` | Excel 批量导入（标准名精确匹配 → 别名兜底） |
| GET | `/api/products/cost/template` | 下载进货价导入模板（预填全部标准名+当前价） |

### AI 分析 ★
| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/export/prices` | 导出价格数据（含统计、倒挂概览、**内嵌系统提示词**） |
| GET | `/api/ai/prompt` | 取系统提示词 |
| POST | `/api/ai/import` | 粘贴 AI 结果 → **容错解析** → 入库（`force=true` 可强导重复内容） |
| GET | `/api/ai/list` | 时间线列表（不含大字段，含生成列） |
| GET | `/api/ai/{id}` | 详情（含结构化 `analysis_data`） |
| GET | `/api/ai/{id}/charts` | **聚合好的图表数据**（KPI/大盘指数/品牌排行/风险热力/预测/倒挂榜） |
| DELETE | `/api/ai/{id}` | 删除 |
| GET | `/api/export/analysis` | AI 分析用导出（早期冻结格式） |

### 备份
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/backups` · POST `/api/backup` · POST `/api/restore/{name}` | 备份列表/创建/还原 |
| POST | `/api/recover` · `/api/seed` | JSON→SQLite 恢复 / 重新种子商品库 |
| GET | `/` | 前端 SPA |

---

## 五、进货价与倒挂 ★

### 颜色口径（全站统一，**不可改**）

> **涨 / 盈利 / 高风险 → 红**　`#ff4d4f`
> **跌 / 倒挂 → 绿**　`#52c41a`
> 持平 / 中风险 → 橙　`#faad14`；无行情 → 蓝

这是本项目从价格看板就定下的口径，**与欧美惯例相反，也与常见的「涨绿跌红」相反**。
外部方案或新同学若按「涨绿跌红」写，会和看板卡片、公司价标签、AI 图表互相打脸 —— 请以本节为准。

### 倒挂计算

```
倒挂幅度 = 进货价 − 最新售价       （> 0 即倒挂）
倒挂比例 = 倒挂幅度 / 进货价 × 100
严重度   = 比例 > 5% → critical(红脉冲) ；> 0 → warning(橙脉冲)
```

### 两个入口，别混

| 入口 | 行为 |
|------|------|
| **价格看板卡片**上的「公司价」/「暂缺数据」 | 点击录入，默认**今天生效** |
| **商品管理 → 展开 → 进货价历史** | 可改**任意一条历史**的价格/日期/备注 |

⚠️ 看板卡片上改进货价 = 记一条**今天生效**的新价（日常改价设计如此）。
想修正某条历史值，必须走「商品管理」的历史编辑，不要在看板上改。

---

## 六、AI 分析工作流 ★

```
① 导出数据 ──→ 复制（提示词 + 数据）
                     │  导出内容里已内嵌：分析要求 + 烟草行业背景 + 严格 JSON 输出格式
                     ↓
② 粘贴给 DeepSeek / ChatGPT / 豆包 ──→ 拿到 JSON 结果
                     ↓
③ 粘贴导入 ──→ 容错解析 ──→ 存一条时间线记录
                     ↓
④ 数据墙：KPI · 大盘指数 · 品牌涨跌 · 风险热力 · 预测曲线 · 倒挂预警 · 摘要建议
```

**设计要点**
- **不自动调用 AI**：服务端不发任何 AI 请求，全部手动导入导出。
- **提示词内嵌导出内容**：用户复制一次即可投喂，无需再补充说明。
- **容错解析**：AI 输出经常夹带 ```json 围栏或前后解释文字，`extract_json()` 会自动抠出 JSON，
  连 JSON 内含 `{}` 干扰也能正确处理。缺必需字段（overview/price_trends/summary）返回 400 并列出缺什么。
- **导入幂等**：`fingerprint = md5(日期区间 + 摘要)`，重复粘贴返回 409 并带已有记录 id；
  需要保留重复副本时传 `force=true`（此时不写指纹，否则违反 UNIQUE 索引）。
- **聚合在后端**：前端不再拉 2MB 全量导出自己遍历，改由 `/api/ai/{id}/charts` 一次算完返回。

---

## 七、前端交互

### 价格看板
```
响应式 8 列网格 · 顶部汇总条（总数/跌价/涨价/平稳/无行情）
每个卡片：商品名 +（公司价 + 盈亏）+ 迷你走势线（股票式分段着色）+ 最新价 + 周期涨跌
点击卡片 → DetailModal（全历史曲线 + dataZoom + 可编辑价格列表）
```

### 商品管理（三层排序）
```
地区分隔行 ⠿ 拖拽 / ↑↓  →  /api/aliases/reorder-brands
  商品行   ⠿ 拖拽 / ▲▼  →  /api/aliases/reorder-products
    别名   ⠿ 拖拽 / ↑↓  →  /api/aliases/reorder
展开面板：基础信息 + 别名管理 + 进货价历史（可改/可补录/可删）
```
> 排序一律基于**未过滤的完整分组**，拖拽用 **id 而非索引**定位 ——
> 所以在搜索/筛选态下排序依然正确，不会写坏真实顺序。

### 深色主题
所有颜色走 `src/utils/theme.js` 的 `T.xxx` token，**禁止写字面色值**（ECharts 配置也一样，
canvas 不解析 CSS 变量）。换肤只改 theme.js 一个文件。
208 张商品卡片**不要用 backdrop-filter**（群晖内存有限），毛玻璃只用于顶栏等少量元素。

---

## 八、匹配引擎（四层）

```
用户粘贴文本 → text_parser.py → 商品名+价格提取
                                    ↓
                          matcher.py 匹配引擎
                        ┌────────────────────┐
                        │ 第1层: 精确匹配     │
                        │ 第2层: 别名匹配     │ ← OCR 对照表
                        │ 第3层: 关键词匹配   │
                        │ 第4层: RapidFuzz    │
                        └────────────────────┘
评分: ≥90 自动通过 | 70-89 待确认 | <70 未识别

DeepSeek AI 比对（可选）：发送原始文本 + 全部首选别名 → 并列显示在引擎右侧
                        ⚠️ 依赖 main.py 里硬编码的 API Key，余额不足时该功能不可用
```

---

## 九、部署

### 群晖（**安全流程，勿用 `rm -rf ./*`**）

> ⚠️ **本项目数据卷挂在部署目录内**（`./data:/data`）。
> 任何形式的 `rm -rf ./*` 或 `find . -delete` 都会**连数据库一起删掉**。

> 凭据不入库。先在本地 shell 里设好环境变量（`SSHPASS` 供 sshpass 用，`NAS_PW` 供群晖 sudo 用）：
> ```bash
> export NAS_HOST=<群晖地址>      # 例 NAS_HOST
> export NAS_USER=<群晖账号>
> export SSHPASS='<该账号密码>'    # sshpass -e 从这里读
> export NAS_PW="$SSHPASS"        # 群晖 sudo 密码（通常同 ssh 密码）
> ```

```bash
# ── 0. 本地打包（只带运行期文件，确认不含 data/）
cd frontend && npm run build && cd ..
tar czf /tmp/deploy.tar.gz \
  --exclude='node_modules' --exclude='__pycache__' --exclude='._*' --exclude='.DS_Store' \
  Dockerfile docker-compose.yml backend/requirements.txt backend/price_template.xlsx \
  backend/app frontend/dist frontend/package.json

# ── 1. 停容器 + 备份（关键一步）
sshpass -e ssh "$NAS_USER@$NAS_HOST" "NAS_PW='$NAS_PW' bash -s" <<'EOF'
set -e
cd /volume1/docker/price-tracker
TS=$(date +%Y%m%d_%H%M%S)
echo "$NAS_PW" | sudo -S /usr/local/bin/docker compose stop
cp -a data/prices.db "data/backups/predeploy_${TS}.db"
echo "$NAS_PW" | sudo -S tar czf "/volume1/docker/price-tracker-predeploy-${TS}.tar.gz" \
  -C /volume1/docker price-tracker
echo "BACKUP_DONE TS=$TS"
EOF

# ── 2. 上传 + 只覆盖代码（data/ 一个字都不动）
sshpass -e scp /tmp/deploy.tar.gz "$NAS_USER@$NAS_HOST:/tmp/"
sshpass -e ssh "$NAS_USER@$NAS_HOST" 'bash -s' <<'EOF'
set -e
cd /volume1/docker/price-tracker
ls -la data/prices.db              # 记下大小
rm -rf frontend/dist               # 只删构建产物
tar xzf /tmp/deploy.tar.gz -C .
mkdir -p data data/backups
ls -la data/prices.db              # 必须与上面完全一致
md5sum backend/app/main.py frontend/dist/assets/*.js
EOF

# ── 3. 重建并启动
sshpass -e ssh "$NAS_USER@$NAS_HOST" "NAS_PW='$NAS_PW' bash -s" <<'EOF'
cd /volume1/docker/price-tracker
echo "$NAS_PW" | sudo -S /usr/local/bin/docker compose up -d --build
EOF

# ── 4. 校验（必做）
# 容器内 md5 必须等于本地；日志无报错；数据行数与备份一致
```

**回滚**
```bash
cd /volume1/docker && sudo tar xzf price-tracker-predeploy-<TS>.tar.gz
cd price-tracker && sudo /usr/local/bin/docker compose up -d --build
```

**访问**：http://NAS_HOST:8889

### Mac 本地测试

```bash
cd frontend && npm run build
rm -rf ../backend/static && cp -r dist ../backend/static
cd ../backend && DATA_DIR=/tmp/data uvicorn app.main:app
```

> 本机 `/usr/bin/python3`（3.9）已装齐后端依赖，但**缺 rapidfuzz**（`main.py` 不引用，仅 `matcher.py` 用）。
> `fastapi.testclient.TestClient` 因 httpx/starlette 版本错配不可用，测接口请起真实 uvicorn + requests。

---

## 十、核心设计决策

| 决策 | 方案 | 理由 |
|------|------|------|
| 数据库 | SQLite (WAL) | 单容器，无需额外服务 |
| 持久化 | JSON + SQLite 双写 | 第一阶段兼容，删除/改名必须同步两边 |
| 品牌识别 | 仅 KNOWN_BRANDS 硬编码 | 防止误解析永久污染 |
| 排序 | 三层 sort_order | 地区 / 商品 / 别名各排各的 |
| 价格检测 | 偏差 ≥20 元预警 | OCR/手误自动提醒 |
| 进货价 | 历史表 + 冗余字段 | 留痕的同时列表页读得快 |
| 同日重复改价 | 覆盖 | 避免冗余记录 |
| 倒挂颜色 | **绿**（跌色） | 与全站涨红跌绿口径一致 |
| AI 分析 | 手动导入导出 | 不依赖服务端 Key、可控、零成本 |
| AI 结果解析 | 容错提取 | AI 输出不可假设是干净 JSON |
| 聚合位置 | 后端算好再给前端 | 前端才能做流畅切换动画 |
| 图表渲染 | 卡片 Canvas / 详情 SVG | 208 张卡片省 DOM，弹窗省内存 |
| 主题 | 全站深色 + token 化 | 换肤只改 theme.js |
| 备份 | SQLite WAL checkpoint | 确保备份数据完整 |

---

## 十一、版本历史

| 版本 | 日期 | 改动 |
|------|------|------|
| v1 | 2026-06-21 | 初始版本，JSON + 37 列 |
| v2 | 2026-06-21 | 日期归一化 / 品牌识别 / 8 列 / 涨跌色 |
| v3 | 2026-06-21 | SQLite / 四层匹配引擎 / 别名管理 / 两阶段上传 |
| v3.1 | 2026-06-22 | ReviewPanel / AI 弹窗 / 架构重构 |
| v3.2 | 2026-06-22 | 新品自动创建 / 手机响应式 / 价格编辑 |
| v3.3 | 2026-08-28 | 箭头+拖拽双模式排序（地区 / 商品 / 别名） |
| v3.5 | 2026-09-15 | 删除/改名双写同步 prices.json；股票式分段着色；顶部汇总条 |
| **v4.0** | **2026-10-02** | **别名管理升级为商品管理（列表布局 + 三层排序）；进货价管理与历史（`product_cost` + 冗余字段 + 倒挂检测 + Excel 批量导入）；价格看板卡片显示公司价与盈亏；AI 分析模块（导出/导入/时间线/数据墙/聚合接口/导入幂等）；全站深色驾驶舱（token 化主题）；`ai_analysis` 生成列与索引** |

---

## 十二、已知隐患

- `backend/app/main.py` 里**硬编码 DeepSeek API Key**，且**余额不足**（返回 HTTP 402 Insufficient Balance）。
  影响「AI 匹配」功能；建议改环境变量并充值。
- `frontend/src/components/AliasManager.jsx` 已被 `ProductManager.jsx` 取代，不再被引用（保留未删）。
- 群晖 `frontend/` 下有多个 `dist.bak.*` 备份目录可清理。
- `AIAnalysis.jsx` 已 800+ 行，图表 option 与弹窗建议拆成子组件。
