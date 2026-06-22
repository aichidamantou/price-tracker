import React, { useState, useCallback, useRef } from 'react'
import { Button, Tag, message, Input, DatePicker, Typography } from 'antd'
import { CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { Text } = Typography
const API_BASE = ''

/**
 * 数据导入模块 — 共享的审核/修正/保存组件
 *
 * 接收 matched 结果数组，每条格式：
 * { _rid, input, matched_name, matched_id, brand, price, last_price, score, source, isNew, manual }
 *
 * props:
 *   items – 匹配结果数组
 *   onRefresh – 重新匹配回调
 *   onCancel – 取消回调
 *   title – 弹窗标题前缀
 */
export default function ReviewPanel({ items, onRefresh, onCancel, title, initialDate }) {
  const [results, setResults] = useState(items)
  const [priceDate, setPriceDate] = useState(initialDate || dayjs())
  const [confirming, setConfirming] = useState(false)
  const [customNames, setCustomNames] = useState({})
  const [brandSearch, setBrandSearch] = useState({})
  const [prodSearch, setProdSearch] = useState({})
  const [lastPrices, setLastPrices] = useState({})
  const bTimer = useRef({})
  const pTimer = useRef({})

  // 从 items 提取 last_price
  React.useEffect(() => {
    setResults(items)
    const lp = {}
    for (const item of items) {
      if (item.last_price != null) lp[item.input] = item.last_price
      // 添加唯一行号
      item._rid = item._rid ?? Math.random().toString(36).slice(2, 8)
    }
    setLastPrices(lp)
  }, [items])

  // 品牌搜索
  const brSearch = useCallback((input, q) => {
    if (!q) { setBrandSearch(p => ({ ...p, [input]: [] })); return }
    fetch(`${API_BASE}/api/products/search/${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => setBrandSearch(p => ({ ...p, [input]: [...new Set((d.results||[]).map(i=>i.brand).filter(Boolean))] })))
      .catch(() => {})
  }, [])

  // 商品搜索
  const pdSearch = useCallback((input, q) => {
    if (!q) { setProdSearch(p => ({ ...p, [input]: [] })); return }
    fetch(`${API_BASE}/api/products/search/${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => setProdSearch(p => ({ ...p, [input]: d.results||[] })))
      .catch(() => {})
  }, [])

  const debB = useCallback((i, q) => { clearTimeout(bTimer.current[i]); bTimer.current[i] = setTimeout(() => brSearch(i, q), 300) }, [brSearch])
  const debP = useCallback((i, q) => { clearTimeout(pTimer.current[i]); pTimer.current[i] = setTimeout(() => pdSearch(i, q), 300) }, [pdSearch])

  const handleBrandSel = useCallback((rid, brand) => {
    setResults(prev => prev.map(i => i._rid === rid ? { ...i, brand, matched_name: '', matched_id: null, manual: false } : i))
  }, [])

  const handleProdSel = useCallback((rid, pid, pname, brand) => {
    setResults(prev => prev.map(i => i._rid === rid ? { ...i, matched_id: pid, matched_name: pname, brand: brand || i.brand, score: 100, manual: true } : i))
    fetch(`${API_BASE}/api/aliases/learn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: i => i._rid === rid ? i.input : '', product_id: pid }),
    }).catch(() => {})
  }, [])

  const handleCustomName = useCallback((rid, name) => {
    setCustomNames(p => ({ ...p, [rid]: name }))
    if (name.trim()) {
      setResults(prev => prev.map(i => i._rid === rid ? { ...i, matched_name: name.trim(), matched_id: null, score: 100, manual: true, isNew: true } : i))
    }
  }, [])

  const handleDelete = useCallback((rid) => {
    setResults(prev => prev.filter(i => i._rid !== rid))
    setCustomNames(prev => { const n = {...prev}; delete n[rid]; return n })
    setBrandSearch(prev => { const n = {...prev}; delete n[rid]; return n })
    setProdSearch(prev => { const n = {...prev}; delete n[rid]; return n })
  }, [])

  const handleSave = async () => {
    setConfirming(true)
    try {
      // 新品也发送：matched_name + brand 用于自动创建
      const toSave = results.filter(i => i.price != null).map(i => ({
        matched_id: i.matched_id,
        matched_name: i.matched_name || '',
        brand: i.brand || '',
        price: i.price,
      }))
      const r = await fetch(`${API_BASE}/api/paste/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toSave, price_date: priceDate.format('YYYY-MM-DD') }),
      })
      const d = await r.json()
      if (d.status === 'ok') { message.success(`已保存 ${d.saved} 条`); onCancel(); setTimeout(() => window.location.reload(), 500) }
    } catch (e) { message.error('保存失败') }
    setConfirming(false)
  }

  const matchedCount = results.filter(i => i.score >= 70 && i.matched_name).length
  const unmatchedCount = results.length - matchedCount

  return (
    <div>
      <div style={{ marginBottom: 6, display:'flex', alignItems:'center', gap:6 }}>
        <Text strong>{results.length} 项</Text>
        <Text type="secondary">✅ {matchedCount} · ❌ {unmatchedCount}</Text>
        <DatePicker value={priceDate} onChange={d => setPriceDate(d)} format="YYYY-MM-DD" size="small" style={{ width:130 }} />
        <span style={{ flex:1 }} />
        {onCancel && <Button size="small" onClick={onCancel}>关闭</Button>}
        {onRefresh && <Button size="small" onClick={onRefresh}>重新匹配</Button>}
      </div>

      <div style={{ display:'flex', gap:6, padding:'6px 8px', fontSize:12, fontWeight:700, borderBottom:'1px solid #f0f0f0' }}>
        <div style={{ width:95 }}>原文</div>
        <div style={{ width:150 }}>品牌</div>
        <div style={{ width:210 }}>商品名</div>
        <div style={{ width:65 }}>价格</div>
        <div style={{ width:100 }}>状态</div>
      </div>

      <div style={{ maxHeight:400, overflowY:'auto' }}>
        {results.map(item => {
          const fixed = item.manual || (item.score >= 70 && item.matched_name)
          return (
            <div key={item._rid} style={{
              display:'flex', alignItems:'center', gap:6, padding:'6px 8px', marginBottom:3, borderRadius:4,
              background: fixed ? '#f6ffed' : '#fffbe6', fontSize:11,
            }}>
              <Text code style={{ fontSize:11, width:95, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:0 }}>{item.input}</Text>

              {/* Input 品牌 */}
              <div style={{width:150, flexShrink:0, position:'relative'}}>
                <Input size="small" placeholder="品牌"
                  value={item.brand || ''}
                  onChange={e => {
                    const v = e.target.value
                    handleBrandSel(item._rid, v)
                    if (v) brSearch(item._rid, v)
                  }}
                />
                {brandSearch[item._rid]?.length > 0 && (
                  <div style={{position:'absolute', top:'100%', left:0, right:0, zIndex:10, background:'#fff', border:'1px solid #d9d9d9', borderRadius:4, maxHeight:150, overflowY:'auto', boxShadow:'0 2px 8px rgba(0,0,0,0.1)'}}>
                    {brandSearch[item._rid].map(b => (
                      <div key={b} onClick={() => handleBrandSel(item._rid, b)} style={{padding:'4px 8px', cursor:'pointer', fontSize:11}}
                        onMouseEnter={e => e.target.style.background='#f0f5ff'}
                        onMouseLeave={e => e.target.style.background='transparent'}>{b}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Input 商品名 */}
              <div style={{width:210, flexShrink:0, position:'relative'}}>
                <Input size="small" placeholder={item.brand ? "搜索或输入商品名" : "先选品牌"}
                  disabled={!item.brand}
                  value={item.matched_name || customNames[item._rid] || ''}
                  onChange={e => {
                    const v = e.target.value
                    setCustomNames(p => ({...p, [item._rid]: v}))
                    debP(item._rid, v)
                  }}
                  onPressEnter={e => {
                    const v = e.target.value.trim()
                    if (v) {
                      setResults(prev => prev.map(i => i._rid === item._rid ? {...i, matched_name: v, matched_id: null, score: 100, manual: true, isNew: true} : i))
                      message.success(`已设定新品: ${v}`)
                    }
                  }}
                  suffix={item.matched_name && !item.matched_id ? <Tag color="purple" style={{fontSize:9, lineHeight:'16px', margin:0}}>新品</Tag>
                    : item.matched_id ? <Tag color="blue" style={{fontSize:9, lineHeight:'16px', margin:0}}>已匹配</Tag> : null}
                />
                {prodSearch[item._rid]?.length > 0 && !item.matched_id && (
                  <div style={{position:'absolute', top:'100%', left:0, right:0, zIndex:10, background:'#fff', border:'1px solid #d9d9d9', borderRadius:4, maxHeight:150, overflowY:'auto', boxShadow:'0 2px 8px rgba(0,0,0,0.1)'}}>
                    {prodSearch[item._rid].map(p => (
                      <div key={p.id} onClick={() => handleProdSel(item._rid, p.id, p.name, item.brand)}
                        style={{padding:'4px 8px', cursor:'pointer', fontSize:11, borderBottom:'1px solid #f5f5f5'}}
                        onMouseEnter={e => e.target.style.background='#f0f5ff'}
                        onMouseLeave={e => e.target.style.background='transparent'}>
                        {p.brand ? `[${p.brand}] ` : ''}{p.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 价格 */}
              <Input size="small" value={item.price != null ? item.price : ''} placeholder="¥"
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  setResults(prev => prev.map(i => i._rid === item._rid ? {...i, price: isNaN(v) ? null : v} : i))
                }}
                onPressEnter={e => e.target.blur()}
                style={{width:65, flexShrink:0, fontSize:11}}
              />

              {/* 状态 */}
              <div style={{width:100, flexShrink:0, display:'flex', flexDirection:'column', gap:1}}>
                {item.isNew ? <Tag color="purple" style={{fontSize:9,margin:0}}>新品</Tag>
                  : item.manual ? <Tag color="blue" style={{fontSize:9,margin:0}}>已修正</Tag>
                  : item.score >= 70 && item.matched_name ? <Tag color="green" style={{fontSize:9,margin:0}}>自动</Tag>
                  : <Tag color="gold" style={{fontSize:9,margin:0}}>待定</Tag>}
                {(() => {
                  const last = lastPrices[item.input]
                  const cur = item.price
                  if (last != null && cur != null && Math.abs(cur - last) >= 20) {
                    const d = Math.round((cur - last) * 10) / 10
                    return <Tag color="warning" style={{fontSize:8,margin:0,lineHeight:'16px'}}>{d > 0 ? `↑${Math.abs(d)}` : `↓${Math.abs(d)}`} 核对</Tag>
                  }
                  return null
                })()}
              </div>

              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item._rid)} style={{width:26,height:26}} />
            </div>
          )
        })}
      </div>

      <div style={{ marginTop:8 }}>
        <Button type="primary" onClick={handleSave} loading={confirming} icon={<CheckCircleOutlined />}>
          保存到 {priceDate.format('YYYY-MM-DD')}
        </Button>
      </div>
    </div>
  )
}
