// 商品走势状态判定（卡片迷你走势线与顶部汇总共用，保证口径一致）
// 规则（按“最近一次导入记录”）：
//   最近一次导入为 0/空价 → nodata 蓝；最近有效价较上一有效价 涨→up 红 / 跌→down 绿 / 持平→flat 橙
export const STATUS_COLOR = {
  up: '#ff4d4f',
  down: '#52c41a',
  flat: '#faad14',
  nodata: '#1677ff',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// 只认合法 ISO 日期，忽略误导入产生的畸形日期（如 “2026-标准-名称”）
export const validDate = (p) => !!p && ISO_DATE.test(p.date || '')

// 价格为 null/undefined/0 都视为“无报价”
export const hasQuote = (p) =>
  validDate(p) && p.price !== null && p.price !== undefined && Number(p.price) > 0

// 返回 { status, lineColor, change, latestPrice, latestDate }
export function analyzePrices(prices) {
  const all = (prices || []).filter(validDate).sort((a, b) => a.date.localeCompare(b.date))
  const valid = all.filter(hasQuote)
  if (valid.length === 0) {
    return { status: 'nodata', lineColor: STATUS_COLOR.nodata, change: 0, latestPrice: null, latestDate: '' }
  }

  const lastRecord = all[all.length - 1]     // 最近一次导入记录（可能无报价）
  const latest = valid[valid.length - 1]    // 最近一个有效价
  const prev = valid.length >= 2 ? valid[valid.length - 2] : null

  let status
  let change = 0
  if (!hasQuote(lastRecord)) {
    status = 'nodata'
  } else if (!prev) {
    status = 'flat'
  } else {
    change = latest.price - prev.price
    status = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  }

  const d = latest.date || ''
  const latestDate = d.length >= 10 ? `${parseInt(d.slice(5, 7), 10)}/${parseInt(d.slice(8, 10), 10)}` : d
  return { status, lineColor: STATUS_COLOR[status], change, latestPrice: latest.price, latestDate }
}

// 分段（股票式）颜色：每一段相对前一点 涨=红 跌=绿 横盘=橙；
// colors[i] 表示“从 i-1 到 i 这一段”的颜色；无行情时最后一段(末尾)强制为蓝。
export function segmentColors(values, isNodata) {
  const n = values.length
  if (!n) return []
  const c = new Array(n)
  for (let i = 0; i < n; i++) {
    if (i === 0) { c[i] = null; continue }
    const d = values[i] - values[i - 1]
    c[i] = d > 0 ? STATUS_COLOR.up : d < 0 ? STATUS_COLOR.down : STATUS_COLOR.flat
  }
  c[0] = n > 1 ? c[1] : STATUS_COLOR.flat
  if (isNodata) c[n - 1] = STATUS_COLOR.nodata
  return c
}

// 把相邻同色段合并成连续区间 [start,end,color]，相邻区间共享端点以保证线条不断
export function colorRuns(values, isNodata) {
  const colors = segmentColors(values, isNodata)
  const n = values.length
  const runs = []
  let start = 0
  for (let k = 1; k <= n; k++) {
    if (k === n || colors[k] !== colors[k - 1]) {
      const end = k - 1
      runs.push([start, end, colors[end]])
      start = end
    }
  }
  return runs
}

// 数字显示：整数不带小数，非整数保留 1 位
export function fmtNum(n) {
  const v = Number(n)
  return Number.isInteger(v) ? `${v}` : v.toFixed(1)
}
