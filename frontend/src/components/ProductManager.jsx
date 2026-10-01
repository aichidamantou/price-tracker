import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Typography, Spin, Input, Button, Tag, message, Tooltip, Popconfirm, Empty,
  Modal, Upload, AutoComplete, Divider,
} from 'antd'
import {
  EditOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined,
  UpOutlined, DownOutlined, LeftOutlined, RightOutlined, HolderOutlined,
  DownloadOutlined, InboxOutlined, FileExcelOutlined, HistoryOutlined,
  RightCircleOutlined, DownCircleOutlined, SaveOutlined, ReloadOutlined,
} from '@ant-design/icons'

const { Text } = Typography
const API_BASE = ''

import { T } from '../utils/theme'

// 列表列宽：商品名 | 品牌 | 别名 | 进货价 | 生效日期 | 排序 | 操作
const GRID = 'minmax(200px, 1fr) 84px 52px 150px 106px 76px 132px'
const ROW_MIN_WIDTH = 900

const todayStr = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const groupByBrand = (list) => {
  const groups = []
  let last = null
  for (const prod of list) {
    const brand = prod.brand || '未分类'
    if (brand !== last) { groups.push({ brand, products: [prod] }); last = brand }
    else groups[groups.length - 1].products.push(prod)
  }
  return groups
}

