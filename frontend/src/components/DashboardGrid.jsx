import React, { useState } from 'react'
import { Spin, Empty, Typography, Card } from 'antd'
import ItemCard from './ItemCard'
import DetailModal from './DetailModal'
import SummaryBar from './SummaryBar'
import CostEntryModal from './CostEntryModal'
import { usePriceStore } from '../store/priceStore'
import { T } from '../utils/theme'

const { Title } = Typography

export default function DashboardGrid({ brands, loading }) {
  const [detailItem, setDetailItem] = useState(null)
  const [costItem, setCostItem] = useState(null)
  const fetchDashboard = usePriceStore(s => s.fetchDashboard)

  React.useEffect(() => {
    const handler = (e) => setDetailItem(e.detail)
    window.addEventListener('open-detail', handler)
    return () => window.removeEventListener('open-detail', handler)
  }, [])

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  }

  if (!brands || brands.length === 0) {
    return <Empty description="暂无数据，请上传 Excel 文件" style={{ marginTop: 80 }} />
  }

  return (
    <>
      <style>{`
        .price-grid {
          grid-template-columns: repeat(8, 1fr);
        }
        @media (max-width: 1200px) { .price-grid { grid-template-columns: repeat(6, 1fr); } }
        @media (max-width: 900px)  { .price-grid { grid-template-columns: repeat(4, 1fr); } }
        @media (max-width: 600px)  { .price-grid { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SummaryBar brands={brands} />
        {brands.map(brand => (
          <Card
            key={brand.brand}
            size="small"
            title={
              <Title level={5} style={{ margin: 0, color: T.primary }}>
                {brand.brand} <span style={{fontSize:12,color:T.textDim,fontWeight:400}}>({(brand.items||[]).length}种)</span>
              </Title>
            }
            styles={{ body: { padding: 8 } }}
          >
            <div className="price-grid" style={{
              display: 'grid',
              gap: 6,
            }}>
              {(brand.items || []).map(item => (
                <div key={item.name}>
                  <ItemCard
                    item={item}
                    brand={brand.brand}
                    onClick={() => setDetailItem({ name: item.name, brand: brand.brand })}
                    onCostClick={setCostItem}
                  />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <DetailModal
        item={detailItem}
        brands={brands}
        onClose={() => setDetailItem(null)}
      />

      <CostEntryModal
        open={!!costItem}
        item={costItem}
        onClose={() => setCostItem(null)}
        onSaved={fetchDashboard}
      />
    </>
  )
}
