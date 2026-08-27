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
  // Drag state
  const [dragBrandIdx, setDragBrandIdx] = useState(null)
  const [dragProdInfo, setDragProdInfo] = useState(null)  // {brand, idx}

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
  const handleAliasDragStart = (productId, aliasId) => {
    // Store in dataTransfer for alias reordering within product
    const prod = products.find(p => p.product_id === productId)
    if (prod) {
      const ids = prod.aliases.map(a => a.id)
      window._aliasDrag = { productId, aliasId, ids }
    }
  }
  const handleAliasDrop = async (productId, targetAliasId) => {
    const drag = window._aliasDrag
    if (!drag || drag.productId !== productId) return
    const ids = [...drag.ids]
    const dragIdx = ids.indexOf(drag.aliasId)
    const dropIdx = ids.indexOf(targetAliasId)
    if (dragIdx === -1 || dropIdx === -1 || dragIdx === dropIdx) { window._aliasDrag = null; return }
    ids.splice(dragIdx, 1)
    ids.splice(dropIdx, 0, drag.aliasId)
    window._aliasDrag = null
    try {
      await fetch(`${API_BASE}/api/aliases/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, alias_ids: ids }),
      })
      fetchAliases()
    } catch (e) { console.error(e) }
  }

  // ── 品牌拖拽排序 ──
  const handleBrandDragStart = (idx) => setDragBrandIdx(idx)
  const handleBrandDragOver = (e) => e.preventDefault()
  const handleBrandDrop = async (targetIdx) => {
    if (dragBrandIdx === null || dragBrandIdx === targetIdx) { setDragBrandIdx(null); return }
    const newOrder = [...brandGroups]
    const [moved] = newOrder.splice(dragBrandIdx, 1)
    newOrder.splice(targetIdx, 0, moved)
    setDragBrandIdx(null)
    const brandNames = newOrder.map(g => g.brand)
    try {
      await fetch(`${API_BASE}/api/aliases/reorder-brands`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: brandNames }),
      })
      // Also reorder products in the data locally and save each brand's product order
      // Re-build products array in new brand order
      const reorderedProducts = []
      for (const g of newOrder) {
        const prodsInBrand = products.filter(p => (p.brand || '未分类') === g.brand)
        reorderedProducts.push(...prodsInBrand)
      }
      setProducts(reorderedProducts)
      message.success('地区排序已保存')
    } catch (e) { message.error('排序保存失败') }
  }

  // ── 商品拖拽排序（同品牌内） ──
  const handleProdDragStart = (brand, idx) => setDragProdInfo({ brand, idx })
  const handleProdDragOver = (e) => e.preventDefault()
  const handleProdDrop = async (brand, targetIdx) => {
    if (!dragProdInfo || dragProdInfo.brand !== brand || dragProdInfo.idx === targetIdx) { setDragProdInfo(null); return }
    const group = brandGroups.find(g => g.brand === brand)
    if (!group) { setDragProdInfo(null); return }
    const newProds = [...group.products]
    const [moved] = newProds.splice(dragProdInfo.idx, 1)
    newProds.splice(targetIdx, 0, moved)
    setDragProdInfo(null)
    const productIds = newProds.map(p => p.product_id)
    try {
      await fetch(`${API_BASE}/api/aliases/reorder-products`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, product_ids: productIds }),
      })
      // Update local state
      setProducts(prev => {
        const other = prev.filter(p => (p.brand || '未分类') !== brand)
        return [...prev.filter(p => (p.brand || '未分类') !== brand).slice(0, 0), ...other]
          .filter(p => (p.brand || '未分类') !== brand)
          .concat(...newProds)
      })
      // Simpler: just refetch
      fetchAliases()
      message.success('商品排序已保存')
    } catch (e) { message.error('排序保存失败') }
  }

  if (loading && products.length === 0) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />
  }

  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Text strong style={{ fontSize: 15 }}>别名管理</Text>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            拖动 ⠿ 排序地区/商品/别名 • 点击 ✏️ 编辑 • 首行=首选别名 • 最多显示{MAX_ALIASES_SHOW}个别名
          </div>
        </div>
      </div>

      {brandGroups.length === 0 && <Empty description="暂无商品" style={{ marginTop: 40 }} />}

      {brandGroups.map((group, brandIdx) => (
        <Card
          key={group.brand}
          size="small"
          style={{
            marginBottom: 10, borderRadius: 8,
            border: dragBrandIdx === brandIdx ? '2px dashed #1677ff' : undefined,
            opacity: dragBrandIdx === brandIdx ? 0.5 : 1,
          }}
          title={
            <div
              draggable
              onDragStart={() => handleBrandDragStart(brandIdx)}
              onDragOver={handleBrandDragOver}
              onDrop={() => handleBrandDrop(brandIdx)}
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
            {group.products.map((prod, prodIdx) => (
              <div
                key={prod.product_id}
                draggable
                onDragStart={() => handleProdDragStart(group.brand, prodIdx)}
                onDragOver={handleProdDragOver}
                onDrop={() => handleProdDrop(group.brand, prodIdx)}
                style={{
                  background: dragProdInfo?.brand === group.brand && dragProdInfo?.idx === prodIdx ? '#e6f7ff' : '#fafafa',
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  padding: '6px 8px',
                  cursor: 'grab',
                  opacity: dragProdInfo?.brand === group.brand && dragProdInfo?.idx === prodIdx ? 0.5 : 1,
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
                          style={{ fontSize: 10, minWidth: 18 }} onClick={() => startEditProduct(prod)} />
                      </Tooltip>
                      <Popconfirm title="确定删除？" onConfirm={() => deleteProduct(prod.product_id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                        <Tooltip title="删除商品">
                          <Button type="text" size="small" danger icon={<DeleteOutlined />}
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
                        onDragStart={(e) => { e.stopPropagation(); handleAliasDragStart(prod.product_id, a.id) }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.stopPropagation(); handleAliasDrop(prod.product_id, a.id) }}
                        style={{ cursor: 'grab', color: '#ccc', fontSize: 11, width: 12 }}>
                        ⠿
                      </span>
                      {editingAlias === a.id ? (
                        <>
                          <Input size="small" value={editValue}
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
                            onClick={() => startEditAlias(a)}>
                            {a.alias}
                          </Text>
                          {idx === 0 && <Tag color="blue" style={{ fontSize: 8, margin: 0, lineHeight: '14px', padding: '0 3px' }}>首</Tag>}
                          <Button type="text" size="small" danger icon={<CloseOutlined />}
                            style={{ fontSize: 9, minWidth: 14, minHeight: 14 }}
                            onClick={() => deleteAlias(a.id)} />
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
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
