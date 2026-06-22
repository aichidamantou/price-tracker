import React, { useState, useCallback } from 'react'
import { Modal, Button, Input, message, DatePicker } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import ReviewPanel from './ReviewPanel'

const { TextArea } = Input
const API_BASE = ''

export default function AIMatcher({ open, onClose }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [priceDate, setPriceDate] = useState(dayjs())

  const handleMatch = useCallback(async () => {
    if (!text.trim()) { message.warning('请粘贴文本'); return }
    setLoading(true)
    try {
      const pv = await fetch(`${API_BASE}/api/paste/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const pvd = await pv.json()
      const previewItems = pvd.items || []
      if (!previewItems.length) { message.warning('未解析'); setLoading(false); return }

      const r = await fetch(`${API_BASE}/api/paste/deepseek-compare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: previewItems }),
      })
      const rd = await r.json()
      const ds = (rd.items || []).map((d, i) => {
        const pi = previewItems.find(p => p.input === d.input)
        return { ...d, _rid: i, price: d.price ?? pi?.price ?? null, last_price: pi?.last_price ?? null, brand: d.brand || pi?.brand || '' }
      })
      setResults(ds)
      message.success(`AI 完成 ${ds.length} 条`)
    } catch (e) { message.error('匹配失败') }
    setLoading(false)
  }, [text])

  return (
    <Modal title="🤖 DeepSeek AI 匹配" open={open} onCancel={onClose}
      width={780} footer={null} destroyOnClose>
      {results.length === 0 ? (
        <div>
          <div style={{ marginBottom: 8 }}><DatePicker value={priceDate} onChange={d => setPriceDate(d)} format="YYYY-MM-DD" /></div>
          <TextArea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="粘贴商品文本，每行一个…" />
          <Button type="primary" onClick={handleMatch} loading={loading}
            icon={<ThunderboltOutlined />} style={{ marginTop: 8 }}>AI 匹配</Button>
        </div>
      ) : (
        <ReviewPanel
          items={results}
          onRefresh={handleMatch}
          onCancel={() => { setResults([]); setText('') }}
          initialDate={priceDate}
        />
      )}
    </Modal>
  )
}
