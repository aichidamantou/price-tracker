import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { Modal, InputNumber, message } from 'antd'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, VisualMapComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, VisualMapComponent, SVGRenderer])

const API_BASE = ''

export default function DetailModal({ item, brands, onClose }) {
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState(null)
  const [chartKey, setChartKey] = useState(0)
  const [productId, setProductId] = useState(null)
  const [apiData, setApiData] = useState(null)

  // Fetch data from API (not from brands prop which doesn't refresh)
  const fetchData = useCallback(() => {
    if (!item) return
    fetch(`${API_BASE}/api/item/${encodeURIComponent(item.name)}`)
      .then(r => r.json())
      .then(d => {
        if (d.items && d.items[0]) {
          setApiData(d.items[0])
          setProductId(d.items[0].product_id)
        }
      })
      .catch(() => {})
  }, [item])

  useEffect(() => { fetchData() }, [item])

  const fullData = useMemo(() => {
    const source = apiData
    if (!source || !source.prices) return null
    const valid = (source.prices || [])
      .filter(p => p.price !== null && p.price !== undefined)
      .sort((a, b) => a.date.localeCompare(b.date))
    const changeInfo = valid.map((p, i) => {
      let change = 0, direction = 0
      if (i > 0) { change = p.price - valid[i-1].price; direction = change > 0 ? 1 : (change < 0 ? -1 : 0) }
      return { ...p, change, direction }
    })
    return {
      name: source.name, brand: source.brand,
      prices: changeInfo, dates: changeInfo.map(p => p.date),
      values: changeInfo.map(p => p.price), changes: changeInfo.map(p => p.change),
      directions: changeInfo.map(p => p.direction),
    }
  }, [apiData, chartKey])

  const handleSave = useCallback(async (date, price) => {
    if (!productId) { message.error('未获取到商品ID'); return }
    const r = await fetch(`${API_BASE}/api/item/update-price`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ product_id: productId, date, price }),
    })
    const d = await r.json()
    if (d.status === 'ok') {
      message.success(`已更新 ¥${price}`)
      setEditing(null); setChartKey(k => k + 1)
      fetchData() // 从 API 重新获取最新数据
    } else message.error('更新失败')
  }, [productId, fetchData])

  const option = useMemo(() => {
    if (!fullData || fullData.prices.length === 0) return null
    const values = fullData.values; const minVal = Math.min(...values); const maxVal = Math.max(...values)
    const range = maxVal - minVal || 1; const pad = range * 0.1
    const dataWithDir = fullData.values.map((v, i) => [fullData.dates[i], v, fullData.directions[i] || 0])
    return {
      tooltip: { trigger: 'axis', formatter: (params) => {
        const p = params[0]; const d = p.name || ''
        const label = d.length >= 10 ? `${parseInt(d.slice(5,7),10)}/${parseInt(d.slice(8,10),10)}` : d
        const val = Array.isArray(p.data) ? p.data[1] : p.value; let extra = ''
        if (fullData) { const idx = fullData.dates.indexOf(p.name)
          if (idx > 0) { const c = fullData.changes[idx]; const a = c > 0 ? '↑' : (c < 0 ? '↓' : '→')
            const co = c > 0 ? '#ff4d4f' : (c < 0 ? '#52c41a' : '#999')
            extra = ` <span style="color:${co};font-size:10px">${a}${c !== 0 ? Math.abs(c) : ''}</span>` }
        }
        return `${label} <span style="color:#1677ff;font-weight:600">${val}</span>${extra}`
      }, confine: true },
      grid: { left: 60, right: 20, top: 20, bottom: 50 },
      xAxis: { type: 'category', data: fullData.dates, axisLabel: { rotate: 45, fontSize: 11 } },
      yAxis: { type: 'value', min: minVal - pad, max: maxVal + pad, axisLabel: { formatter: '¥{value}' } },
      visualMap: { show: false, dimension: 2, pieces: [{ value: -1, color: '#52c41a' }, { value: 0, color: '#d9d9d9' }, { value: 1, color: '#ff4d4f' }], outOfRange: { color: '#d9d9d9' } },
      dataZoom: [{ type: 'inside', start: 0, end: 100 }, { type: 'slider', start: 0, end: 100, height: 24, bottom: 10 }],
      series: [{ type: 'line', data: dataWithDir, smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2 } }],
    }
  }, [fullData])

  const stats = useMemo(() => {
    if (!fullData || fullData.prices.length === 0) return null
    const vals = fullData.values; const avg = (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(0)
    const max = Math.max(...vals); const min = Math.min(...vals)
    const last = vals[vals.length-1]; const prev = vals.length >= 2 ? vals[vals.length-2] : null
    const ct = prev !== null ? (last > prev ? `↑${last-prev}` : last < prev ? `↓${Math.abs(last-prev)}` : '') : ''
    const cc = prev !== null ? (last > prev ? '#ff4d4f' : last < prev ? '#52c41a' : '#999') : '#999'
    return { avg, max, min, last, prev, changeText: ct, changeColor: cc }
  }, [fullData])

  if (!item) return null
  return (
    <Modal title={`${item.name} — ${item.brand}`} open={!!item} onCancel={onClose}
      footer={null} width={700} destroyOnClose>
      {fullData && fullData.prices.length > 0 ? (
        <>
          <div style={{ marginBottom: 12, color:'#666', fontSize:13 }}>
            共 <strong>{fullData.prices.length}</strong> 个报价记录
            {stats && <span>，最新 <strong style={{color:stats.changeColor}}>¥{stats.last}</strong>
              {stats.prev !== null && <span style={{color:stats.changeColor, fontSize:12, marginLeft:4}}>{stats.changeText}</span>}
              ，最高 ¥{stats.max}，最低 ¥{stats.min}，均价 ¥{stats.avg}</span>}
          </div>
          <ReactEChartsCore key={chartKey} echarts={echarts} option={option}
            style={{height:300, width:'100%'}} notMerge lazyUpdate />
          <div style={{marginTop:8, fontSize:12, color:'#666'}}>点击右侧「修改」编辑价格：</div>
          <div style={{marginTop:4, border:'1px solid #f0f0f0', borderRadius:6, maxHeight:200, overflowY:'auto'}}>
            <div style={{display:'flex', padding:'6px 12px', background:'#fafafa', fontSize:12, fontWeight:600, borderBottom:'1px solid #f0f0f0'}}>
              <div style={{width:100}}>日期</div>
              <div style={{width:100, textAlign:'right'}}>价格</div>
              <div style={{flex:1, textAlign:'right'}}>操作</div>
            </div>
            {[...fullData.prices].reverse().map(p => (
              <div key={p.date} style={{display:'flex', alignItems:'center', padding:'6px 12px', fontSize:12, borderBottom:'1px solid #f5f5f5',
                background: editing?.date === p.date ? '#fffbe6' : 'transparent'}}>
                <div style={{width:100}}>{p.date}</div>
                {editing?.date === p.date ? (
                  <>
                    <InputNumber size="small" value={editVal ?? p.price} onChange={v => setEditVal(v)}
                      min={0} style={{width:100}} formatter={v=>`¥${v}`} parser={v=>v.replace(/[^0-9.]/g,'')} />
                    <div style={{flex:1, textAlign:'right', display:'flex', gap:4, justifyContent:'flex-end'}}>
                      <button onClick={() => handleSave(p.date, editVal)}
                        style={{padding:'2px 10px', background:'#1677ff', color:'#fff', border:'none', borderRadius:3, cursor:'pointer', fontSize:11}}>保存</button>
                      <button onClick={() => setEditing(null)}
                        style={{padding:'2px 10px', background:'#f5f5f5', border:'1px solid #d9d9d9', borderRadius:3, cursor:'pointer', fontSize:11}}>取消</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{width:100, textAlign:'right', fontWeight:600, color:'#1677ff'}}>¥{p.price}</div>
                    <div style={{flex:1, textAlign:'right'}}>
                      <button onClick={() => { setEditing(p); setEditVal(p.price) }}
                        style={{padding:'2px 10px', background:'transparent', border:'1px solid #1677ff', color:'#1677ff', borderRadius:3, cursor:'pointer', fontSize:11}}>修改</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{padding:40, textAlign:'center', color:'#999'}}>暂无报价数据</div>
      )}
    </Modal>
  )
}
