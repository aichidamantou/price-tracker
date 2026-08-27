import React, { useState, useEffect, useCallback } from 'react'
import { Typography, Spin, Input, Button, Tag, message, Tooltip, Card, Popconfirm, Empty } from 'antd'
import { EditOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined, UpOutlined, DownOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'

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

  // ── 按 brand 分组 ──
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

  // ── 品牌上下移动 ──
  const moveBrand = async (brandIdx, direction) => {
    const targetIdx = brandIdx + direction
    if (targetIdx < 0 || targetIdx >= brandGroups.length) return
    const newOrder = [...brandGroups]
    const temp = newOrder[brandIdx]
    newOrder[brandIdx] = newOrder[targetIdx]
    newOrder[targetIdx] = temp
    const brandNames = newOrder.map(g => g.brand)
    try {
      await fetch(`${API_BASE}/api/aliases/reorder-brands`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: brandNames }),
      })
      message.success('地区排序已更新')
      fetchAliases()
    } catch (e) { message.error('排序失败') }
  }

  // ── 商品左右移动（同品牌内） ──
  const moveProduct = async (brand, prodIdx, direction) => {
    const group = brandGroups.find(g => g.brand === brand)
    if (!group) return
    const targetIdx = prodIdx + direction
    if (targetIdx < 0 || targetIdx >= group.products.length) return
    const newProds = [...group.products]
    const temp = newProds[prodIdx]
    newProds[prodIdx] = newProds[targetIdx]
    newProds[targetIdx] = temp
    const productIds = newProds.map(p => p.product_id)
    try {
      await fetch(`${API_BASE}/api/aliases/reorder-products`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, product_ids: productIds }),
      })
      message.success('商品排序已更新')
      fetchAliases()
    } catch (e) { message.error('排序失败') }
  }

  // ── 别名排序（简单上下移动） ──
  const moveAlias = async (productId, aliasId, direction) => {
    const prod = products.find(p => p.product_id === productId)
    if (!prod) return
    const aliases = prod.aliases
    const idx = aliases.findIndex(a => a.id === aliasId)
    const targetIdx = idx + direction
    if (idx === -1 || targetIdx < 0 || targetIdx >= aliases.length) return
    const ids = aliases.map(a => a.id)
    const temp = ids[idx]
    ids[idx] = ids[targetIdx]
    ids[targetIdx] = temp
    try {
      await fetch(`${API_BASE}/api/aliases/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, alias_ids: ids }),
      })
      fetchAliases()
    } catch (e) { message.error('排序失败') }
  }

  if (loading && products.length === 0) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />
  }

  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ marginBottom: 10 }}>
        <Text strong style={{ fontSize: 15 }}>别名管理</Text>
        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
          点击 ↑↓ 移动地区/商品/别名顺序 • ✏️ 编辑 • 首行=首选别名 • 最多显示{MAX_ALIASES_SHOW}个别名
        </div>
      </div>

      {brandGroups.length === 0 && <Empty description="暂无商品" style={{ marginTop: 40 }} />}

      {brandGroups.map((group, brandIdx) => (
        <Card
          key={group.brand}
          size="small"
          style={{ marginBottom: 10, borderRadius: 8 }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Title level={5} style={{ margin: 0, color: '#1677ff', fontSize: 14 }}>{group.brand}</Title>
              <Tag style={{ fontSize: 10 }}>{group.products.length}种</Tag>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                <Tooltip title="上移地区">
                  <Button size="small" icon={<UpOutlined />} disabled={brandIdx === 0}
                    onClick={() => moveBrand(brandIdx, -1)} style={{ fontSize: 10 }} />
                </Tooltip>
                <Tooltip title="下移地区">
                  <Button size="small" icon={<DownOutlined />} disabled={brandIdx === brandGroups.length - 1}
                    onClick={() => moveBrand(brandIdx, 1)} style={{ fontSize: 10 }} />
                </Tooltip>
              </div>
            </div>
          }
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 6,
          }}>
            {group.products.map((prod, prodIdx) => (
              <div key={prod.product_id} style={{
                background: '#fafafa',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: '6px 8px',
              }}>
                {/* 标题行：序号 + 名称 + 排序箭头 + 操作 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 4 }}>
                  <Tag style={{ fontSize: 10, margin: 0, lineHeight: '16px', minWidth: 22, textAlign: 'center' }}>
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
                      {/* 排序箭头 */}
                      <Tooltip title="前移">
                        <Button type="text" size="small" icon={<LeftOutlined />}
                          disabled={prodIdx === 0}
                          onClick={() => moveProduct(group.brand, prodIdx, -1)}
                          style={{ fontSize: 10, minWidth: 16, color: prodIdx === 0 ? '#ddd' : '#1677ff' }} />
                      </Tooltip>
                      <Tooltip title="后移">
                        <Button type="text" size="small" icon={<RightOutlined />}
                          disabled={prodIdx === group.products.length - 1}
                          onClick={() => moveProduct(group.brand, prodIdx, 1)}
                          style={{ fontSize: 10, minWidth: 16, color: prodIdx === group.products.length - 1 ? '#ddd' : '#1677ff' }} />
                      </Tooltip>
                      <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />}
                          onClick={() => startEditProduct(prod)} style={{ fontSize: 10, minWidth: 16 }} />
                      </Tooltip>
                      <Popconfirm title="确定删除？" onConfirm={() => deleteProduct(prod.product_id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                        <Tooltip title="删除">
                          <Button type="text" size="small" danger icon={<DeleteOutlined />}
                            style={{ fontSize: 10, minWidth: 16 }} />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  )}
                </div>

                {/* 别名列表 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {prod.aliases.slice(0, MAX_ALIASES_SHOW).map((a, idx) => (
                    <div key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 2,
                      padding: '1px 3px', borderRadius: 3,
                      background: idx === 0 ? '#f0f9ff' : '#fff',
                      border: `1px solid ${idx === 0 ? '#bae0ff' : '#f5f5f5'}`,
                    }}>
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
                          {/* 别名排序箭头 */}
                          <Button type="text" size="small" icon={<UpOutlined />}
                            disabled={idx === 0}
                            onClick={() => moveAlias(prod.product_id, a.id, -1)}
                            style={{ fontSize: 8, minWidth: 12, minHeight: 12, color: idx === 0 ? '#eee' : '#999' }} />
                          <Button type="text" size="small" icon={<DownOutlined />}
                            disabled={idx === Math.min(prod.aliases.length, MAX_ALIASES_SHOW) - 1}
                            onClick={() => moveAlias(prod.product_id, a.id, 1)}
                            style={{ fontSize: 8, minWidth: 12, minHeight: 12, color: idx === Math.min(prod.aliases.length, MAX_ALIASES_SHOW) - 1 ? '#eee' : '#999' }} />
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
