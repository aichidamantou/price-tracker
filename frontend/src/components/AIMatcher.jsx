import React, { useState, useCallback, useRef } from 'react'
import { Typography, Button, Tag, message, Input, Select, Divider, DatePicker, InputNumber } from 'antd'
import { ThunderboltOutlined, CheckCircleOutlined, DeleteOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { Text } = Typography
const { TextArea } = Input
const API_BASE = ''

export default function AIMatcher() {
  const [text, setText] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [priceDate, setPriceDate] = useState(dayjs())
  const [lastPrices, setLastPrices] = useState({}) // input -> last_price
  const [searchResults, setSearchResults] = useState({})
  const searchTimer = useRef({})

  const handleMatch = useCallback(async () => {
    if (!text.trim()) { message.warning('请粘贴文本'); return }
    setLoading(true)
    try {
      // Step 1: Parse text to get names
      const preview = await fetch(`${API_BASE}/api/paste/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const previewData = await preview.json()
      const items = previewData.items || []

      if (items.length === 0) {
        message.warning('未解析出商品')
        setLoading(false); return
      }

      // Step 2: AI match with preferred aliases
      const res = await fetch(`${API_BASE}/api/paste/deepseek-compare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const d = await res.json()
      const dsItems = d.items || []

      // Step 3: Attach last_price info for deviation check
      const priceMap = {}
      for (const item of items) {
        if (item.last_price != null) {
          priceMap[item.input] = item.last_price
        }
      }
      setLastPrices(priceMap)

      if (dsItems.length > 0) {
        // 合并预览中的价格到 AI 结果
        const merged = dsItems.map(ds => {
          const preview = items.find(i => i.input === ds.input)
          return { ...ds, price: ds.price ?? preview?.price ?? null }
        })
        setResults(merged)
        message.success(`AI 匹配完成，${dsItems.length} 条`)
      } else {
        message.warning('AI 未返回结果')
      }
    } catch (e) { message.error('AI 匹配失败') }
    setLoading(false)
  }, [text])

  const handleSearch = useCallback(async (name, q) => {
    if (!q || q.length < 1) { setSearchResults(p => ({ ...p, [name]: [] })); return }
    try {
      const r = await fetch(`${API_BASE}/api/products/search/${encodeURIComponent(q)}`)
      const d = await r.json(); setSearchResults(p => ({ ...p, [name]: d.results || [] }))
    } catch { setSearchResults(p => ({ ...p, [name]: [] })) }
  }, [])

  const debSearch = useCallback((name, q) => {
    if (searchTimer.current[name]) clearTimeout(searchTimer.current[name])
    searchTimer.current[name] = setTimeout(() => handleSearch(name, q), 300)
  }, [handleSearch])

  const handleManual = useCallback((input, pid, pname) => {
    setResults(prev => prev.map(i => i.input === input ? { ...i, matched_name: pname, matched_id: pid, score: 100 } : i))
    fetch(`${API_BASE}/api/aliases/learn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, product_id: pid }),
    }).catch(() => {})
  }, [])

  const handleDelete = useCallback((input) => {
    setResults(prev => prev.filter(i => i.input !== input))
  }, [])

  const handleSaveAll = async () => {
    setConfirming(true)
    try {
      // Find matched_id by product name for DeepSeek results that only have matched_name
      const resolved = await Promise.all(results
        .filter(i => i.price != null)
        .map(async (i) => {
          let pid = i.matched_id
          if (!pid && i.matched_name) {
            // Search by name
            try {
              const r = await fetch(`${API_BASE}/api/products/search/${encodeURIComponent(i.matched_name)}`)
              const d = await r.json()
              if (d.results && d.results.length > 0) pid = d.results[0].id
            } catch {}
          }
          return { matched_id: pid || i.matched_id, price: i.price }
        }))
      const toSave = resolved.filter(f => f.matched_id && f.price != null)

      const res = await fetch(`${API_BASE}/api/paste/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toSave, price_date: priceDate.format('YYYY-MM-DD') }),
      })
      const d = await res.json()
      if (d.status === 'ok') {
        message.success(`已保存 ${d.saved} 条`)
        setResults([])
        setTimeout(() => window.location.reload(), 500)
      }
    } catch (e) { message.error('保存失败') }
    setConfirming(false)
  }

  const extraPrice = (input, currentPrice) => {
    const last = lastPrices[input]
    if (last == null || currentPrice == null) return null
    const diff = Math.abs(currentPrice - last)
    if (diff >= 20) return { last, current: currentPrice, d: Math.round((currentPrice - last) * 10) / 10 }
    return null
  }

  const matched = results.filter(i => i.score >= 70)
  const unknown = results.filter(i => i.score < 70 || !i.matched_name)

  // 价格修改
  const handlePriceChange = useCallback((input, val) => {
    setResults(prev => prev.map(i => i.input === input ? { ...i, price: val } : i))
  }, [])

  return (
    <div style={{ padding: 12 }}>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 15 }}>🤖 DeepSeek AI 匹配</Text>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          粘贴文本 → AI 按首选别名匹配 → 自动识别商品
        </div>
      </div>

      {results.length === 0 ? (
        <div>
          <div style={{ marginBottom: 8 }}>
            <DatePicker value={priceDate} onChange={d => setPriceDate(d)} format="YYYY-MM-DD" />
          </div>
          <TextArea rows={8} value={text} onChange={e => setText(e.target.value)}
            placeholder="粘贴商品文本，每行一个…" />
          <Button type="primary" onClick={handleMatch} loading={loading}
            icon={<ThunderboltOutlined />} style={{ marginTop: 8 }}>
            AI 匹配（{priceDate.format('YYYY-MM-DD')}）
          </Button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text strong>{results.length} 项</Text>
            <Text type="secondary">✅ {matched.length} · ✨ {unknown.length}</Text>
            <DatePicker value={priceDate} onChange={d => setPriceDate(d)} format="YYYY-MM-DD" size="small" style={{ width: 130 }} />
            <span style={{ flex: 1 }} />
            <Button size="small" onClick={() => { setResults([]); setLastPrices({}) }}>取消</Button>
            <Button size="small" onClick={handleMatch} loading={loading} icon={<ThunderboltOutlined />}>重新匹配</Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ width: 100 }}>原文</div>
            <div style={{ width: 140 }}>AI 匹配（首选别名）</div>
            <div style={{ width: 60 }}>价格</div>
            <div style={{ width: 80 }}>状态</div>
          </div>

          {matched.length > 0 && (
            <div key={`m-${results.length}`}>
            <Divider orientation="left" plain style={{ fontSize: 11, margin: '4px 0' }}>
              ✅ 已识别 ({matched.length})
            </Divider>
            {matched.map(item => {
              const dev = extraPrice(item.input, item.price)
              return (
                <div key={item.input} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', marginBottom: 4, borderRadius: 4,
                  background: '#f6ffed', fontSize: 11,
                }}>
                  <Text code style={{ fontSize: 10, width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{item.input}</Text>
                  <Select size="small" showSearch value={item.matched_name || undefined}
                    placeholder="搜索…" notFoundContent={null} filterOption={false}
                    onSearch={(q) => debSearch(item.input, q)}
                    onChange={(val, opt) => handleManual(item.input, opt?.key, val)}
                    style={{ width: 140, flexShrink: 0 }}
                    onFocus={() => handleSearch(item.input, item.matched_name || '')}
                    dropdownMatchSelectWidth={250}>
                    {(searchResults[item.input] || []).map(p => (
                      <Select.Option key={p.id} value={p.name}>{p.brand ? `[${p.brand}] ` : ''}{p.name}</Select.Option>
                    ))}
                  </Select>
                  <InputNumber size="small" value={item.price}
                    onChange={(v) => handlePriceChange(item.input, v)}
                    min={0} style={{ width: 64, flexShrink: 0 }}
                    formatter={v => `¥${v}`} parser={v => v.replace(/[^0-9.]/g, '')} />
                  <div style={{ width: 80, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Tag color={item.score >= 90 ? 'green' : 'orange'} style={{ fontSize: 9, margin: 0 }}>{item.score}</Tag>
                    {dev && <Tag color="warning" style={{ fontSize: 9, margin: 0 }} icon={<WarningOutlined />}>
                      {dev.d > 0 ? `↑${Math.abs(dev.d)}` : `↓${Math.abs(dev.d)}`}
                    </Tag>}
                  </div>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item.input)}
                    style={{ width: 26, height: 26 }} />
                </div>
              )
            })}</div>
          )}

          {unknown.length > 0 && (
            <div key={`u-${results.length}`}>
            <Divider orientation="left" plain style={{ fontSize: 11, margin: '4px 0' }}>
              ✨ 新品/未识别 ({unknown.length}) — 搜索选择标准名
            </Divider>
            {unknown.map(item => {
              const dev = extraPrice(item.input, item.price)
              return (
                <div key={item.input} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', marginBottom: 4, borderRadius: 4,
                  background: '#fffbe6', fontSize: 11,
                }}>
                  <Text code style={{ fontSize: 10, width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{item.input}</Text>
                  <Select size="small" showSearch value={item.matched_name || undefined}
                    placeholder="搜索…" notFoundContent={null} filterOption={false}
                    onSearch={(q) => debSearch(item.input, q)}
                    onChange={(val, opt) => handleManual(item.input, opt?.key, val)}
                    style={{ width: 140, flexShrink: 0 }}
                    onFocus={() => handleSearch(item.input, item.matched_name || '')}
                    dropdownMatchSelectWidth={250}>
                    {(searchResults[item.input] || []).map(p => (
                      <Select.Option key={p.id} value={p.name}>{p.brand ? `[${p.brand}] ` : ''}{p.name}</Select.Option>
                    ))}
                  </Select>
                  <InputNumber size="small" value={item.price}
                    onChange={(v) => handlePriceChange(item.input, v)}
                    min={0} style={{ width: 64, flexShrink: 0 }}
                    formatter={v => `¥${v}`} parser={v => v.replace(/[^0-9.]/g, '')} />
                  <div style={{ width: 80, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Tag color="gold" style={{ fontSize: 9, margin: 0 }}>新品</Tag>
                    {dev && <Tag color="warning" style={{ fontSize: 9, margin: 0 }} icon={<WarningOutlined />}>
                      {dev.d > 0 ? `↑${Math.abs(dev.d)}` : `↓${Math.abs(dev.d)}`}
                    </Tag>}
                  </div>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item.input)}
                    style={{ width: 26, height: 26 }} />
                </div>
              )
            })}</div>
          )}

          <div style={{ marginTop: 8 }}>
            <Button type="primary" onClick={handleSaveAll} loading={confirming} icon={<CheckCircleOutlined />}>
              保存到 {priceDate.format('YYYY-MM-DD')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
