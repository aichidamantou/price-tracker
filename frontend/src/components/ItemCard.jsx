import React, { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { Tooltip as AntTooltip } from 'antd'

// Register ECharts modules with SVG renderer
echarts.use([LineChart, GridComponent, TooltipComponent, VisualMapComponent, SVGRenderer])

function fmtDate(isoDate) {
  if (!isoDate || isoDate.length < 10) return isoDate
  const m = parseInt(isoDate.slice(5, 7), 10)
  const d = parseInt(isoDate.slice(8, 10), 10)
  return `${m}/${d}`
}

function getRecentPrices(prices, maxCount = 30) {
  const valid = (prices || []).filter(p => p.price !== null && p.price !== undefined)
  valid.sort((a, b) => a.date.localeCompare(b.date))
  return valid.slice(-maxCount)
}

export default function ItemCard({ item, brand, onClick }) {
  const recentPrices = useMemo(() => getRecentPrices(item.prices), [item.prices])

  // Latest price WITH actual value (use full history, find most recent valid)
  const { latestPrice, latestDate, priceChange, changeColor } = useMemo(() => {
    const allWithPrice = (item.prices || [])
      .filter(p => p.price !== null && p.price !== undefined)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (allWithPrice.length === 0) return { latestPrice: null, latestDate: '', priceChange: 0, changeColor: '#999' }

    const latest = allWithPrice[allWithPrice.length - 1]
    const prev = allWithPrice.length >= 2 ? allWithPrice[allWithPrice.length - 2] : null

    let change = 0
    if (prev) {
      change = latest.price - prev.price
    }
    const color = change > 0 ? '#ff4d4f' : change < 0 ? '#52c41a' : '#999'
    const d = latest.date || ''
    const dateLabel = d.length >= 10 ? `${parseInt(d.slice(5,7),10)}/${parseInt(d.slice(8,10),10)}` : d
    return { latestPrice: latest.price, latestDate: dateLabel, priceChange: change, changeColor: color }
  }, [item.prices])

  const option = useMemo(() => {
    if (recentPrices.length === 0) return null

    const dates = recentPrices.map(p => p.date)
    const values = recentPrices.map(p => p.price)
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)
    const range = maxVal - minVal || 1
    const pad = range * 0.15

    // Data with direction encoding (dimension 2)
    const dataWithDir = values.map((v, i) => {
      let dir = 0
      if (i > 0) {
        dir = v > values[i-1] ? 1 : (v < values[i-1] ? -1 : 0)
      }
      return [dates[i], v, dir]
    })

    return {
      grid: { left: 2, right: 2, top: 2, bottom: 2 },
      xAxis: {
        type: 'category',
        data: dates,
        show: false,
      },
      yAxis: {
        type: 'value',
        show: false,
        min: minVal - pad,
        max: maxVal + pad,
      },
      visualMap: {
        show: false,
        dimension: 2,
        pieces: [
          { value: -1, color: '#52c41a' },
          { value: 0,  color: '#d9d9d9' },
          { value: 1,  color: '#ff4d4f' },
        ],
        outOfRange: { color: '#d9d9d9' },
      },
      series: [{
        type: 'line',
        data: dataWithDir,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255,77,79,0.15)' },
              { offset: 0.5, color: 'rgba(217,217,217,0.08)' },
              { offset: 1, color: 'rgba(82,196,26,0.15)' },
            ],
          },
        },
      }],
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0]
          const label = fmtDate(p.name)
          // data is [date, value, dir] array — take second element for price
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
  }, [recentPrices])

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

        {/* Latest date + price + change indicator */}
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '0 4px 3px',
          color: changeColor,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          lineHeight: '14px',
        }}>
          {latestPrice !== null ? (
            <>{latestDate} ¥{latestPrice}</>
          ) : '—'}
          {priceChange !== 0 && (
            <span style={{ fontSize: 9 }}>
              {priceChange > 0 ? `↑${priceChange}` : `↓${Math.abs(priceChange)}`}
            </span>
          )}
        </div>
      </div>
    </AntTooltip>
  )
}
