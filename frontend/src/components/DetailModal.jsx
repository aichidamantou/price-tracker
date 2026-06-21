import React, { useMemo } from 'react'
import { Modal } from 'antd'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, VisualMapComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, VisualMapComponent, SVGRenderer])

export default function DetailModal({ item, brands, onClose }) {
  const fullData = useMemo(() => {
    if (!item) return null

    for (const brand of brands || []) {
      for (const it of brand.items || []) {
        if (it.name === item.name) {
          const valid = (it.prices || [])
            .filter(p => p.price !== null && p.price !== undefined)
            .sort((a, b) => a.date.localeCompare(b.date))

          // Calculate day-over-day change for each point
          const changeInfo = valid.map((p, i) => {
            let change = 0
            let direction = 0 // 0=flat, 1=up, -1=down
            if (i > 0) {
              const prev = valid[i - 1].price
              change = p.price - prev
              direction = change > 0 ? 1 : (change < 0 ? -1 : 0)
            }
            return { ...p, change, direction }
          })

          return {
            name: it.name,
            brand: brand.brand,
            prices: changeInfo,
            dates: changeInfo.map(p => p.date),
            values: changeInfo.map(p => p.price),
            changes: changeInfo.map(p => p.change),
            directions: changeInfo.map(p => p.direction),
          }
        }
      }
    }
    return null
  }, [item, brands])

  const option = useMemo(() => {
    if (!fullData || fullData.prices.length === 0) return null

    const values = fullData.values
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)
    const range = maxVal - minVal || 1
    const pad = range * 0.1

    // Data with direction dimension
    const dataWithDir = fullData.values.map((v, i) => {
      const dir = fullData.directions[i] || 0
      return [fullData.dates[i], v, dir]
    })

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0]
          const d = p.name || ''
          const label = d.length >= 10
            ? `${parseInt(d.slice(5,7),10)}/${parseInt(d.slice(8,10),10)}`
            : d
          // data is [date, value, dir] array — take second element for price
          const val = Array.isArray(p.data) ? p.data[1] : p.value
          let extra = ''
          if (fullData) {
            const idx = fullData.dates.indexOf(p.name)
            if (idx > 0) {
              const change = fullData.changes[idx]
              const arrow = change > 0 ? '↑' : (change < 0 ? '↓' : '→')
              const color = change > 0 ? '#ff4d4f' : (change < 0 ? '#52c41a' : '#999')
              extra = ` <span style="color:${color};font-size:10px">${arrow}${change !== 0 ? Math.abs(change) : ''}</span>`
            }
          }
          return `${label} <span style="color:#1677ff;font-weight:600">${val}</span>${extra}`
        },
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        padding: 0,
        extraCssText: 'box-shadow:none;border:none;background:transparent !important;font-size:11px;line-height:1.2',
        confine: true,
      },
      grid: { left: 60, right: 20, top: 20, bottom: 50 },
      xAxis: {
        type: 'category',
        data: fullData.dates,
        axisLabel: {
          rotate: 45,
          fontSize: 11,
        },
      },
      yAxis: {
        type: 'value',
        min: minVal - pad,
        max: maxVal + pad,
        axisLabel: {
          formatter: '¥{value}',
        },
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
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          start: 0,
          end: 100,
          height: 24,
          bottom: 10,
          borderColor: '#ddd',
          fillerColor: 'rgba(22,119,255,0.15)',
        },
      ],
      series: [{
        type: 'line',
        data: dataWithDir,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255,77,79,0.2)' },
              { offset: 0.5, color: 'rgba(217,217,217,0.05)' },
              { offset: 1, color: 'rgba(82,196,26,0.2)' },
            ],
          },
        },
        markLine: {
          silent: true,
          data: [
            { type: 'average', name: '均价' },
            { type: 'max', name: '最高' },
            { type: 'min', name: '最低' },
          ],
          lineStyle: { type: 'dashed', opacity: 0.5 },
          label: {
            formatter: '{b}: ¥{c}',
            fontSize: 10,
          },
        },
      }],
    }
  }, [fullData])

  // Aggregate stats
  const stats = useMemo(() => {
    if (!fullData || fullData.prices.length === 0) return null
    const vals = fullData.values
    const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(0)
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const last = vals[vals.length - 1]
    const prev = vals.length >= 2 ? vals[vals.length - 2] : null
    const changeText = prev !== null
      ? (last > prev ? `↑${last - prev}` : last < prev ? `↓${Math.abs(last - prev)}` : '→0')
      : ''
    const changeColor = prev !== null
      ? (last > prev ? '#ff4d4f' : last < prev ? '#52c41a' : '#999')
      : '#999'
    return { avg, max, min, last, prev, changeText, changeColor }
  }, [fullData])

  return (
    <Modal
      title={item ? `${item.name} — ${item.brand}` : '商品详情'}
      open={!!item}
      onCancel={onClose}
      footer={null}
      width={700}
      destroyOnClose
    >
      {fullData && fullData.prices.length > 0 ? (
        <>
          <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
            共 <strong>{fullData.prices.length}</strong> 个报价记录
            {stats && (
              <span>
                ，最新 <strong style={{ color: stats.changeColor }}>¥{stats.last}</strong>
                {stats.prev !== null && (
                  <span style={{ color: stats.changeColor, fontSize: 12, marginLeft: 4 }}>
                    {stats.changeText}
                  </span>
                )}
                ，最<span>高</span> ¥{stats.max}
                ，最<span>低</span> ¥{stats.min}
                ，均价 ¥{stats.avg}
              </span>
            )}
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            style={{ height: 380, width: '100%' }}
            notMerge
            lazyUpdate
          />
        </>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
          暂无报价数据
        </div>
      )}
    </Modal>
  )
}
