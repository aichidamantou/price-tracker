import React, { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { Tooltip as AntTooltip } from 'antd'
import { analyzePrices, hasQuote, colorRuns, fmtNum, STATUS_COLOR } from '../utils/priceStatus'
import { T } from '../utils/theme'

// 迷你图数量多且分段 series 多，用 Canvas 渲染更省 DOM、滚动更流畅
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

function fmtDate(isoDate) {
  if (!isoDate || isoDate.length < 10) return isoDate
  const m = parseInt(isoDate.slice(5, 7), 10)
  const d = parseInt(isoDate.slice(8, 10), 10)
  return `${m}/${d}`
}

export default function ItemCard({ item, brand, onClick, onCostClick }) {
  // 只取历史上“有报价”的记录用于画线（按日期升序，最多近 30 条，即卡片周期）
  const recentPrices = useMemo(() => {
    return (item.prices || [])
      .filter(hasQuote)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
  }, [item.prices])

  // 最近一次导入决定的整体状态（与顶部汇总口径一致）
  const { status, lineColor, latestPrice, latestDate } = useMemo(
    () => analyzePrices(item.prices),
    [item.prices]
  )

  // 卡片“周期内”涨跌：窗口首点 → 末点
  const period = useMemo(() => {
    if (recentPrices.length < 2) return null
    const first = recentPrices[0].price
    const last = recentPrices[recentPrices.length - 1].price
    const delta = last - first
    return { delta, pct: first ? (delta / first) * 100 : 0 }
  }, [recentPrices])

  const periodColor = !period
    ? STATUS_COLOR.flat
    : period.delta > 0 ? STATUS_COLOR.up : period.delta < 0 ? STATUS_COLOR.down : STATUS_COLOR.flat

  const option = useMemo(() => {
    if (recentPrices.length === 0) return null

    const dates = recentPrices.map(p => p.date)
    const values = recentPrices.map(p => p.price)
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)
    const range = maxVal - minVal || 1
    const pad = range * 0.15
    const nodata = status === 'nodata'

    // 股票式分段：相邻同色合并为一段，多 series 保证每段颜色准确
    const runs = colorRuns(values, nodata)
    const runSeries = runs.map(([a, b, color]) => ({
      type: 'line',
      z: 2,
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.6, color },
      itemStyle: { color },
      data: values.map((v, idx) => {
        if (idx < a || idx > b) return null
        // 无行情时在末尾点画一个蓝色小圆点
        if (idx === b && b === values.length - 1 && nodata) {
          return { value: v, symbol: 'circle', symbolSize: 3.5, itemStyle: { color, borderColor: T.card, borderWidth: 0.5 } }
        }
        return v
      }),
    }))

    return {
      animation: false,
      grid: { left: 2, right: 2, top: 2, bottom: 2 },
      xAxis: { type: 'category', data: dates, show: false },
      yAxis: { type: 'value', show: false, min: minVal - pad, max: maxVal + pad },
      series: runSeries,
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params]
          const idx = arr[0]?.dataIndex ?? 0
          return `${fmtDate(dates[idx])} <span style="color:${T.primary};font-weight:600">${values[idx]}</span>`
        },
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        padding: 0,
        extraCssText: 'box-shadow:none;border:none;background:transparent !important;font-size:11px;line-height:1.2',
        confine: true,
      },
    }
  }, [recentPrices, status])

  // 公司价（烟草公司进货价）与盈亏：最新售价 - 公司价
  // 盈利(>0) → 红；倒挂(<0，成本高于售价) → 绿；持平 → 橙。与全站涨红跌绿口径一致。
  const cost = item.cost !== null && item.cost !== undefined ? Number(item.cost) : null
  const profit = (cost !== null && latestPrice !== null) ? latestPrice - cost : null
  const profitColor = profit === null
    ? T.textDim
    : profit > 0 ? STATUS_COLOR.up : profit < 0 ? STATUS_COLOR.down : STATUS_COLOR.flat
  const profitText = profit === null
    ? ''
    : `${profit > 0 ? '+' : profit < 0 ? '-' : ''}${fmtNum(Math.abs(profit))}`

  const costLine = cost === null
    ? '公司价：暂缺 —— 点击卡片上的「暂缺数据」录入进货价与生效日期'
    : `公司价：¥${fmtNum(cost)}${item.cost_effective_from ? `（${item.cost_effective_from} 起）` : ''}`
      + (profit === null
        ? ''
        : profit > 0 ? ` · 盈利 ${profitText}`
          : profit < 0 ? ` · 倒挂 ${profitText}` : ' · 持平')
      + ' —— 点击可修改'

  return (
    <AntTooltip
      title={
        <div style={{ fontSize: 11, lineHeight: 1.6 }}>
          <div>{item.name} — {brand}{latestPrice !== null ? ` — ¥${latestPrice}` : ' — 暂无报价'}</div>
          <div>{costLine}</div>
        </div>
      }
    >
      <div
        onClick={onClick}
        style={{
          background: T.card,
          borderRadius: 6,
          border: `1px solid ${T.borderSoft}`,
          cursor: 'pointer',
          transition: 'all 0.2s',
          overflow: 'hidden',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = T.primary
          e.currentTarget.style.boxShadow = '0 0 0 1px rgba(0,212,255,0.35), 0 2px 10px rgba(0,212,255,0.18)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = T.borderSoft
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {/* 商品名 + 右侧公司价（倒挂绿 / 盈利红）
            flexWrap：短名并排一行；名字太长时公司价自动落到第二行，不牺牲商品名 */}
        <div style={{
          fontSize: 10,
          lineHeight: '14px',
          padding: '3px 4px 1px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0 3px',
          overflow: 'hidden',
        }}>
          <span style={{
            color: T.text,
            flex: '0 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {item.name}
          </span>

          {cost === null ? (
            <span
              onClick={(e) => { e.stopPropagation(); onCostClick && onCostClick(item) }}
              style={{
                flexShrink: 0, fontSize: 9, lineHeight: '13px', cursor: 'pointer',
                color: T.warnText, background: T.warnBg,
                border: `1px dashed ${T.warnBorder}`, borderRadius: 3, padding: '0 3px',
                whiteSpace: 'nowrap',
              }}
            >
              暂缺数据
            </span>
          ) : (
            <span
              onClick={(e) => { e.stopPropagation(); onCostClick && onCostClick(item) }}
              style={{
                flexShrink: 0, fontSize: 9, lineHeight: '13px', cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: T.textSub }}>（公司价</span>
              <span style={{ color: T.text, fontWeight: 600, marginLeft: 1 }}>{fmtNum(cost)}</span>
              {profit !== null && (
                <span style={{ color: profitColor, fontWeight: 600, marginLeft: 3 }}>{profitText}</span>
              )}
              <span style={{ color: T.textSub }}>）</span>
            </span>
          )}
        </div>

        {/* Mini sparkline（股票式分段多色） */}
        {option ? (
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            opts={{ renderer: 'canvas' }}
            style={{ height: 28, width: '100%' }}
            notMerge
            lazyUpdate
          />
        ) : (
          <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: T.textDim }}>
            无数据
          </div>
        )}

        {/* 左下：最近日期+价格（整体状态色）；右下：卡片周期内涨跌额+幅度 */}
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '0 4px 3px',
          color: lineColor,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 4,
          lineHeight: '14px',
        }}>
          <span style={{ whiteSpace: 'nowrap' }}>
            {latestPrice !== null ? <>{latestDate} ¥{latestPrice}</> : '—'}
          </span>
          {period && (
            <span style={{ color: periodColor, whiteSpace: 'nowrap', fontSize: 9.5 }}>
              {period.delta > 0 ? '↑' : period.delta < 0 ? '↓' : ''}
              {fmtNum(Math.abs(period.delta))}
              <span style={{ opacity: 0.75 }}> {period.pct >= 0 ? '+' : ''}{period.pct.toFixed(1)}%</span>
            </span>
          )}
        </div>
      </div>
    </AntTooltip>
  )
}
