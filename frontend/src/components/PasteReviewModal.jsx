import React, { useState, useCallback, useRef } from 'react'
import { Modal, InputNumber, Button, Tag, Typography, message, DatePicker, Input, Select, Divider } from 'antd'
import { CheckCircleOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { Text } = Typography
const { TextArea } = Input
const API_BASE = ''

export default function PasteReviewModal({ open, onClose }) {
  const [text, setText] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [priceDate, setPriceDate] = useState(dayjs())
  const [confirming, setConfirming] = useState(false)
  const [searchResults, setSearchResults] = useState({})
  const searchTimer = useRef({})

  const handleParse = useCallback(async () => {
    if (!text.trim()) { message.warning('请粘贴文本'); return }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/paste/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const d = await res.json()
      setItems(d.items || [])
    } catch (e) { message.error('解析失败') }
    setLoading(false)
  }, [text])

  const getEngine = (i) => items.find(e => e.input === i)

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

  const handleMatch = useCallback((input, pid, pname) => {
    setItems(prev => prev.map(i => i.input === input ? { ...i, matched_id: pid, matched_name: pname, score: 100 } : i))
    fetch(`${API_BASE}/api/aliases/learn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, product_id: pid }),
    }).catch(() => {})
  }, [])

  const handlePriceChange = useCallback((input, val) => {
    setItems(prev => prev.map(i => i.input === input ? { ...i, price: val } : i))
  }, [])

  const handleDelete = useCallback((input) => {
    setItems(prev => prev.filter(i => i.input !== input))
  }, [])

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      const matched = items.filter(i => i.score >= 70)
      const toSave = matched.map(i => ({ matched_id: i.matched_id, price: i.price })).filter(f => f.matched_id && f.price != null)
      const leftover = items.filter(i => i.score < 70)
      const res = await fetch(`${API_BASE}/api/paste/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toSave, price_date: priceDate.format('YYYY-MM-DD') }),
      })
      const d = await res.json()
      if (d.status === 'ok') {
        if (d.saved > 0) message.success(`已保存 ${d.saved} 条`)
        if (leftover.length > 0) { setItems(leftover) }
        else { onClose(); setTimeout(() => window.location.reload(), 500) }
      }
    } catch (e) { message.error('保存失败') }
    setConfirming(false)
  }

  const matchedList = items.filter(i => i.score >= 70)
  const unmatchedList = items.filter(i => i.score < 70)

  const renderSelect = (item, matchedName) => (
    <Select size="small" showSearch value={matchedName || undefined}
      placeholder="搜索…" notFoundContent={null} filterOption={false}
      onSearch={(q) => debSearch(item.input, q)}
      onChange={(val, opt) => handleMatch(item.input, opt?.key, val)}
      style={{ width: 130, flexShrink: 0 }}
      onFocus={() => handleSearch(item.input, matchedName || '')}
      dropdownMatchSelectWidth={250}>
      {(searchResults[item.input] || []).map(p => (
        <Select.Option key={p.id} value={p.name}>
          {p.brand ? `[${p.brand}] ` : ''}{p.name}
        </Select.Option>
      ))}
    </Select>
  )

  const renderRow = (item) => {
    const eng = getEngine(item.input)
    const ok = item.score >= 70
    return (
      <div key={item.input} style={{
        display: 'flex', alignItems: 'center', gap: 4, width: '100%',
        padding: '6px 8px', marginBottom: 4, borderRadius: 4,
        background: ok ? '#f6ffed' : '#fff2f0', fontSize: 11,
      }}>
        <Text code style={{ fontSize: 10, width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{item.input}</Text>
        {renderSelect(item, eng?.matched_name)}
        <InputNumber size="small" value={item.price} onChange={(v) => handlePriceChange(item.input, v)}
          min={0} style={{ width: 60, flexShrink: 0 }}
          formatter={v => `¥${v}`} parser={v => v.replace(/[^0-9.]/g, '')} />
        <div style={{ width: 50, flexShrink: 0 }}>
          {ok ? <Tag color="green" style={{ fontSize: 9, margin: 0 }}>匹配</Tag> : <Tag color="red" style={{ fontSize: 9, margin: 0 }}>×</Tag>}
        </div>
        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item.input)}
          style={{ flexShrink: 0, width: 26, height: 26 }} />
      </div>
    )
  }

  return (
    <Modal title="📋 粘贴文本" open={open} onCancel={onClose}
      width={620} footer={null} destroyOnClose>
      {items.length === 0 ? (
        <div>
          <TextArea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="粘贴商品文本到这里…" />
          <Button type="primary" onClick={handleParse} loading={loading} style={{ marginTop: 8 }}>解析</Button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text strong>{items.length} 项</Text>
            <Text type="secondary">✅ {matchedList.length} · ❌ {unmatchedList.length}</Text>
            <DatePicker value={priceDate} onChange={d => setPriceDate(d)} format="YYYY-MM-DD" size="small" style={{ width: 120 }} />
            <span style={{ flex: 1 }} />
            <Button size="small" onClick={() => setText('')}>取消</Button>
            <Button size="small" onClick={handleParse} loading={loading} icon={<ReloadOutlined />}>重新解析</Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ width: 90 }}>OCR原文</div>
            <div style={{ width: 130 }}>匹配引擎</div>
            <div style={{ width: 60 }}>价格</div>
            <div style={{ width: 50 }}>状态</div>
          </div>
          {matchedList.length > 0 && (
            <><Divider orientation="left" plain style={{ fontSize: 11, margin: '4px 0' }}>✅ 已识别 ({matchedList.length})</Divider>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>{matchedList.map(renderRow)}</div></>
          )}
          {unmatchedList.length > 0 && (
            <><Divider orientation="left" plain style={{ fontSize: 11, margin: '4px 0' }}>❌ 未识别 ({unmatchedList.length})</Divider>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>{unmatchedList.map(renderRow)}</div></>
          )}
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <Button type="primary" onClick={handleConfirm} loading={confirming} icon={<CheckCircleOutlined />}>确认保存（{priceDate.format('YYYY-MM-DD')}）</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
