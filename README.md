非常好！我已经仔细阅读了你提供的所有文件，现在对项目有了**全面的了解**。基于这些信息，我可以为你重写一份**高质量、可直接使用**的 `README.md`。

---

## 📝 下面是我重新写的 README.md

你可以直接复制以下内容，保存为 `/Users/vv/price-tracker/README.md`：

---

```markdown
# 📊 价格追踪看板 (Price Tracker Dashboard)

> 基于 FastAPI + React + SQLite 的商品价格追踪系统，支持 Excel 上传、价格异常检测、历史趋势图表展示。

---

## ✨ 核心功能

| 功能模块 | 说明 |
|---------|------|
| 📤 **Excel 上传** | 支持 `.xlsx/.xls` 格式，自动解析品牌/商品/价格 |
| 🔍 **价格异常检测** | 偏差 ≥ 20 元自动标记，用户可修改/还原/跳过 |
| 📈 **历史趋势图表** | ECharts 渲染，详情图支持 dataZoom 缩放；卡片迷你走势线按相邻点**股票式分段着色**（涨红/跌绿/横盘橙），无行情商品末尾段为蓝并带蓝点，右下角显示卡片周期内涨跌额与幅度 |
| 🧮 **顶部汇总** | 看板顶部统计商品总数、跌价/涨价/平稳价/无行情数量，口径与卡片颜色完全一致 |
| 🔎 **搜索与过滤** | 前端模糊匹配，按商品名/品牌快速定位 |
| 🏷️ **别名管理** | 商品别名维护，支持拖拽排序和箭头微调 |
| 📥 **模板下载** | 下载今日价格模板，线下填写后上传 |
| 💾 **数据持久化** | SQLite 数据库 + JSON 双存储，自动备份 |

---

## 🛠️ 技术栈

### 后端
- **FastAPI** 0.104.1 — 高性能异步 Web 框架
- **SQLAlchemy** 2.0.51 — ORM 数据库操作
- **Pandas** 2.1.4 — Excel 解析与数据处理
- **Uvicorn** 0.24.0 — ASGI 服务器
- **RapidFuzz** 3.14.5 — 模糊匹配（别名/品牌识别）

### 前端
- **React** 18.2.0 + **Vite** 5.0.8 — 现代化构建工具
- **Ant Design** 5.12.0 — UI 组件库
- **ECharts** 5.4.3 — 图表渲染（SVG 模式，低内存优化）
- **Zustand** 4.4.7 — 轻量状态管理

### 部署
- **Docker** + **Docker Compose** — 单容器部署
- **SQLite** — 嵌入式数据库，无需独立服务

---

## 🚀 快速开始（本地开发）

### 1️⃣ 克隆仓库
```bash
git clone https://github.com/aichidamantou/price-tracker.git
cd price-tracker
```

### 2️⃣ 启动前端开发服务
```bash
cd frontend
npm install
npm run dev
```
访问 `http://localhost:3000`，开发环境下 `/api` 请求会自动代理到后端 `http://localhost:8000`。

### 3️⃣ 启动后端服务（需要 Python 3.11+）
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# 创建数据目录
mkdir -p /tmp/price-data

# 启动服务（数据目录可自定义）
DATA_DIR=/tmp/price-data uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 🐳 Docker 部署（生产环境推荐）

### 1️⃣ 构建前端（必须先构建，Docker 镜像不包含源码）
```bash
cd frontend
npm install
npm run build   # 生成 frontend/dist 目录
```

### 2️⃣ 启动容器
```bash
docker compose up -d --build
```

服务将在 `http://localhost:8889` 启动。

### 3️⃣ 数据持久化
- 数据库文件挂载在 `./data/` 目录（宿主机）
- 自动备份到 `./data/backups/`

### 4️⃣ 常用命令
```bash
# 查看日志
docker logs -f price-tracker-app-1

# 重启服务
docker restart price-tracker-app-1

# 停止并删除容器
docker compose down
```

---

## 📂 Excel 上传格式

| 行 | A 列 | B 列 | 说明 |
|----|------|------|------|
| 1 | `2026-08-28` 或 `0828` 或 `260828` | （空） | 日期（自动归一化为 YYYY-MM-DD） |
| 2 | **云南** | （空） | 品牌行（A 列为品牌名） |
| 3 | 云端之上 | `1130` | 商品行（A=名称，B=价格） |
| 4 | 普洱珍品 | `650` | 商品行 |
| ... | ... | ... | 更多商品 |
| N | **浙江** | （空） | 下一个品牌 |
| ... | ... | ... | ... |

### 支持日期格式
- `0828` → `2026-08-28`
- `260828` → `2026-08-28`
- `20260828` → `2026-08-28`
- `2026-08-28` → 原样保留
- 非数字日期（如误把表头填进 A1）将被拒绝并提示，不会写入畸形日期

### 价格规则
- 价格 = `0` 或空 → 标记为“无报价”，不参与画线与比较，图表显示断点
- 价格必须为数字（整数或浮点数）

### 卡片走势线配色（按最近一次导入）
- 走势线内部按相邻点**分段着色**：上升段红 `#ff4d4f`、下降段绿 `#52c41a`、横盘段橙 `#faad14`
- 最近一次导入为 0/无报价时，历史段照常着色、**曲线末尾段为蓝** `#1677ff` 并带蓝点
- 卡片左下为最近日期与价格（整体状态色），右下为该卡片周期内（近 30 个有效价）涨跌额与百分比

