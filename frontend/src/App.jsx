import React, { useEffect, useState, useCallback, useRef } from 'react'
import { ConfigProvider, Layout, Typography, Button, Upload, message, Tooltip, Menu } from 'antd'
import { UploadOutlined, DownloadOutlined, CloudServerOutlined, FileExcelOutlined, SnippetsOutlined, DashboardOutlined, AlignLeftOutlined, ThunderboltOutlined } from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import SearchBar from './components/SearchBar'
import DashboardGrid from './components/DashboardGrid'
import DetailModal from './components/DetailModal'
import PriceReviewModal from './components/PriceReviewModal'
import BackupRestoreModal from './components/BackupRestoreModal'
import PasteReviewModal from './components/PasteReviewModal'
import AliasManager from './components/AliasManager'
import AIMatcher from './components/AIMatcher'
import { usePriceStore } from './store/priceStore'

const { Header, Content, Sider } = Layout
const { Title } = Typography

export default function App() {
  const { brands, loading, fetchDashboard, previewUpload, confirmUpload } = usePriceStore()
  const fileInputRef = useRef(null)

  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewData, setReviewData] = useState(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [currentView, setCurrentView] = useState('dashboard')

  useEffect(() => { fetchDashboard() }, [])

  const handleUpload = useCallback(async (file) => {
    try {
      const preview = await previewUpload(file)
      if (preview.alert_count > 0) {
        setReviewData({
          alerts: preview.alerts,
          sessionId: preview.session_id,
          dateStr: preview.date_str,
        })
        setReviewOpen(true)
      } else {
        await confirmUpload(preview.session_id, {})
        message.success(`上传成功！已合并 ${file.name}`)
      }
    } catch (e) { message.error(e.message || '上传失败') }
    return false
  }, [previewUpload, confirmUpload])

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    e.target.value = ''
  }, [handleUpload])

  const handleReviewConfirm = useCallback(async (sessionId, corrections) => {
    await confirmUpload(sessionId, corrections)
    setReviewOpen(false)
    setReviewData(null)
  }, [confirmUpload])

  const handleReviewCancel = useCallback(() => {
    setReviewOpen(false)
    setReviewData(null)
    message.info('已取消上传')
  }, [])

  const downloadTemplate = useCallback(() => {
    const a = document.createElement('a')
    a.href = '/api/template'
    a.download = '价格模板.xlsx'
    a.click()
  }, [])

  const menuItems = [
    { key: 'dashboard', icon: <DashboardOutlined />, label: '价格看板' },
    { key: 'upload_excel', icon: <FileExcelOutlined />, label: 'Excel上传' },
    { key: 'paste', icon: <SnippetsOutlined />, label: '粘贴上传' },
    { key: 'ai', icon: <ThunderboltOutlined />, label: 'AI 匹配' },
    { key: 'aliases', icon: <AlignLeftOutlined />, label: '别名管理' },
  ]

  return (
    <ConfigProvider locale={zhCN}>
      <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <Sider width={180} style={{
          background: '#fff', borderRight: '1px solid #f0f0f0',
          height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 200,
        }}>
          <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}>
            <Title level={5} style={{ margin: 0, fontSize: 14 }}>📊 价格追踪</Title>
          </div>
          {/* Hidden file input triggered by menu */}
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls"
            onChange={handleFileSelect} style={{ display: 'none' }} />
          <Menu
            mode="inline"
            selectedKeys={[currentView]}
            onClick={({ key }) => {
              if (key === 'upload_excel') { fileInputRef.current?.click(); return }
              if (key === 'paste') { setPasteOpen(true); return }
              setCurrentView(key)
            }}
            items={menuItems}
            style={{ borderRight: 0, marginTop: 4 }}
          />
        </Sider>

        <Layout style={{ marginLeft: 180 }}>
          <Header style={{
            background: '#fff', padding: '0 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            position: 'sticky', top: 0, zIndex: 100, height: 48, lineHeight: '48px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <SearchBar />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Tooltip title="下载包含最新售价的模板 Excel">
                <Button size="small" icon={<DownloadOutlined />} onClick={downloadTemplate}>
                  模板下载
                </Button>
              </Tooltip>
              <Tooltip title="数据备份与还原">
                <Button size="small" icon={<CloudServerOutlined />} onClick={() => setBackupOpen(true)}>
                  备份
                </Button>
              </Tooltip>
            </div>
          </Header>

          <Content style={{ padding: '8px 12px', minHeight: 'calc(100vh - 48px)' }}>
            {currentView === 'dashboard' && <DashboardGrid brands={brands} loading={loading} />}
            {currentView === 'aliases' && <AliasManager />}
            {currentView === 'ai' && <AIMatcher />}
          </Content>
        </Layout>
      </Layout>

      <PriceReviewModal
        open={reviewOpen}
        alerts={reviewData?.alerts || []}
        dateStr={reviewData?.dateStr || ''}
        sessionId={reviewData?.sessionId || ''}
        onConfirm={handleReviewConfirm}
        onCancel={handleReviewCancel}
      />
      <BackupRestoreModal open={backupOpen} onClose={() => setBackupOpen(false)} />
      <PasteReviewModal open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </ConfigProvider>
  )
}
