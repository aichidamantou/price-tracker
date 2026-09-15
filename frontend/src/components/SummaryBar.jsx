import React, { useMemo } from 'react'
import { analyzePrices } from '../utils/priceStatus'

// 页面顶部汇总：商品总数 + 跌价(绿)/涨价(红)/平稳价(橙)/无行情(蓝)
export default function SummaryBar({ brands }) {
  const stats = useMemo(() => {
    const s = { total: 0, up: 0, down: 0, flat: 0, nodata: 0 }
    for (const brand of brands || []) {
      for (const item of brand.items || []) {
        s.total += 1
        s[analyzePrices(item.prices).status] += 1
      }
    }
    return s
  }, [brands])

  const cells = [
    { key: 'total', label: '商品数量', value: stats.total, color: '#1f1f1f' },
    { key: 'down', label: '跌价', value: stats.down, color: '#52c41a' },
    { key: 'up', label: '涨价', value: stats.up, color: '#ff4d4f' },
    { key: 'flat', label: '平稳价', value: stats.flat, color: '#faad14' },
    { key: 'nodata', label: '无行情', value: stats.nodata, color: '#1677ff' },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
      }}
    >
      {cells.map(c => (
        <div
          key={c.key}
          style={{
            flex: '1 1 120px',
            minWidth: 110,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderLeft: `4px solid ${c.color}`,
            borderRadius: 6,
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 700, color: c.color, lineHeight: 1, minWidth: 34, textAlign: 'right' }}>
            {c.value}
          </span>
          <span style={{ fontSize: 13, color: '#666' }}>{c.label}</span>
        </div>
      ))}
    </div>
  )
}
