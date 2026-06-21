import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Button, List, Tag, Space, message, Typography, Spin, Popconfirm, Tooltip } from 'antd'
import { SaveOutlined, RollbackOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons'

const { Text } = Typography

const API_BASE = ''

export default function BackupRestoreModal({ open, onClose }) {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(false)
  const [backingUp, setBackingUp] = useState(false)

  const fetchBackups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/backups`)
      const data = await res.json()
      setBackups(data.backups || [])
    } catch (e) {
      message.error('获取备份列表失败')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) fetchBackups()
  }, [open, fetchBackups])

  const triggerDownload = (backupName) => {
    const a = document.createElement('a')
    a.href = `${API_BASE}/api/backup/download/${encodeURIComponent(backupName)}`
    a.download = backupName
    a.click()
  }

  const handleBackup = async () => {
    setBackingUp(true)
    try {
      const res = await fetch(`${API_BASE}/api/backup`, { method: 'POST' })
      const data = await res.json()
      if (data.status === 'ok') {
        message.success('备份成功！')
        fetchBackups()
        // Auto-download the backup to browser
        triggerDownload(data.name)
      } else {
        message.error(data.error || '备份失败')
      }
    } catch (e) {
      message.error('备份失败: ' + e.message)
    }
    setBackingUp(false)
  }

  const handleRestore = async (backupName) => {
    try {
      const res = await fetch(`${API_BASE}/api/restore/${encodeURIComponent(backupName)}`, { method: 'POST' })
      const data = await res.json()
      if (data.status === 'ok') {
        message.success(`已还原！共 ${data.brands_count} 个品牌`)
        setTimeout(() => window.location.reload(), 800)
      } else {
        message.error(data.error || '还原失败')
      }
    } catch (e) {
      message.error('还原失败: ' + e.message)
    }
  }

  return (
    <Modal
      title="💾 数据备份与还原"
      open={open}
      onCancel={onClose}
      footer={null}
      width={580}
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleBackup} loading={backingUp}>
            立即备份 & 下载
          </Button>
          <Tooltip title="刷新备份列表">
            <Button icon={<ReloadOutlined />} onClick={fetchBackups} loading={loading} />
          </Tooltip>
        </Space>
      </div>

      <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
        点击"立即备份"将在群晖保存一份，同时下载到浏览器
      </div>

      <Spin spinning={loading}>
        {backups.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>暂无备份</div>
        ) : (
          <List
            size="small"
            dataSource={backups}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    size="small"
                    type="link"
                    icon={<DownloadOutlined />}
                    onClick={() => triggerDownload(item.name)}
                  >
                    下载
                  </Button>,
                  <Popconfirm
                    title="确认还原此备份？当前数据将被覆盖"
                    onConfirm={() => handleRestore(item.name)}
                    okText="还原"
                    cancelText="取消"
                  >
                    <Button size="small" type="link" icon={<RollbackOutlined />}>
                      还原
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={<Text code>{item.name}</Text>}
                  description={`${item.time} · ${(item.size / 1024).toFixed(1)} KB`}
                />
              </List.Item>
            )}
          />
        )}
      </Spin>
    </Modal>
  )
}
