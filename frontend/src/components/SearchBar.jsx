import React, { useState, useMemo } from 'react'
import { AutoComplete, Input } from 'antd'
import { usePriceStore } from '../store/priceStore'

export default function SearchBar() {
  const [value, setValue] = useState('')
  const [selected, setSelected] = useState(null)
  const getSearchIndex = usePriceStore(s => s.getSearchIndex)

  const options = useMemo(() => {
    if (!value.trim()) return []
    const kw = value.trim().toLowerCase()
    return getSearchIndex()
      .filter(item => item.label.toLowerCase().includes(kw))
      .slice(0, 20)
      .map(item => ({
        value: item.value,
        label: item.label,
        brand: item.brand,
      }))
  }, [value, getSearchIndex])

  const handleSelect = (val, option) => {
    setSelected(option)
    // Dispatch custom event for detail modal
    window.dispatchEvent(new CustomEvent('open-detail', {
      detail: { name: option.value, brand: option.brand },
    }))
    setValue('')
  }

  return (
    <AutoComplete
      value={value}
      options={options}
      onSelect={handleSelect}
      onSearch={setValue}
      style={{ width: 320 }}
      filterOption={false}
    >
      <Input.Search
        placeholder="搜索商品名称…"
        allowClear
        size="middle"
      />
    </AutoComplete>
  )
}
