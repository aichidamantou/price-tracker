import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Typography, Spin, Input, Button, Tag, message, Tooltip, Card, Popconfirm, Empty } from 'antd'
import { EditOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined, HolderOutlined } from '@ant-design/icons'

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
  // Drag state — use ref to avoid stale closures
  const dragBrandIdxRef = useRef(null)
  const dragProdInfoRef = useRef(null)  // {brand, idx}
  const [dragOverBrandIdx, setDragOverBrandIdx] = useState(null)
  const [dragOverProdInfo, setDragOverProdInfo] = useState(null)

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

  // ── 按 brand 分组（保持API返回顺序） ──
  const buildBrandGroups = useCallback(() => {
    const groups = []
    let lastBrand = null
    for (const prod of products) {
      const brand = prod.brand || '未分类'
      if (brand !== lastBrand) {
        groups.push({ brand, products: [prod] })
        lastBrand = brand
      } else {
        groups[groups.length - 1].products.push(prod)
      }
    }
    return groups
  }, [products])

  const brandGroups = buildBrandGroups()

  // ── 编辑标准名称 ──
  const startEditProduct = (prod) => { setEditingProduct(prod.product_id); setEditValue(prod.name); setEditingAlias(null) }
  const saveProductName = async (productId) => {
    if (!editValue.trim()) return
    try {
      const res = await fetch(`${API_BASE}/api/aliases/edit-product`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, name: editValue.trim() }),
      })
      const data = await res.json()
      if (data.status === 'ok') { message.success('已更新'); setEditingProduct(null); fetchAliases() }
      else message.error(data.error || '更新失败')
    } catch (e) { message.error('更新失败') }
  }

  // ── 编辑别名 ──
  const startEditAlias = (alias) => { setEditingAlias(alias.id); setEditValue(alias.alias); setEditingProduct(null) }
  const saveAlias = async (aliasId) => {
    if (!editValue.trim()) return
    try {
      const res = await fetch(`${API_BASE}/api/aliases/edit-alias`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias_id: aliasId, alias: editValue.trim() }),
      })
      const data = await res.json()
      if (data.status === 'ok') { message.success('已更新'); setEditingAlias(null); fetchAliases() }
      else message.error(data.error || '更新失败')
    } catch (e) { message.error('更新失败') }
  }

  // ── 添加别名 ──
  const addAlias = async (productId) => {
    const aliasText = (newAliasValues[productId] || '').trim()
    if (!aliasText) return
    try {
      const res = await fetch(`${API_BASE}/api/aliases/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, alias: aliasText }),
      })
      const data = await res.json()
      if (data.status === 'ok') { message.success('别名已添加'); setNewAliasValues(prev => ({ ...prev, [productId]: '' })); fetchAliases() }
      else message.error(data.error || '添加失败')
    } catch (e) { message.error('添加失败') }
  }

  // ── 删除别名 ──
  const deleteAlias = async (aliasId) => {
    try {
      await fetch(`${API_BASE}/api/aliases/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias_id: aliasId }),
      })
      message.success('别名已删除'); fetchAliases()
    } catch (e) { message.error('删除失败') }
  }

  // ── 删除商品 ──
  const deleteProduct = async (productId) => {
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.status === 'ok') { message.success('商品已删除'); fetchAliases() }
      else message.error(data.error || '删除失败')
    } catch (e) { message.error('删除失败') }
  }

  // ── 别名拖拽排序 ──
  const aliasDragRef = useRef(null)
  const handleAliasDragStart = (e, productId, aliasId) => {
    e.stopPropagation()
    const prod = products.find(p => p.product_id === productId)
    if (prod) {
      aliasDragRef.current = { productId, aliasId, ids: prod.aliases.map(a => a.id) }
    }
  }
  const handleAliasDrop = async (e, productId, targetAliasId) => {
    e.stopPropagation()
    const drag = aliasDragRef.current
    if (!drag || drag.productId !== productId) return
    const ids = [...drag.ids]
    const dragIdx = ids.indexOf(drag.aliasId)
    const dropIdx = ids.indexOf(targetAliasId)
    if (dragIdx === -1 || dropIdx === -1 || dragIdx === dropIdx) { aliasDragRef.current = null; return }
    ids.splice(dragIdx, 1)
    ids.splice(dropIdx, 0, drag.aliasId)
    aliasDragRef.current = null
    try {
      await fetch(`${API_BASE}/api/aliases/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, alias_ids: ids }),
      })
      fetchAliases()
    } catch (err) { console.error(err) }
  }

  // ── 品牌拖拽排序 ──
  const handleBrandDragStart = (e, idx) => {
    e.stopPropagation()
    dragBrandIdxRef.current = idx
    setDragOverBrandIdx(null)
  }
  const handleBrandDragOver = (e, idx) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverProdInfo(null)
    if (dragBrandIdxRef.current !== null && dragBrandIdxRef.current !== idx) {
      setDragOverBrandIdx(idx)
    }
  }
  const handleBrandDrop = async (e, targetIdx) => {
    e.stopPropagation()
    const srcIdx = dragBrandIdxRef.current
    if (srcIdx === null || srcIdx === targetIdx) { dragBrandIdxRef.current = null; setDragOverBrandIdx(null); return }
    const newOrder = [...brandGroups]
    const [moved] = newOrder.splice(srcIdx, 1)
    newOrder.splice(targetIdx, 0, moved)
    dragBrandIdxRef.current = null
    setDragOverBrandIdx(null)
    const brandNames = newOrder.map(g => g.brand)
    try {
      await fetch(`${API_BASE}/api/aliases/reorder-brands`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: brandNames }),
      })
      message.success('地区排序已保存')
      fetchAliases()
    } catch (err) { message.error('排序保存失败') }
  }

  // ── 商品拖拽排序（同品牌内） ──
  const handleProdDragStart = (e, brand, idx) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    dragProdInfoRef.current = { brand, idx }
    setDragOverProdInfo(null)
  }
  const handleProdDragOver = (e, brand, idx) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverBrandIdx(null)
    const di = dragProdInfoRef.current
    if (di && di.brand === brand && di.idx !== idx) {
      setDragOverProdInfo({ brand, idx })
    }
  }
  const handleProdDrop = async (e, brand, targetIdx) => {
    e.stopPropagation()
    const di = dragProdInfoRef.current
    if (!di || di.brand !== brand || di.idx === targetIdx) { dragProdInfoRef.current = null; setDragOverProdInfo(null); return }
    const group = brandGroups.find(g => g.brand === brand)
    if (!group) { dragProdInfoRef.current = null; setDragOverProdInfo(null); return }
    const newProds = [...group.products]
    const [moved] = newProds.splice(di.idx, 1)
    newProds.splice(targetIdx, 0, moved)
    dragProdInfoRef.current = null
    setDragOverProdInfo(null)
    // Send ALL product IDs in new order
    const productIds = newProds.map(p => p.product_id)
    try {
      await fetch(`${API_BASE}/api/aliases/reorder-products`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, product_ids: productIds }),
      })
      message.success('商品排序已保存')
      fetchAliases()
    } catch (err) { message.error('排序保存失败') }
  }

  // Reset drag on dragend
  const handleDragEnd = () => {
    dragBrandIdxRef.current = null
    dragProdInfoRef.current = null
    aliasDragRef.current = null
    setDragOverBrandIdx(null)
    setDragOverProdInfo(null)
  }

  if (loading && products.length === 0) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />
  }

  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ marginBottom: 10 }}>
        <Text strong style={{ fontSize: 15 }}>别名管理</Text>
        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
          拖动 ⠿ 排序地区/商品/别名 • 点击 ✏️ 编辑 • 首行=首选别名 • 最多显示{MAX_ALIASES_SHOW}个别名
        </div>
      </div>

      {brandGroups.length === 0 && <Empty description="暂无商品" style={{ marginTop: 40 }} />}

      {brandGroups.map((group, brandIdx) => (
        <Card
          key={group.brand}
          size="small"
          style={{
            marginBottom: 10, borderRadius: 8,
            border: dragOverBrandIdx === brandIdx ? '2px dashed #1677ff' : undefined,
          }}
          title={
            <div
              draggable
              onDragStart={(e) => handleBrandDragStart(e, brandIdx)}
              onDragOver={(e) => handleBrandDragOver(e, brandIdx)}
              onDrop={(e) => handleBrandDrop(e, brandIdx)}
              onDragEnd={handleDragEnd}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'grab' }}
            >
              <HolderOutlined style={{ color: '#bbb', fontSize: 12 }} />
              <Title level={5} style={{ margin: 0, color: '#1677ff', fontSize: 14 }}>{group.brand}</Title>
              <Tag style={{ fontSize: 10 }}>{group.products.length}种</Tag>
            </div>
          }
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 6,
          }}>
            {group.products.map((prod, prodIdx) => {
              const isDragSource = dragOverProdInfo?.brand === group.brand && dragOverProdInfo?.idx === prodIdx
              const isDragOrigin = dragProdInfoRef.current?.brand === group.brand && dragProdInfoRef.current?.idx === prodIdx
              return (
                <div
                  key={prod.product_id}
                  draggable
                  onDragStart={(e) => handleProdDragStart(e, group.brand, prodIdx)}
                  onDragOver={(e) => handleProdDragOver(e, group.brand, prodIdx)}
                  onDrop={(e) => handleProdDrop(e, group.brand, prodIdx)}
                  onDragEnd={handleDragEnd}
                  style={{
                    background: isDragSource ? '#e6f7ff' : '#fafafa',
                    border: isDragSource ? '2px dashed #1677ff' : '1px solid #f0f0f0',
                    borderRadius: 6,
                    padding: '6px 8px',
                    cursor: 'grab',
                    opacity: isDragOrigin ? 0.4 : 1,
                  }}
                >
                  {/* 标题行：序号 + 名称 + 操作 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <Tag style={{ fontSize: 10, margin: 0, lineHeight: '16px', minWidth: 24, textAlign: 'center' }}>
                      {prodIdx + 1}
                    </Tag>
                    {editingProduct === prod.product_id ? (
                      <>
                        <Input size="small" value={editValue}
                          onClick={(e) => e.stopPropagation()}
                          onChange={e => setEditValue(e.target.value)}
                          style={{ flex: 1, fontSize: 11 }}
                          onPressEnter={() => saveProductName(prod.product_id)} />
                        <Button size="small" type="primary" icon={<CheckOutlined />}
                          style={{ fontSize: 10, minWidth: 20 }} onClick={() => saveProductName(prod.product_id)} />
                        <Button size="small" icon={<CloseOutlined />}
                          style={{ fontSize: 10, minWidth: 20 }} onClick={() => setEditingProduct(null)} />
                      </>
                    ) : (
                      <>
                        <Text strong style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {prod.name}
                        </Text>
                        <Tooltip title="编辑">
                          <Button type="text" size="small" icon={<EditOutlined />}
                            onClick={(e) => { e.stopPropagation(); startEditProduct(prod) }}
                            style={{ fontSize: 10, minWidth: 18 }} />
                        </Tooltip>
                        <Popconfirm title="确定删除？" onConfirm={() => deleteProduct(prod.product_id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                          <Tooltip title="删除商品">
                            <Button type="text" size="small" danger icon={<DeleteOutlined />}
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontSize: 10, minWidth: 18 }} />
                          </Tooltip>
                        </Popconfirm>
                      </>
                    )}
                  </div>

                  {/* 别名列表（最多显示MAX_ALIASES_SHOW个） */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {prod.aliases.slice(0, MAX_ALIASES_SHOW).map((a, idx) => (
                      <div key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: 3,
                        padding: '1px 4px', borderRadius: 3,
                        background: idx === 0 ? '#f0f9ff' : '#fff',
                        border: `1px solid ${idx === 0 ? '#bae0ff' : '#f5f5f5'}`,
                      }}>
                        <span draggable
                          onDragStart={(e) => handleAliasDragStart(e, prod.product_id, a.id)}
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                          onDrop={(e) => handleAliasDrop(e, prod.product_id, a.id)}
                          onDragEnd={handleDragEnd}
                          style={{ cursor: 'grab', color: '#ccc', fontSize: 11, width: 12 }}>
                          ⠿
                        </span>
                        {editingAlias === a.id ? (
                          <>
                            <Input size="small" value={editValue}
                              onClick={(e) => e.stopPropagation()}
                              onChange={e => setEditValue(e.target.value)}
                              style={{ flex: 1, fontSize: 10 }}
                              onPressEnter={() => saveAlias(a.id)} />
                            <Button size="small" type="primary" icon={<CheckOutlined />}
                              style={{ fontSize: 9, minWidth: 16 }} onClick={() => saveAlias(a.id)} />
                            <Button size="small" icon={<CloseOutlined />}
                              style={{ fontSize: 9, minWidth: 16 }} onClick={() => setEditingAlias(null)} />
                          </>
                        ) : (
                          <>
                            <Text style={{ flex: 1, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              onClick={(e) => { e.stopPropagation(); startEditAlias(a) }}>
                              {a.alias}
                            </Text>
                            {idx === 0 && <Tag color="blue" style={{ fontSize: 8, margin: 0, lineHeight: '14px', padding: '0 3px' }}>首</Tag>}
                            <Button type="text" size="small" danger icon={<CloseOutlined />}
                              style={{ fontSize: 9, minWidth: 14, minHeight: 14 }}
                              onClick={(e) => { e.stopPropagation(); deleteAlias(a.id) }} />
                          </>
                        )}
                      </div>
                    ))}
                    {prod.aliases.length > MAX_ALIASES_SHOW && (
                      <Text style={{ fontSize: 9, color: '#999', textAlign: 'center' }}>
                        +{prod.aliases.length - MAX_ALIASES_SHOW}个别名
                      </Text>
                    )}
                  </div>

                  {/* 添加别名输入行 */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 3, marginTop: 2,
                    padding: '1px 4px', borderRadius: 3,
                    border: '1px dashed #e8e8e8', background: '#fff',
                  }}>
                    <PlusOutlined style={{ color: '#bbb', fontSize: 9 }} />
                    <Input
                      size="small"
                      placeholder="添加别名"
                      value={newAliasValues[prod.product_id] || ''}
                      onChange={e => setNewAliasValues(prev => ({ ...prev, [prod.product_id]: e.target.value }))}
                      onPressEnter={() => addAlias(prod.product_id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flex: 1, fontSize: 10 }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}
