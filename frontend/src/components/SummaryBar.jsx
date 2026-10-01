import React, { useMemo } from 'react'
import { analyzePrices } from '../utils/priceStatus'
import { T } from '../utils/theme'

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
    { key: 'total', label: '商品数量', value: stats.total, color: T.text },
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
            background: T.card,
            border: `1px solid ${T.borderSoft}`,
            borderLeft: `4px solid ${c.color}`,
            borderRadius: 6,
            boxShadow: 'none',
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 700, color: c.color, lineHeight: 1, minWidth: 34, textAlign: 'right' }}>
            {c.value}
          </span>
          <span style={{ fontSize: 13, color: T.textSub }}>{c.label}</span>
        </div>
      ))}
    </div>
  )
}
