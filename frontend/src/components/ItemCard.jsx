import React, { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { Tooltip as AntTooltip } from 'antd'
import { analyzePrices, hasQuote, colorRuns, fmtNum, STATUS_COLOR } from '../utils/priceStatus'

// 迷你图数量多且分段 series 多，用 Canvas 渲染更省 DOM、滚动更流畅
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

function fmtDate(isoDate) {
  if (!isoDate || isoDate.length < 10) return isoDate
  const m = parseInt(isoDate.slice(5, 7), 10)
  const d = parseInt(isoDate.slice(8, 10), 10)
  return `${m}/${d}`
}

export default function ItemCard({ item, brand, onClick }) {
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
          return { value: v, symbol: 'circle', symbolSize: 3.5, itemStyle: { color, borderColor: '#fff', borderWidth: 0.5 } }
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
          return `${fmtDate(dates[idx])} <span style="color:#1677ff;font-weight:600">${values[idx]}</span>`
        },
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        padding: 0,
        extraCssText: 'box-shadow:none;border:none;background:transparent !important;font-size:11px;line-height:1.2',
        confine: true,
      },
    }
  }, [recentPrices, status])

  return (
    <AntTooltip title={`${item.name} — ${brand}${latestPrice !== null ? ` — ¥${latestPrice}` : ' — 暂无报价'}`}>
      <div
        onClick={onClick}
        style={{
          background: '#fafafa',
          borderRadius: 6,
          border: '1px solid #f0f0f0',
          cursor: 'pointer',
          transition: 'all 0.2s',
          overflow: 'hidden',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = '#1677ff'
          e.currentTarget.style.boxShadow = '0 1px 4px rgba(22,119,255,0.2)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = '#f0f0f0'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {/* Product name */}
        <div style={{
          fontSize: 10,
          lineHeight: '14px',
          padding: '3px 4px 1px',
          color: '#333',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.name}
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
          <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#999' }}>
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
