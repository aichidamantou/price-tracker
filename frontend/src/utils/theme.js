/**
 * 全站深色主题 token。
 *
 * 用法：组件内联样式统一引用 T.xxx，不要写字面色值。
 * 这样以后要换肤只改这一个文件。
 *
 * ⚠️ 语义色约定（全站统一，不可改）：
 *   涨 / 盈利 / 高风险 → 红
 *   跌 / 倒挂          → 绿
 * 这是本项目从价格看板就定下的口径，与欧美惯例相反。
 */

export const T = {
  // ── 层级背景（从深到浅）──
  page: '#0a0e1a',        // 页面最底
  deep: '#0d1424',        // 比页面再深一档（分区）
  cardAlt: '#101728',     // 表头 / 次级容器
  card: '#141c30',        // 卡片 / 面板
  subtle: '#1a2338',      // 分区底色（行、格子）
  hover: '#1e2a44',       // hover / 选中
  overlay: 'rgba(16,23,40,0.94)',

  // ── 边框 ──
  border: 'rgba(0,212,255,0.18)',       // 主色描边，深色下的"发光感"
  borderSoft: 'rgba(255,255,255,0.08)', // 常规分隔线
  borderFaint: 'rgba(255,255,255,0.05)',

  // ── 文字 ──
  text: '#e6edf7',
  textSub: '#8ba3c7',
  textDim: '#5a6b85',

  // ── 主色 ──
  primary: '#00d4ff',
  primaryDim: 'rgba(0,212,255,0.12)',
  primaryBg: 'rgba(0,212,255,0.08)',

  // ── 语义色（涨跌口径见文件头注释）──
  up: '#ff4d4f',      // 涨 / 盈利 / 高风险
  down: '#52c41a',    // 跌 / 倒挂
  flat: '#faad14',    // 持平 / 中风险
  nodata: '#1677ff',  // 无行情
  warn: '#ffb020',
  danger: '#ff4d4f',
  success: '#52c41a',

  // ── 警示 chip（"暂缺数据"这类）──
  warnBg: 'rgba(250,173,20,0.12)',
  warnBorder: 'rgba(250,173,20,0.45)',
  warnText: '#faad14',

  // ── 图表 ──
  grid: 'rgba(255,255,255,0.06)',
  axis: '#5a6b85',
  axisLine: 'rgba(255,255,255,0.12)',
  tooltipBg: 'rgba(16,23,40,0.96)',
  tooltipBorder: 'rgba(0,212,255,0.28)',
  areaUp: 'rgba(255,77,79,0.28)',
  areaDown: 'rgba(82,196,26,0.28)',
  areaPrimary: 'rgba(0,212,255,0.28)',

  // ── 毛玻璃（只用于顶部栏等少量元素；208 张卡片不要用，群晖内存有限）──
  glass: 'rgba(20,28,48,0.72)',
  glassBlur: 'blur(12px)',
}

/** antd ConfigProvider 的 theme 配置 */
export const antdTheme = {
  algorithm: 'dark',
  token: {
    colorPrimary: T.primary,
    colorInfo: T.primary,
    colorSuccess: T.success,
    colorError: T.danger,
    colorWarning: T.warn,
    colorBgBase: T.page,
    colorBgLayout: T.page,
    colorBgContainer: T.card,
    colorBgElevated: T.cardAlt,
    colorBorder: T.border,
    colorBorderSecondary: T.borderSoft,
    colorText: T.text,
    colorTextSecondary: T.textSub,
    colorTextTertiary: T.textDim,
    colorTextQuaternary: T.textDim,
    borderRadius: 8,
  },
  components: {
    Layout: { headerBg: T.cardAlt, siderBg: T.cardAlt, bodyBg: T.page },
    Card: { colorBgContainer: T.card },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: T.hover,
      itemSelectedColor: T.primary,
      itemHoverBg: T.subtle,
      itemColor: T.textSub,
    },
    Table: { headerBg: T.cardAlt, rowHoverBg: T.hover, borderColor: T.borderSoft },
    Modal: { contentBg: T.card, headerBg: T.card },
    Select: { optionSelectedBg: T.hover },
    Input: { colorBgContainer: T.subtle },
    Popconfirm: { colorBgElevated: T.cardAlt },
    Tooltip: { colorBgSpotlight: T.cardAlt, colorTextLightSolid: T.text },
    Drawer: { colorBgElevated: T.cardAlt },
    Empty: { colorTextDescription: T.textDim },
  },
}

/** 页面级全局样式（滚动条 / 选中态 / body 底色） */
export const globalCss = `
  html, body, #root { background: ${T.page}; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: ${T.deep}; }
  ::-webkit-scrollbar-thumb { background: rgba(0,212,255,0.22); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,212,255,0.38); }
  ::selection { background: rgba(0,212,255,0.3); }
  @keyframes ptPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: .35; transform: scale(.72); }
  }
  .pt-pulse { animation: ptPulse 1.5s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .pt-pulse { animation: none; } }
`
