import { create } from 'zustand'

const API_BASE = ''

async function apiFetch(url, opts = {}) {
  const res = await fetch(`${API_BASE}${url}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export const usePriceStore = create((set, get) => ({
  brands: [],
  loading: false,
  error: null,

  fetchDashboard: async () => {
    set({ loading: true, error: null })
    try {
      const data = await apiFetch('/api/dashboard')
      set({ brands: data.brands || [], loading: false })
    } catch (e) {
      set({ error: e.message, loading: false })
    }
  },

  // Phase 1: Upload & preview (no save)
  previewUpload: async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    return await apiFetch('/api/upload/preview', { method: 'POST', body: formData })
  },

  // Phase 2: Confirm with corrections
  confirmUpload: async (sessionId, corrections) => {
    const formData = new FormData()
    formData.append('session_id', sessionId)
    formData.append('corrections', JSON.stringify(corrections))
    const result = await apiFetch('/api/upload/confirm', { method: 'POST', body: formData })
    // Reload dashboard
    await get().fetchDashboard()
    return result
  },

  uploadExcel: async (file) => {
    // Legacy one-shot upload (kept for compatibility)
    const result = await get().previewUpload(file)
    if (result.alert_count > 0) {
      // Return the preview result — caller handles dialog
      return { preview: result }
    }
    // No alerts → confirm immediately
    await get().confirmUpload(result.session_id, {})
    return { saved: true }
  },

  getSearchIndex: () => {
    const { brands } = get()
    const results = []
    for (const brand of brands) {
      for (const item of brand.items || []) {
        results.push({
          label: `${item.name} — ${brand.brand}`,
          value: item.name,
          brand: brand.brand,
        })
      }
    }
    return results
  },
}))
