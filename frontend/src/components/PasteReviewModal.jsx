import React, { useState, useCallback, useRef } from 'react'
import { Modal, InputNumber, Button, Tag, Typography, message, DatePicker, Tooltip, Input, Select, Divider } from 'antd'
import { ThunderboltOutlined, CheckCircleOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { Text } = Typography
const { TextArea } = Input
const API_BASE = ''
const DEVIATION_THRESHOLD = 20

export default function PasteReviewModal({ open, onClose }) {
  const [text, setText] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [priceDate, setPriceDate] = useState(dayjs())
  const [engineResults, setEngineResults] = useState(null)
  const [dsResults, setDsResults] = useState(null)
  const [showDs, setShowDs] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [searchResults, setSearchResults] = useState({})
  const [searchLoading, setSearchLoading] = useState({})
  const [manualOverrides, setManualOverrides] = useState({})
  const searchTimer = useRef({})

  const handleParse = useCallback(async () => {
    if (!text.trim()) { message.warning('请粘贴文本'); return }
    setLoading(true); setDsResults(null); setShowDs(false); setManualOverrides({})
    try {
      const res = await fetch(`${API_BASE}/api/paste/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      setItems(data.items || [])
      setEngineResults(data.items || [])
    } catch (e) { message.error('解析失败: ' + e.message) }
    setLoading(false)
  }, [text])

  const handleDeepSeek = useCallback(async () => {
    if (!items.length) return; setShowDs(true)
    try {
      const res = await fetch(`${API_BASE}/api/paste/deepseek-compare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      setDsResults(data.items || []); message.success('AI 比对完成')
    } catch (e) { message.error('AI 比对失败: ' + e.message) }
  }, [items])

  const getEngine = (i) => engineResults?.find(e => e.input === i)
  const getDs = (i) => dsResults?.find(d => d.input === i)

  const getFinal = (i) => {
    const ov = manualOverrides[i]
    if (ov?.product_id) return ov
    const e = getEngine(i)
    if (e?.score >= 70 && e.matched_id) return { product_id: e.matched_id, product_name: e.matched_name }
    const d = getDs(i)
    if (d?.score >= 70 && d.matched_id) return { product_id: d.matched_id, product_name: d.matched_name }
    return null
  }

  const isMatched = (i) => !!getFinal(i)

  const getDev = (i, price) => {
    const e = getEngine(i)
    if (!e?.last_price || price == null) return null
    const diff = Math.abs(price - e.last_price)
    return diff >= DEVIATION_THRESHOLD
      ? { old: e.last_price, new: price, d: Math.round((price - e.last_price) * 10) / 10 }
      : null
  }

  const handleSearch = useCallback(async (name, q) => {
    if (!q || q.length < 1) { setSearchResults(p => ({ ...p, [name]: [] })); return }
    setSearchLoading(p => ({ ...p, [name]: true }))
    try {
      const r = await fetch(`${API_BASE}/api/products/search/${encodeURIComponent(q)}`)
      const d = await r.json(); setSearchResults(p => ({ ...p, [name]: d.results || [] }))
    } catch { setSearchResults(p => ({ ...p, [name]: [] })) }
    setSearchLoading(p => ({ ...p, [name]: false }))
  }, [])

  const debSearch = useCallback((name, q) => {
    if (searchTimer.current[name]) clearTimeout(searchTimer.current[name])
    searchTimer.current[name] = setTimeout(() => handleSearch(name, q), 300)
  }, [handleSearch])

  const handleMatch = useCallback((input, pid, pname) => {
    setManualOverrides(p => ({ ...p, [input]: { product_id: pid, product_name: pname } }))
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
    setEngineResults(prev => prev ? prev.filter(i => i.input !== input) : null)
    setManualOverrides(prev => {
      const n = { ...prev }; delete n[input]; return n
    })
  }, [])

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      const matchedItems = items.filter(i => isMatched(i.input))
      const unmatchedItems = items.filter(i => !isMatched(i.input))

      const toSave = matchedItems.map(item => {
        const fm = getFinal(item.input)
        return { matched_id: fm?.product_id || item.matched_id, price: item.price }
      }).filter(f => f.matched_id && f.price != null)

      if (toSave.length === 0) {
        message.warning('没有可保存的匹配项')
        setConfirming(false); return
      }

      const res = await fetch(`${API_BASE}/api/paste/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toSave, price_date: priceDate.format('YYYY-MM-DD') }),
      })
      const data = await res.json()
      if (data.status === 'ok') {
        message.success(`已保存 ${data.saved} 条`)
        // 保留未匹配项让用户继续处理
        if (unmatchedItems.length > 0) {
          setItems(unmatchedItems)
          setEngineResults(unmatchedItems)
          setManualOverrides({})
        } else {
          onClose(); setTimeout(() => window.location.reload(), 500)
        }
      }
    } catch (e) { message.error('保存失败: ' + e.message) }
    setConfirming(false)
  }

  const matchedList = items.filter(i => isMatched(i.input))
  const unmatchedList = items.filter(i => !isMatched(i.input))

  const renderRow = (item) => {
    const fm = getFinal(item.input)
    const dev = getDev(item.input, item.price)
    const eng = getEngine(item.input)
    const ds = getDs(item.input)
    const score = fm ? 100 : Math.max(eng?.score || 0, ds?.score || 0)

    return (
      <div key={item.input} style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%',
        padding: '6px 8px', marginBottom: 4, borderRadius: 4,
        background: fm ? '#f6ffed' : '#fff2f0', fontSize: 11,
      }}>
        <Text code style={{ fontSize: 10, width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {item.input}
        </Text>

        <Select size="small" showSearch value={fm?.product_name || undefined}
          placeholder="搜索…" notFoundContent={null} filterOption={false}
          onSearch={(q) => debSearch(item.input, q)}
          onChange={(val, opt) => handleMatch(item.input, opt?.key, val)}
          style={{ width: 150, flexShrink: 0 }}
          onFocus={() => handleSearch(item.input, fm?.product_name || '')}
          loading={searchLoading[item.input]}
          dropdownMatchSelectWidth={250}>
          {(searchResults[item.input] || []).map(p => (
            <Select.Option key={p.id} value={p.name}>
              {p.brand ? `[${p.brand}] ` : ''}{p.name}
            </Select.Option>
          ))}
        </Select>

        {showDs && (
          <Text style={{ fontSize: 10, width: 80, flexShrink: 0 }}>
            {ds?.matched_name ? (
              <>{ds.matched_name} <Tag color={ds.score >= 90 ? 'green' : 'orange'} style={{ fontSize: 8 }}>{ds.score}</Tag></>
            ) : '—'}
          </Text>
        )}

        <InputNumber size="small" value={item.price}
          onChange={(v) => handlePriceChange(item.input, v)}
          min={0} style={{ width: 64, flexShrink: 0 }}
          formatter={v => `¥${v}`} parser={v => v.replace(/[^0-9.]/g, '')} />

        <div style={{ width: 70, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {fm ? (
            <Tag color="blue" style={{ fontSize: 9, margin: 0 }}>
              {manualOverrides[item.input] ? '手动' : '匹配'}
            </Tag>
          ) : score >= 90 ? (
            <Tag color="green" style={{ fontSize: 9, margin: 0 }}>自动</Tag>
          ) : score >= 70 ? (
            <Tag color="orange" style={{ fontSize: 9, margin: 0 }}>待确认({score})</Tag>
          ) : (
            <Tag color="red" style={{ fontSize: 9, margin: 0 }}>未识别</Tag>
          )}
          {dev && <Tag color="warning" style={{ fontSize: 9, margin: 0 }}>
            {dev.d > 0 ? `↑${Math.abs(dev.d)}` : `↓${Math.abs(dev.d)}`}
          </Tag>}
        </div>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" danger icon={<DeleteOutlined />}
            onClick={() => handleDelete(item.input)}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
        </div>
      </div>
    )
  }

  return (
    <Modal title="📋 粘贴文本 — 商品匹配确认" open={open} onCancel={onClose}
      width={showDs ? 820 : 700} footer={null} destroyOnClose>

      {items.length === 0 && (
        <div style={{ marginBottom: 12 }}>
          <TextArea rows={8} value={text} onChange={e => setText(e.target.value)}
            placeholder="粘贴商品文本到这里…" />
          <Button type="primary" onClick={handleParse} loading={loading} style={{ marginTop: 8 }}>解析</Button>
        </div>
      )}

      {items.length > 0 && (
        <div>
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text strong style={{ fontSize: 12 }}>共 {items.length} 项</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              ✅ {matchedList.length} · ❌ {unmatchedList.length}
            </Text>
            <DatePicker value={priceDate} onChange={d => setPriceDate(d)} format="YYYY-MM-DD" size="small" style={{ width: 120 }} />
            {!showDs && (
              <Tooltip title="DeepSeek AI 二次比对">
                <Button size="small" icon={<ThunderboltOutlined />} onClick={handleDeepSeek}>AI 比对</Button>
              </Tooltip>
            )}
            {showDs && <Tag color="purple" style={{ fontSize: 9 }}>AI✓</Tag>}
            <span style={{ flex: 1 }} />
            <Button size="small" onClick={() => { setItems([]); setDsResults(null); setShowDs(false) }}>取消</Button>
            <Button size="small" onClick={handleParse} loading={loading} icon={<ReloadOutlined />}>重新解析</Button>
          </div>

          {/* Column headers — shared above all sections */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', fontSize: 12, color: '#555', fontWeight: 700, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>
            <div style={{ width: 100, flexShrink: 0 }}>OCR原文</div>
            <div style={{ width: 150, flexShrink: 0 }}>识别引擎</div>
            {showDs && <div style={{ width: 80, flexShrink: 0 }}>AI 比对</div>}
            <div style={{ width: 64, flexShrink: 0 }}>价格</div>
            <div style={{ width: 70, flexShrink: 0 }}>状态</div>
            <div style={{ flex: 1, minWidth: 30 }}></div>
          </div>

          {matchedList.length > 0 && (
            <div key={`matched-${items.length}-${matchedList.length}`}>
              <Divider orientation="left" plain style={{ fontSize: 11, margin: '4px 0' }}>
                ✅ 已识别 ({matchedList.length})
              </Divider>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {matchedList.map(renderRow)}
              </div>
            </div>
          )}

          {unmatchedList.length > 0 && (
            <div key={`unmatched-${items.length}-${unmatchedList.length}`}>
              <Divider orientation="left" plain style={{ fontSize: 11, margin: '4px 0' }}>
                ❌ 未识别 ({unmatchedList.length}) — 在识别引擎栏搜索选择
              </Divider>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {unmatchedList.map(renderRow)}
              </div>
            </div>
          )}

          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <Button type="primary" onClick={handleConfirm} loading={confirming} icon={<CheckCircleOutlined />}>
              确认保存（{priceDate.format('YYYY-MM-DD')}）
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