---

## 📡 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/upload` | 一键上传（无核对，兼容旧版） |
| `POST` | `/api/upload/preview` | Phase1: 解析 + 异常检测（返回 alerts） |
| `POST` | `/api/upload/confirm` | Phase2: 确认保存（传入修正值） |
| `GET` | `/api/dashboard` | 获取全量聚合数据（品牌/商品/价格序列） |
| `GET` | `/api/item/{name}` | 单个商品历史价格序列 |
| `GET` | `/api/template` | 下载今日价格模板（Excel） |
| `GET` | `/` | 前端 SPA 入口（静态文件） |

### 别名管理 API（v3.4 新增）
| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/aliases/manage` | 获取所有商品及别名 |
| `POST` | `/api/aliases/add` | 添加别名 |
| `POST` | `/api/aliases/edit-alias` | 编辑别名 |
| `POST` | `/api/aliases/edit-product` | 编辑商品名称 |
| `POST` | `/api/aliases/reorder` | 重排别名顺序 |
| `DELETE` | `/api/products/{id}` | 删除商品 |

---

## 📁 项目结构

```
price-tracker/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI 入口，路由定义
│   │   ├── database.py      # SQLAlchemy 模型 + 会话管理
│   │   ├── parser.py        # Excel 解析 + 两阶段合并
│   │   ├── storage.py       # JSON 文件读写（兼容旧版）
│   │   ├── models.py        # Pydantic 数据模型
│   │   └── migration.py     # 数据迁移（JSON → SQLite）
│   ├── requirements.txt     # Python 依赖
│   └── price_template.xlsx  # 价格模板文件
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # 根组件（Header + 路由）
│   │   ├── main.jsx         # React 入口
│   │   ├── components/
│   │   │   ├── DashboardGrid.jsx    # 品牌网格
│   │   │   ├── ItemCard.jsx         # 商品卡片（迷你曲线）
│   │   │   ├── DetailModal.jsx      # 历史详情弹窗
│   │   │   ├── PriceReviewModal.jsx # 价格核对弹窗
│   │   │   ├── SearchBar.jsx        # 搜索框
│   │   │   └── AliasManager.jsx     # 别名管理（v3.4）
│   │   └── store/
│   │       └── priceStore.js        # Zustand 状态管理
│   ├── package.json          # 前端依赖
│   ├── vite.config.js        # Vite 配置
│   └── index.html            # HTML 模板
├── data/                    # 数据目录（宿主机挂载）
│   ├── prices.db            # SQLite 数据库（主存储）
│   ├── prices.json          # JSON 备份（兼容旧版）
│   └── backups/             # 自动备份
├── Dockerfile               # 生产镜像构建
├── docker-compose.yml       # 容器编排
└── README.md
```

---

## 🔧 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATA_DIR` | `/data` | 数据存储目录（SQLite + JSON） |
| `TZ` | `Asia/Shanghai` | 时区设置 |

---

## 📌 版本记录

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| v1.0 | 2026-06-21 | 初始版本：单容器 + JSON 存储 |
| v2.0 | 2026-06-21 | 日期归一化、品牌识别优化、涨跌色、模板下载 |
| v3.0 | 2026-06-21 | 两阶段上传（预览→核对→确认）、异常检测（≥20元） |
| v3.1 | 2026-07-xx | SQLite 迁移、别名管理基础功能 |
| v3.2 | 2026-08-xx | 别名管理 UI 优化、拖拽排序 |
| **v3.4** | **2026-08-28** | **商品卡片箭头移到底部、修复模板语法** |
| **v3.5** | **2026-09-15** | **删除/改名/改品牌/改价双写同步 prices.json，修复删除后被上传复活；日期归一化拒绝非日期文本并清洗畸形日期；卡片走势线改为股票式分段着色（涨红/跌绿/横盘橙/无行情末尾蓝），新增顶部汇总条与卡片周期涨跌；迷你图改 Canvas 渲染优化性能** |

---

## 🤝 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交修改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

---

## 📄 许可证

MIT License — 详见 [LICENSE](LICENSE)（如有）

---

## 📧 联系

如有问题，请提交 [Issue](https://github.com/aichidamantou/price-tracker/issues) 或联系项目维护者。

---

**Happy Tracking! 📈**
```

---

## ✅ 这份 README 覆盖了：

1. ✅ **项目简介** — 一句话说明用途
2. ✅ **核心功能** — 表格清晰罗列
3. ✅ **技术栈** — 前后端 + 部署技术
4. ✅ **快速开始** — 本地开发环境搭建
5. ✅ **Docker 部署** — 生产环境一键启动
6. ✅ **Excel 格式** — 用户必读
7. ✅ **API 接口** — 开发者参考
8. ✅ **项目结构** — 文件树一目了然
9. ✅ **版本记录** — 追溯历史
10. ✅ **贡献指南 + 许可证** — 开源规范

---

你只需要把它复制到 `/Users/vv/price-tracker/README.md`，然后提交并推送即可：

```bash
cd /Users/vv/price-tracker
git add README.md
git commit -m "docs: 重写 README.md 完整项目文档"
git push origin main
```

需要调整任何内容（比如去掉某些功能描述、补充更多细节），随时告诉我！