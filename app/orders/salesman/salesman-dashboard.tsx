'use client'

import {
  useState, useTransition, useRef, useEffect, useCallback, useMemo, useId,
} from 'react'
import { useRouter } from 'next/navigation'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { createOrder, updateOrder, cancelOrder, getSalesmanOrderWithItems } from '@/app/actions/orders'
import { searchShopkeepers, searchArticles, getArticleDetail, getArticleDetailByNumber } from '@/app/actions/catalogue'
import type { ShopkeeperResult, ArticleResult, ArticleDetail } from '@/app/actions/catalogue'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ExistingOrder {
  id: number
  orderNumber: string
  shopkeeperName: string
  status: string
  notes: string | null
  orderedAt: Date
  updatedAt: Date
}

// Statuses the salesman can still edit or cancel
const EDITABLE_STATUSES = ['pending', 'assigned']

interface Props {
  orders: ExistingOrder[]
  userName: string
}

// One line in the current order cart (article + color + per-size quantities)
interface OrderLine {
  id: string // local uuid for stable keys
  articleId: number
  artNumber: string
  colorId: number
  colorName: string
  colorHex: string | null
  sizes: { id: number; sizeLabel: string; sortOrder: number }[]
  quantities: Record<string, number> // sizeLabel → qty
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour swatch
// ─────────────────────────────────────────────────────────────────────────────

const SWATCHES: Record<string, string> = {
  brown: '#8B5E3C', black: '#1a1a1a', tan: '#D2A679', white: '#F0EDE8',
  red: '#C0392B', navy: '#1B3A6B', grey: '#6B7280', gray: '#6B7280',
  blue: '#2563EB', green: '#16A34A', yellow: '#CA8A04', pink: '#DB2777',
  orange: '#EA580C', purple: '#9333EA', beige: '#E8D8C0', cream: '#FFF8E7',
}
function swatch(hex: string | null, name: string) {
  return hex ?? SWATCHES[name.toLowerCase()] ?? '#9CA3AF'
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchCombobox — generic, accessible, debounced
// ─────────────────────────────────────────────────────────────────────────────

interface SearchComboboxProps<T> {
  id?: string
  label: string
  required?: boolean
  placeholder: string
  inputValue: string
  onInputChange: (v: string) => void
  onSelect: (item: T) => void
  onClear: () => void
  results: T[]
  loading: boolean
  renderOption: (item: T, active: boolean) => React.ReactNode
  getKey: (item: T) => string | number
  disabled?: boolean
}

function SearchCombobox<T>({
  id, label, required, placeholder, inputValue, onInputChange,
  onSelect, onClear, results, loading, renderOption, getKey, disabled,
}: SearchComboboxProps<T>) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  useEffect(() => { setActiveIdx(0) }, [results])

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[activeIdx]
      if (item) { onSelect(item); setOpen(false) }
    } else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative flex items-center">
        <svg className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && results[activeIdx] ? `${listId}-${activeIdx}` : undefined}
          value={inputValue}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          onChange={e => { onInputChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        />
        {inputValue && !disabled && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => { onClear(); setOpen(false) }}
            className="absolute right-3 text-muted-foreground hover:text-foreground"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-60 overflow-y-auto"
        >
          {loading && <li className="px-4 py-3 text-sm text-muted-foreground">Searching…</li>}
          {!loading && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">No results found</li>
          )}
          {!loading && results.map((item, i) => (
            <li
              key={getKey(item)}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); onSelect(item); setOpen(false) }}
              className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${i === activeIdx ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {renderOption(item, i === activeIdx)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SizeMatrix — single color, quick buttons + manual input
// ─────────────────────────────────────────────────────────────────────────────

const QUICK_QTYS = [1, 2, 3, 4, 5, 6]

interface SizeMatrixProps {
  sizes: { id: number; sizeLabel: string; sortOrder: number }[]
  quantities: Record<string, number>
  onChange: (quantities: Record<string, number>) => void
}

function SizeMatrix({ sizes, quantities, onChange }: SizeMatrixProps) {
  // manualActive[size] = true means manual input controls it
  const [manualActive, setManualActive] = useState<Record<string, boolean>>({})

  function setQty(sizeLabel: string, qty: number) {
    onChange({ ...quantities, [sizeLabel]: Math.max(0, qty) })
  }

  function handleQuickClick(sizeLabel: string, qty: number) {
    // Quick button click: clear manual mode for this size
    setManualActive(prev => ({ ...prev, [sizeLabel]: false }))
    setQty(sizeLabel, qty)
  }

  function handleManualChange(sizeLabel: string, raw: string) {
    setManualActive(prev => ({ ...prev, [sizeLabel]: true }))
    const n = parseInt(raw)
    setQty(sizeLabel, isNaN(n) || n < 0 ? 0 : n)
  }

  const colorTotal = sizes.reduce((s, sz) => s + (quantities[sz.sizeLabel] ?? 0), 0)

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="grid items-center gap-1" style={{ gridTemplateColumns: '5rem repeat(6, 2.5rem) 5rem 3.5rem' }}>
        <span className="text-xs font-medium text-muted-foreground">Size</span>
        {QUICK_QTYS.map(q => (
          <span key={q} className="text-xs font-medium text-muted-foreground text-center">{q}</span>
        ))}
        <span className="text-xs font-medium text-muted-foreground text-center">Manual</span>
        <span className="text-xs font-medium text-muted-foreground text-center">Total</span>
      </div>

      {/* Size rows */}
      {sizes.map(sz => {
        const current = quantities[sz.sizeLabel] ?? 0
        const isManual = manualActive[sz.sizeLabel]
        return (
          <div
            key={sz.id}
            className="grid items-center gap-1 rounded-lg py-1"
            style={{ gridTemplateColumns: '5rem repeat(6, 2.5rem) 5rem 3.5rem' }}
          >
            <span className="text-sm font-medium text-foreground truncate">{sz.sizeLabel}</span>
            {QUICK_QTYS.map(q => {
              const active = !isManual && current === q
              return (
                <button
                  key={q}
                  type="button"
                  aria-label={`Set ${sz.sizeLabel} to ${q}`}
                  aria-pressed={active}
                  onClick={() => handleQuickClick(sz.sizeLabel, q)}
                  className={`h-9 w-9 rounded-lg text-sm font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {q}
                </button>
              )
            })}
            <input
              type="number"
              min={0}
              aria-label={`Manual quantity for size ${sz.sizeLabel}`}
              value={isManual ? (current === 0 ? '' : current) : (current > 6 ? current : '')}
              placeholder="0"
              onChange={e => handleManualChange(sz.sizeLabel, e.target.value)}
              onFocus={() => setManualActive(prev => ({ ...prev, [sz.sizeLabel]: true }))}
              className={`h-9 w-full rounded-lg border text-sm text-center font-medium bg-background focus:outline-none focus:ring-2 focus:ring-ring transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                isManual && current > 0
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground'
              }`}
            />
            <span className={`text-sm font-bold text-center ${current > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
              {current}
            </span>
          </div>
        )
      })}

      {/* Color total row */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        <span className="text-sm text-muted-foreground">Total pairs for this color</span>
        <span className="text-xl font-bold text-foreground">{colorTotal}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmDialog
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmDialog({
  title, message, confirmLabel, onCancel, onConfirm,
}: {
  title: string
  message: React.ReactNode
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <div className="text-sm text-muted-foreground">{message}</div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns 'new' if created within 24 h and never edited, 'updated' if edited after creation, else null */
function orderTag(order: ExistingOrder): 'new' | 'updated' | null {
  const now = Date.now()
  const created = new Date(order.orderedAt).getTime()
  const updated = new Date(order.updatedAt).getTime()
  if (Math.abs(updated - created) > 5000) return 'updated'          // edited >5 s after creation
  if (now - created < 24 * 60 * 60 * 1000) return 'new'             // created within last 24 h
  return null
}

function linePairs(line: OrderLine) {
  return Object.values(line.quantities).reduce((s, n) => s + n, 0)
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dashboard component
// ─────────────────────────────────────────────────────────────────────────────

// ── Detail view types ──
interface DetailItem {
  id: number
  artNumber: string
  colorNumber: string | null
  sizeNumber: string | null
  quantityOrdered: number
  quantityPacked: number
  status: string
}

export function SalesmanDashboard({ orders, userName }: Props) {
  const [view, setView] = useState<'list' | 'new' | 'detail'>('list')
  const router = useRouter()

  // ── Detail view state ──
  const [detailOrder, setDetailOrder] = useState<ExistingOrder | null>(null)
  const [detailItems, setDetailItems] = useState<DetailItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  // ── Filter + sort state ──
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'order'>('date-desc')

  // ── SizeMatrix reset key — increment to force SizeMatrix remount after Add to Order ──
  const [matrixKey, setMatrixKey] = useState(0)

  // ── Shopkeeper state ──
  const [skQuery, setSkQuery] = useState('')
  const [skResults, setSkResults] = useState<ShopkeeperResult[]>([])
  const [skLoading, setSkLoading] = useState(false)
  const [selectedSk, setSelectedSk] = useState<ShopkeeperResult | null>(null)

  // ── Article entry state ──
  const [artQuery, setArtQuery] = useState('')
  const [artResults, setArtResults] = useState<ArticleResult[]>([])
  const [artLoading, setArtLoading] = useState(false)
  const [selectedArt, setSelectedArt] = useState<ArticleDetail | null>(null)
  const [artDetailLoading, setArtDetailLoading] = useState(false)

  // ── Per-color entry state ──
  // selectedColorId: which color chip is active
  const [selectedColorId, setSelectedColorId] = useState<number | null>(null)
  // colorQuantities: preserved per-color quantities while user navigates
  // key = colorId, value = sizeLabel→qty
  const [colorQuantities, setColorQuantities] = useState<Record<number, Record<string, number>>>({})
  // lastUsedSet: the most recently added size quantities (any article/color)
  const [lastUsedSet, setLastUsedSet] = useState<Record<string, number> | null>(null)

  // ── Set confirmation dialog ──
  const [setConfirm, setSetConfirm] = useState(false)

  // ── Edit state ──
  const [editingLineId, setEditingLineId] = useState<string | null>(null)

  // ── Delete confirm (cart line) ──
  const [deleteLineId, setDeleteLineId] = useState<string | null>(null)

  // ── Editing an existing order (vs creating new) ──
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null)

  // ── Cancel order confirm (existing orders list) ──
  const [cancelOrderId, setCancelOrderId] = useState<number | null>(null)
  const [cancellingOrder, startCancelTransition] = useTransition()
  const [orderActionError, setOrderActionError] = useState('')

  // ── Order cart ──
  const [lines, setLines] = useState<OrderLine[]>([])
  const [notes, setNotes] = useState('')

  // ── Submission ──
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // ── Debounced shopkeeper search ──
  const skSeq = useRef(0)
  useEffect(() => {
    const seq = ++skSeq.current
    setSkLoading(true)
    const t = setTimeout(async () => {
      const res = await searchShopkeepers(skQuery)
      if (seq === skSeq.current) { setSkResults(res); setSkLoading(false) }
    }, 150)
    return () => clearTimeout(t)
  }, [skQuery])

  // ── Debounced article search ──
  const artSeq = useRef(0)
  useEffect(() => {
    const seq = ++artSeq.current
    setArtLoading(true)
    const t = setTimeout(async () => {
      const res = await searchArticles(artQuery)
      if (seq === artSeq.current) { setArtResults(res); setArtLoading(false) }
    }, 150)
    return () => clearTimeout(t)
  }, [artQuery])

  // ── Derived: currently selected color object ──
  const selectedColor = useMemo(
    () => selectedArt?.colors.find(c => c.id === selectedColorId) ?? null,
    [selectedArt, selectedColorId],
  )

  // ── Current quantities for selected color ──
  const currentQties = selectedColorId != null
    ? (colorQuantities[selectedColorId] ?? {})
    : {}

  function setCurrentQties(q: Record<string, number>) {
    if (selectedColorId == null) return
    setColorQuantities(prev => ({ ...prev, [selectedColorId]: q }))
  }

  const currentColorTotal = useMemo(
    () => Object.values(currentQties).reduce((s, n) => s + n, 0),
    [currentQties],
  )

  // ── Select an article from search ──
  async function handleSelectArticle(art: ArticleResult) {
    setArtQuery(art.artNumber)
    setArtDetailLoading(true)
    setSelectedArt(null)
    setSelectedColorId(null)
    setColorQuantities({})
    const detail = await getArticleDetail(art.id)
    setSelectedArt(detail)
    setArtDetailLoading(false)
  }

  function clearArticle() {
    setArtQuery('')
    setArtResults([])
    setSelectedArt(null)
    setSelectedColorId(null)
    setColorQuantities({})
  }

  // ── Apply default set ──
  const DEFAULT_SET_LABEL = 'Set'

  function buildDefaultSet(): Record<string, number> | null {
    if (!selectedArt) return null
    const sizes = selectedArt.sizes
    if (sizes.length < 5) return null
    const labels = sizes.map(s => s.sizeLabel)
    const result: Record<string, number> = {}
    const defaults = [1, 2, 2, 2, 1]
    labels.slice(0, 5).forEach((l, i) => { result[l] = defaults[i] })
    return result
  }

  function applyDefaultSet() {
    const s = buildDefaultSet()
    if (!s) return
    const hasAny = Object.values(currentQties).some(v => v > 0)
    if (hasAny) { setSetConfirm(true); return }
    setCurrentQties(s)
  }

  function confirmApplySet() {
    const s = buildDefaultSet()
    if (s) setCurrentQties(s)
    setSetConfirm(false)
  }

  function applyLastUsed() {
    if (lastUsedSet) setCurrentQties({ ...lastUsedSet })
  }

  // ── Add current color to order ──
  function handleAddToOrder() {
    if (!selectedArt || selectedColorId == null || !selectedColor) return
    if (currentColorTotal === 0) {
      setError('Add at least one pair before adding this item.')
      return
    }
    setError('')

    const qties = { ...currentQties }

    if (editingLineId) {
      // Update existing line
      setLines(prev => prev.map(l =>
        l.id === editingLineId ? { ...l, quantities: qties } : l
      ))
      setEditingLineId(null)
    } else {
      // Check for duplicate (same article + color already in cart)
      const dupIdx = lines.findIndex(
        l => l.articleId === selectedArt.id && l.colorId === selectedColorId
      )
      if (dupIdx !== -1) {
        // Merge quantities
        setLines(prev => prev.map((l, i) =>
          i !== dupIdx ? l : {
            ...l,
            quantities: Object.fromEntries(
              selectedArt.sizes.map(sz => [
                sz.sizeLabel,
                (l.quantities[sz.sizeLabel] ?? 0) + (qties[sz.sizeLabel] ?? 0),
              ])
            ),
          }
        ))
      } else {
        const newLine: OrderLine = {
          id: uid(),
          articleId: selectedArt.id,
          artNumber: selectedArt.artNumber,
          colorId: selectedColorId,
          colorName: selectedColor.colorName,
          colorHex: selectedColor.colorHex,
          sizes: selectedArt.sizes,
          quantities: qties,
        }
        setLines(prev => [...prev, newLine])
      }
    }

    // Remember last used set globally (most recent Add to Order)
    setLastUsedSet(qties)

    // Clear current color quantities after adding, but stay on same article
    setColorQuantities(prev => ({ ...prev, [selectedColorId]: {} }))
    setSelectedColorId(null)
    // Force SizeMatrix remount so manualActive state is cleared
    setMatrixKey(k => k + 1)
  }

  // ── Edit a line ──
  function handleEditLine(line: OrderLine) {
    // Reload the article if different
    if (!selectedArt || selectedArt.id !== line.articleId) {
      setArtDetailLoading(true)
      setSelectedArt(null)
      setArtQuery(line.artNumber)
      getArticleDetail(line.articleId).then(detail => {
        setSelectedArt(detail)
        setArtDetailLoading(false)
        setSelectedColorId(line.colorId)
        setColorQuantities(prev => ({ ...prev, [line.colorId]: { ...line.quantities } }))
      })
    } else {
      setSelectedColorId(line.colorId)
      setColorQuantities(prev => ({ ...prev, [line.colorId]: { ...line.quantities } }))
    }
    setEditingLineId(line.id)
    // Scroll to top of form
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Delete a line ──
  function confirmDeleteLine() {
    if (!deleteLineId) return
    setLines(prev => prev.filter(l => l.id !== deleteLineId))
    setDeleteLineId(null)
    if (editingLineId === deleteLineId) setEditingLineId(null)
  }

  // ── Reset everything ──
  function resetForm() {
    setSelectedSk(null); setSkQuery('')
    clearArticle()
    setLines([]); setNotes('')
    setError(''); setSuccess('')
    setEditingLineId(null)
    setEditingOrderId(null)
    setLastUsedSet(null)
    setColorQuantities({})
    setDetailOrder(null)
    setDetailItems([])
    setDetailError('')
  }

  // ── Submit order (create new OR update existing) ──
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!selectedSk) { setError('Please select a vendor.'); return }
    if (lines.length === 0) { setError('Add at least one item to the order.'); return }

    const items = lines.flatMap(l =>
      Object.entries(l.quantities)
        .filter(([, qty]) => qty > 0)
        .map(([size, qty]) => ({
          artNumber: l.artNumber,
          colorNumber: l.colorName,
          sizeNumber: size,
          quantityOrdered: qty,
        }))
    )
    if (items.length === 0) { setError('All items have zero quantity.'); return }

    const payload = { shopkeeperName: selectedSk.name, notes, items }

    startTransition(async () => {
      try {
        if (editingOrderId != null) {
          await updateOrder(editingOrderId, payload)
          setSuccess('Order updated!')
        } else {
          await createOrder(payload)
          setSuccess('Order created!')
        }
        setTimeout(() => {
          resetForm()
          router.refresh()   // re-fetch server props so orders list is up to date
          setView('list')
        }, 1200)
      } catch {
        setError(editingOrderId != null ? 'Failed to update order. Please try again.' : 'Failed to create order. Please try again.')
      }
    })
  }

  // ── Totals ──
  const totalPairs = useMemo(() => lines.reduce((s, l) => s + linePairs(l), 0), [lines])
  const uniqueArticles = useMemo(() => new Set(lines.map(l => l.articleId)).size, [lines])

  const canSubmit = !!selectedSk && lines.length > 0 && !isPending

  // ── Edit existing order: load its items back into the new-order form ──
  async function handleEditOrder(order: ExistingOrder) {
    if (!EDITABLE_STATUSES.includes(order.status)) return
    setOrderActionError('')
    // Clear any stale form state first so the edit starts clean
    setLines([])
    setColorQuantities({})
    setEditingLineId(null)
    setError('')
    setSuccess('')
    try {
      const { order: o, items } = await getSalesmanOrderWithItems(order.id)

      // Collect unique artNumbers and fetch their full details in parallel
      const artNumbers = [...new Set(items.map(i => i.artNumber))]
      const detailResults = await Promise.all(artNumbers.map(n => getArticleDetailByNumber(n)))
      const detailMap = new Map<string, NonNullable<Awaited<ReturnType<typeof getArticleDetailByNumber>>>>()
      detailResults.forEach(d => { if (d) detailMap.set(d.artNumber, d) })

      // Build OrderLines with real articleId, colorId, colorHex, sizes
      const lineMap = new Map<string, OrderLine>()
      for (const item of items) {
        const key = `${item.artNumber}||${item.colorNumber ?? ''}`
        if (!lineMap.has(key)) {
          const detail = detailMap.get(item.artNumber)
          const colorMatch = detail?.colors.find(
            c => c.colorName.toLowerCase() === (item.colorNumber ?? '').toLowerCase()
          )
          lineMap.set(key, {
            id: uid(),
            articleId: detail?.id ?? 0,
            artNumber: item.artNumber,
            colorId: colorMatch?.id ?? 0,
            colorName: item.colorNumber ?? '',
            colorHex: colorMatch?.colorHex ?? null,
            sizes: detail?.sizes ?? [],
            quantities: {},
          })
        }
        const line = lineMap.get(key)!
        if (item.sizeNumber) line.quantities[item.sizeNumber] = item.quantityOrdered
      }
      setLines(Array.from(lineMap.values()))
      setSelectedSk({ id: -1, name: o.shopkeeperName, code: null, phone: null, address: null })
      setSkQuery(o.shopkeeperName)
      setNotes(o.notes ?? '')
      setEditingOrderId(order.id)
      // Close detail panel before showing the edit form
      setDetailOrder(null)
      setDetailItems([])
      setView('new')
    } catch (e: unknown) {
      setOrderActionError(e instanceof Error ? e.message : 'Failed to load order.')
    }
  }

  // ── Cancel existing order ──
  function handleCancelOrder() {
    if (cancelOrderId == null) return
    startCancelTransition(async () => {
      try {
        await cancelOrder(cancelOrderId)
        setCancelOrderId(null)
        // If we cancelled from the detail view, close it and go back to list
        setDetailOrder(null)
        setDetailItems([])
        setView('list')
        router.refresh()
      } catch (e: unknown) {
        setOrderActionError(e instanceof Error ? e.message : 'Failed to cancel order.')
        setCancelOrderId(null)
      }
    })
  }

  // ── Open detail view for an order ──
  async function handleViewOrder(order: ExistingOrder) {
    setDetailOrder(order)
    setDetailItems([])
    setDetailError('')
    setDetailLoading(true)
    setView('detail')
    try {
      const { items } = await getSalesmanOrderWithItems(order.id)
      setDetailItems(items as DetailItem[])
    } catch (e: unknown) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load order details.')
    } finally {
      setDetailLoading(false)
    }
  }

  // ── Counts for stats ──
  const counts = {
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  }

  // ── Filtered + sorted orders ──
  const displayedOrders = useMemo(() => {
    let list = filterStatus === 'all' ? orders : orders.filter(o => o.status === filterStatus)
    if (sortBy === 'date-desc') list = [...list].sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime())
    if (sortBy === 'date-asc')  list = [...list].sort((a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime())
    if (sortBy === 'order')     list = [...list].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))
    return list
  }, [orders, filterStatus, sortBy])

  const ALL_STATUSES = ['pending', 'assigned', 'packed', 'dispatched', 'delivered', 'cancelled']

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 pb-32">
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="My Orders" subtitle={`Welcome, ${userName}`} />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Total" value={counts.total} />
          <StatCard label="Pending" value={counts.pending} color="text-yellow-600" />
          <StatCard label="Delivered" value={counts.delivered} color="text-green-600" />
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border mb-6">
          {(['list', 'new'] as const).map(t => (
            <button key={t} type="button"
              onClick={() => { setView(t); if (t === 'list') resetForm() }}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                (view === t || (view === 'detail' && t === 'list')) ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
              {t === 'list' ? 'All Orders' : '+ New Order'}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            ALL ORDERS LIST
        ════════════════════════════════════════════════════════════════ */}
        {view === 'list' && (
          <div className="space-y-3">
            {orderActionError && (
              <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{orderActionError}</p>
            )}

            {/* Filter + Sort bar */}
            {orders.length > 0 && (
              <div className="flex items-center gap-2 pb-1">
                <span className="text-xs text-muted-foreground">Filter:</span>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="all">All</option>
                  {ALL_STATUSES.map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground ml-auto">Sort:</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="order">Order number</option>
                </select>
              </div>
            )}

            {orders.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">No orders yet.</p>
                <button type="button" onClick={() => setView('new')}
                  className="mt-2 text-sm text-primary hover:underline">
                  Create your first order →
                </button>
              </div>
            )}
            {displayedOrders.length === 0 && orders.length > 0 && (
              <p className="text-center py-8 text-sm text-muted-foreground">No orders match this filter.</p>
            )}
            {displayedOrders.map(order => {
              const tag = orderTag(order)
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => handleViewOrder(order)}
                  className="w-full text-left rounded-xl border border-border bg-card p-4 hover:bg-muted/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm">{order.shopkeeperName}</p>
                    <StatusPill status={order.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{order.orderNumber}</span>
                    {tag === 'new' && (
                      <span className="inline-flex items-center border-l-2 border-green-500 pl-1.5 pr-1 py-px text-[10px] font-medium text-green-600 dark:text-green-400 tracking-wide">NEW</span>
                    )}
                    {tag === 'updated' && (
                      <span className="inline-flex items-center border-l-2 border-blue-400 pl-1.5 pr-1 py-px text-[10px] font-medium text-blue-500 dark:text-blue-400 tracking-wide">UPDATED</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {tag === 'updated' ? fmt(order.updatedAt) : fmt(order.orderedAt)}
                    </span>
                  </div>
                  {order.notes && <p className="mt-1.5 text-xs text-muted-foreground italic">{order.notes}</p>}
                </button>
              )
            })}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            ORDER DETAIL VIEW
        ════════════════════════════════════════════════════════════════ */}
        {view === 'detail' && detailOrder && (
          <div className="space-y-4">
            {/* Back + header */}
            <button type="button" onClick={() => setView('list')}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back to All Orders
            </button>

            {/* Order summary card */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-base text-foreground">{detailOrder.shopkeeperName}</p>
                  <p className="font-mono text-xs text-muted-foreground mt-0.5">{detailOrder.orderNumber}</p>
                </div>
                <StatusPill status={detailOrder.status} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Ordered</span>
                <span className="text-foreground">{fmt(detailOrder.orderedAt)}</span>
                {Math.abs(new Date(detailOrder.updatedAt).getTime() - new Date(detailOrder.orderedAt).getTime()) > 5000 && (
                  <>
                    <span className="text-muted-foreground">Last updated</span>
                    <span className="text-foreground">{fmt(detailOrder.updatedAt)}</span>
                  </>
                )}
                {detailOrder.notes && (
                  <>
                    <span className="text-muted-foreground">Notes</span>
                    <span className="text-foreground italic">{detailOrder.notes}</span>
                  </>
                )}
              </div>
            </div>

            {/* Items */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 bg-muted/30 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Order Items</h2>
              </div>
              {detailLoading && (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">Loading items…</p>
              )}
              {detailError && (
                <p className="px-4 py-4 text-sm text-red-600">{detailError}</p>
              )}
              {!detailLoading && !detailError && detailItems.length === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">No items found.</p>
              )}
              {!detailLoading && detailItems.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20 border-b border-border">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Article</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Color</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Size</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {detailItems.map(item => (
                        <tr key={item.id} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-semibold text-xs">{item.artNumber}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.colorNumber ?? '—'}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.sizeNumber ?? '—'}</td>
                          <td className="px-4 py-2.5 text-xs font-medium text-right">{item.quantityOrdered}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-border bg-muted/20">
                      <tr>
                        <td colSpan={3} className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Total pairs</td>
                        <td className="px-4 py-2.5 text-xs font-bold text-right">
                          {detailItems.reduce((s, i) => s + i.quantityOrdered, 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Actions */}
            {(() => {
              const canAct = EDITABLE_STATUSES.includes(detailOrder.status)
              const reason = !canAct ? `Only pending or assigned orders can be edited` : undefined
              return (
                <div className="space-y-2 pt-1">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={!canAct}
                      title={reason}
                      onClick={() => handleEditOrder(detailOrder)}
                      className="flex-1 rounded-xl border border-primary text-primary px-4 py-2.5 text-sm font-semibold hover:bg-primary/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      Edit Order
                    </button>
                    <button
                      type="button"
                      disabled={!canAct}
                      title={reason}
                      onClick={() => { setOrderActionError(''); setCancelOrderId(detailOrder.id) }}
                      className="flex-1 rounded-xl border border-red-300 text-red-500 px-4 py-2.5 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      Cancel Order
                    </button>
                  </div>
                  {!canAct && (
                    <p className="text-center text-xs text-muted-foreground">
                      This order is <span className="font-medium text-foreground">{detailOrder.status}</span> and cannot be edited or cancelled.
                    </p>
                  )}
                </div>
              )
            })()}
            {orderActionError && (
              <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{orderActionError}</p>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            NEW ORDER FORM
        ════════════════════════════════════════════════════════════════ */}
        {view === 'new' && (
          <form id="new-order-form" onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* ── 1. SHOPKEEPER ── */}
            <section aria-labelledby="sk-heading" className="rounded-2xl border border-border bg-card">
              <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border rounded-t-2xl">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  <h2 id="sk-heading" className="text-sm font-semibold text-foreground">Vendor</h2>
                </div>
                {selectedSk && (
                  <button type="button" onClick={() => { setSelectedSk(null); setSkQuery('') }}
                    className="text-xs text-primary hover:underline font-medium">
                    Change
                  </button>
                )}
              </div>

              <div className="p-4">
                {!selectedSk ? (
                  <SearchCombobox<ShopkeeperResult>
                    id="sk-search"
                    label="Search Vendor"
                    required
                    placeholder="Search vendor..."
                    inputValue={skQuery}
                    onInputChange={setSkQuery}
                    onSelect={sk => { setSelectedSk(sk); setSkQuery(sk.name) }}
                    onClear={() => { setSelectedSk(null); setSkQuery('') }}
                    results={skResults}
                    loading={skLoading}
                    getKey={r => r.id}
                    renderOption={(r, active) => (
                      <div className="flex items-center justify-between gap-4">
                        <span className={`font-medium ${active ? 'text-primary-foreground' : 'text-foreground'}`}>{r.name}</span>
                        <span className={`text-xs font-mono ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {r.code ?? r.address ?? ''}
                        </span>
                      </div>
                    )}
                  />
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm flex-shrink-0">
                      {selectedSk.name[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground text-sm">{selectedSk.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[selectedSk.code, selectedSk.phone, selectedSk.address].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ── 2. ARTICLE ENTRY ── */}
            <section aria-labelledby="art-heading" className="rounded-2xl border border-border bg-card">
              <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border rounded-t-2xl">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                  <h2 id="art-heading" className="text-sm font-semibold text-foreground">Article</h2>
                </div>
                <span className="hidden sm:block text-xs text-muted-foreground">Search article and set color-wise quantities</span>
              </div>

              <div className="p-4 space-y-4">
                {/* Article search */}
                <SearchCombobox<ArticleResult>
                  id="art-search"
                  label="Search Article Number"
                  required
                  placeholder="Search article number..."
                  inputValue={artQuery}
                  onInputChange={setArtQuery}
                  onSelect={handleSelectArticle}
                  onClear={clearArticle}
                  results={artResults}
                  loading={artLoading}
                  getKey={r => r.id}
                  renderOption={(r, active) => (
                    <div className="flex items-center justify-between gap-4">
                      <span className={`font-semibold ${active ? 'text-primary-foreground' : 'text-foreground'}`}>{r.artNumber}</span>
                    </div>
                  )}
                />

                {artDetailLoading && (
                  <p className="text-sm text-muted-foreground">Loading article…</p>
                )}

                {selectedArt && (
                  <>
                    {/* Article header */}
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-lg font-bold text-foreground">{selectedArt.artNumber}</span>
                      {editingLineId && (
                        <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-900/20 rounded-full px-2 py-0.5">
                          Editing line
                        </span>
                      )}
                    </div>

                    {/* Color chips */}
                    {selectedArt.colors.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Available Colors</p>
                        <div className="flex flex-wrap gap-2">
                          {selectedArt.colors.map(c => {
                            const active = selectedColorId === c.id
                            const hasData = Object.values(colorQuantities[c.id] ?? {}).some(v => v > 0)
                            const inOrder = lines.some(l => l.articleId === selectedArt.id && l.colorId === c.id)
                            return (
                              <button
                                key={c.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setSelectedColorId(c.id)}
                                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                  active
                                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                                }`}
                              >
                                <span className="w-3.5 h-3.5 rounded-full border border-white/30 flex-shrink-0"
                                  style={{ background: swatch(c.colorHex, c.colorName) }} aria-hidden />
                                {c.colorName}
                                {inOrder && !active && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" aria-label="added to order" />
                                )}
                                {hasData && !inOrder && !active && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" aria-label="has quantities" />
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No colors configured for this article. Add them in Master.</p>
                    )}

                    {/* Size matrix for selected color */}
                    {selectedColor && selectedArt.sizes.length > 0 && (
                      <div className="rounded-xl border border-border bg-background p-4 space-y-4">
                        {/* Color header */}
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full border border-border flex-shrink-0"
                              style={{ background: swatch(selectedColor.colorHex, selectedColor.colorName) }} aria-hidden />
                            <span className="text-sm font-semibold text-foreground">Color: {selectedColor.colorName}</span>
                          </div>

                          {/* Set buttons */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={applyDefaultSet}
                              disabled={!buildDefaultSet()}
                              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40"
                            >
                              {DEFAULT_SET_LABEL}
                            </button>
                            <button
                              type="button"
                              onClick={applyLastUsed}
                              disabled={!lastUsedSet}
                              title={lastUsedSet
                                ? `Restore: ${Object.entries(lastUsedSet).filter(([,v])=>v>0).map(([k,v])=>`${k}/${v}`).join(', ')}`
                                : 'No previous set'}
                              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Last Used
                            </button>
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <SizeMatrix
                            key={matrixKey}
                            sizes={selectedArt.sizes}
                            quantities={currentQties}
                            onChange={setCurrentQties}
                          />
                        </div>

                        {/* Error for this section */}
                        {error && (
                          <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
                        )}

                        {/* Add to Order */}
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={handleAddToOrder}
                            disabled={currentColorTotal === 0}
                            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            {editingLineId ? 'Save Changes' : '+ Add to Order'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* ── 3. CURRENT ORDER ── */}
            {lines.length > 0 && (
              <section aria-labelledby="order-heading" className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  <h2 id="order-heading" className="text-sm font-semibold text-foreground">Current Order</h2>
                  <span className="ml-auto text-xs text-muted-foreground">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
                </div>

                {/* ── Mobile: card per line ── */}
                <div className="sm:hidden divide-y divide-border">
                  {lines.map((line, idx) => {
                    const pairs = linePairs(line)
                    const isEditing = editingLineId === line.id
                    const sizeSummary = line.sizes
                      .filter(sz => (line.quantities[sz.sizeLabel] ?? 0) > 0)
                      .map(sz => `${sz.sizeLabel}/${line.quantities[sz.sizeLabel]}`)
                      .join(', ')
                    return (
                      <div key={line.id} className={`px-4 py-3 space-y-1.5 ${isEditing ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-muted-foreground w-4 shrink-0">{idx + 1}</span>
                            <span className="font-semibold text-sm truncate">{line.artNumber}</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                              <span className="w-2.5 h-2.5 rounded-full border border-border inline-block"
                                style={{ background: swatch(line.colorHex, line.colorName) }} aria-hidden />
                              {line.colorName}
                            </span>
                          </div>
                          <span className="font-bold text-sm shrink-0">{pairs} pr</span>
                        </div>
                        {sizeSummary && (
                          <p className="text-xs text-muted-foreground pl-6 truncate" title={sizeSummary}>{sizeSummary}</p>
                        )}
                        {isEditing && (
                          <p className="pl-6 text-[10px] font-medium text-amber-600 dark:text-amber-400">Editing this line…</p>
                        )}
                        <div className="pl-6 flex items-center gap-4 pt-0.5">
                          <button type="button" onClick={() => handleEditLine(line)}
                            className="text-xs font-medium text-primary hover:underline">
                            Edit
                          </button>
                          <button type="button" onClick={() => setDeleteLineId(line.id)}
                            className="text-xs font-medium text-red-500 hover:underline">
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* ── Desktop: table ── */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted/20">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">#</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Article</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Color</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Sizes</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Pairs</th>
                        <th className="text-center px-4 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lines.map((line, idx) => {
                        const pairs = linePairs(line)
                        const isEditing = editingLineId === line.id
                        const sizeSummary = line.sizes
                          .filter(sz => (line.quantities[sz.sizeLabel] ?? 0) > 0)
                          .map(sz => `${sz.sizeLabel}/${line.quantities[sz.sizeLabel]}`)
                          .join(', ')
                        return (
                          <tr key={line.id} className={`transition-colors ${isEditing ? 'bg-amber-50/30 dark:bg-amber-900/10' : 'hover:bg-muted/20'}`}>
                            <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                            <td className="px-4 py-3 font-semibold">{line.artNumber}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-full border border-border flex-shrink-0"
                                  style={{ background: swatch(line.colorHex, line.colorName) }} aria-hidden />
                                {line.colorName}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate" title={sizeSummary}>{sizeSummary}</td>
                            <td className="px-4 py-3 text-right font-semibold">{pairs}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-center gap-2">
                                <button type="button" onClick={() => handleEditLine(line)}
                                  aria-label={`Edit ${line.artNumber} ${line.colorName}`}
                                  className="text-xs text-primary hover:underline font-medium">
                                  Edit
                                </button>
                                <button type="button" onClick={() => setDeleteLineId(line.id)}
                                  aria-label={`Delete ${line.artNumber} ${line.colorName}`}
                                  className="text-muted-foreground hover:text-red-500 transition-colors">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Order totals */}
                <div className="border-t border-border px-4 py-3 flex flex-wrap gap-6">
                  <div><p className="text-xs text-muted-foreground">Total Articles</p><p className="text-base font-bold text-foreground">{uniqueArticles}</p></div>
                  <div><p className="text-xs text-muted-foreground">Total Pairs</p><p className="text-base font-bold text-foreground">{totalPairs}</p></div>
                </div>
              </section>
            )}

            {/* Notes */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
              <label htmlFor="order-notes" className="block text-xs font-medium text-muted-foreground">Notes (optional)</label>
              <textarea id="order-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Any special instructions…"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
            </div>

            {success && (
              <p className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2">{success}</p>
            )}
          </form>
        )}
      </div>

      {/* ── Sticky bottom actions (new order only) ── */}
      {view === 'new' && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur border-t border-border pb-4">
          <div className="max-w-4xl mx-auto px-4 py-3 flex gap-3 items-center">
            {lines.length > 0 && (
              <div className="flex gap-4 mr-auto text-sm">
                <span className="text-muted-foreground">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
                <span className="font-semibold text-foreground">{totalPairs} pairs</span>
              </div>
            )}
            <button type="button" onClick={() => { setView('list'); resetForm() }}
              className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </button>
            <button type="submit" form="new-order-form" disabled={!canSubmit}
              className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {isPending ? (editingOrderId != null ? 'Saving…' : 'Creating…') : (editingOrderId != null ? 'Save Changes' : 'Create Order')}
            </button>
          </div>
        </div>
      )}

      {/* ── Set confirmation dialog ── */}
      {setConfirm && (
        <ConfirmDialog
          title="Replace current quantities?"
          message={<>This will replace the quantities currently entered for <strong>{selectedColor?.colorName}</strong>.</>}
          confirmLabel="Apply Set"
          onCancel={() => setSetConfirm(false)}
          onConfirm={confirmApplySet}
        />
      )}

      {/* ── Cancel order confirmation ── */}
      {cancelOrderId != null && (() => {
        // Look up from orders list OR fall back to detailOrder (when cancelling from detail view)
        const order = orders.find(o => o.id === cancelOrderId) ?? (detailOrder?.id === cancelOrderId ? detailOrder : null)
        return order ? (
          <ConfirmDialog
            title="Cancel this order?"
            message={<><strong>{order.shopkeeperName}</strong> · <span className="font-mono">{order.orderNumber}</span><br />This cannot be undone.</>}
            confirmLabel={cancellingOrder ? 'Cancelling…' : 'Cancel Order'}
            onCancel={() => setCancelOrderId(null)}
            onConfirm={handleCancelOrder}
          />
        ) : null
      })()}

      {/* ── Delete line confirmation ── */}
      {deleteLineId && (() => {
        const line = lines.find(l => l.id === deleteLineId)
        return line ? (
          <ConfirmDialog
            title="Remove this item?"
            message={<><strong>{line.artNumber} · {line.colorName}</strong> · {linePairs(line)} pairs</>}
            confirmLabel="Remove"
            onCancel={() => setDeleteLineId(null)}
            onConfirm={confirmDeleteLine}
          />
        ) : null
      })()}
    </div>
  )
}
