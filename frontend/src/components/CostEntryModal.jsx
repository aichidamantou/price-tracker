import React, { useState, useEffect } from 'react'
import { Modal, Input, Button, message, Typography, Tag, Divider } from 'antd'

const { Text } = Typography
const API_BASE = ''
import { T } from '../utils/theme'

const todayStr = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const fmtMoney = (n) => {
  const v = Number(n)
  return Number.isInteger(v) ? `${v}` : v.toFixed(2)
}

/**
 * 公司价（烟草公司进货价）录入弹窗。
 * 从价格看板卡片上的「暂缺数据 / 公司价」点进来，可补录任意生效日期的进货价。
 */
export default function CostEntryModal({ open, item, onClose, onSaved }) {
  const [date, setDate] = useState(todayStr())
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState([])

  const loadHistory = async (productId) => {
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}/cost/history`)
      const d = await res.json()
      setHistory(d.history || [])
    } catch (e) { setHistory([]) }
  }

  useEffect(() => {
    if (!open || !item) return
    setDate(todayStr())
    setPrice(item.cost != null ? String(item.cost) : '')
    setNote('')
    if (item.product_id) loadHistory(item.product_id)
  }, [open, item])

  const doSubmit = async (overwrite) => {
    const v = Number(price)
    if (String(price).trim() === '' || !isFinite(v) || v < 0) {
      message.error('请填写合法的进货价')
      return false
    }
    if (!String(date).trim()) { message.error('请填写生效日期'); return false }
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/products/${item.product_id}/cost/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cost_price: v,
          effective_from: date.trim(),
          note: note.trim() || '手动更新',
          overwrite,
        }),
      })
      let d = {}
      try { d = await res.json() } catch (e) { /* ignore */ }
      if (res.status === 409) {
        Modal.confirm({
          title: '该日期已有公司价',
          content: `${d.error || ''}，是否覆盖？`,
          okText: '覆盖', cancelText: '取消',
          onOk: async () => { await doSubmit(true) },
        })
        return false
      }
      if (!res.ok) { message.error(d.error || '保存失败'); return false }
      message.success('公司价已保存')
      onSaved && onSaved()
      onClose && onClose()
      return true
    } finally {
      setSaving(false)
    }
  }

  if (!item) return null

  return (
    <Modal
      title={`公司价 — ${item.name}`}
      open={open}
      onCancel={onClose}
      width={460}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="ok" type="primary" loading={saving} onClick={() => doSubmit(false)}>保存</Button>,
      ]}
    >
      <div style={{ fontSize: 12, color: T.textSub, marginBottom: 10 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          公司价 = 烟草公司进货价。填生效日期 + 价格即可，留空日期默认今天。
        </Text>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: T.textSub, marginBottom: 3 }}>生效日期</div>
          <Input
            size="small" value={date} placeholder={todayStr()}
            onChange={e => setDate(e.target.value)}
            style={{ width: 160 }}
          />
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
            支持 2025-12-01 / 251201
          </Text>
        </div>
        <div>
          <div style={{ fontSize: 12, color: T.textSub, marginBottom: 3 }}>进货价（元）</div>
          <Input
            size="small" value={price} placeholder="如 583.00" autoFocus
            onChange={e => setPrice(e.target.value)}
            onPressEnter={() => doSubmit(false)}
            style={{ width: 160 }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: T.textSub, marginBottom: 3 }}>备注（可选）</div>
          <Input
            size="small" value={note} placeholder="如 供应商调价"
            onChange={e => setNote(e.target.value)}
            onPressEnter={() => doSubmit(false)}
            style={{ width: 220 }}
          />
        </div>
      </div>

      {history.length > 0 && (
        <>
          <Divider style={{ margin: '14px 0 8px' }} />
          <div style={{ fontSize: 12, color: T.textSub, marginBottom: 4 }}>
            已有记录（{history.length} 条，最新的生效）
          </div>
          <div style={{ maxHeight: 150, overflowY: 'auto' }}>
            {history.map(h => (
              <div key={h.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 11, padding: '3px 4px', borderBottom: `1px solid ${T.borderFaint}`,
              }}>
                <span style={{ width: 84, color: T.textSub }}>{h.effective_from}</span>
                <span style={{ width: 70, fontWeight: 600 }}>¥{fmtMoney(h.cost_price)}</span>
                <Tag style={{ fontSize: 9, margin: 0 }}>{h.note || '—'}</Tag>
              </div>
            ))}
          </div>
          <Text type="secondary" style={{ fontSize: 10 }}>
            要修改或删除某条历史，去「商品管理」展开该商品即可。
          </Text>
        </>
      )}
    </Modal>
  )
}
