import React, { useEffect, useState, useCallback, useRef } from 'react'
import { ConfigProvider, Layout, Typography, Button, Upload, message, Tooltip, Menu, Drawer, theme as antdAlgo } from 'antd'
import { UploadOutlined, DownloadOutlined, CloudServerOutlined, FileExcelOutlined, SnippetsOutlined, DashboardOutlined, AlignLeftOutlined, ThunderboltOutlined, MenuOutlined, RobotOutlined } from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import SearchBar from './components/SearchBar'
import DashboardGrid from './components/DashboardGrid'
import DetailModal from './components/DetailModal'
import PriceReviewModal from './components/PriceReviewModal'
import BackupRestoreModal from './components/BackupRestoreModal'
import PasteReviewModal from './components/PasteReviewModal'
import ProductManager from './components/ProductManager'
import AIAnalysis from './components/AIAnalysis'
import AIMatcher from './components/AIMatcher'
import { usePriceStore } from './store/priceStore'
import { T, antdTheme, globalCss } from './utils/theme'

const { Header, Content, Sider } = Layout
const { Title } = Typography

const appTheme = {
  ...antdTheme,
  algorithm: antdAlgo.darkAlgorithm,
}

export default function App() {
  const { brands, loading, fetchDashboard, previewUpload, confirmUpload } = usePriceStore()
  const fileInputRef = useRef(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    fetchDashboard()
    return () => window.removeEventListener('resize', handler)
  }, [])

  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewData, setReviewData] = useState(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [currentView, setCurrentView] = useState('dashboard')

  const handleUpload = useCallback(async (file) => {
    try {
      const preview = await previewUpload(file)
      if (preview.alert_count > 0) {
        setReviewData({ alerts: preview.alerts, sessionId: preview.session_id, dateStr: preview.date_str })
        setReviewOpen(true)
      } else {
        await confirmUpload(preview.session_id, {})
        message.success(`上传成功！已合并 ${file.name}`)
      }
    } catch (e) { message.error(e.message || '上传失败') }
    return false
  }, [previewUpload, confirmUpload])

  const handleReviewConfirm = useCallback(async (sid, corr) => {
    await confirmUpload(sid, corr)
    setReviewOpen(false); setReviewData(null)
  }, [confirmUpload])
  const handleReviewCancel = useCallback(() => { setReviewOpen(false); setReviewData(null); message.info('已取消上传') }, [])
  const downloadTemplate = useCallback(() => { const a = document.createElement('a'); a.href='/api/template'; a.download='价格模板.xlsx'; a.click() }, [])
  const handleFileSelect = useCallback((e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }, [handleUpload])

  const menuItems = [
    { key: 'dashboard', icon: <DashboardOutlined />, label: '价格看板' },
    { key: 'upload_excel', icon: <FileExcelOutlined />, label: 'Excel上传' },
    { key: 'paste', icon: <SnippetsOutlined />, label: '粘贴上传' },
    { key: 'ai', icon: <ThunderboltOutlined />, label: 'AI 匹配' },
    { key: 'products', icon: <AlignLeftOutlined />, label: '商品管理' },
    { key: 'ai_analysis', icon: <RobotOutlined />, label: 'AI 分析' },
  ]

  const handleMenuClick = ({ key }) => {
    if (key === 'upload_excel') { fileInputRef.current?.click(); if (isMobile) setMobileOpen(false); return }
    if (key === 'paste') { setPasteOpen(true); if (isMobile) setMobileOpen(false); return }
    if (key === 'ai') { setAiOpen(true); if (isMobile) setMobileOpen(false); return }
    // 旧视图 key 'aliases' 保留跳转，统一落到商品管理
    setCurrentView(key === 'aliases' ? 'products' : key)
    if (isMobile) setMobileOpen(false)
  }

  const siderContent = (
    <>
      <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${T.borderSoft}` }}>
        <Title level={5} style={{ margin: 0, fontSize: 14, color: T.primary }}>价格追踪看板</Title>
      </div>
      <input type="file" ref={fileInputRef} accept=".xlsx,.xls" onChange={handleFileSelect} style={{ display: 'none' }} />
      <Menu mode="inline" selectedKeys={[currentView]} onClick={handleMenuClick} items={menuItems} style={{ borderRight: 0, marginTop: 4 }} />
    </>
  )

  return (
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <style>{globalCss}</style>
      <Layout style={{ minHeight: '100vh', background: T.page }}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <Sider width={180} style={{ background: T.cardAlt, borderRight: `1px solid ${T.borderSoft}`, height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 200 }}>
            {siderContent}
          </Sider>
        )}

        {/* Mobile drawer */}
        {isMobile && (
          <Drawer title={null} placement="left" open={mobileOpen} onClose={() => setMobileOpen(false)} width={200} styles={{ body: { padding: 0 } }}>
            {siderContent}
          </Drawer>
        )}

        <Layout style={{ marginLeft: isMobile ? 0 : 180 }}>
          <Header style={{
            background: T.glass, backdropFilter: T.glassBlur, padding: '0 8px',
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', borderBottom: `1px solid ${T.borderSoft}`,
            position: 'sticky', top: 0, zIndex: 100, height: 48,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setMobileOpen(true)} />}
              {!isMobile && <SearchBar />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {isMobile && <Tooltip title="上传 Excel"><Upload name="file" accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleUpload}><Button size="small" icon={<UploadOutlined />} /></Upload></Tooltip>}
              <Tooltip title="模板下载"><Button size="small" icon={<DownloadOutlined />} onClick={downloadTemplate} /></Tooltip>
              <Tooltip title="备份"><Button size="small" icon={<CloudServerOutlined />} onClick={() => setBackupOpen(true)} /></Tooltip>
            </div>
          </Header>

          <Content style={{ padding: isMobile ? '4px' : '8px 12px', minHeight: 'calc(100vh - 48px)' }}>
            {currentView === 'dashboard' && <DashboardGrid brands={brands} loading={loading} />}
            {(currentView === 'products' || currentView === 'aliases') && <ProductManager />}
            {currentView === 'ai_analysis' && <AIAnalysis />}
          </Content>
        </Layout>
      </Layout>

      <PriceReviewModal open={reviewOpen} alerts={reviewData?.alerts || []} dateStr={reviewData?.dateStr || ''} sessionId={reviewData?.sessionId || ''} onConfirm={handleReviewConfirm} onCancel={handleReviewCancel} />
      <BackupRestoreModal open={backupOpen} onClose={() => setBackupOpen(false)} />
      <PasteReviewModal open={pasteOpen} onClose={() => setPasteOpen(false)} />
      <AIMatcher open={aiOpen} onClose={() => setAiOpen(false)} />
    </ConfigProvider>
  )
}