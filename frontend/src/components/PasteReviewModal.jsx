import React, { useState, useCallback } from 'react'
import { Modal, Button, Input, message, DatePicker } from 'antd'
import dayjs from 'dayjs'
import ReviewPanel from './ReviewPanel'

const { TextArea } = Input
const API_BASE = ''

export default function PasteReviewModal({ open, onClose }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [priceDate, setPriceDate] = useState(dayjs())

  const handleParse = useCallback(async () => {
    if (!text.trim()) { message.warning('请粘贴文本'); return }
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/paste/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const d = await r.json()
      const items = (d.items || []).map((it, i) => ({ ...it, _rid: i }))
      setResults(items)
    } catch (e) { message.error('解析失败') }
    setLoading(false)
  }, [text])

  return (
    <Modal title="📋 粘贴文本" open={open} onCancel={onClose}
      width={780} footer={null} destroyOnClose>
      {results.length === 0 ? (
        <div>
          <div style={{ marginBottom: 8 }}><DatePicker value={priceDate} onChange={d => setPriceDate(d)} format="YYYY-MM-DD" /></div>
          <TextArea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="粘贴商品文本到这里…" />
          <Button type="primary" onClick={handleParse} loading={loading} style={{ marginTop: 8 }}>解析</Button>
        </div>
      ) : (
        <ReviewPanel
          items={results}
          onRefresh={handleParse}
          onCancel={() => { setResults([]); setText('') }}
          initialDate={priceDate}
        />
      )}
    </Modal>
  )
}
