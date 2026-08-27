import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Typography, Spin, Input, Button, Tag, message, Tooltip, Card, Popconfirm, Empty } from 'antd'
import { EditOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined, UpOutlined, DownOutlined, LeftOutlined, RightOutlined, HolderOutlined } from '@ant-design/icons'

const { Text, Title } = Typography
const API_BASE = ''
const MAX_ALIASES_SHOW = 3

export default function AliasManager() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingProduct, setEditingProduct] = useState(null)
  const [editingAlias, setEditingAlias] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [newAliasValues, setNewAliasValues] = useState({})
  const dragBrandIdxRef = useRef(null)
  const dragProdInfoRef = useRef(null)
  const aliasDragRef = useRef(null)
  const [dragOverBrandIdx, setDragOverBrandIdx] = useState(null)
  const [dragOverProdKey, setDragOverProdKey] = useState(null)

  const fetchAliases = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/aliases/manage`)
      const data = await res.json()
      setProducts(data.products || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAliases() }, [])

  const brandGroups = useCallback(() => {
    const groups = []; let lastBrand = null
    for (const prod of products) {
      const brand = prod.brand || '未分类'
      if (brand !== lastBrand) { groups.push({ brand, products: [prod] }); lastBrand = brand }
      else { groups[groups.length - 1].products.push(prod) }
    }
    return groups
  }, [products])()

  const startEditProduct = (prod) => { setEditingProduct(prod.product_id); setEditValue(prod.name); setEditingAlias(null) }
  const saveProductName = async (productId) => {
    if (!editValue.trim()) return
    try {
      const res = await fetch(`${API_BASE}/api/aliases/edit-product`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: productId, name: editValue.trim() }) })
      const data = await res.json()
      if (data.status === 'ok') { message.success('已更新'); setEditingProduct(null); fetchAliases() } else message.error(data.error || '失败')
    } catch (e) { message.error('失败') }
  }
  const startEditAlias = (alias) => { setEditingAlias(alias.id); setEditValue(alias.alias); setEditingProduct(null) }
  const saveAlias = async (aliasId) => {
    if (!editValue.trim()) return
    try {
      const res = await fetch(`${API_BASE}/api/aliases/edit-alias`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias_id: aliasId, alias: editValue.trim() }) })
      const data = await res.json()
      if (data.status === 'ok') { message.success('已更新'); setEditingAlias(null); fetchAliases() } else message.error(data.error || '失败')
    } catch (e) { message.error('失败') }
  }
  const addAlias = async (productId) => {
    const t = (newAliasValues[productId] || '').trim(); if (!t) return
    try {
      const res = await fetch(`${API_BASE}/api/aliases/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: productId, alias: t }) })
      const data = await res.json()
      if (data.status === 'ok') { message.success('别名已添加'); setNewAliasValues(prev => ({ ...prev, [productId]: '' })); fetchAliases() } else message.error(data.error || '失败')
    } catch (e) { message.error('失败') }
  }
  const deleteAlias = async (aliasId) => {
    try { await fetch(`${API_BASE}/api/aliases/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias_id: aliasId }) }); message.success('已删除'); fetchAliases() } catch (e) { message.error('失败') }
  }
  const deleteProduct = async (productId) => {
    try { const res = await fetch(`${API_BASE}/api/products/${productId}`, { method: 'DELETE' }); const data = await res.json(); if (data.status === 'ok') { message.success('已删除'); fetchAliases() } else message.error(data.error || '失败') } catch (e) { message.error('失败') }
  }

  // ── 移动排序 ──
  const moveBrand = async (brandIdx, dir) => {
    const t = brandIdx + dir; if (t < 0 || t >= brandGroups.length) return
    const o = [...brandGroups]; const tmp = o[brandIdx]; o[brandIdx] = o[t]; o[t] = tmp
    try { await fetch(`${API_BASE}/api/aliases/reorder-brands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brands: o.map(g => g.brand) }) }); message.success('地区排序已更新'); fetchAliases() } catch (e) { message.error('失败') }
  }
  const moveProduct = async (brand, idx, dir) => {
    const g = brandGroups.find(g => g.brand === brand); if (!g) return
    const t = idx + dir; if (t < 0 || t >= g.products.length) return
    const p = [...g.products]; const tmp = p[idx]; p[idx] = p[t]; p[t] = tmp
    try { await fetch(`${API_BASE}/api/aliases/reorder-products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand, product_ids: p.map(x => x.product_id) }) }); message.success('商品排序已更新'); fetchAliases() } catch (e) { message.error('失败') }
  }
  const moveAlias = async (productId, aliasId, dir) => {
    const prod = products.find(p => p.product_id === productId); if (!prod) return
    const i = prod.aliases.findIndex(a => a.id === aliasId); const t = i + dir
    if (i === -1 || t < 0 || t >= prod.aliases.length) return
    const ids = prod.aliases.map(a => a.id); const tmp = ids[i]; ids[i] = ids[t]; ids[t] = tmp
    try { await fetch(`${API_BASE}/api/aliases/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: productId, alias_ids: ids }) }); fetchAliases() } catch (e) { message.error('失败') }
  }

  // ── 拖拽 ──
  const bds = (e, i) => { e.stopPropagation(); dragBrandIdxRef.current = i }
  const bdo = (e, i) => { e.preventDefault(); e.stopPropagation(); if (dragBrandIdxRef.current !== null && dragBrandIdxRef.current !== i) setDragOverBrandIdx(i) }
  const bdd = (e, t) => { e.stopPropagation(); const s = dragBrandIdxRef.current; if (s === null || s === t) { dragBrandIdxRef.current = null; setDragOverBrandIdx(null); return }; moveBrand(s, t - s); dragBrandIdxRef.current = null; setDragOverBrandIdx(null) }
  const pds = (e, b, i) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; dragProdInfoRef.current = { brand: b, idx: i } }
  const pdo = (e, b, i) => { e.preventDefault(); e.stopPropagation(); const d = dragProdInfoRef.current; if (d && d.brand === b && d.idx !== i) setDragOverProdKey(`${b}:${i}`) }
  const pdd = (e, b, t) => { e.stopPropagation(); const d = dragProdInfoRef.current; if (!d || d.brand !== b || d.idx === t) { dragProdInfoRef.current = null; setDragOverProdKey(null); return }; moveProduct(b, d.idx, t - d.idx); dragProdInfoRef.current = null; setDragOverProdKey(null) }
  const ads = (e, pid, aid) => { e.stopPropagation(); aliasDragRef.current = { productId: pid, aliasId: aid } }
  const add2 = (e, pid, tid) => { e.stopPropagation(); const d = aliasDragRef.current; if (!d || d.productId !== pid) return; const p = products.find(x => x.product_id === pid); if (!p) return; const i = p.aliases.findIndex(a => a.id === d.aliasId); const t = p.aliases.findIndex(a => a.id === tid); if (i === -1 || t === -1 || i === t) { aliasDragRef.current = null; return }; moveAlias(pid, d.aliasId, t - i); aliasDragRef.current = null }
  const dend = () => { dragBrandIdxRef.current = null; dragProdInfoRef.current = null; aliasDragRef.current = null; setDragOverBrandIdx(null); setDragOverProdKey(null) }

  if (loading && products.length === 0) return <Spin style={{ display: 'block', margin: '40px auto' }} />

  const SBtn = ({ icon, dis, tip, onClick }) => (
    <Tooltip title={tip}><Button type="text" size="small" icon={icon} disabled={dis} onClick={onClick} style={{ fontSize: 10, minWidth: 18, color: dis ? '#ddd' : '#1677ff' }} /></Tooltip>
  )

  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ marginBottom: 10 }}>
        <Text strong style={{ fontSize: 15 }}>别名管理</Text>
        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>↑↓←→ 箭头 / 拖拽⠿ 排序 • ✏️ 编辑 • 首行=首选别名 • 最多{MAX_ALIASES_SHOW}个别名</div>
      </div>
      {brandGroups.length === 0 && <Empty description="暂无商品" style={{ marginTop: 40 }} />}
      {brandGroups.map((group, bi) => (
        <Card key={group.brand} size="small" style={{ marginBottom: 10, borderRadius: 8, border: dragOverBrandIdx === bi ? '2px dashed #1677ff' : undefined }}
          title={
            <div draggable onDragStart={(e) => bds(e, bi)} onDragOver={(e) => bdo(e, bi)} onDrop={(e) => bdd(e, bi)} onDragEnd={dend} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'grab' }}>
              <HolderOutlined style={{ color: '#ccc', fontSize: 12 }} />
              <Title level={5} style={{ margin: 0, color: '#1677ff', fontSize: 14 }}>{group.brand}</Title>
              <Tag style={{ fontSize: 10 }}>{group.products.length}种</Tag>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                <SBtn icon={<UpOutlined />} dis={bi === 0} tip="上移" onClick={() => moveBrand(bi, -1)} />
                <SBtn icon={<DownOutlined />} dis={bi === brandGroups.length - 1} tip="下移" onClick={() => moveBrand(bi, 1)} />
              </div>
            </div>
          }>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
            {group.products.map((prod, pi) => (
              <div key={prod.product_id} draggable onDragStart={(e) => pds(e, group.brand, pi)} onDragOver={(e) => pdo(e, group.brand, pi)} onDrop={(e) => pdd(e, group.brand, pi)} onDragEnd={dend}
                style={{ background: dragOverProdKey === `${group.brand}:${pi}` ? '#e6f7ff' : '#fafafa', border: dragOverProdKey === `${group.brand}:${pi}` ? '2px dashed #1677ff' : '1px solid #f0f0f0', borderRadius: 6, padding: '6px 8px', cursor: 'grab' }}>
                {/* 序号+名称（不挤箭头） */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Tag style={{ fontSize: 10, margin: 0, lineHeight: '16px', minWidth: 22, textAlign: 'center' }}>{pi + 1}</Tag>
                  {editingProduct === prod.product_id ? (
                    <>
                      <Input size="small" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ flex: 1, fontSize: 11 }} onPressEnter={() => saveProductName(prod.product_id)} />
                      <Button size="small" type="primary" icon={<CheckOutlined />} style={{ fontSize: 10, minWidth: 20 }} onClick={() => saveProductName(prod.product_id)} />
                      <Button size="small" icon={<CloseOutlined />} style={{ fontSize: 10, minWidth: 20 }} onClick={() => setEditingProduct(null)} />
                    </>
                  ) : (
                    <Text strong style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prod.name}</Text>
                  )}
                </div>
                {/* 别名列表 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {prod.aliases.slice(0, MAX_ALIASES_SHOW).map((a, idx) => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '1px 3px', borderRadius: 3, background: idx === 0 ? '#f0f9ff' : '#fff', border: `1px solid ${idx === 0 ? '#bae0ff' : '#f5f5f5'}` }}>
                      {editingAlias === a.id ? (
                        <>
                          <Input size="small" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ flex: 1, fontSize: 10 }} onPressEnter={() => saveAlias(a.id)} />
                          <Button size="small" type="primary" icon={<CheckOutlined />} style={{ fontSize: 9, minWidth: 16 }} onClick={() => saveAlias(a.id)} />
                          <Button size="small" icon={<CloseOutlined />} style={{ fontSize: 9, minWidth: 16 }} onClick={() => setEditingAlias(null)} />
                        </>
                      ) : (
                        <>
                          <span draggable onDragStart={(e) => ads(e, prod.product_id, a.id)} onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }} onDrop={(e) => add2(e, prod.product_id, a.id)} onDragEnd={dend} style={{ cursor: 'grab', color: '#ccc', fontSize: 11 }}>⠿</span>
                          <Text style={{ flex: 1, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => startEditAlias(a)}>{a.alias}</Text>
                          {idx === 0 && <Tag color="blue" style={{ fontSize: 8, margin: 0, lineHeight: '14px', padding: '0 3px' }}>首</Tag>}
                          <Button type="text" size="small" icon={<UpOutlined />} disabled={idx === 0} onClick={() => moveAlias(prod.product_id, a.id, -1)} style={{ fontSize: 8, minWidth: 12, minHeight: 12, color: idx === 0 ? '#eee' : '#999' }} />
                          <Button type="text" size="small" icon={<DownOutlined />} disabled={idx === Math.min(prod.aliases.length, MAX_ALIASES_SHOW) - 1} onClick={() => moveAlias(prod.product_id, a.id, 1)} style={{ fontSize: 8, minWidth: 12, minHeight: 12, color: idx === Math.min(prod.aliases.length, MAX_ALIASES_SHOW) - 1 ? '#eee' : '#999' }} />
                          <Button type="text" size="small" danger icon={<CloseOutlined />} style={{ fontSize: 9, minWidth: 14, minHeight: 14 }} onClick={() => deleteAlias(a.id)} />
                        </>
                      )}
                    </div>
                  ))}
                  {prod.aliases.length > MAX_ALIASES_SHOW && <Text style={{ fontSize: 9, color: '#999', textAlign: 'center' }}>+{prod.aliases.length - MAX_ALIASES_SHOW}个别名</Text>}
                </div>
                {/* 添加别名 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2, padding: '1px 4px', borderRadius: 3, border: '1px dashed #e8e8e8', background: '#fff' }}>
                  <PlusOutlined style={{ color: '#bbb', fontSize: 9 }} />
                  <Input size="small" placeholder="添加别名" value={newAliasValues[prod.product_id] || ''} onChange={e => setNewAliasValues(prev => ({ ...prev, [prod.product_id]: e.target.value }))} onPressEnter={() => addAlias(prod.product_id)} onClick={(e) => e.stopPropagation()} style={{ flex: 1, fontSize: 10 }} />
                </div>
                {/* 底部操作栏：← → 编辑 删除 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingTop: 3, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <SBtn icon={<LeftOutlined />} dis={pi === 0} tip="前移" onClick={(e) => { e.stopPropagation(); moveProduct(group.brand, pi, -1) }} />
                    <SBtn icon={<RightOutlined />} dis={pi === group.products.length - 1} tip="后移" onClick={(e) => { e.stopPropagation(); moveProduct(group.brand, pi, 1) }} />
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); startEditProduct(prod) }} style={{ fontSize: 10, minWidth: 18 }} /></Tooltip>
                    <Popconfirm title="确定删除？" onConfirm={() => deleteProduct(prod.product_id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                      <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} style={{ fontSize: 10, minWidth: 18 }} /></Tooltip>
                    </Popconfirm>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
