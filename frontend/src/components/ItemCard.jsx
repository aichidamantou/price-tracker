import React, { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { Tooltip as AntTooltip } from 'antd'

// Register ECharts modules with SVG renderer
echarts.use([LineChart, GridComponent, TooltipComponent, SVGRenderer])

// 线条状态配色：涨=红 跌=绿 持平=黄 最近一次导入无报价(0/空)=蓝
const STATUS_COLOR = {
  up: '#ff4d4f',
  down: '#52c41a',
  flat: '#faad14',
  nodata: '#1677ff',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// 只认合法 ISO 日期，忽略误导入产生的畸形日期（如 “2026-标准-名称”）
const validDate = (p) => !!p && ISO_DATE.test(p.date || '')
// 价格为 null/undefined/0 都视为“无报价”，不参与绘图与比较
const hasQuote = (p) => validDate(p) && p.price !== null && p.price !== undefined && Number(p.price) > 0

function fmtDate(isoDate) {
  if (!isoDate || isoDate.length < 10) return isoDate
  const m = parseInt(isoDate.slice(5, 7), 10)
  const d = parseInt(isoDate.slice(8, 10), 10)
  return `${m}/${d}`
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

export default function ItemCard({ item, brand, onClick }) {
  // 只取历史上“有报价”的记录用于画线（按日期升序，最多近 30 条）
  const recentPrices = useMemo(() => {
    return (item.prices || [])
      .filter(hasQuote)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
  }, [item.prices])

  // 根据“最近一次导入记录”判定整条线的状态/颜色
  const { status, lineColor, latestPrice, latestDate, priceChange } = useMemo(() => {
    const all = (item.prices || []).filter(validDate).sort((a, b) => a.date.localeCompare(b.date))
    const valid = all.filter(hasQuote)
    if (valid.length === 0) {
      return { status: 'nodata', lineColor: STATUS_COLOR.nodata, latestPrice: null, latestDate: '', priceChange: 0 }
    }

    const lastRecord = all[all.length - 1]      // 最近一次导入记录（可能无报价）
    const latest = valid[valid.length - 1]     // 最近一个有效价
    const prev = valid.length >= 2 ? valid[valid.length - 2] : null

    let s
    let change = 0
    if (!hasQuote(lastRecord)) {
      s = 'nodata'                              // 最近一次导入为 0/空 → 蓝
    } else if (!prev) {
      s = 'flat'                                // 仅一个有效价、无可比项 → 黄
    } else {
      change = latest.price - prev.price
      s = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
    }

    const color = STATUS_COLOR[s]
    const d = latest.date || ''
    const dateLabel = d.length >= 10 ? `${parseInt(d.slice(5, 7), 10)}/${parseInt(d.slice(8, 10), 10)}` : d
    return { status: s, lineColor: color, latestPrice: latest.price, latestDate: dateLabel, priceChange: change }
  }, [item.prices])

  const option = useMemo(() => {
    if (recentPrices.length === 0) return null

    const dates = recentPrices.map(p => p.date)
    const values = recentPrices.map(p => p.price)
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)
    const range = maxVal - minVal || 1
    const pad = range * 0.15

    return {
      grid: { left: 2, right: 2, top: 2, bottom: 2 },
      xAxis: { type: 'category', data: dates, show: false },
      yAxis: { type: 'value', show: false, min: minVal - pad, max: maxVal + pad },
      series: [{
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5, color: lineColor },
        itemStyle: { color: lineColor },
        // 面积用与线条同色的纵向淡渐变
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: hexToRgba(lineColor, 0.18) },
              { offset: 1, color: hexToRgba(lineColor, 0.02) },
            ],
          },
        },
      }],
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0]
          const label = fmtDate(p.name)
          const val = Array.isArray(p.data) ? p.data[1] : p.value
          return `${label} <span style="color:#1677ff;font-weight:600">${val}</span>`
        },
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        padding: 0,
        extraCssText: 'box-shadow:none;border:none;background:transparent !important;font-size:11px;line-height:1.2',
        confine: true,
      },
    }
  }, [recentPrices, lineColor])

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

        {/* Mini sparkline */}
        {option ? (
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            style={{ height: 28, width: '100%' }}
            notMerge
            lazyUpdate
          />
        ) : (
          <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#999' }}>
            无数据
          </div>
        )}

        {/* Latest date + price + change indicator（颜色与线条状态一致） */}
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '0 4px 3px',
          color: lineColor,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          lineHeight: '14px',
        }}>
          {latestPrice !== null ? (
            <>{latestDate} ¥{latestPrice}</>
          ) : '—'}
          {/* 仅在确实发生涨跌时显示箭头；无报价/持平不显示 */}
          {priceChange !== 0 && (status === 'up' || status === 'down') && (
            <span style={{ fontSize: 9 }}>
              {priceChange > 0 ? `↑${priceChange}` : `↓${Math.abs(priceChange)}`}
            </span>
          )}
        </div>
      </div>
    </AntTooltip>
  )
}
