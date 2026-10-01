import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Typography, Select, Button, Modal, Input, message, Empty, Spin, Tag, Tooltip,
  Popconfirm, DatePicker, Divider, Space, Radio, Alert,
} from 'antd'
import {
  ExportOutlined, ImportOutlined, DeleteOutlined, CopyOutlined, DownloadOutlined,
  RobotOutlined, ReloadOutlined, ThunderboltOutlined, WarningOutlined, BulbOutlined,
  RiseOutlined, FallOutlined, LineChartOutlined, HistoryOutlined, AppstoreOutlined,
} from '@ant-design/icons'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, TitleComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import dayjs from 'dayjs'
import { STATUS_COLOR } from '../utils/priceStatus'
import { T } from '../utils/theme'

echarts.use([
  LineChart, BarChart, HeatmapChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, TitleComponent,
  SVGRenderer,
])

const { Text, Paragraph } = Typography
const { RangePicker } = DatePicker
const API_BASE = ''

const UP = STATUS_COLOR.up      // 涨 = 红
const DOWN = STATUS_COLOR.down  // 跌 = 绿

const pctColor = (v) => (v > 0 ? UP : v < 0 ? DOWN : T.textSub)
const pctText = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`

const fmtTime = (s) => (s || '').replace('T', ' ').slice(0, 16)

export default function AIAnalysis() {
  const [records, setRecords] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [charts, setCharts] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [brandOptions, setBrandOptions] = useState([])

  // 弹窗
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  // 导出配置
  const [range, setRange] = useState(null)
  const [scope, setScope] = useState('all')
  const [pickedBrands, setPickedBrands] = useState([])
  const [exporting, setExporting] = useState(false)
  const [exportPreview, setExportPreview] = useState(null)

  // 导入
  const [pasteText, setPasteText] = useState('')
  const [pasteTitle, setPasteTitle] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const analysis = detail?.analysis_data || null

  // ── 列表 ──────────────────────────────────────────────
  const loadList = useCallback(async (autoSelect = true) => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/list`)
      const d = await res.json()
      const list = d.records || []
      setRecords(list)
      if (autoSelect && list.length && !list.some(r => r.id === selectedId)) {
        setSelectedId(list[0].id)
      }
    } catch (e) { message.error('加载时间线失败') }
    setLoadingList(false)
  }, [selectedId])

  useEffect(() => { loadList() }, [])

  // 品牌选项（导出用）
  useEffect(() => {
    fetch(`${API_BASE}/api/dashboard`)
      .then(r => r.json())
      .then(d => setBrandOptions((d.brands || []).map(b => ({ label: b.brand, value: b.brand }))))
      .catch(() => {})
  }, [])

  // ── 详情 + 该区间的价格数据（供图表用）────────────────
  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); setCharts(null); return }
    setLoadingDetail(true)
    try {
      const res = await fetch(`${API_BASE}/api/ai/${id}`)
      if (!res.ok) { message.error('记录不存在'); setDetail(null); return }
      setDetail(await res.json())
      // 图表数据由后端聚合好（不再拉 2MB 全量导出在浏览器里遍历）
      const cr = await fetch(`${API_BASE}/api/ai/${id}/charts`)
      setCharts(cr.ok ? await cr.json() : null)
    } catch (e) {
      message.error('加载详情失败')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => { loadDetail(selectedId) }, [selectedId, loadDetail])

  // ── 图表数据 ──────────────────────────────────────────
  // 全部由后端 /api/ai/{id}/charts 聚合好，前端只做渲染
  const marketIndex = useMemo(() => {
    const mi = charts?.market_index
    return mi && mi.values?.length >= 2 ? mi : null
  }, [charts])

  const brandRank = useMemo(() => charts?.brand_rank || [], [charts])

  const riskHeat = useMemo(() => {
    const rh = charts?.risk_heat
    if (!rh || !rh.brands?.length || !rh.cells?.length) return null
    return { brands: rh.brands, data: rh.cells, max: rh.max || 1 }
  }, [charts])

  const invertedTop = useMemo(() => charts?.inverted_top || [], [charts])

  const predictions = useMemo(
    () => ((charts?.predictions?.length ? charts.predictions : analysis?.predictions) || []).slice(0, 6),
    [charts, analysis])

  // ── 图表 option ───────────────────────────────────────
  const lineOpt = useMemo(() => {
    if (!marketIndex) return null
    const last = marketIndex.values[marketIndex.values.length - 1]
    const c = last > 100 ? UP : last < 100 ? DOWN : T.textSub
    return {
      grid: { left: 46, right: 14, top: 18, bottom: 26 },
      tooltip: { trigger: 'axis', valueFormatter: v => Number(v).toFixed(2) },
      xAxis: {
        type: 'category', data: marketIndex.dates.map(d => d.slice(5)),
        axisLine: { lineStyle: { color: T.axisLine } },
        axisLabel: { fontSize: 10, color: T.textDim },
      },
      yAxis: {
        type: 'value', scale: true,
        splitLine: { lineStyle: { color: T.grid } },
        axisLabel: { fontSize: 10, color: T.textDim },
      },
      series: [{
        type: 'line', data: marketIndex.values, smooth: true,
        symbol: 'none', lineStyle: { width: 2, color: c },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: (c === UP ? T.areaUp : T.areaDown) },
              { offset: 1, color: 'rgba(255,255,255,0)' },
            ],
          },
        },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: T.axis, type: 'dashed', width: 1 },
          data: [{ yAxis: 100, label: { formatter: '基准100', fontSize: 9, color: T.textDim } }],
        },
      }],
    }
  }, [marketIndex])

  const barOpt = useMemo(() => {
    if (!brandRank.length) return null
    return {
      grid: { left: 62, right: 40, top: 10, bottom: 22 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: p => {
          const it = brandRank[p[0].dataIndex]
          return `${it.brand}<br/>平均涨跌 <b style="color:${pctColor(it.avg)}">${pctText(it.avg)}</b><br/>商品数 ${it.n}`
        },
      },
      xAxis: {
        type: 'value', axisLabel: { fontSize: 10, color: T.textDim, formatter: '{value}%' },
        splitLine: { lineStyle: { color: T.grid } },
      },
      yAxis: {
        type: 'category', data: brandRank.map(b => b.brand),
        axisLabel: { fontSize: 10, color: T.textSub },
        axisLine: { lineStyle: { color: T.axisLine } },
      },
      series: [{
        type: 'bar', barWidth: '62%',
        data: brandRank.map(b => ({
          value: b.avg,
          itemStyle: { color: b.avg > 0 ? UP : b.avg < 0 ? DOWN : T.textDim, borderRadius: 2 },
        })),
        label: {
          show: true, position: 'right', fontSize: 9, color: T.textSub,
          formatter: p => `${p.value > 0 ? '+' : ''}${p.value}%`,
        },
      }],
    }
  }, [brandRank])

  const heatOpt = useMemo(() => {
    if (!riskHeat) return null
    return {
      grid: { left: 62, right: 16, top: 12, bottom: 30 },
      tooltip: {
        formatter: p => `${riskHeat.brands[p.data[1]]} · ${['高风险', '中风险', '低风险'][p.data[0]]}<br/><b>${p.data[2]}</b> 个`,
      },
      xAxis: {
        type: 'category', data: ['高风险', '中风险', '低风险'],
        axisLabel: { fontSize: 10, color: T.textSub }, splitArea: { show: true },
      },
      yAxis: {
        type: 'category', data: riskHeat.brands,
        axisLabel: { fontSize: 10, color: T.textSub }, splitArea: { show: true },
      },
      visualMap: {
        min: 0, max: riskHeat.max, calculable: false, orient: 'horizontal',
        left: 'center', bottom: 0, itemHeight: 60, itemWidth: 10,
        textStyle: { fontSize: 9, color: T.textDim },
        inRange: { color: ['rgba(0,212,255,0.18)', 'rgba(250,173,20,0.45)', 'rgba(255,77,79,0.62)', 'rgba(255,77,79,0.95)'] },
      },
      series: [{
        type: 'heatmap', data: riskHeat.data,
        label: { show: true, fontSize: 9, color: T.text },
        itemStyle: { borderColor: T.card, borderWidth: 1 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.65)' } },
      }],
    }
  }, [riskHeat])

  const predOpt = useMemo(() => {
    if (!predictions.length) return null
    const palette = [T.primary, T.up, T.down, T.flat, '#a78bfa', '#22d3ee']
    return {
      grid: { left: 52, right: 16, top: 30, bottom: 24 },
      tooltip: {
        trigger: 'axis',
        formatter: ps => {
          const i = ps[0].dataIndex
          return ps.map(p => `${p.marker}${p.seriesName}: <b>¥${p.value}</b>`).join('<br/>')
            + (i === 1 ? '<br/><span style="color:${T.textDim};font-size:10px">（30 天预测值）</span>' : '')
        },
      },
      legend: {
        type: 'scroll', top: 0, itemWidth: 12, itemHeight: 8,
        textStyle: { fontSize: 10, color: T.textSub },
      },
      xAxis: {
        type: 'category', data: ['当前', '30天后'],
        axisLabel: { fontSize: 10, color: T.textSub },
        axisLine: { lineStyle: { color: T.axisLine } },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value', scale: true, axisLabel: { fontSize: 10, color: T.textDim },
        splitLine: { lineStyle: { color: T.grid } },
      },
      series: predictions.map((p, i) => ({
        name: p.product_name, type: 'line',
        data: [p.current_price, p.predicted_price_30d],
        symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 1.6, type: 'dashed', color: palette[i % palette.length] },
        itemStyle: { color: palette[i % palette.length] },
      })),
    }
  }, [predictions])

  // ── 导出 ──────────────────────────────────────────────
  const buildExportBody = () => {
    const body = {}
    if (range && range[0]) body.date_from = range[0].format('YYYY-MM-DD')
    if (range && range[1]) body.date_to = range[1].format('YYYY-MM-DD')
    return body
  }

  const runExport = async () => {
    setExporting(true)
    try {
      const res = await fetch(`${API_BASE}/api/export/prices`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildExportBody()),
      })
      const d = await res.json()
      if (!res.ok) { message.error(d.error || '导出失败'); return null }
      // 按品牌过滤（前端过滤，避免后端再开一个参数）
      if (scope === 'brand' && pickedBrands.length) {
        d.products = d.products.filter(p => pickedBrands.includes(p.brand))
        d.product_count = d.products.length
        d.total_records = d.products.reduce((n, p) => n + p.price_history.length, 0)
      }
      setExportPreview(d)
      return d
    } catch (e) {
      message.error('导出失败')
      return null
    } finally {
      setExporting(false)
    }
  }

  const copyText = async (text, tip) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(tip || '已复制到剪贴板')
    } catch (e) {
      message.warning('浏览器拒绝访问剪贴板，请手动下载 JSON')
    }
  }

  const downloadJson = (d) => {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `价格数据_${d.date_range.from || 'all'}_${d.date_range.to || 'now'}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── 导入 ──────────────────────────────────────────────
  const doImport = async () => {
    if (!pasteText.trim()) { message.error('请先粘贴 AI 返回的内容'); return }
    setImporting(true); setImportError('')
    try {
      const res = await fetch(`${API_BASE}/api/ai/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText, title: pasteTitle }),
      })
      const d = await res.json()
      if (!res.ok) {
        setImportError(d.error || '导入失败')
        message.error(d.error || '导入失败')
        return
      }
      message.success('导入成功，已生成一条时间线记录')
      if (d.warnings?.length) message.warning(d.warnings.join('；'))
      setImportOpen(false)
      setPasteText(''); setPasteTitle('')
      await loadList(false)
      setSelectedId(d.id)
    } catch (e) {
      setImportError('网络错误')
      message.error('导入失败')
    } finally {
      setImporting(false)
    }
  }

  const doDelete = async (id) => {
    const res = await fetch(`${API_BASE}/api/ai/${id}`, { method: 'DELETE' })
    if (res.ok) {
      message.success('已删除')
      setRecords(prev => prev.filter(r => r.id !== id))
      if (selectedId === id) { setSelectedId(null); setDetail(null); setExportData(null) }
      loadList()
    } else message.error('删除失败')
  }

  // ── 渲染 ──────────────────────────────────────────────
  // KPI 优先用后端聚合（口径与图表一致），退化时回落到 AI 原始 overview
  const ov = analysis?.overview || {}
  const risk = analysis?.risk_assessment || {}
  const kpi = charts?.kpi || {}
  const kTotal = kpi.total ?? ov.total_products
  const kAvg = kpi.avg_change_pct ?? ov.avg_change_pct
  const kInverted = kpi.inverted_count ?? ov.inverted_count
  const kRiskLevel = kpi.risk_level || ov.risk_level
  const kHealth = kpi.health_index

  // AI 只提供文字；数字一律来自本地引擎
  const aiText = charts?.ai_text || {}
  const summaryText = aiText.summary || analysis?.summary || ''
  const marketCtx = (aiText.market_context && Object.keys(aiText.market_context).length)
    ? aiText.market_context : (analysis?.market_context || {})
  const recs = (aiText.recommendations?.length ? aiText.recommendations : analysis?.recommendations) || []
  const catInsights = aiText.category_insights || []
  const catStats = charts?.category_stats || {}
  const riskCount = kpi.high_risk != null
    ? (kpi.high_risk + kpi.medium_risk)
    : ((risk.high_risk?.length || 0) + (risk.medium_risk?.length || 0))

  const Kpi = ({ label, value, color, suffix, icon }) => (
    <div style={{
      flex: '1 1 150px', background: T.card, border: `1px solid ${T.borderSoft}`,
      borderRadius: 8, padding: '10px 14px',
    }}>
      <div style={{ fontSize: 11, color: T.textSub, display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color || T.text, marginTop: 2 }}>
        {value}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>{suffix}</span>
      </div>
    </div>
  )

  const Panel = ({ title, extra, children, height = 240 }) => (
    <div style={{
      flex: '1 1 380px', minWidth: 320, background: T.card,
      border: `1px solid ${T.borderSoft}`, borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <Text strong style={{ fontSize: 12.5 }}>{title}</Text>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textDim }}>{extra}</span>
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  )

  const chartOrEmpty = (opt, tip) => (opt
    ? <ReactEChartsCore echarts={echarts} option={opt} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
    : <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, color: T.textDim, textAlign: 'center', padding: 12,
    }}>{tip}</div>)

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* ── 工具栏 ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
        background: T.card, border: `1px solid ${T.borderSoft}`, borderRadius: 8,
        padding: '8px 12px', marginBottom: 10,
      }}>
        <RobotOutlined style={{ color: T.primary, fontSize: 16 }} />
        <Text strong style={{ fontSize: 15 }}>AI 分析</Text>
        <Select
          size="small" style={{ minWidth: 300 }} placeholder="选择导入批次"
          value={selectedId ?? undefined}
          onChange={setSelectedId}
          loading={loadingList}
          options={records.map(r => {
            const span = (r.date_range_from || r.date_range_to)
              ? `${r.date_range_from || '最早'}~${r.date_range_to || '至今'}`
              : '全部时间'
            return {
              value: r.id,
              label: `${r.import_time.slice(0, 16)} 导入（${span}）${r.title ? ' · ' + r.title : ''}`,
            }
          })}
          notFoundContent="还没有导入记录"
        />
        <Button size="small" icon={<ReloadOutlined />} onClick={() => { loadList(); loadDetail(selectedId) }}>
          刷新
        </Button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setGuideOpen(true)}>使用说明</Button>
          <Button size="small" icon={<ExportOutlined />} onClick={() => { setExportOpen(true); setExportPreview(null) }}>
            导出数据
          </Button>
          <Button size="small" type="primary" icon={<ImportOutlined />} onClick={() => { setImportOpen(true); setImportError('') }}>
            粘贴导入
          </Button>
          {selectedId && (
            <Popconfirm title="删除这条分析记录？" onConfirm={() => doDelete(selectedId)}
              okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </div>
      </div>

      {loadingList ? (
        <Spin style={{ display: 'block', margin: '60px auto' }} />
      ) : !records.length ? (
        <div style={{
          background: T.card, border: `1px dashed ${T.borderSoft}`, borderRadius: 8,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <RobotOutlined style={{ fontSize: 40, color: T.axis }} />
          <div style={{ marginTop: 12, fontSize: 14, color: T.text }}>还没有任何 AI 分析记录</div>
          <div style={{ marginTop: 6, fontSize: 12, color: T.textSub, lineHeight: 1.9 }}>
            流程：<b>导出数据</b> → 复制给 DeepSeek 等 AI → 把 AI 返回的 JSON <b>粘贴导入</b>
          </div>
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" icon={<ExportOutlined />} onClick={() => { setExportOpen(true); setExportPreview(null) }}>
              第一步：导出数据
            </Button>
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>已有结果，直接导入</Button>
          </Space>
        </div>
      ) : (
        <>
          {/* ── KPI ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            <Kpi label="商品总数" value={kTotal ?? '—'} suffix="个" icon={<LineChartOutlined />} />
            <Kpi
              label="均价涨跌"
              value={kAvg != null ? pctText(kAvg) : '—'}
              color={kAvg != null ? pctColor(kAvg) : undefined}
              icon={kAvg > 0 ? <RiseOutlined /> : <FallOutlined />}
            />
            <Kpi label="倒挂商品" value={kInverted ?? '—'} suffix="个"
              color={kInverted > 0 ? T.down : undefined} icon={<WarningOutlined />} />
            <Kpi label="风险商品" value={riskCount || '—'} suffix="个"
              color={riskCount > 0 ? UP : undefined} icon={<WarningOutlined />} />
            <Kpi
              label="风险等级"
              value={{ high: '高', medium: '中', low: '低' }[kRiskLevel] || '—'}
              color={{ high: UP, medium: T.flat, low: T.down }[kRiskLevel]}
            />
            <Kpi
              label="健康指数"
              value={kHealth ?? '—'}
              suffix={kHealth != null ? '/100' : ''}
              color={kHealth == null ? undefined
                : kHealth >= 70 ? T.down : kHealth >= 45 ? T.flat : UP}
              icon={<ThunderboltOutlined />}
            />
          </div>

          {/* ── 品类表现（本地计算）── */}
          {Object.keys(catStats).length > 0 && (
            <div style={{
              background: T.card, border: `1px solid ${T.borderSoft}`, borderRadius: 8,
              padding: '10px 14px', marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <AppstoreOutlined style={{ color: T.primary }} />
                <Text strong style={{ fontSize: 12.5 }}>品类表现</Text>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textDim }}>
                  相对大盘 = 该品类涨跌幅 − 大盘涨跌幅
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }}>
                {['细支', '中支', '常规'].map(cat => {
                  const cs = catStats[cat]
                  if (!cs) return null
                  const rel = cs.relative_to_market
                  const insight = catInsights.find(x => x.category === cat)
                  return (
                    <div key={cat} style={{
                      background: T.subtle, border: `1px solid ${T.borderFaint}`,
                      borderRadius: 6, padding: '8px 10px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <Text strong style={{ fontSize: 13 }}>{cat}</Text>
                        <span style={{ fontSize: 11, color: T.textDim }}>{cs.product_count} 个</span>
                        {rel != null && (
                          <span style={{
                            marginLeft: 'auto', fontSize: 11.5, fontWeight: 600,
                            color: pctColor(rel),
                          }}>
                            相对大盘 {pctText(rel)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11.5 }}>
                        <span style={{ color: pctColor(cs.avg_change_pct) }}>
                          均跌 {cs.avg_change_pct != null ? pctText(cs.avg_change_pct) : '—'}
                        </span>
                        <span style={{ color: T.textSub }}>
                          倒挂 <b style={{ color: T.down }}>{cs.inverted_count}</b>
                          （{(cs.inverted_rate * 100).toFixed(1)}%）
                        </span>
                        <span style={{ color: T.textSub }}>
                          高风险 <b style={{ color: cs.high_risk_count > 0 ? T.up : T.textDim }}>{cs.high_risk_count}</b>
                        </span>
                      </div>
                      {insight?.comment && (
                        <div style={{ marginTop: 6, fontSize: 11, color: T.textSub, lineHeight: 1.7 }}>
                          {insight.comment}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── 倒挂预警战情列表 ── */}
          {invertedTop.length > 0 && (
            <div style={{
              background: T.card, border: `1px solid ${T.borderSoft}`, borderRadius: 8,
              padding: '10px 14px', marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <WarningOutlined style={{ color: T.up }} />
                <Text strong style={{ fontSize: 12.5 }}>倒挂预警</Text>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textDim }}>
                  按倒挂金额倒序 · 共 {invertedTop.length} 个
                </span>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                gap: 6, maxHeight: 210, overflowY: 'auto',
              }}>
                {invertedTop.map((x, i) => {
                  const critical = x.severity === 'critical'
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                      borderRadius: 6,
                      background: critical ? 'rgba(255,77,79,0.10)' : 'rgba(250,173,20,0.08)',
                      border: `1px solid ${critical ? 'rgba(255,77,79,0.35)' : 'rgba(250,173,20,0.28)'}`,
                    }}>
                      <span className="pt-pulse" style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: critical ? T.up : T.flat,
                        animationDuration: critical ? '1.1s' : '2.1s',
                      }} />
                      <span style={{
                        fontSize: 12, color: T.text, flex: 1, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {x.product_name}
                      </span>
                      <Tag style={{ fontSize: 9.5, margin: 0, flexShrink: 0 }}>{x.brand}</Tag>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.down, flexShrink: 0 }}>
                        {x.inverted_amount}
                      </span>
                      <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0, width: 44, textAlign: 'right' }}>
                        {x.inverted_pct}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── 四宫格 ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            <Panel title="价格走势总览" extra="全商品归一化指数（基准 100）">
              {chartOrEmpty(lineOpt, '暂无价格数据')}
            </Panel>
            <Panel title="品牌涨跌排行" extra={`${brandRank.length} 个品牌`}>
              {chartOrEmpty(barOpt, '暂无品牌数据')}
            </Panel>
            <Panel title="风险预警分布" extra="品牌 × 风险等级">
              {chartOrEmpty(heatOpt, 'AI 结果里没有 risk_assessment')}
            </Panel>
            <Panel title="AI 价格预测" extra={`${predictions.length} 个品规 · 30 天`}>
              {chartOrEmpty(predOpt, 'AI 结果里没有 predictions')}
            </Panel>
          </div>

          {/* ── 摘要 + 建议 ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <div style={{
              flex: '1 1 480px', background: T.card, border: `1px solid ${T.borderSoft}`,
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <BulbOutlined style={{ color: T.flat }} />
                <Text strong style={{ fontSize: 12.5 }}>AI 解读</Text>
                <Tag style={{ marginLeft: 'auto', fontSize: 10 }}>
                  {detail?.import_time?.slice(0, 16)} 导入
                </Tag>
              </div>
              <Paragraph style={{ fontSize: 12.5, lineHeight: 1.9, marginBottom: 0, color: T.text }}>
                {summaryText || '（本条记录没有 summary）'}
              </Paragraph>

              {(marketCtx && Object.values(marketCtx).some(Boolean)) && (
                <>
                  <Divider style={{ margin: '10px 0 8px' }} />
                  <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 2 }}>
                    {marketCtx.industry_trend && (
                      <div>· <b>行业趋势</b>：{marketCtx.industry_trend}</div>
                    )}
                    {marketCtx.policy_impact && (
                      <div>· <b>政策影响</b>：{marketCtx.policy_impact}</div>
                    )}
                    {marketCtx.consumer_shift && (
                      <div>· <b>消费变化</b>：{marketCtx.consumer_shift}</div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div style={{
              flex: '1 1 380px', background: T.card, border: `1px solid ${T.borderSoft}`,
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <ThunderboltOutlined style={{ color: T.primary }} />
                <Text strong style={{ fontSize: 12.5 }}>关键建议</Text>
                <Tag color="cyan" style={{ fontSize: 9.5, margin: 0 }}>AI 生成</Tag>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textDim }}>
                  {recs.length} 条
                </span>
              </div>
              {!recs.length && (
                <div style={{ fontSize: 12, color: T.textDim }}>（本条记录没有 recommendations）</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                {recs.map((r, i) => (
                  <div key={i} style={{
                    border: `1px solid ${T.borderSoft}`, borderRadius: 6, padding: '7px 10px',
                    borderLeft: `3px solid ${r.priority === 'high' ? UP : r.priority === 'medium' ? T.flat : T.down}`,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
                      {r.action}
                    </div>
                    {(r.affected_products || []).length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {r.affected_products.map((n, j) => (
                          <Tag key={j} style={{ fontSize: 10, margin: 0 }}>{n}</Tag>
                        ))}
                      </div>
                    )}
                    {r.expected_benefit && (
                      <div style={{ fontSize: 11, color: T.down, marginTop: 4 }}>
                        预期收益：{r.expected_benefit}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 导出弹窗 ── */}
      <Modal
        title="导出价格数据"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        width={620}
        footer={[
          <Button key="c" onClick={() => setExportOpen(false)}>关闭</Button>,
          <Button key="p" onClick={async () => {
            const d = exportPreview || await runExport()
            if (d) copyText(d.prompt + '\n\n## 数据（已由本地引擎计算完成）\n' + JSON.stringify(d.ai_payload, null, 2), '已复制「提示词 + 数据」，直接粘给 AI 即可')
          }} loading={exporting}>复制（提示词 + 数据）</Button>,
          <Button key="j" onClick={async () => {
            const d = exportPreview || await runExport()
            if (d) { copyText(JSON.stringify(d.ai_payload, null, 2), '已复制 JSON'); }
          }}>复制 JSON</Button>,
          <Button key="d" type="primary" icon={<DownloadOutlined />} onClick={async () => {
            const d = exportPreview || await runExport()
            if (d) downloadJson({ ...d.ai_payload, _prompt: d.prompt })
          }}>下载 JSON</Button>,
        ]}
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
          message="用法"
          description={<span style={{ fontSize: 12, lineHeight: 1.8 }}>
            点「复制（提示词 + 数据）」→ 粘贴给 DeepSeek 等 AI → 把 AI 返回的 JSON 用「粘贴导入」存回来。
          </span>}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
          <div>
            <div style={{ color: T.textSub, marginBottom: 4 }}>时间范围（留空 = 全部）</div>
            <RangePicker size="small" value={range} onChange={setRange} style={{ width: 280 }} />
            <Space size={4} style={{ marginLeft: 8 }}>
              <Button size="small" type="link" onClick={() => setRange([dayjs().subtract(3, 'month'), dayjs()])}>近3月</Button>
              <Button size="small" type="link" onClick={() => setRange([dayjs().subtract(6, 'month'), dayjs()])}>近6月</Button>
              <Button size="small" type="link" onClick={() => setRange(null)}>全部</Button>
            </Space>
          </div>
          <div>
            <div style={{ color: T.textSub, marginBottom: 4 }}>商品范围</div>
            <Radio.Group size="small" value={scope} onChange={e => setScope(e.target.value)}>
              <Radio value="all">全部商品</Radio>
              <Radio value="brand">按品牌</Radio>
            </Radio.Group>
            {scope === 'brand' && (
              <Select
                mode="multiple" size="small" style={{ width: '100%', marginTop: 8 }}
                placeholder="选择品牌（地区）" value={pickedBrands} onChange={setPickedBrands}
                options={brandOptions} maxTagCount="responsive"
              />
            )}
          </div>
          {exportPreview && (
            <div style={{
              background: 'rgba(82,196,26,0.10)', border: '1px solid rgba(82,196,26,0.35)', borderRadius: 6,
              padding: '8px 10px', fontSize: 12, color: T.down,
            }}>
              ✓ 本地引擎已算完：{exportPreview.product_count} 个商品 / {exportPreview.total_records} 条记录
              ，倒挂 {exportPreview.summary?.inverted_count ?? 0} 个
              ，均价 {exportPreview.summary?.avg_change_pct ?? 0}%
              ，健康指数 {exportPreview.summary?.health_index ?? '—'}
              <div style={{ fontSize: 11, color: T.textSub, marginTop: 3 }}>
                AI 只负责解释，不参与任何数值计算
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ── 粘贴导入弹窗 ── */}
      <Modal
        title="粘贴导入 AI 分析结果"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={doImport}
        okText="解析并导入"
        cancelText="取消"
        confirmLoading={importing}
        width={680}
      >
        <div style={{ fontSize: 12, color: T.textSub, marginBottom: 8, lineHeight: 1.8 }}>
          把 AI 返回的 JSON 直接贴进来即可。支持纯 JSON、```json 围栏、或夹带解释文字，
          系统会自动抠出 JSON。
        </div>
        <Input
          size="small" placeholder="备注标题（可选，如「10月第1周」）"
          value={pasteTitle} onChange={e => setPasteTitle(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <Input.TextArea
          rows={12} value={pasteText} onChange={e => setPasteText(e.target.value)}
          placeholder={'{\n  "analysis_version": "1.0",\n  "overview": { ... },\n  "price_trends": [ ... ],\n  "summary": "..."\n}'}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5 }}
        />
        {importError && (
          <Alert type="error" showIcon style={{ marginTop: 8, fontSize: 12 }}
            message={importError} />
        )}
      </Modal>

      {/* ── 使用说明 ── */}
      <Modal
        title="AI 分析使用说明"
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={<Button onClick={() => setGuideOpen(false)}>知道了</Button>}
        width={640}
      >
        <div style={{ fontSize: 12.5, lineHeight: 2, color: T.text }}>
          <div><b>1. 导出数据（本地引擎先算）</b></div>
          <div style={{ color: T.textSub }}>
            点「导出数据」→ 选范围 → 点「复制（提示词 + 数据）」。
            所有数值（涨跌幅、倒挂、风险分、预测）都由<b>本地引擎</b>算好并随内容一起给出，
            AI 拿到的是结论而不是原始记录。
          </div>
          <Divider style={{ margin: '10px 0' }} />
          <div><b>2. 投喂给 AI</b></div>
          <div style={{ color: T.textSub }}>
            粘贴给任意大模型直接发送。提示词已明确<b>禁止 AI 重算任何数值</b>，
            AI 只输出市场背景解释、风险原因归纳、建议和总结。
          </div>
          <Divider style={{ margin: '10px 0' }} />
          <div><b>3. 粘贴导入</b></div>
          <div style={{ color: T.textSub }}>
            把 AI 返回的内容整段复制，点「粘贴导入」贴进来 → 解析并导入。
            系统会自动抠出 JSON（哪怕 AI 加了 ```json 围栏或前后解释文字）。
          </div>
          <Divider style={{ margin: '10px 0' }} />
          <div><b>4. 看数据墙</b></div>
          <div style={{ color: T.textSub }}>
            导入成功后本页自动刷新：KPI、大盘走势、品牌涨跌、风险分布、预测曲线和结论建议。
            每次导入都会在顶部时间线里留一条，可以随时切换对比不同时期的结论。
          </div>
          <Divider style={{ margin: '10px 0' }} />
          <div style={{ color: T.textSub, fontSize: 11.5 }}>
            提示：AI 若没返回某些字段（如 risk_assessment / predictions），对应图卡会显示占位提示，不影响其余部分。
          </div>
        </div>
      </Modal>
    </div>
  )
}
