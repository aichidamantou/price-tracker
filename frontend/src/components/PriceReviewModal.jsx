import React, { useState, useMemo } from 'react'
import { Modal, Table, InputNumber, Button, Tag, Typography, Space, message } from 'antd'

const { Text } = Typography

export default function PriceReviewModal({
  open,
  alerts,
  dateStr,
  sessionId,
  onConfirm,
  onCancel,
}) {
  const [corrections, setCorrections] = useState({})
  const [confirming, setConfirming] = useState(false)

  // Reset corrections when modal opens with new data
  React.useEffect(() => {
    if (open) {
      const initial = {}
      alerts.forEach(a => {
        initial[a.item_name] = a.new_price
      })
      setCorrections(initial)
    }
  }, [open, alerts])

  const handlePriceChange = (itemName, value) => {
    setCorrections(prev => ({
      ...prev,
      [itemName]: value,
    }))
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      // Build corrections map: only send items whose price changed from original
      const finalCorrections = {}
      alerts.forEach(a => {
        const corrected = corrections[a.item_name]
        if (corrected !== a.new_price) {
          finalCorrections[a.item_name] = corrected
        }
      })
      await onConfirm(sessionId, finalCorrections)
      message.success(`已保存！共处理 ${alerts.length} 条价格提醒`)
      setConfirming(false)
    } catch (e) {
      message.error('保存失败: ' + e.message)
      setConfirming(false)
    }
  }

  const handleSkipAll = async () => {
    setConfirming(true)
    try {
      // Skip all corrections — keep original prices
      await onConfirm(sessionId, {})
      message.success('已跳过所有价格提醒，原始价格已保存')
      setConfirming(false)
    } catch (e) {
      message.error('保存失败: ' + e.message)
      setConfirming(false)
    }
  }

  const columns = [
    {
      title: '品牌',
      dataIndex: 'brand',
      key: 'brand',
      width: 80,
      render: (val) => <Text type="secondary" style={{ fontSize: 12 }}>{val}</Text>,
    },
    {
      title: '商品名',
      dataIndex: 'item_name',
      key: 'item_name',
      width: 120,
    },
    {
      title: '上期价格',
      dataIndex: 'old_price',
      key: 'old_price',
      width: 80,
      render: (val) => <Text>¥{val}</Text>,
    },
    {
      title: '新价格',
      key: 'new_price',
      width: 140,
      render: (_, record) => (
        <InputNumber
          size="small"
          value={corrections[record.item_name]}
          onChange={(v) => handlePriceChange(record.item_name, v)}
          min={0}
          style={{ width: 100 }}
          formatter={(value) => `¥${value}`}
          parser={(value) => value.replace(/[^0-9.]/g, '')}
        />
      ),
    },
    {
      title: '差额',
      key: 'diff',
      width: 70,
      render: (_, record) => {
        const corrected = corrections[record.item_name] ?? record.new_price
        const diff = corrected - record.old_price
        const color = diff > 0 ? '#ff4d4f' : diff < 0 ? '#52c41a' : '#999'
        return (
          <Text style={{ color, fontWeight: 600, fontSize: 13 }}>
            {diff > 0 ? `↑${diff}` : diff < 0 ? `↓${Math.abs(diff)}` : '—'}
          </Text>
        )
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      render: (_, record) => (
        <Button
          size="small"
          type="link"
          danger
          onClick={() => handlePriceChange(record.item_name, record.old_price)}
        >
          还原
        </Button>
      ),
    },
  ]

  return (
    <Modal
      title={
        <Space>
          <span>⚠️ 价格核对提醒</span>
          <Tag color="orange">{alerts.length} 项</Tag>
        </Space>
      }
      open={open}
      onCancel={onCancel}
      width={680}
      footer={
        <Space>
          <Button onClick={handleSkipAll} loading={confirming}>
            全部跳过
          </Button>
          {alerts.length > 0 && (
            <Button type="primary" onClick={handleConfirm} loading={confirming}>
              确认{alerts.length > 0 ? ` (${alerts.length}项)` : ''}
            </Button>
          )}
        </Space>
      }
      destroyOnClose
    >
      <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
        以下 <strong>{alerts.length}</strong> 项价格与上期差异 ≥ 20 元，请核对：
      </div>

      <Table
        dataSource={alerts}
        columns={columns}
        rowKey="item_name"
        size="small"
        pagination={false}
        scroll={{ y: 360 }}
        summary={() => alerts.length > 0 ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={6}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                • 可直接在"新价格"列修改数值
                • 点击"还原"恢复为上期价格
                • 点击"全部跳过"则保留 Excel 原值
                • 价格填 0 视为当日无报价
              </Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        ) : null}
      />
    </Modal>
  )
}