export default function ProductManager() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('全部')

  const [expanded, setExpanded] = useState(null)
  const [editingProduct, setEditingProduct] = useState(null)
  const [editingAlias, setEditingAlias] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [newAliasValues, setNewAliasValues] = useState({})

  const [costEditing, setCostEditing] = useState(null)
  const [costValue, setCostValue] = useState('')

  const [histories, setHistories] = useState({})
  const [histOpen, setHistOpen] = useState({})
  const [histForm, setHistForm] = useState({})

  const [collapsed, setCollapsed] = useState({})
  const [importOpen, setImportOpen] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', brand: '', cost_price: '' })

  const dragBrandRef = useRef(null)
  const dragProdRef = useRef(null)
  const dragAliasRef = useRef(null)
  const [dragOverBrand, setDragOverBrand] = useState(null)
  const [dragOverProd, setDragOverProd] = useState(null)
  const costSubmittingRef = useRef(false)
  const [histEditing, setHistEditing] = useState(null)
  const [histEditValue, setHistEditValue] = useState({ date: '', price: '', note: '' })

  // ── 数据 ──────────────────────────────────────────────
  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/aliases/manage`)
      const data = await res.json()
      setProducts(data.products || [])
    } catch (e) { console.error(e); message.error('加载失败') }
    setLoading(false)
  }, [])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  // 完整分组（不受搜索/筛选影响）—— 排序永远基于真实顺序，避免筛选态写坏顺序
  const fullGroups = useMemo(() => groupByBrand(products), [products])
  const brandOptions = useMemo(() => fullGroups.map(g => g.brand), [fullGroups])

  const isFiltering = search.trim() !== '' || brandFilter !== '全部'

  const visibleGroups = useMemo(() => {
    const kw = search.trim().toLowerCase()
    const filtered = products.filter((p) => {
      if (brandFilter !== '全部' && (p.brand || '未分类') !== brandFilter) return false
      if (!kw) return true
      const hay = [p.name, p.brand, ...(p.aliases || []).map(a => a.alias)]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(kw)
    })
    return groupByBrand(filtered)
  }, [products, search, brandFilter])

  // ── 通用请求 ──────────────────────────────────────────
  const postJSON = async (url, body, method = 'POST') => {
    const res = await fetch(`${API_BASE}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let data = {}
    try { data = await res.json() } catch (e) { /* ignore */ }
    return { ok: res.ok, status: res.status, data }
  }

  // ── 地区（品牌）排序 ───────────────────────────────────
  const saveBrandOrder = async (names, tip) => {
    const r = await postJSON('/api/aliases/reorder-brands', { brands: names })
    if (r.ok) { message.success(tip || '地区排序已更新'); fetchProducts() }
    else message.error(r.data.error || '排序失败')
  }
  const moveBrandArrow = async (brand, dir) => {
    const names = fullGroups.map(g => g.brand)
    const i = names.indexOf(brand), t = i + dir
    if (i < 0 || t < 0 || t >= names.length) return
    const next = [...names]
    ;[next[i], next[t]] = [next[t], next[i]]
    await saveBrandOrder(next)
  }
  const moveBrandTo = async (srcBrand, targetBrand) => {
    const names = fullGroups.map(g => g.brand)
    const from = names.indexOf(srcBrand), to = names.indexOf(targetBrand)
    if (from < 0 || to < 0 || from === to) return
    const next = [...names]
    next.splice(to, 0, next.splice(from, 1)[0])
    await saveBrandOrder(next)
  }

  // ── 商品排序（同品牌内）───────────────────────────────
  const saveProductOrder = async (brand, ids, tip) => {
    const r = await postJSON('/api/aliases/reorder-products', { brand, product_ids: ids })
    if (r.ok) { message.success(tip || '商品排序已更新'); fetchProducts() }
    else message.error(r.data.error || '排序失败')
  }
  const moveProductArrow = async (brand, productId, dir) => {
    const g = fullGroups.find(x => x.brand === brand); if (!g) return
    const ids = g.products.map(p => p.product_id)
    const i = ids.indexOf(productId), t = i + dir
    if (i < 0 || t < 0 || t >= ids.length) return
    const next = [...ids]
    ;[next[i], next[t]] = [next[t], next[i]]
    await saveProductOrder(brand, next)
  }
  const moveProductTo = async (brand, srcId, targetId) => {
    const g = fullGroups.find(x => x.brand === brand); if (!g) return
    const ids = g.products.map(p => p.product_id)
    const from = ids.indexOf(srcId), to = ids.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...ids]
    next.splice(to, 0, next.splice(from, 1)[0])
    await saveProductOrder(brand, next)
  }

  // ── 别名排序 ──────────────────────────────────────────
  const moveAlias = async (productId, aliasId, dir) => {
    const prod = products.find(p => p.product_id === productId); if (!prod) return
    const ids = (prod.aliases || []).map(a => a.id)
    const i = ids.indexOf(aliasId), t = i + dir
    if (i < 0 || t < 0 || t >= ids.length) return
    const next = [...ids]
    ;[next[i], next[t]] = [next[t], next[i]]
    const r = await postJSON('/api/aliases/reorder', { product_id: productId, alias_ids: next })
    if (r.ok) fetchProducts(); else message.error(r.data.error || '排序失败')
  }
  const moveAliasTo = async (productId, srcId, targetId) => {
    const prod = products.find(p => p.product_id === productId); if (!prod) return
    const ids = (prod.aliases || []).map(a => a.id)
    const from = ids.indexOf(srcId), to = ids.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...ids]
    next.splice(to, 0, next.splice(from, 1)[0])
    const r = await postJSON('/api/aliases/reorder', { product_id: productId, alias_ids: next })
    if (r.ok) fetchProducts(); else message.error(r.data.error || '排序失败')
  }

  // ── 拖拽：地区 ────────────────────────────────────────
  const brandDragStart = (e, brand) => { e.stopPropagation(); dragBrandRef.current = brand }
  const brandDragOver = (e, brand) => {
    e.preventDefault(); e.stopPropagation()
    if (dragBrandRef.current && dragBrandRef.current !== brand) setDragOverBrand(brand)
  }
  const brandDrop = async (e, brand) => {
    e.stopPropagation()
    const src = dragBrandRef.current
    dragBrandRef.current = null; setDragOverBrand(null)
    if (src && src !== brand) await moveBrandTo(src, brand)
  }

  // ── 拖拽：商品 ────────────────────────────────────────
  const prodDragStart = (e, brand, productId) => {
    e.stopPropagation(); dragProdRef.current = { brand, productId }
  }
  const prodDragOver = (e, brand, productId) => {
    e.preventDefault(); e.stopPropagation()
    const d = dragProdRef.current
    if (d && d.brand === brand && d.productId !== productId) setDragOverProd(productId)
  }
  const prodDrop = async (e, brand, productId) => {
    e.stopPropagation()
    const d = dragProdRef.current
    dragProdRef.current = null; setDragOverProd(null)
    if (d && d.brand === brand && d.productId !== productId) {
      await moveProductTo(brand, d.productId, productId)
    }
  }

  // ── 拖拽：别名 ────────────────────────────────────────
  const aliasDragStart = (e, productId, aliasId) => {
    e.stopPropagation(); dragAliasRef.current = { productId, aliasId }
  }
  const aliasDrop = async (e, productId, aliasId) => {
    e.stopPropagation()
    const d = dragAliasRef.current
    dragAliasRef.current = null
    if (d && d.productId === productId && d.aliasId !== aliasId) {
      await moveAliasTo(productId, d.aliasId, aliasId)
    }
  }
  const dragEnd = () => {
    dragBrandRef.current = null
    dragProdRef.current = null
    dragAliasRef.current = null
    setDragOverBrand(null); setDragOverProd(null)
  }

  // ── 商品名 / 别名编辑 ─────────────────────────────────
  const startEditProduct = (prod) => {
    setEditingProduct(prod.product_id); setEditValue(prod.name); setEditingAlias(null)
  }
  const saveProductName = async (productId) => {
    const name = editValue.trim()
    if (!name) return
    const r = await postJSON('/api/aliases/edit-product', { product_id: productId, name })
    if (r.ok) { message.success('已更新'); setEditingProduct(null); fetchProducts() }
    else message.error(r.data.error || '失败')
  }
  const startEditAlias = (a) => { setEditingAlias(a.id); setEditValue(a.alias); setEditingProduct(null) }
  const saveAlias = async (aliasId) => {
    const alias = editValue.trim()
    if (!alias) return
    const r = await postJSON('/api/aliases/edit-alias', { alias_id: aliasId, alias })
    if (r.ok) { message.success('已更新'); setEditingAlias(null); fetchProducts() }
    else message.error(r.data.error || '失败')
  }
  const addAlias = async (productId) => {
    const t = (newAliasValues[productId] || '').trim(); if (!t) return
    const r = await postJSON('/api/aliases/add', { product_id: productId, alias: t })
    if (r.ok) {
      message.success('别名已添加')
      setNewAliasValues(prev => ({ ...prev, [productId]: '' }))
      fetchProducts()
    } else message.error(r.data.error || '失败')
  }
  const deleteAlias = async (aliasId) => {
    const r = await postJSON('/api/aliases/delete', { alias_id: aliasId })
    if (r.ok) { message.success('已删除'); fetchProducts() } else message.error(r.data.error || '失败')
  }
  const deleteProduct = async (productId) => {
    const res = await fetch(`${API_BASE}/api/products/${productId}`, { method: 'DELETE' })
    let data = {}
    try { data = await res.json() } catch (e) { /* ignore */ }
    if (res.ok) { message.success('已删除'); if (expanded === productId) setExpanded(null); fetchProducts() }
    else message.error(data.error || '失败')
  }

  // ── 进货价 ────────────────────────────────────────────
  const startEditCost = (prod) => {
    setCostEditing(prod.product_id)
    setCostValue(prod.current_cost != null ? String(prod.current_cost) : '')
  }
  const saveCost = async (prod) => {
    // Enter 与 blur 会各触发一次，用「进行中」标记挡并发即可；
    // 不能按值去重 —— 否则删掉记录后想把同一个值重新填回去会被静默吞掉。
    if (costSubmittingRef.current) return
    const raw = String(costValue ?? '').trim()
    if (raw === '') { setCostEditing(null); return }
    const v = Number(raw)
    if (!isFinite(v) || v < 0) { message.error('请输入合法的进货价'); return }
    if (prod.current_cost != null && Math.abs(v - prod.current_cost) < 1e-9) {
      setCostEditing(null); return
    }
    costSubmittingRef.current = true
    try {
      const r = await postJSON(`/api/products/${prod.product_id}/cost`, { cost_price: v }, 'PATCH')
      if (r.ok) {
        message.success('进货价已更新，历史已记录')
        setCostEditing(null)
        fetchProducts()
        if (histories[prod.product_id]) loadHistory(prod.product_id)
      } else {
        message.error(r.data.error || '保存失败')
      }
    } finally {
      costSubmittingRef.current = false
    }
  }

  const loadHistory = async (productId) => {
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}/cost/history`)
      const d = await res.json()
      setHistories(prev => ({ ...prev, [productId]: d.history || [] }))
    } catch (e) { message.error('历史加载失败') }
  }

  const toggleExpand = async (prod) => {
    if (expanded === prod.product_id) { setExpanded(null); return }
    setExpanded(prod.product_id)
    setEditingProduct(null); setEditingAlias(null); setCostEditing(null); setHistEditing(null)
    await loadHistory(prod.product_id)
  }

  const postHistory = async (productId, body, overwrite) => {
    return postJSON(`/api/products/${productId}/cost/history`, { ...body, overwrite })
  }
  const addHistory = async (prod) => {
    const f = histForm[prod.product_id] || {}
    if (!f.date) { message.error('请填写生效日期'); return }
    const v = Number(f.price)
    if (!isFinite(v) || v < 0 || String(f.price ?? '').trim() === '') {
      message.error('请填写合法的进货价'); return
    }
    const body = { cost_price: v, effective_from: f.date, note: f.note || '补录' }
    let r = await postHistory(prod.product_id, body, false)
    if (r.status === 409) {
      Modal.confirm({
        title: '该日期已有进货价',
        content: r.data.error || '是否覆盖？',
        okText: '覆盖', cancelText: '取消',
        onOk: async () => {
          const r2 = await postHistory(prod.product_id, body, true)
          if (r2.ok) {
            message.success('已覆盖')
            setHistForm(prev => ({ ...prev, [prod.product_id]: { date: '', price: '', note: '' } }))
            loadHistory(prod.product_id); fetchProducts()
          } else message.error(r2.data.error || '失败')
        },
      })
      return
    }
    if (r.ok) {
      message.success('已补录')
      setHistForm(prev => ({ ...prev, [prod.product_id]: { date: '', price: '', note: '' } }))
      loadHistory(prod.product_id); fetchProducts()
    } else message.error(r.data.error || '失败')
  }
  const deleteHistory = async (productId, costId) => {
    const res = await fetch(`${API_BASE}/api/products/cost/history/${costId}`, { method: 'DELETE' })
    let data = {}
    try { data = await res.json() } catch (e) { /* ignore */ }
    if (res.ok) { message.success('已删除，当前进货价已重算'); loadHistory(productId); fetchProducts() }
    else message.error(data.error || '失败')
  }

  const startEditHistory = (h) => {
    setHistEditing(h.id)
    setHistEditValue({
      date: h.effective_from,
      price: String(h.cost_price),
      note: h.note || '',
    })
  }
  const postHistoryEdit = (costId, body, overwrite) =>
    postJSON(`/api/products/cost/history/${costId}`, { ...body, overwrite }, 'PATCH')

  const saveHistoryEdit = async (productId, costId) => {
    const rawPrice = String(histEditValue.price ?? '').trim()
    const v = Number(rawPrice)
    if (rawPrice === '' || !isFinite(v) || v < 0) { message.error('请填写合法的进货价'); return }
    if (!String(histEditValue.date || '').trim()) { message.error('请填写生效日期'); return }
    const body = {
      cost_price: v,
      effective_from: histEditValue.date.trim(),
      note: histEditValue.note || '',
    }
    let r = await postHistoryEdit(costId, body, false)
    if (r.status === 409) {
      Modal.confirm({
        title: '该日期已有进货价',
        content: `${r.data.error || ''}，是否合并（覆盖那条）？`,
        okText: '合并覆盖', cancelText: '取消',
        onOk: async () => {
          const r2 = await postHistoryEdit(costId, body, true)
          if (r2.ok) {
            message.success('已修改')
            setHistEditing(null)
            loadHistory(productId); fetchProducts()
          } else message.error(r2.data.error || '失败')
        },
      })
      return
    }
    if (r.ok) {
      message.success('已修改')
      setHistEditing(null)
      loadHistory(productId); fetchProducts()
    } else message.error(r.data.error || '失败')
  }

  // ── 导入 / 新增 ───────────────────────────────────────
  const handleImport = async (file) => {
    setImporting(true); setImportResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API_BASE}/api/products/cost/import`, { method: 'POST', body: fd })
      let d = {}
      try { d = await res.json() } catch (e) { /* ignore */ }
      if (!res.ok) { message.error(d.error || '导入失败'); return }
      setImportResult(d)
      message.success(`导入完成：成功 ${d.success_count} 条`)
      fetchProducts()
    } catch (e) {
      message.error('导入失败')
    } finally {
      setImporting(false)
    }
  }
  const createProduct = async () => {
    const name = newForm.name.trim()
    if (!name) { message.error('请填写商品名'); return }
    if (!newForm.brand.trim()) { message.error('请填写品牌'); return }
    const body = { name, brand: newForm.brand.trim() }
    if (String(newForm.cost_price).trim() !== '') body.cost_price = Number(newForm.cost_price)
    const r = await postJSON('/api/products', body)
    if (r.ok) {
      message.success('商品已新增')
      setNewOpen(false); setNewForm({ name: '', brand: '', cost_price: '' })
      fetchProducts()
    } else message.error(r.data.error || '失败')
  }

  if (loading && products.length === 0) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />
  }

  const SBtn = ({ icon, dis, tip, onClick }) => (
    <Tooltip title={tip}>
      <Button
        type="text" size="small" icon={icon} disabled={dis} onClick={onClick}
        style={{ fontSize: 10, minWidth: 18, height: 20, padding: 0, color: dis ? T.textDim : T.primary }}
      />
    </Tooltip>
  )

  const totalAliases = products.reduce((n, p) => n + (p.aliases?.length || 0), 0)
  const costFilled = products.filter(p => p.current_cost != null).length

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* ── 工具栏 ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text strong style={{ fontSize: 15 }}>商品管理</Text>
        <Input
          size="small" allowClear placeholder="搜索商品名 / 别名 / 品牌"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        <AutoComplete
          size="small" value={brandFilter} style={{ width: 130 }}
          onChange={v => setBrandFilter(v || '全部')}
          options={[{ value: '全部' }, ...brandOptions.map(b => ({ value: b }))]}
          placeholder="品牌"
        />
        <Button size="small" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>新增</Button>
        <Button size="small" icon={<FileExcelOutlined />} onClick={() => { setImportOpen(true); setImportResult(null) }}>
          导入 Excel
        </Button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textSub }}>
          共 {products.length} 商品 · {totalAliases} 别名 · 已录进货价 {costFilled}/{products.length}
        </span>
      </div>
      <div style={{ fontSize: 11, color: T.textSub, marginBottom: 8 }}>
        ⠿ 拖拽 / ↑↓←→ 排序（地区 · 商品 · 别名三层均可排） · 进货价改完失焦或回车即存并自动记历史 ·
        点击商品名展开别名与进货价历史
        {isFiltering && <span style={{ color: T.flat }}> · 当前为筛选视图，排序仍按真实顺序生效</span>}
      </div>

      {visibleGroups.length === 0 && <Empty description="暂无商品" style={{ marginTop: 40 }} />}

      {visibleGroups.length > 0 && (
        <div style={{ overflowX: 'auto', border: `1px solid ${T.borderSoft}`, borderRadius: 8, background: T.card }}>
          <div style={{ minWidth: ROW_MIN_WIDTH }}>
            {/* 表头 */}
            <div style={{
              display: 'grid', gridTemplateColumns: GRID, gap: 6, padding: '6px 10px',
              background: T.cardAlt, borderBottom: `1px solid ${T.borderSoft}`,
              fontSize: 11, color: T.textSub, fontWeight: 600,
            }}>
              <div>标准商品名</div>
              <div>品牌</div>
              <div>别名</div>
              <div>进货价</div>
              <div>生效日期</div>
              <div style={{ textAlign: 'center' }}>排序</div>
              <div style={{ textAlign: 'right' }}>操作</div>
            </div>

            {visibleGroups.map((group) => {
              const brandIdx = brandOptions.indexOf(group.brand)
              const isCollapsed = collapsed[group.brand]
              return (
                <div key={group.brand}>
                  {/* 地区分隔行（拖拽 + ↑↓ 排序） */}
                  <div
                    draggable
                    onDragStart={(e) => brandDragStart(e, group.brand)}
                    onDragOver={(e) => brandDragOver(e, group.brand)}
                    onDrop={(e) => brandDrop(e, group.brand)}
                    onDragEnd={dragEnd}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                      background: dragOverBrand === group.brand ? T.hover : T.subtle,
                      borderTop: `1px solid ${T.borderSoft}`, borderBottom: `1px solid ${T.borderSoft}`,
                      cursor: 'grab',
                    }}
                  >
                    <HolderOutlined style={{ color: T.textDim, fontSize: 11 }} />
                    <Button
                      type="text" size="small"
                      icon={isCollapsed ? <RightCircleOutlined /> : <DownCircleOutlined />}
                      onClick={() => setCollapsed(prev => ({ ...prev, [group.brand]: !prev[group.brand] }))}
                      style={{ fontSize: 11, minWidth: 18, height: 18, padding: 0, color: T.primary }}
                    />
                    <Text strong style={{ fontSize: 12, color: T.primary }}>{group.brand}</Text>
                    <Tag style={{ fontSize: 10, margin: 0 }}>{group.products.length}种</Tag>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      <SBtn
                        icon={<UpOutlined />} dis={brandIdx <= 0} tip="地区上移"
                        onClick={() => moveBrandArrow(group.brand, -1)}
                      />
                      <SBtn
                        icon={<DownOutlined />} dis={brandIdx < 0 || brandIdx >= brandOptions.length - 1} tip="地区下移"
                        onClick={() => moveBrandArrow(group.brand, 1)}
                      />
                    </div>
                  </div>

                  {!isCollapsed && group.products.map((prod) => {
                    const isOpen = expanded === prod.product_id
                    const g = fullGroups.find(x => x.brand === group.brand)
                    const idxInBrand = g ? g.products.findIndex(p => p.product_id === prod.product_id) : -1
                    const aliasCount = prod.aliases?.length || 0
                    const inv = prod.inversion || {}
                    return (
                      <div key={prod.product_id}>
                        {/* 商品行 */}
                        <div
                          draggable
                          onDragStart={(e) => prodDragStart(e, group.brand, prod.product_id)}
                          onDragOver={(e) => prodDragOver(e, group.brand, prod.product_id)}
                          onDrop={(e) => prodDrop(e, group.brand, prod.product_id)}
                          onDragEnd={dragEnd}
                          style={{
                            display: 'grid', gridTemplateColumns: GRID, gap: 6, alignItems: 'center',
                            padding: '5px 10px',
                            borderBottom: `1px solid ${T.borderFaint}`,
                            background: dragOverProd === prod.product_id
                              ? T.hover
                              : (isOpen ? T.primaryBg : T.card),
                            border: dragOverProd === prod.product_id ? `1px dashed ${T.primary}` : undefined,
                            cursor: 'grab',
                          }}
                        >
                          {/* 商品名 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                            <HolderOutlined style={{ color: T.textDim, fontSize: 11 }} />
                            <Tag style={{ fontSize: 9, margin: 0, lineHeight: '14px', minWidth: 20, textAlign: 'center' }}>
                              {idxInBrand + 1}
                            </Tag>
                            {editingProduct === prod.product_id ? (
                              <>
                                <Input
                                  size="small" value={editValue} autoFocus
                                  onChange={e => setEditValue(e.target.value)}
                                  onPressEnter={() => saveProductName(prod.product_id)}
                                  style={{ flex: 1, fontSize: 11 }}
                                />
                                <Button size="small" type="primary" icon={<CheckOutlined />}
                                  style={{ fontSize: 10, minWidth: 20 }}
                                  onClick={() => saveProductName(prod.product_id)} />
                                <Button size="small" icon={<CloseOutlined />}
                                  style={{ fontSize: 10, minWidth: 20 }}
                                  onClick={() => setEditingProduct(null)} />
                              </>
                            ) : (
                              <Text
                                strong={isOpen}
                                style={{
                                  fontSize: 12, flex: 1, overflow: 'hidden',
                                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  cursor: 'pointer', color: isOpen ? T.primary : undefined,
                                }}
                                onClick={() => toggleExpand(prod)}
                              >
                                {prod.name}
                              </Text>
                            )}
                          </div>

                          {/* 品牌 */}
                          <div style={{ fontSize: 11, color: T.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {prod.brand || '—'}
                          </div>

                          {/* 别名数 */}
                          <div>
                            <Tag style={{ fontSize: 10, margin: 0 }}>{aliasCount}</Tag>
                          </div>

                          {/* 进货价 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {costEditing === prod.product_id ? (
                              <Input
                                size="small" autoFocus value={costValue}
                                onChange={e => setCostValue(e.target.value)}
                                onPressEnter={() => saveCost(prod)}
                                onBlur={() => saveCost(prod)}
                                style={{ width: 78, fontSize: 11 }}
                                placeholder="进货价"
                              />
                            ) : (
                              <span
                                onClick={() => startEditCost(prod)}
                                style={{
                                  fontSize: 12, cursor: 'pointer', minWidth: 54,
                                  color: prod.current_cost != null ? T.text : T.textDim,
                                  borderBottom: `1px dashed ${T.borderSoft}`,
                                }}
                              >
                                {prod.current_cost != null ? `¥${prod.current_cost.toFixed(2)}` : '—'}
                              </span>
                            )}
                            {inv.status === 'ok' && inv.inverted_pct > 0 && (
                              <Tooltip title={`倒挂 ${inv.inverted_amount > 0 ? '+' : ''}${inv.inverted_amount} 元（进货价高于最新售价 ${inv.inverted_pct}%）`}>
                                <Tag color={inv.level === 'critical' ? 'red' : 'orange'} style={{ fontSize: 9, margin: 0, padding: '0 3px' }}>
                                  倒挂
                                </Tag>
                              </Tooltip>
                            )}
                          </div>

                          {/* 生效日期 */}
                          <div style={{ fontSize: 11, color: prod.cost_effective_from ? T.textSub : T.textDim }}>
                            {prod.cost_effective_from || '—'}
                          </div>

                          {/* 排序 */}
                          <div style={{ display: 'flex', justifyContent: 'center', gap: 0 }}>
                            <SBtn
                              icon={<UpOutlined />} dis={idxInBrand <= 0} tip="商品上移"
                              onClick={(e) => { e.stopPropagation(); moveProductArrow(group.brand, prod.product_id, -1) }}
                            />
                            <SBtn
                              icon={<DownOutlined />}
                              dis={!g || idxInBrand < 0 || idxInBrand >= g.products.length - 1} tip="商品下移"
                              onClick={(e) => { e.stopPropagation(); moveProductArrow(group.brand, prod.product_id, 1) }}
                            />
                          </div>

                          {/* 操作 */}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Tooltip title={isOpen ? '收起' : '展开别名/进货价'}>
                              <Button
                                type="text" size="small"
                                icon={isOpen ? <UpOutlined /> : <DownOutlined />}
                                onClick={() => toggleExpand(prod)}
                                style={{ fontSize: 10, minWidth: 18 }}
                              />
                            </Tooltip>
                            <Tooltip title="改商品名">
                              <Button type="text" size="small" icon={<EditOutlined />}
                                onClick={() => startEditProduct(prod)}
                                style={{ fontSize: 10, minWidth: 18 }} />
                            </Tooltip>
                            <Popconfirm title="删除商品及其价格、别名、进货价记录？" onConfirm={() => deleteProduct(prod.product_id)}
                              okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                              <Tooltip title="删除">
                                <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                  style={{ fontSize: 10, minWidth: 18 }} />
                              </Tooltip>
                            </Popconfirm>
                          </div>
                        </div>

                        {/* 展开面板 */}
                        {isOpen && (
                          <div style={{
                            padding: '8px 14px 12px 30px', background: T.subtle,
                            borderBottom: `1px solid ${T.borderSoft}`, borderLeft: `3px solid ${T.primary}`,
                          }}>
                            {/* 基础信息 */}
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.primary, marginBottom: 4 }}>
                              基础信息
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', fontSize: 11 }}>
                              <span>
                                标准名：<Text strong style={{ fontSize: 11 }}>{prod.name}</Text>
                              </span>
                              <span>
                                品牌：<Text style={{ fontSize: 11 }}>{prod.brand || '—'}</Text>
                              </span>
                              <span>
                                最新售价：
                                <Text style={{ fontSize: 11 }}>
                                  {prod.current_price != null ? `¥${prod.current_price}` : '无报价'}
                                </Text>
                                {prod.current_price_date && (
                                  <Text style={{ fontSize: 10, color: T.textDim }}> ({prod.current_price_date})</Text>
                                )}
                              </span>
                              <span>
                                当前进货价：
                                {costEditing === prod.product_id ? (
                                  <Input
                                    size="small" value={costValue} autoFocus
                                    onChange={e => setCostValue(e.target.value)}
                                    onPressEnter={() => saveCost(prod)}
                                    onBlur={() => saveCost(prod)}
                                    style={{ width: 90, fontSize: 11 }}
                                  />
                                ) : (
                                  <Text
                                    style={{ fontSize: 11, cursor: 'pointer', borderBottom: `1px dashed ${T.borderSoft}` }}
                                    onClick={() => startEditCost(prod)}
                                  >
                                    {prod.current_cost != null ? `¥${prod.current_cost.toFixed(2)}` : '— 点击录入'}
                                  </Text>
                                )}
                              </span>
                              {inv.status === 'ok' && (
                                <span style={{ color: inv.inverted_pct > 0 ? T.down : T.up }}>
                                  倒挂：{inv.inverted_amount > 0 ? '+' : ''}{inv.inverted_amount} 元（{inv.inverted_pct}%）
                                </span>
                              )}
                            </div>

                            <Divider style={{ margin: '8px 0' }} />

                            {/* 别名管理 */}
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.primary, marginBottom: 4 }}>
                              别名管理 <Text style={{ fontSize: 10, color: T.textDim, fontWeight: 400 }}>
                                （⠿ 拖拽或 ↑↓ 排序，首行=首选别名）
                              </Text>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {(prod.aliases || []).map((a, ai) => (
                                <div
                                  key={a.id}
                                  draggable={editingAlias !== a.id}
                                  onDragStart={(e) => aliasDragStart(e, prod.product_id, a.id)}
                                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                                  onDrop={(e) => aliasDrop(e, prod.product_id, a.id)}
                                  onDragEnd={dragEnd}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 2,
                                    padding: '1px 4px', borderRadius: 4,
                                    background: ai === 0 ? T.primaryBg : T.card,
                                    border: `1px solid ${ai === 0 ? T.primary : T.borderSoft}`,
                                    cursor: 'grab',
                                  }}
                                >
                                  {editingAlias === a.id ? (
                                    <>
                                      <Input
                                        size="small" value={editValue} autoFocus
                                        onChange={e => setEditValue(e.target.value)}
                                        onPressEnter={() => saveAlias(a.id)}
                                        style={{ width: 90, fontSize: 10 }}
                                      />
                                      <Button size="small" type="primary" icon={<CheckOutlined />}
                                        style={{ fontSize: 9, minWidth: 18 }}
                                        onClick={() => saveAlias(a.id)} />
                                      <Button size="small" icon={<CloseOutlined />}
                                        style={{ fontSize: 9, minWidth: 18 }}
                                        onClick={() => setEditingAlias(null)} />
                                    </>
                                  ) : (
                                    <>
                                      <HolderOutlined style={{ color: T.textDim, fontSize: 10 }} />
                                      <Text style={{ fontSize: 11 }} onClick={() => startEditAlias(a)}>
                                        {a.alias}
                                      </Text>
                                      {ai === 0 && (
                                        <Tag color="blue" style={{ fontSize: 8, margin: 0, lineHeight: '14px', padding: '0 3px' }}>
                                          首
                                        </Tag>
                                      )}
                                      <Button type="text" size="small" icon={<UpOutlined />} disabled={ai === 0}
                                        onClick={() => moveAlias(prod.product_id, a.id, -1)}
                                        style={{ fontSize: 8, minWidth: 14, height: 16, padding: 0, color: ai === 0 ? T.textDim : T.textDim }} />
                                      <Button type="text" size="small" icon={<DownOutlined />}
                                        disabled={ai === (prod.aliases || []).length - 1}
                                        onClick={() => moveAlias(prod.product_id, a.id, 1)}
                                        style={{ fontSize: 8, minWidth: 14, height: 16, padding: 0, color: ai === (prod.aliases || []).length - 1 ? T.textDim : T.textDim }} />
                                      <Button type="text" size="small" danger icon={<CloseOutlined />}
                                        onClick={() => deleteAlias(a.id)}
                                        style={{ fontSize: 9, minWidth: 14, height: 16, padding: 0 }} />
                                    </>
                                  )}
                                </div>
                              ))}
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: 3, padding: '1px 4px',
                                borderRadius: 4, border: `1px dashed ${T.borderSoft}`,
                              }}>
                                <PlusOutlined style={{ color: T.textDim, fontSize: 9 }} />
                                <Input
                                  size="small" placeholder="添加别名"
                                  value={newAliasValues[prod.product_id] || ''}
                                  onChange={e => setNewAliasValues(prev => ({ ...prev, [prod.product_id]: e.target.value }))}
                                  onPressEnter={() => addAlias(prod.product_id)}
                                  style={{ width: 96, fontSize: 10 }}
                                />
                                <Button size="small" type="text" icon={<CheckOutlined />}
                                  onClick={() => addAlias(prod.product_id)}
                                  style={{ fontSize: 10, minWidth: 18 }} />
                              </div>
                            </div>

                            <Divider style={{ margin: '8px 0' }} />

                            {/* 进货价历史 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Button
                                type="link" size="small"
                                icon={<HistoryOutlined />}
                                onClick={() => setHistOpen(prev => ({ ...prev, [prod.product_id]: !prev[prod.product_id] }))}
                                style={{ fontSize: 11, padding: 0 }}
                              >
                                进货价历史 ({(histories[prod.product_id] || []).length})
                                {histOpen[prod.product_id] ? ' ▲' : ' ▼'}
                              </Button>
                              <Button type="text" size="small" icon={<ReloadOutlined />}
                                onClick={() => loadHistory(prod.product_id)}
                                style={{ fontSize: 10 }} />
                              <Text style={{ fontSize: 10, color: T.textDim }}>
                                每条都能改（✏️ 改价格/日期/备注，改完当前进货价自动重算）
                              </Text>
                            </div>

                            {histOpen[prod.product_id] && (
                              <div style={{ marginTop: 4 }}>
                                {(histories[prod.product_id] || []).length === 0 && (
                                  <Text style={{ fontSize: 11, color: T.textDim }}>暂无历史记录</Text>
                                )}
                                {(histories[prod.product_id] || []).map((h) => (
                                  <div key={h.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    fontSize: 11, padding: '3px 6px',
                                    borderBottom: `1px solid ${T.borderFaint}`,
                                    background: histEditing === h.id ? T.primaryBg : undefined,
                                  }}>
                                    {histEditing === h.id ? (
                                      <>
                                        <Input
                                          size="small" autoFocus value={histEditValue.date}
                                          placeholder="2025-12-01"
                                          onChange={e => setHistEditValue(v => ({ ...v, date: e.target.value }))}
                                          onPressEnter={() => saveHistoryEdit(prod.product_id, h.id)}
                                          style={{ width: 108, fontSize: 11 }}
                                        />
                                        <Input
                                          size="small" value={histEditValue.price} placeholder="进货价"
                                          onChange={e => setHistEditValue(v => ({ ...v, price: e.target.value }))}
                                          onPressEnter={() => saveHistoryEdit(prod.product_id, h.id)}
                                          style={{ width: 82, fontSize: 11 }}
                                        />
                                        <Input
                                          size="small" value={histEditValue.note} placeholder="备注"
                                          onChange={e => setHistEditValue(v => ({ ...v, note: e.target.value }))}
                                          onPressEnter={() => saveHistoryEdit(prod.product_id, h.id)}
                                          style={{ width: 108, fontSize: 11 }}
                                        />
                                        <Button size="small" type="primary" icon={<CheckOutlined />}
                                          onClick={() => saveHistoryEdit(prod.product_id, h.id)}
                                          style={{ fontSize: 11 }}>保存</Button>
                                        <Button size="small" icon={<CloseOutlined />}
                                          onClick={() => setHistEditing(null)}
                                          style={{ fontSize: 11 }}>取消</Button>
                                      </>
                                    ) : (
                                      <>
                                        <span style={{ width: 84, color: T.textSub }}>{h.effective_from}</span>
                                        <span style={{ width: 76, fontWeight: 600 }}>¥{Number(h.cost_price).toFixed(2)}</span>
                                        <Tag style={{ fontSize: 9, margin: 0 }}>{h.note || '—'}</Tag>
                                        <span style={{ flex: 1, fontSize: 10, color: T.textDim }}>{h.created_at}</span>
                                        <Tooltip title="修改这条历史（价格 / 生效日期 / 备注）">
                                          <Button type="text" size="small" icon={<EditOutlined />}
                                            onClick={() => startEditHistory(h)}
                                            style={{ fontSize: 10, minWidth: 18, color: T.primary }} />
                                        </Tooltip>
                                        <Popconfirm title="删除该条进货价记录？删除后当前进货价会重算"
                                          onConfirm={() => deleteHistory(prod.product_id, h.id)}
                                          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                                          <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                            style={{ fontSize: 10, minWidth: 18 }} />
                                        </Popconfirm>
                                      </>
                                    )}
                                  </div>
                                ))}

                                {/* 补录表单 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                                  <Input
                                    size="small" placeholder={todayStr()} style={{ width: 108, fontSize: 11 }}
                                    value={histForm[prod.product_id]?.date || ''}
                                    onChange={e => setHistForm(prev => ({
                                      ...prev, [prod.product_id]: { ...(prev[prod.product_id] || {}), date: e.target.value },
                                    }))}
                                  />
                                  <Input
                                    size="small" placeholder="进货价" style={{ width: 84, fontSize: 11 }}
                                    value={histForm[prod.product_id]?.price || ''}
                                    onChange={e => setHistForm(prev => ({
                                      ...prev, [prod.product_id]: { ...(prev[prod.product_id] || {}), price: e.target.value },
                                    }))}
                                  />
                                  <Input
                                    size="small" placeholder="备注(可选)" style={{ width: 110, fontSize: 11 }}
                                    value={histForm[prod.product_id]?.note || ''}
                                    onChange={e => setHistForm(prev => ({
                                      ...prev, [prod.product_id]: { ...(prev[prod.product_id] || {}), note: e.target.value },
                                    }))}
                                  />
                                  <Button size="small" type="primary" icon={<SaveOutlined />}
                                    onClick={() => addHistory(prod)}
                                    style={{ fontSize: 11 }}>
                                    补录
                                  </Button>
                                  <Text style={{ fontSize: 10, color: T.textDim }}>日期格式 2025-12-01 / 251201</Text>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 导入弹窗 ── */}
      <Modal
        title="导入进货价"
        open={importOpen}
        onCancel={() => { setImportOpen(false); setImportResult(null) }}
        footer={<Button onClick={() => { setImportOpen(false); setImportResult(null) }}>关闭</Button>}
        width={560}
      >
        <div style={{ fontSize: 12, color: T.textSub, marginBottom: 8 }}>
          模板列：<Text code>标准商品名</Text> | <Text code>进货价</Text> | <Text code>生效日期(可选)</Text>
          <br />
          <span style={{ color: T.flat }}>⚠️ 生效日期留空则默认为今天；填了则用于补录历史。</span>
        </div>
        <Button
          size="small" icon={<DownloadOutlined />} style={{ marginBottom: 10 }}
          onClick={() => {
            const a = document.createElement('a')
            a.href = `${API_BASE}/api/products/cost/template`
            a.download = '进货价模板.xlsx'
            a.click()
          }}
        >
          下载模板
        </Button>
        <Upload.Dragger
          name="file" accept=".xlsx,.xls" showUploadList={false} multiple={false}
          beforeUpload={(f) => { handleImport(f); return false }}
          disabled={importing}
        >
          <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
            <InboxOutlined style={{ color: T.primary }} />
          </p>
          <p style={{ fontSize: 12 }}>点击或拖拽 Excel 到此处{importing ? '（导入中…）' : ''}</p>
        </Upload.Dragger>

        {importResult && (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            <div style={{ color: T.down }}>✓ 成功：{importResult.success_count} 条</div>
            {importResult.skipped?.length > 0 && (
              <div style={{ color: T.flat, marginTop: 4 }}>
                ⚠ 跳过（未填进货价）：{importResult.skipped.length} 条
              </div>
            )}
            {importResult.failed?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ color: T.up }}>✗ 未匹配：{importResult.failed.length} 条</div>
                <div style={{
                  maxHeight: 160, overflowY: 'auto', background: 'rgba(255,77,79,0.08)',
                  border: '1px solid rgba(255,77,79,0.3)', borderRadius: 4, padding: 6, marginTop: 4,
                }}>
                  {importResult.failed.map((n, i) => (
                    <div key={i} style={{ fontSize: 11, color: T.up }}>{n}</div>
                  ))}
                </div>
                <Button
                  size="small" style={{ marginTop: 6 }}
                  onClick={() => {
                    navigator.clipboard?.writeText(importResult.failed.join('\n'))
                    message.success('未匹配名称已复制')
                  }}
                >
                  复制未匹配名称
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── 新增商品弹窗 ── */}
      <Modal
        title="新增商品"
        open={newOpen}
        onOk={createProduct}
        onCancel={() => setNewOpen(false)}
        okText="新增" cancelText="取消"
        width={420}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          <div>
            <div style={{ marginBottom: 3, color: T.textSub }}>标准商品名</div>
            <Input
              size="small" value={newForm.name} placeholder="如 中华(软)"
              onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <div style={{ marginBottom: 3, color: T.textSub }}>品牌（地区）</div>
            <AutoComplete
              size="small" style={{ width: '100%' }} value={newForm.brand}
              onChange={v => setNewForm(f => ({ ...f, brand: v }))}
              options={brandOptions.map(b => ({ value: b }))}
              placeholder="选择已有品牌或直接输入"
            />
          </div>
          <div>
            <div style={{ marginBottom: 3, color: T.textSub }}>进货价（可选）</div>
            <Input
              size="small" value={newForm.cost_price} placeholder="留空则稍后录入"
              onChange={e => setNewForm(f => ({ ...f, cost_price: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
