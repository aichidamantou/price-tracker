import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Typography, Spin, Input, Button, Tag, message, Tooltip, Card, Popconfirm, Empty } from 'antd'
import { EditOutlined, CheckOutlined, CloseOutlined, SaveOutlined, DragOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'

const { Text, Title } = Typography
const API_BASE = ''

export default function AliasManager() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingProduct, setEditingProduct] = useState(null)  // product_id
  const [editingAlias, setEditingAlias] = useState(null)      // alias id
  const [editValue, setEditValue] = useState('')
  const [draggedItem, setDraggedItem] = useState(null)
  // 每个商品的添加别名输入值 {productId: string}
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

  // ── 编辑标准名称 ──
  const startEditProduct = (prod) => {
    setEditingProduct(prod.product_id)
    setEditValue(prod.name)
    setEditingAlias(null)
  }

  const saveProductName = async (productId) => {
    if (!editValue.trim()) return
    try {
      const res = await fetch(`${API_BASE}/api/aliases/edit-product`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, name: editValue.trim() }),
      })
      const data = await res.json()
      if (data.status === 'ok') {
        message.success('已更新')
        setEditingProduct(null)
        fetchAliases()
      } else message.error(data.error || '更新失败')
    } catch (e) { message.error('更新失败') }
  }

  // ── 编辑别名 ──
  const startEditAlias = (productId, alias) => {
    setEditingAlias(alias.id)
    setEditValue(alias.alias)
    setEditingProduct(null)
  }

  const saveAlias = async (aliasId) => {
    if (!editValue.trim()) return
    try {
      const res = await fetch(`${API_BASE}/api/aliases/edit-alias`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias_id: aliasId, alias: editValue.trim() }),
      })
      const data = await res.json()
      if (data.status === 'ok') {
        message.success('已更新')
        setEditingAlias(null)
        fetchAliases()
      } else message.error(data.error || '更新失败')
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
      if (data.status === 'ok') {
        message.success('别名已添加')
        setNewAliasValues(prev => ({ ...prev, [productId]: '' }))
        fetchAliases()
      } else message.error(data.error || '添加失败')
    } catch (e) { message.error('添加失败') }
  }

  // ── 删除别名 ──
  const deleteAlias = async (aliasId) => {
    try {
      await fetch(`${API_BASE}/api/aliases/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias_id: aliasId }),
      })
      message.success('别名已删除')
      fetchAliases()
    } catch (e) { message.error('删除失败') }
  }

  // ── 删除商品 ──
  const deleteProduct = async (productId) => {
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (data.status === 'ok') {
        message.success('商品已删除')
        fetchAliases()
      } else message.error(data.error || '删除失败')
    } catch (e) { message.error('删除失败') }
  }

  // ── 拖拽排序 ──
  const handleDragStart = (productId, aliasId) => setDraggedItem({ productId, aliasId })
  const handleDragOver = (e) => e.preventDefault()
  const handleDrop = async (productId, targetAliasId) => {
    if (!draggedItem || draggedItem.productId !== productId) return
    const prod = products.find(p => p.product_id === productId)
    if (!prod) return
    const ids = prod.aliases.map(a => a.id)
    const dragIdx = ids.indexOf(draggedItem.aliasId)
    const dropIdx = ids.indexOf(targetAliasId)
    if (dragIdx === -1 || dropIdx === -1) return
    ids.splice(dragIdx, 1)
    ids.splice(dropIdx, 0, draggedItem.aliasId)
    setDraggedItem(null)
    try {
      await fetch(`${API_BASE}/api/aliases/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, alias_ids: ids }),
      })
      fetchAliases()
    } catch (e) { console.error(e) }
  }

  // ── 按 brand 分组 ──
  const brandGroups = {}
  for (const prod of products) {
    const brand = prod.brand || '未分类'
    if (!brandGroups[brand]) brandGroups[brand] = []
    brandGroups[brand].push(prod)
  }
  const sortedBrands = Object.keys(brandGroups).sort()

  if (loading && products.length === 0) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />
  }

  return (
    <div style={{ padding: '8px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 15 }}>别名管理</Text>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          点击 ✏️ 编辑 • 拖动 ⠿ 排序 • 首行=首选别名 • 按【地区】分组
        </div>
      </div>

      {sortedBrands.length === 0 && <Empty description="暂无商品" style={{ marginTop: 40 }} />}

      {sortedBrands.map(brand => (
        <Card
          key={brand}
          size="small"
          style={{ marginBottom: 12, borderRadius: 8 }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Title level={5} style={{ margin: 0, color: '#1677ff', fontSize: 14 }}>{brand}</Title>
              <Tag style={{ fontSize: 10 }}>{brandGroups[brand].length}种商品</Tag>
            </div>
          }
        >
          {brandGroups[brand].map(prod => (
            <div key={prod.product_id} style={{
              marginBottom: 8, background: '#fafafa', borderRadius: 6, padding: 10,
              border: '1px solid #f0f0f0',
            }}>
              {/* 标准名称行 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: prod.aliases.length > 0 ? 6 : 0,
                padding: '4px 0', borderBottom: prod.aliases.length > 0 ? '1px solid #f5f5f5' : 'none',
              }}>
                {editingProduct === prod.product_id ? (
                  <>
                    <Input size="small" value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      style={{ width: 180 }}
                      onPressEnter={() => saveProductName(prod.product_id)} />
                    <Button size="small" type="primary" icon={<CheckOutlined />}
                      onClick={() => saveProductName(prod.product_id)} />
                    <Button size="small" icon={<CloseOutlined />}
                      onClick={() => setEditingProduct(null)} />
                  </>
                ) : (
                  <>
                    <Text strong style={{ fontSize: 13, flex: 1 }}>{prod.name}</Text>
                    <Tag style={{ fontSize: 10, margin: 0 }}>{prod.aliases.length}个别名</Tag>
                    <Tooltip title="编辑标准名称">
                      <Button type="text" size="small" icon={<EditOutlined />}
                        onClick={() => startEditProduct(prod)} />
                    </Tooltip>
                    <Popconfirm
                      title="确定删除此商品？"
                      description="将同时删除所有别名和价格记录"
                      onConfirm={() => deleteProduct(prod.product_id)}
                      okText="确定删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Tooltip title="删除商品">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  </>
                )}
              </div>

              {/* 别名列表 */}
              {prod.aliases.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {prod.aliases.map((a, idx) => (
                    <div key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '3px 6px', borderRadius: 4,
                      background: idx === 0 ? '#f0f9ff' : '#fff',
                      border: '1px solid',
                      borderColor: idx === 0 ? '#bae0ff' : '#f0f0f0',
                    }}>
                      {/* 拖拽手柄 */}
                      <span draggable
                        onDragStart={() => handleDragStart(prod.product_id, a.id)}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(prod.product_id, a.id)}
                        style={{ cursor: 'grab', color: '#bbb', fontSize: 14, width: 16 }}>
                        ⠿
                      </span>

                      {/* 别名文本 */}
                      {editingAlias === a.id ? (
                        <>
                          <Input size="small" value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            style={{ flex: 1 }}
                            onPressEnter={() => saveAlias(a.id)} />
                          <Button size="small" type="primary" icon={<CheckOutlined />}
                            onClick={() => saveAlias(a.id)} />
                          <Button size="small" icon={<CloseOutlined />}
                            onClick={() => setEditingAlias(null)} />
                        </>
                      ) : (
                        <>
                          <Tooltip title="编辑别名">
                            <Text style={{
                              flex: 1, fontSize: 12, cursor: 'pointer',
                              textDecoration: 'none', padding: '2px 0',
                            }}
                              onClick={() => startEditAlias(prod.product_id, a)}>
                              {a.alias}
                            </Text>
                          </Tooltip>

                          {idx === 0 && (
                            <Tag color="blue" style={{ fontSize: 9, margin: 0, lineHeight: '16px' }}>
                              首选
                            </Tag>
                          )}
                          <Tag style={{ fontSize: 9, margin: 0, lineHeight: '16px' }}>
                            {a.source === 'manual' ? '手动' : a.source === 'user_correction' ? '学习' : '自动'}
                          </Tag>
                          <Tooltip title="编辑">
                            <Button type="text" size="small" icon={<EditOutlined />}
                              style={{ fontSize: 11, color: '#888' }}
                              onClick={() => startEditAlias(prod.product_id, a)} />
                          </Tooltip>
                          <Tooltip title="删除别名">
                            <Button type="text" size="small" danger icon={<CloseOutlined />}
                              style={{ fontSize: 11 }}
                              onClick={() => deleteAlias(a.id)} />
                          </Tooltip>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 添加别名输入行 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginTop: 4,
                padding: '3px 6px', borderRadius: 4, background: '#fff',
                border: '1px dashed #d9d9d9',
              }}>
                <PlusOutlined style={{ color: '#999', fontSize: 11 }} />
                <Input
                  size="small"
                  placeholder="输入新别名后回车添加"
                  value={newAliasValues[prod.product_id] || ''}
                  onChange={e => setNewAliasValues(prev => ({ ...prev, [prod.product_id]: e.target.value }))}
                  onPressEnter={() => addAlias(prod.product_id)}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <Button
                  size="small"
                  type="link"
                  disabled={!(newAliasValues[prod.product_id] || '').trim()}
                  onClick={() => addAlias(prod.product_id)}
                  style={{ fontSize: 11 }}
                >
                  添加
                </Button>
              </div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  )
}
