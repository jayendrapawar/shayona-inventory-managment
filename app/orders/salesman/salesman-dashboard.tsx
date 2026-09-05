'use client'

import {
  useState, useTransition, useRef, useEffect, useMemo, useId, useCallback,
  forwardRef, useImperativeHandle,
} from 'react'
import { useRouter } from 'next/navigation'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { createOrder, updateOrder, cancelOrder, getSalesmanOrderWithItems } from '@/app/actions/orders'
import { PageNav } from '@/components/page-nav'
import { fuzzyFilter } from '@/lib/fuzzy'
import type { ArticleDetail, CatalogueData } from '@/app/actions/catalogue'
import { useCatalogueCache } from '@/lib/use-catalogue-cache'

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
  salesmanName?: string | null
}

// Statuses the salesman can still edit or cancel
const EDITABLE_STATUSES = ['pending', 'assigned']

interface Props {
  orders: ExistingOrder[]
  userName: string
  embedded?: boolean
  catalogue: CatalogueData
}

// Alias types that were previously imported from catalogue actions
type ShopkeeperResult = CatalogueData['vendors'][number]
type ArticleResult = { artNumber: string }

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
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  pattern?: string
}

export interface SearchComboboxHandle {
  focus: () => void
}

const SearchCombobox = forwardRef(function SearchComboboxInner<T>(
  {
    id, label, required, placeholder, inputValue, onInputChange,
    onSelect, onClear, results, loading, renderOption, getKey, disabled,
    inputMode, pattern,
  }: SearchComboboxProps<T>,
  ref: React.Ref<SearchComboboxHandle>,
) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    },
  }))

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
      if (item) { onSelect(item); setOpen(false); inputRef.current?.blur() }
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
          inputMode={inputMode}
          pattern={pattern}
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
          className="absolute z-50 bottom-full mb-1 w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-60 overflow-y-auto"
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
              onMouseDown={e => { e.preventDefault(); onSelect(item); setOpen(false); inputRef.current?.blur() }}
              className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${i === activeIdx ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {renderOption(item, i === activeIdx)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}) as <T>(props: SearchComboboxProps<T> & { ref?: React.Ref<SearchComboboxHandle> }) => React.ReactElement

// ─────────────────────────────────────────────────────────────────────────────
// OrderItemsCard — consolidated table view matching the screenshot layout
// Article | Color | Size/Qty — article name only on first row of its group
// ─────────────────────────────────────────────────────────────────────────────

interface OrderItemsCardProps {
  lines: OrderLine[]
  editingLineId: string | null
  onEdit: (line: OrderLine) => void
  onDeselect: () => void
}

function OrderItemsCard({ lines, editingLineId, onEdit, onDeselect }: OrderItemsCardProps) {
  // Group lines by artNumber preserving insertion order
  const groups: { artNumber: string; lines: OrderLine[] }[] = []
  const seen = new Map<string, OrderLine[]>()
  for (const line of lines) {
    if (!seen.has(line.artNumber)) {
      const group: OrderLine[] = []
      seen.set(line.artNumber, group)
      groups.push({ artNumber: line.artNumber, lines: group })
    }
    seen.get(line.artNumber)!.push(line)
  }

  const totalPairs = lines.reduce((s, l) => s + Object.values(l.quantities).reduce((a, b) => a + b, 0), 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        {/* Header */}
        <thead>
          <tr className="border-b border-border/50 bg-muted/20">
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground border-r border-border/40 whitespace-nowrap">Article</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground border-r border-border/40 whitespace-nowrap">Color</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Size / Qty</th>
          </tr>
        </thead>

        <tbody>
          {groups.map(group =>
            group.lines.map((line, lineIdx) => {
              const isFirst = lineIdx === 0
              const isEditing = editingLineId === line.id
              const sizeCols = line.sizes
                .filter((sz, i, arr) => arr.findIndex(s => s.sizeLabel === sz.sizeLabel) === i)
                .filter(sz => (line.quantities[sz.sizeLabel] ?? 0) > 0)

              return (
                <tr
                  key={line.id}
                  onClick={() => isEditing ? onDeselect() : onEdit(line)}
                  className={`border-b border-border/40 transition-colors cursor-pointer ${
                    isEditing ? 'bg-amber-50/40 dark:bg-amber-900/10' : 'hover:bg-primary/5'
                  }`}
                >
                  {/* Article cell — only shown on first row of group */}
                  <td className="px-3 py-2.5 align-top border-r border-border/40 whitespace-nowrap">
                    {isFirst && (
                      <span className="font-bold text-xs text-foreground">{group.artNumber}</span>
                    )}
                  </td>

                  {/* Color */}
                  <td className="px-3 py-2.5 align-middle border-r border-border/40 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-border/60 flex-shrink-0"
                        style={{ background: swatch(line.colorHex, line.colorName) }}
                        aria-hidden
                      />
                      <span className="font-medium text-foreground uppercase tracking-wide text-xs">
                        {line.colorName}
                      </span>
                    </div>
                  </td>

                  {/* Size / Qty */}
                  <td className="px-3 py-2.5 align-middle">
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {sizeCols.map(sz => (
                        <span key={sz.sizeLabel} className="text-xs text-muted-foreground whitespace-nowrap">
                          {sz.sizeLabel}/<span className="font-bold text-foreground">{line.quantities[sz.sizeLabel]}</span>
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              )
            })
          )}

          {/* Total row */}
          <tr className="border-t border-border/60 bg-muted/20">
            <td colSpan={2} className="px-3 py-2 text-right text-xs text-muted-foreground border-r border-border/40">Total</td>
            <td className="px-3 py-2 text-sm font-bold text-foreground">{totalPairs}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SizeMatrix — single color, quick buttons + manual input
// ─────────────────────────────────────────────────────────────────────────────

const QUICK_QTYS = [1, 2, 3, 4, 5]

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
    const current = quantities[sizeLabel] ?? 0
    // Double-tap: clicking the already-active chip deselects it (sets to 0)
    const next = !manualActive[sizeLabel] && current === qty ? 0 : qty
    setManualActive(prev => ({ ...prev, [sizeLabel]: false }))
    setQty(sizeLabel, next)
  }

  function handleManualChange(sizeLabel: string, raw: string) {
    setManualActive(prev => ({ ...prev, [sizeLabel]: true }))
    const n = parseInt(raw)
    setQty(sizeLabel, isNaN(n) || n < 0 ? 0 : n)
  }

  const colorTotal = sizes.reduce((s, sz) => s + (quantities[sz.sizeLabel] ?? 0), 0)

  // Responsive column sizes: on very small screens chips shrink to 2rem, on sm+ stay 2.5rem
  const gridCols = 'minmax(2rem,auto) repeat(5, minmax(0,2.5rem)) minmax(0,3.5rem) 2.5rem'

  return (
    <div className="space-y-1">
      {/* Header row */}
      <div className="grid items-center gap-y-0 gap-x-1" style={{ gridTemplateColumns: gridCols }}>
        <span className="text-xs font-medium text-muted-foreground leading-tight">Size</span>
        {QUICK_QTYS.map(q => (
          <span key={q} className="text-xs font-medium text-muted-foreground text-center">{q}</span>
        ))}
        <span className="text-xs font-medium text-muted-foreground text-center">Qty</span>
        <span className="text-xs font-medium text-muted-foreground text-center">=</span>
      </div>

      {/* Size rows */}
      {sizes.map(sz => {
        const current = quantities[sz.sizeLabel] ?? 0
        const isManual = manualActive[sz.sizeLabel]
        return (
          <div
            key={sz.id}
            className="grid items-center gap-y-0 gap-x-1 rounded-lg py-0.5"
            style={{ gridTemplateColumns: gridCols }}
          >
            <span className="text-sm font-medium text-foreground truncate pr-1 leading-tight">{sz.sizeLabel}</span>
            {QUICK_QTYS.map(q => {
              const isActive = !isManual && current === q
              // Active chip = green outline only. All other chips = normal grey.
              const chipClass = isActive
                ? 'border-green-400 bg-background text-green-700 dark:text-green-400 dark:border-green-600'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
              return (
                <button
                  key={q}
                  type="button"
                  aria-label={`Set ${sz.sizeLabel} to ${q}`}
                  aria-pressed={isActive}
                  onClick={() => handleQuickClick(sz.sizeLabel, q)}
                  className={`h-8 w-full rounded-lg text-sm font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${chipClass}`}
                >
                  {q}
                </button>
              )
            })}
            <input
              type="number"
              min={0}
              aria-label={`Manual quantity for size ${sz.sizeLabel}`}
              value={isManual ? (current === 0 ? '' : current) : (current > 5 ? current : '')}
              placeholder="0"
              onChange={e => handleManualChange(sz.sizeLabel, e.target.value)}
              onFocus={() => setManualActive(prev => ({ ...prev, [sz.sizeLabel]: true }))}
              className={`h-8 w-full rounded-lg border text-xs text-center font-medium bg-background focus:outline-none focus:ring-2 focus:ring-ring transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                (isManual && current > 0) || current > 5
                  ? 'border-green-400 text-green-700 dark:text-green-400 dark:border-green-600'
                  : 'border-border text-muted-foreground'
              }`}
            />
            <span className={`text-xs font-bold text-center ${current > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
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
// LiveBadge — shows last-refreshed time and a manual refresh button
// ─────────────────────────────────────────────────────────────────────────────

function LiveBadge({ lastRefreshed, onRefresh }: { lastRefreshed: Date; onRefresh: () => void }) {
  const [, tick] = useState(0)

  // Re-render every 30 s so the "X min ago" text stays accurate
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  function ago(d: Date) {
    const diff = Math.floor((Date.now() - d.getTime()) / 1000)
    if (diff < 10) return 'just now'
    if (diff < 60) return `${diff}s ago`
    const m = Math.floor(diff / 60)
    return `${m}m ago`
  }

  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Live · updated {ago(lastRefreshed)}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        title="Refresh now"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582M20 20v-5h-.581M4.582 9A8 8 0 0120 15M19.418 15A8 8 0 014 9" />
        </svg>
        Refresh
      </button>
    </div>
  )
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

export function SalesmanDashboard({ orders, userName, embedded, catalogue: serverCatalogue }: Props) {
  // Use cache-first catalogue: returns serverCatalogue immediately on first render,
  // then silently hydrates from Cache API / re-fetches in background
  const catalogue = useCatalogueCache(serverCatalogue)

  const [view, setView] = useState<'list' | 'new' | 'detail' | 'print'>('new')
  const router = useRouter()

  // ── Auto-refresh (All Orders stays live) ──
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date())
  const { refresh: rawRefresh } = useAutoRefresh(30_000)
  const refresh = useCallback(() => {
    rawRefresh()
    setLastRefreshed(new Date())
  }, [rawRefresh])
  // Update lastRefreshed whenever orders prop changes (server pushed new data)
  useEffect(() => { setLastRefreshed(new Date()) }, [orders])

  // ── Detail view state ──
  const [detailOrder, setDetailOrder] = useState<ExistingOrder | null>(null)
  const [detailItems, setDetailItems] = useState<DetailItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  // ── Filter + sort state ──
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterSalesman, setFilterSalesman] = useState<string>(userName || 'all')
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
  const artSearchRef = useRef<SearchComboboxHandle>(null)
  const artSectionRef = useRef<HTMLElement>(null)
  const currentOrderSectionRef = useRef<HTMLElement>(null)

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

  // ── Single confirmation dialog ──
  const [singleConfirm, setSingleConfirm] = useState(false)

  // ── Edit state ──
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  // Ref mirror so event-handler callbacks always read the latest value without stale closure issues
  const editingLineIdRef = useRef<string | null>(null)
  useEffect(() => { editingLineIdRef.current = editingLineId }, [editingLineId])

  // ── Outside-click deselect: clear selection when clicking outside BOTH the
  //    Current Order card AND the Article section (user may be editing quantities there)
  useEffect(() => {
    if (!editingLineId) return
    function handleOutside(e: MouseEvent) {
      const inOrderCard  = currentOrderSectionRef.current?.contains(e.target as Node) ?? false
      const inArtSection = artSectionRef.current?.contains(e.target as Node) ?? false
      if (!inOrderCard && !inArtSection) {
        setEditingLineId(null)
        setSelectedColorId(null)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  // Only re-register when editingLineId transitions null ↔ non-null, not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingLineId != null])

  // ── Editing an existing order (vs creating new) ──
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null)

  // ── Print Orders state ──
  const [printSelectedIds, setPrintSelectedIds] = useState<Set<number>>(new Set())
  const [printItemsMap, setPrintItemsMap] = useState<Record<number, DetailItem[]>>({})
  const [printLoadingIds, setPrintLoadingIds] = useState<Set<number>>(new Set())
  const [printConfigOpen, setPrintConfigOpen] = useState(false)
  const [printPageSize, setPrintPageSize] = useState<'A4' | 'A5'>('A5')
  const [printOrientation, setPrintOrientation] = useState<'portrait' | 'landscape'>('portrait')

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

  // ── Preloaded catalogue lookup map (artNumber → ArticleDetail) ──
  const artCatalogueMap = useMemo(() => {
    const m = new Map<string, ArticleDetail>()
    for (const a of catalogue.articles) m.set(a.artNumber, a)
    return m
  }, [catalogue.articles])

  // ── Vendor search — purely client-side, instant ──
  useEffect(() => {
    setSkLoading(false)
    if (!skQuery.trim()) {
      setSkResults(catalogue.vendors.slice(0, 20))
      return
    }
    const results = fuzzyFilter(
      catalogue.vendors,
      skQuery,
      v => [v.name, v.code, v.phone, v.address],
    )
    setSkResults(results.slice(0, 20))
  }, [skQuery, catalogue.vendors])

  // ── Article search — purely client-side, instant ──
  useEffect(() => {
    setArtLoading(false)
    if (!artQuery.trim()) {
      setArtResults(catalogue.articles.slice(0, 20).map(a => ({ artNumber: a.artNumber })))
      return
    }
    const results = fuzzyFilter(
      catalogue.articles,
      artQuery,
      a => [a.artNumber],
    )
    setArtResults(results.slice(0, 20).map(a => ({ artNumber: a.artNumber })))
  }, [artQuery, catalogue.articles])

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

  // ── Select an article from search — instant Map lookup, no network ──
  function handleSelectArticle(art: ArticleResult) {
    setArtQuery(art.artNumber)
    const detail = artCatalogueMap.get(art.artNumber) ?? null
    setSelectedArt(detail)
    setSelectedColorId(null)
    setColorQuantities({})
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

  // ── Apply single (qty 1 for every available size of the selected color) ──
  function buildSingle(): Record<string, number> | null {
    if (!selectedArt || !selectedColor) return null
    const sizes = selectedArt.sizes.filter(s => s.articleId === selectedColor.articleId)
    if (sizes.length === 0) return null
    const result: Record<string, number> = {}
    sizes.forEach(s => { result[s.sizeLabel] = 1 })
    return result
  }

  function applySingle() {
    const s = buildSingle()
    if (!s) return
    const hasAny = Object.values(currentQties).some(v => v > 0)
    if (hasAny) { setSingleConfirm(true); return }
    setCurrentQties(s)
  }

  function confirmApplySingle() {
    const s = buildSingle()
    if (s) setCurrentQties(s)
    setSingleConfirm(false)
  }

  // ── Add / save current color to order ──
  // Always replaces: whether it's a brand-new color or re-editing one already in the order.
  function handleAddToOrder() {
    if (!selectedArt || selectedColorId == null || !selectedColor) return
    if (currentColorTotal === 0) {
      setError('Add at least one pair before adding this item.')
      return
    }
    setError('')

    const qties = { ...currentQties }
    const existingIdx = lines.findIndex(
      l => l.articleId === selectedArt.id && l.colorId === selectedColorId
    )
    const editIdx = editingLineId ? lines.findIndex(l => l.id === editingLineId) : -1

    if (editIdx !== -1) {
      // Came via "Edit" button from the cart — replace that specific line
      setLines(prev => prev.map(l =>
        l.id === editingLineId ? { ...l, quantities: qties } : l
      ))
      setEditingLineId(null)
    } else if (existingIdx !== -1) {
      // User re-selected this color from the chip — replace quantities (no merge)
      setLines(prev => prev.map((l, i) =>
        i !== existingIdx ? l : { ...l, quantities: qties }
      ))
    } else {
      // Brand new color
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

    // Remember last used set globally
    setLastUsedSet(qties)

    // Clear working quantities for this color and deselect
    setColorQuantities(prev => ({ ...prev, [selectedColorId]: {} }))
    setSelectedColorId(null)
    // Force SizeMatrix remount so manualActive state is cleared
    setMatrixKey(k => k + 1)
  }

  // ── Next Article — save ALL colors with qty > 0 for this article, then jump to article search ──
  function handleNextArticle() {
    if (selectedArt) {
      let lastQties: Record<string, number> | null = null

      setLines(prev => {
        let next = [...prev]

        // Flush every color that has at least 1 pair entered
        for (const [colorIdStr, qties] of Object.entries(colorQuantities)) {
          const colorId = Number(colorIdStr)
          const total = Object.values(qties).reduce((s, n) => s + n, 0)
          if (total === 0) continue

          const colorObj = selectedArt.colors.find(c => c.id === colorId)
          if (!colorObj) continue

          lastQties = qties

          // If we're editing a specific line and this is that color, update it
          const editIdx = editingLineId ? next.findIndex(l => l.id === editingLineId && l.colorId === colorId) : -1
          if (editIdx !== -1) {
            next = next.map(l => l.id === editingLineId ? { ...l, quantities: { ...qties } } : l)
          } else {
            const existingIdx = next.findIndex(
              l => l.articleId === selectedArt.id && l.colorId === colorId
            )
            if (existingIdx !== -1) {
              next = next.map((l, i) => i !== existingIdx ? l : { ...l, quantities: { ...qties } })
            } else {
              next = [...next, {
                id: uid(),
                articleId: selectedArt.id,
                artNumber: selectedArt.artNumber,
                colorId,
                colorName: colorObj.colorName,
                colorHex: colorObj.colorHex,
                sizes: selectedArt.sizes,
                quantities: { ...qties },
              }]
            }
          }
        }

        return next
      })

      if (lastQties) setLastUsedSet(lastQties)
    }

    // Clear article and focus the search input
    setArtQuery('')
    setArtResults([])
    setSelectedArt(null)
    setSelectedColorId(null)
    setColorQuantities({})
    setEditingLineId(null)
    setError('')
    setMatrixKey(k => k + 1)
    // Small timeout so the input is visible/enabled before focus
    setTimeout(() => artSearchRef.current?.focus(), 50)
  }

  // ── Deselect current line (clear editing state) ──
  const handleDeselectLine = useCallback(() => {
    setEditingLineId(null)
    setSelectedColorId(null)
  }, [])

  // ── Edit a line (open it in the matrix for modification) ──
  const handleEditLine = useCallback((line: OrderLine) => {
    const detail = artCatalogueMap.get(line.artNumber) ?? null
    // Set selectedArt + color + quantities atomically.
    // Do NOT call setArtQuery here — changing the search input value fires the article
    // search effect, populates the dropdown, and risks handleSelectArticle being triggered
    // which resets selectedColorId and colorQuantities. The article name is shown as a
    // heading inside the section so the search field can safely stay as-is.
    setSelectedArt(detail)
    setSelectedColorId(line.colorId)
    setColorQuantities(prev => ({ ...prev, [line.colorId]: { ...line.quantities } }))
    setEditingLineId(line.id)
    // Scroll the Article section into view after React has committed the state
    setTimeout(() => {
      artSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [artCatalogueMap])

  // ── Delete the currently selected line directly ──
  const handleDeleteSelectedLine = useCallback(() => {
    const id = editingLineIdRef.current
    if (!id) return
    setLines(prev => prev.filter(l => l.id !== id))
    setEditingLineId(null)
    setSelectedColorId(null)
    setSelectedArt(null)
    setArtQuery('')
    setColorQuantities({})
  }, [])

  // ── Reset everything ──
  function resetForm() {
    setSelectedSk(null); setSkQuery('')
    clearArticle()
    setLines([]); setNotes('')
    setError(''); setSuccess('')
    setEditingLineId(null)
    setEditingOrderId(null)
    // lastUsedSet is intentionally kept so it carries forward to the next new order
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

      // Use preloaded catalogue map — no extra DB round-trips
      const detailMap = artCatalogueMap

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
      setSelectedSk({ id: '', name: o.shopkeeperName, code: null, phone: null, address: null })
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

  // ── Toggle selection of an order for printing ──
  async function handleTogglePrintOrder(order: ExistingOrder) {
    const id = order.id
    setPrintSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    // Lazily load items if not yet loaded
    if (!printItemsMap[id]) {
      setPrintLoadingIds(prev => new Set(prev).add(id))
      try {
        const { items } = await getSalesmanOrderWithItems(id)
        setPrintItemsMap(prev => ({ ...prev, [id]: items as DetailItem[] }))
      } finally {
        setPrintLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s })
      }
    }
  }

  // ── Build a Pick List bill HTML fragment for one order ──
  function buildBillFragment(
    order: ExistingOrder,
    items: DetailItem[],
    salesman: string,
    orientation: 'portrait' | 'landscape',
  ): string {
    const artMap = new Map<string, Map<string, Record<string, number>>>()
    for (const item of items) {
      const art = item.artNumber
      const col = item.colorNumber ?? ''
      if (!artMap.has(art)) artMap.set(art, new Map())
      const colMap = artMap.get(art)!
      if (!colMap.has(col)) colMap.set(col, {})
      const sz = item.sizeNumber ?? '?'
      colMap.get(col)![sz] = (colMap.get(col)![sz] ?? 0) + item.quantityOrdered
    }
    const grandTotal = items.reduce((s, i) => s + i.quantityOrdered, 0)
    const dateStr = new Date(order.orderedAt).toLocaleDateString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    let rows = ''
    artMap.forEach((colMap, artNumber) => {
      rows += `<div class="art-block"><div class="art-number">${artNumber}</div>`
      colMap.forEach((sizes, color) => {
        const sorted = Object.entries(sizes).sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b))
        const sizesStr = sorted.map(([sz, qty]) => `${sz}/${qty}`).join(', ')
        const bracket = orientation === 'portrait'
          ? '[&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]'
          : '[&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;]'
        rows += `<div class="color-row"><span class="col-color">${color || '—'}</span><span class="col-sizes">${sizesStr}</span><span class="col-bracket">${bracket}</span></div>`
      })
      rows += `</div>`
    })
    return `<div class="bill${orientation === 'portrait' ? ' bill-portrait' : ''}">
  <div class="bill-title">${order.shopkeeperName}</div>
  <div class="bill-meta"><span class="meta-order">Order #${order.orderNumber}</span><span class="meta-sep">&nbsp;·&nbsp;</span><span class="meta-date">${dateStr}</span></div>
  <div class="rule"></div>
  ${rows}
  <div class="rule"></div>
  <div class="total-row"><span>Total</span><span>${grandTotal} pairs</span></div>
  <div class="rule"></div>
  <div class="picker-row"><span>Picked by:&nbsp;<span class="blank-line"></span></span><span>Salesman: ${salesman}</span></div>
</div>`
  }

  // ── Estimate the relative "height" of a bill (in logical line units) ──
  function estimateBillHeight(items: DetailItem[]): number {
    // Fixed overhead: title(1) + meta(1) + rule(1) + parties(1) + rule(1) + rule(1) + total(1) + rule(1) + picker(1) = 9
    const FIXED_LINES = 9
    // Per article: article-number row (1) + one color row per unique color
    const artMap = new Map<string, Set<string>>()
    for (const item of items) {
      if (!artMap.has(item.artNumber)) artMap.set(item.artNumber, new Set())
      artMap.get(item.artNumber)!.add(item.colorNumber ?? '')
    }
    let artLines = 0
    artMap.forEach((colors, _) => { artLines += 1 + colors.size })  // 1 art-number + N color rows
    return FIXED_LINES + artLines
  }

  // ── Open a new window with bills packed tightly and trigger print ──
  function handlePrintOrders(
    selectedOrders: ExistingOrder[],
    pageSize: 'A4' | 'A5',
    orientation: 'portrait' | 'landscape',
  ) {
    // Page dimensions in mm
    const pageDims = {
      A4:     { w: 210, h: 297 },
      A5:     { w: 148, h: 210 },
    }
    const { w: pw, h: ph } = pageDims[pageSize]
    const [pageW, pageH] = orientation === 'landscape' ? [ph, pw] : [pw, ph]

    // Usable area after margins (6mm each side)
    const marginMm = 6
    const usableW = pageW - marginMm * 2   // mm

    // Bill width: try to fit 2 per row in landscape, 1 in portrait
    // 1mm ≈ 3.7795px at 96dpi; bill inner width chosen so two fit with a gap
    const gapMm = 4
    const cols = orientation === 'landscape' ? 2 : 1
    const billWidthMm = (usableW - gapMm * (cols - 1)) / cols
    const billWidthPx = Math.floor(billWidthMm * 3.7795)

    // ── Sort by height descending so same-sized bills land on the same row ──
    // flex-wrap places bills left→right; sorting descending means the two
    // tallest bills fill row 1, the next two fill row 2, etc.
    // For portrait (1 col) the row concept doesn't apply — keep original order.
    let orderedOrders: ExistingOrder[]
    if (cols === 1) {
      orderedOrders = [...selectedOrders]
    } else {
      orderedOrders = [...selectedOrders].sort(
        (a, b) =>
          estimateBillHeight(printItemsMap[b.id] ?? []) -
          estimateBillHeight(printItemsMap[a.id] ?? []),
      )
    }

    const bills = orderedOrders
      .map(o => buildBillFragment(o, printItemsMap[o.id] ?? [], userName, orientation))
      .join('\n')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Bills</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    background: #fff;
    color: #000;
    /* flex-wrap so bills fill columns naturally */
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: ${gapMm}mm;
    padding: ${marginMm}mm;
    width: ${pageW}mm;
  }
  .bill {
    width: ${billWidthPx}px;
    border: 1px solid #ccc;
    padding: 6px 8px 5px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .bill-title    { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 0; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bill-meta     { text-align: center; font-size: 9px; color: #555; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bill-meta-sm  { font-size: 8.5px; margin-bottom: 4px; }
  .rule          { border-top: 1px dashed #aaa; margin: 3px 0; }
  .bill-parties  { display: flex; justify-content: space-between; align-items: baseline; padding: 2px 0; }
  .shop-name     { font-weight: bold; font-size: 12px; }
  .salesman-name { font-size: 11px; }
  .art-block     { margin: 4px 0 1px; }
  .art-number    { font-weight: bold; font-size: 12px; margin-bottom: 1px; }
  .color-row     { display: flex; align-items: baseline; gap: 6px; padding: 1px 0; font-size: 11px; }
  .col-color     { width: 64px; flex-shrink: 0; }
  .col-sizes     { flex: 1; font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; min-width: 0; }
  .bill-portrait .color-row { gap: 12px; }
  .col-bracket   { white-space: nowrap; }
  .total-row     { display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; padding: 2px 0; }
  .picker-row    { display: flex; justify-content: space-between; font-size: 10px; color: #555; padding: 2px 0; }
  .blank-line    { display: inline-block; border-bottom: 1px solid #000; width: 80px; margin-bottom: -1px; }
  .blank-line.short { width: 50px; }
  @media print {
    @page {
      size: ${pageSize} ${orientation};
      margin: ${marginMm}mm;
    }
    body { padding: 0; width: 100%; }
  }
</style>
</head>
<body>
${bills}
<script>window.onload = function(){ window.print(); }</` + `script>
</body>
</html>`

    const winW = Math.round(pageW * 3.7795) + 40
    const winH = Math.min(Math.round(pageH * 3.7795) + 80, screen.availHeight - 60)
    const w = window.open('', '_blank', `width=${winW},height=${winH}`)
    if (w) {
      w.document.write(html)
      w.document.close()
    }
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
    inProgress: orders.filter(o => !['pending', 'cancelled', 'dispatched', 'delivered'].includes(o.status)).length,
  }

  // ── Unique salesmen list for filter dropdown ──
  const uniqueSalesmen = useMemo(() => {
    const list = new Set<string>()
    if (userName) {
      list.add(userName)
    }
    orders.forEach(o => {
      if (o.salesmanName) {
        list.add(o.salesmanName)
      }
    })
    return Array.from(list).sort()
  }, [orders, userName])

  // ── Filtered + sorted orders ──
  const displayedOrders = useMemo(() => {
    let list = orders
    if (filterStatus !== 'all') {
      list = list.filter(o => o.status === filterStatus)
    }
    if (filterSalesman !== 'all') {
      list = list.filter(o => o.salesmanName === filterSalesman)
    }
    if (sortBy === 'date-desc') list = [...list].sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime())
    if (sortBy === 'date-asc')  list = [...list].sort((a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime())
    if (sortBy === 'order')     list = [...list].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))
    return list
  }, [orders, filterStatus, filterSalesman, sortBy])

  const ALL_STATUSES = ['pending', 'assigned', 'packed', 'dispatched', 'delivered', 'cancelled']

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className={embedded ? '' : 'min-h-screen bg-background'}>
      <div className={embedded ? 'pb-32' : 'max-w-4xl mx-auto px-4 py-6 pb-32'}>
        {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="My Orders" subtitle={`Welcome, ${userName}`} />
          <PageNav />
        </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Total" value={counts.total} />
          <StatCard label="Pending" value={counts.pending} color="text-yellow-600" />
          <StatCard label="In Progress" value={counts.inProgress} color="text-blue-600" />
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border mb-6">
          {(['list', 'new', 'print'] as const)
            .map(t => (
            <button key={t} type="button"
              onClick={() => {
                setView(t)
                if (t === 'list') resetForm()
                if (t === 'print') { setPrintSelectedIds(new Set()); setPrintItemsMap({}) }
              }}
              className={`flex-1 px-2 py-2 text-xs sm:text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                (view === t || (view === 'detail' && t === 'list')) ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
              {t === 'list' ? 'All Orders' : t === 'new' ? 'New Order' : 'Print Orders'}
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

            {/* Live refresh indicator */}
            <LiveBadge lastRefreshed={lastRefreshed} onRefresh={refresh} />

            {/* Filter + Sort bar (Compact & Sleek) */}
            {orders.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-2.5 space-y-2 mb-3 text-xs shadow-sm">
                {/* 1st Line: Salesman Selector (Compact & Full-width) */}
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-muted-foreground uppercase tracking-wide flex-shrink-0">Salesman:</span>
                  <select
                    value={filterSalesman}
                    onChange={e => setFilterSalesman(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer min-w-0"
                  >
                    <option value="all">All Salesmen</option>
                    {uniqueSalesmen.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* 2nd Line: Status (left) & Sort (right) (Compact) */}
                <div className="flex items-center justify-between gap-4">
                  {/* Status Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-muted-foreground uppercase tracking-wide flex-shrink-0">Status:</span>
                    <select
                      value={filterStatus}
                      onChange={e => setFilterStatus(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer w-32 sm:w-36"
                    >
                      <option value="all">All Statuses</option>
                      {ALL_STATUSES.map(s => (
                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                      ))}
                    </select>
                  </div>

                  {/* Sort Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-muted-foreground uppercase tracking-wide flex-shrink-0">Sort:</span>
                    <select
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value as typeof sortBy)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer w-32 sm:w-36"
                    >
                      <option value="date-desc">Newest first</option>
                      <option value="date-asc">Oldest first</option>
                      <option value="order">Order number</option>
                    </select>
                  </div>
                </div>
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
                    {order.salesmanName && (
                      <span className="text-xs text-muted-foreground">• Created by: <span className="font-medium text-foreground">{order.salesmanName}</span></span>
                    )}
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
                {detailOrder.salesmanName && (
                  <>
                    <span className="text-muted-foreground">Created by</span>
                    <span className="text-foreground font-medium">{detailOrder.salesmanName}</span>
                  </>
                )}
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
              {!detailLoading && detailItems.length > 0 && (() => {
                const showPacked = ['packed', 'dispatched', 'delivered'].includes(detailOrder.status)
                // Group: artNumber → colorNumber → items
                const artMap = new Map<string, Map<string, DetailItem[]>>()
                for (const item of detailItems) {
                  if (!artMap.has(item.artNumber)) artMap.set(item.artNumber, new Map())
                  const colorKey = item.colorNumber ?? '—'
                  if (!artMap.get(item.artNumber)!.has(colorKey)) artMap.get(item.artNumber)!.set(colorKey, [])
                  artMap.get(item.artNumber)!.get(colorKey)!.push(item)
                }
                const articleGroups = Array.from(artMap.entries()).map(([artNumber, colorMap]) => ({
                  artNumber,
                  colorGroups: Array.from(colorMap.entries()).map(([color, items]) => ({ color, items })),
                }))
                return (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/20 border-b border-border">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Article</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Color</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">
                          {showPacked
                            ? <>Size <span className="ml-1 text-[10px] font-normal text-muted-foreground/60">ord→pkd</span></>
                            : 'Size / Qty'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {articleGroups.map(({ artNumber, colorGroups }) =>
                        colorGroups.map(({ color, items }, ci) => {
                          const allOrd = colorGroups.flatMap(cg => cg.items).reduce((s, i) => s + i.quantityOrdered, 0)
                          const allPkd = colorGroups.flatMap(cg => cg.items).reduce((s, i) => s + i.quantityPacked, 0)
                          return (
                            <tr key={`${artNumber}-${color}`} className="border-b border-border hover:bg-muted/20">
                              {ci === 0 && (
                                <td
                                  className="px-4 py-2.5 font-semibold text-xs align-top border-r border-border"
                                  rowSpan={colorGroups.length}
                                >
                                  {artNumber}
                                  {showPacked && (
                                    <>
                                      <span className="block font-normal text-muted-foreground tabular-nums mt-0.5">{allOrd} ord</span>
                                      <span className={`block font-semibold tabular-nums ${allPkd < allOrd ? 'text-yellow-500' : 'text-green-600 dark:text-green-400'}`}>{allPkd} pkd</span>
                                    </>
                                  )}
                                </td>
                              )}
                              <td className="px-3 py-2.5 text-xs font-medium text-foreground align-top w-28 border-r border-border">{color}</td>
                              <td className="px-3 py-2.5 align-top">
                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                  {items.map(item => {
                                    if (!showPacked) return (
                                      <span key={item.id} className="text-xs tabular-nums whitespace-nowrap">
                                        <span className="text-muted-foreground">{item.sizeNumber ?? '—'}</span>
                                        <span className="mx-0.5 text-muted-foreground">/</span>
                                        <span className="font-semibold text-foreground">{item.quantityOrdered}</span>
                                      </span>
                                    )
                                    const isOOS  = item.status === 'out_of_stock'
                                    const isFull = !isOOS && item.quantityPacked >= item.quantityOrdered
                                    return (
                                      <span key={item.id} className="inline-flex items-baseline gap-0.5 text-xs tabular-nums whitespace-nowrap">
                                        <span className="text-foreground">{item.sizeNumber ?? '—'}</span>
                                        <span className="text-[10px] text-muted-foreground/50 mx-px">/</span>
                                        <span className="font-bold text-foreground">{item.quantityOrdered}</span>
                                        <span className="text-[10px] text-muted-foreground/40">→</span>
                                        <span className={`font-bold ${isOOS ? 'text-red-500' : isFull ? 'text-green-600 dark:text-green-400' : 'text-yellow-500'}`}>
                                          {isOOS ? 0 : item.quantityPacked}
                                        </span>
                                      </span>
                                    )
                                  })}
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                    <tfoot className="border-t-2 border-border bg-muted/20">
                      <tr>
                        <td colSpan={2} className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Total</td>
                        <td className="px-3 py-2.5 text-xs">
                          {showPacked ? (
                            <>
                              <span className="font-medium text-foreground tabular-nums">{detailItems.reduce((s, i) => s + i.quantityOrdered, 0)}</span>
                              <span className="text-muted-foreground mx-1">ord /</span>
                              <span className={`font-bold tabular-nums ${detailItems.reduce((s, i) => s + i.quantityPacked, 0) < detailItems.reduce((s, i) => s + i.quantityOrdered, 0) ? 'text-yellow-500' : 'text-green-600 dark:text-green-400'}`}>
                                {detailItems.reduce((s, i) => s + i.quantityPacked, 0)}
                              </span>
                              <span className="text-muted-foreground ml-1">pkd</span>
                            </>
                          ) : (
                            <span className="font-bold tabular-nums">{detailItems.reduce((s, i) => s + i.quantityOrdered, 0)}</span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                )
              })()}
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
                    getKey={r => r.name}
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
            <section ref={artSectionRef} aria-labelledby="art-heading" className="rounded-2xl border border-border bg-card">
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
                  ref={artSearchRef}
                  id="art-search"
                  label="Search Article Number"
                  required
                  placeholder="Search article number..."
                  inputValue={artQuery}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  onInputChange={setArtQuery}
                  onSelect={handleSelectArticle}
                  onClear={clearArticle}
                  results={artResults}
                  loading={artLoading}
                  getKey={r => r.artNumber}
                  renderOption={(r, active) => (
                    <div className="flex items-center justify-between gap-4">
                      <span className={`font-semibold ${active ? 'text-primary-foreground' : 'text-foreground'}`}>{r.artNumber}</span>
                    </div>
                  )}
                />

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
                            const savedLine = lines.find(l => l.articleId === selectedArt.id && l.colorId === c.id)
                            const inOrder = !!savedLine
                            // Dirty = in order but working quantities differ from what's saved
                            const isDirty = inOrder && hasData && savedLine
                              ? Object.keys({ ...colorQuantities[c.id], ...savedLine.quantities }).some(
                                  k => (colorQuantities[c.id]?.[k] ?? 0) !== (savedLine.quantities[k] ?? 0)
                                )
                              : false
                            return (
                              <button
                                key={c.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => {
                                  // Only seed from saved line if there are no working quantities
                                  // already — preserves any unsaved edits the user made before switching away.
                                  const hasWorking = Object.values(colorQuantities[c.id] ?? {}).some(v => v > 0)
                                  if (!hasWorking) {
                                    const savedLine = lines.find(
                                      l => l.articleId === selectedArt.id && l.colorId === c.id
                                    )
                                    if (savedLine) {
                                      setColorQuantities(prev => ({ ...prev, [c.id]: { ...savedLine.quantities } }))
                                    }
                                  }
                                  setSelectedColorId(c.id)
                                }}
                                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                  active
                                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                                }`}
                              >
                                <span className="w-3.5 h-3.5 rounded-full border border-white/30 flex-shrink-0"
                                  style={{ background: swatch(c.colorHex, c.colorName) }} aria-hidden />
                                {c.colorName}
                                {inOrder && !isDirty && !active && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" aria-label="added to order" />
                                )}
                                {inOrder && isDirty && !active && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" aria-label="unsaved changes" />
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

                    {/* Size matrix for selected color — filtered to this color's articleId */}
                    {selectedColor && selectedArt.sizes.filter(s => s.articleId === selectedColor.articleId).length > 0 && (
                      <div className="rounded-xl border border-border bg-background p-3 space-y-3">
                        {/* Color header — name left, set-buttons right; on narrow screens buttons wrap below */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="w-4 h-4 rounded-full border border-border flex-shrink-0"
                              style={{ background: swatch(selectedColor.colorHex, selectedColor.colorName) }} aria-hidden />
                            <span className="text-sm font-semibold text-foreground truncate">Color: {selectedColor.colorName}</span>
                          </div>

                          {/* Set buttons — compact, never overflow their row */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={applySingle}
                              disabled={!buildSingle()}
                              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40"
                            >
                              Single
                            </button>
                            <button
                              type="button"
                              onClick={applyDefaultSet}
                              disabled={!buildDefaultSet()}
                              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40"
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
                              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Last Used
                            </button>
                          </div>
                        </div>

                        <SizeMatrix
                          key={matrixKey}
                          sizes={selectedArt.sizes.filter(s => s.articleId === selectedColor.articleId)}
                          quantities={currentQties}
                          onChange={setCurrentQties}
                        />

                        {/* Error for this section */}
                        {error && (
                          <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
                        )}

                        {/* Add to Order + Next Article — full-width on mobile, auto-width on wider */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleNextArticle}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                            Next Article
                          </button>
                          <button
                            type="button"
                            onClick={handleAddToOrder}
                            disabled={currentColorTotal === 0}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            {(editingLineId || lines.some(l => l.articleId === selectedArt.id && l.colorId === selectedColorId))
                              ? 'Save Changes'
                              : 'Add to Order'}
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
              <section
                ref={currentOrderSectionRef}
                aria-labelledby="order-heading"
                className="rounded-2xl border border-border bg-card overflow-hidden"
              >
                <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  <h2 id="order-heading" className="text-sm font-semibold text-foreground">Current Order</h2>
                  <span className="ml-auto text-xs text-muted-foreground">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
                  {editingLineId && (
                    <button
                      type="button"
                      onClick={handleDeleteSelectedLine}
                      className="flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      aria-label="Delete selected line"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  )}
                </div>
                <OrderItemsCard
                  lines={lines}
                  editingLineId={editingLineId}
                  onEdit={handleEditLine}
                  onDeselect={handleDeselectLine}
                />
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

        {/* ═══════════════════════════════════════════════════════════════
            PRINT ORDERS
        ════════════════════════════════════════════════════════════════ */}
        {view === 'print' && (() => {
          const assignedOrders = orders.filter(o => o.status === 'assigned' || o.status === 'pending')
          const selectedOrders = assignedOrders.filter(o => printSelectedIds.has(o.id))
          const allLoaded = selectedOrders.every(o => !!printItemsMap[o.id])
          const allSelected = assignedOrders.length > 0 && assignedOrders.every(o => printSelectedIds.has(o.id))
          const totalSelectedPairs = selectedOrders.reduce(
            (s, o) => s + (printItemsMap[o.id] ?? []).reduce((ss, i) => ss + i.quantityOrdered, 0), 0
          )

          function toggleAll() {
            if (allSelected) {
              setPrintSelectedIds(new Set())
              setPrintItemsMap({})
            } else {
              assignedOrders.forEach(o => { if (!printSelectedIds.has(o.id)) handleTogglePrintOrder(o) })
            }
          }

          return (
            <div className="space-y-3">

              {/* ── Empty state ── */}
              {assignedOrders.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                  <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <div className="text-center">
                    <p className="text-sm font-medium">No pending or assigned orders</p>
                    <p className="text-xs mt-0.5">Orders must be in <span className="font-semibold text-foreground">pending</span> or <span className="font-semibold text-foreground">assigned</span> status to appear here.</p>
                  </div>
                </div>
              )}

              {/* ── Selection card ── */}
              {assignedOrders.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">

                  {/* Card header */}
                  <div className="px-3 py-3 sm:px-4 sm:py-3.5 bg-muted/30 border-b border-border">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <h2 className="text-sm font-semibold text-foreground">Select Orders to Print</h2>
                        {printSelectedIds.size > 0 && (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                            {printSelectedIds.size}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={toggleAll}
                        className="text-xs font-medium text-primary hover:underline shrink-0"
                      >
                        {allSelected ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                  </div>

                  {/* Rows */}
                  <div className="divide-y divide-border">
                    {assignedOrders.map(order => {
                      const checked = printSelectedIds.has(order.id)
                      const loading = printLoadingIds.has(order.id)
                      const pairs = printItemsMap[order.id]?.reduce((s, i) => s + i.quantityOrdered, 0) ?? null

                      return (
                        <label
                          key={order.id}
                          className={`flex items-center gap-3 px-3 py-3 sm:px-4 cursor-pointer select-none transition-colors ${
                            checked ? 'bg-primary/5' : 'hover:bg-muted/30 active:bg-muted/50'
                          }`}
                        >
                          {/* Custom checkbox */}
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                            checked ? 'border-primary bg-primary' : 'border-border bg-background'
                          }`}>
                            {checked && (
                              <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleTogglePrintOrder(order)}
                            className="sr-only"
                          />

                          {/* Text */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate leading-snug">{order.shopkeeperName}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="font-mono text-[11px] text-muted-foreground">{order.orderNumber}</span>
                              <span className="text-[11px] text-muted-foreground">·</span>
                              <span className="text-[11px] text-muted-foreground">{fmt(order.orderedAt)}</span>
                            </div>
                          </div>

                          {/* Right side */}
                          <div className="flex items-center gap-2 shrink-0">
                            {loading && (
                              <svg className="w-3.5 h-3.5 text-muted-foreground animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                              </svg>
                            )}
                            {checked && !loading && pairs !== null && (
                              <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                                {pairs} pairs
                              </span>
                            )}
                            <StatusPill status={order.status} />
                          </div>
                        </label>
                      )
                    })}
                  </div>

                  {/* Summary strip — shown when at least one selected */}
                  {selectedOrders.length > 0 && (
                    <div className="border-t border-border px-3 py-2.5 sm:px-4 bg-muted/20 flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <span><span className="font-semibold text-foreground">{selectedOrders.length}</span> order{selectedOrders.length !== 1 ? 's' : ''} selected</span>
                      </div>
                      {allLoaded && totalSelectedPairs > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 014-4z" />
                          </svg>
                          <span><span className="font-semibold text-foreground">{totalSelectedPairs}</span> pairs total</span>
                        </div>
                      )}
                      {!allLoaded && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          Loading items…
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* ── Sticky bottom actions (new order only) ── */}
      {view === 'new' && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur border-t border-border pb-safe">
          <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex gap-2 items-center">
            {lines.length > 0 && (
              <div className="flex gap-2 sm:gap-4 mr-auto text-xs sm:text-sm min-w-0 shrink">
                <span className="text-muted-foreground whitespace-nowrap">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
                <span className="font-semibold text-foreground whitespace-nowrap">{totalPairs} pairs</span>
              </div>
            )}
            <button type="button" onClick={() => { setView('list'); resetForm() }}
              className="shrink-0 rounded-xl border border-border px-3 sm:px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </button>
            <button type="submit" form="new-order-form" disabled={!canSubmit}
              className="shrink-0 rounded-xl bg-primary px-4 sm:px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {isPending ? (editingOrderId != null ? 'Saving…' : 'Creating…') : (editingOrderId != null ? 'Save Changes' : 'Create Order')}
            </button>
          </div>
        </div>
      )}

      {/* ── Sticky bottom bar — Print Orders ── */}
      {view === 'print' && (() => {
        const assignedOrders = orders.filter(o => o.status === 'assigned' || o.status === 'pending')
        const selectedOrders = assignedOrders.filter(o => printSelectedIds.has(o.id))
        const allLoaded = selectedOrders.every(o => !!printItemsMap[o.id])
        const canPrint = selectedOrders.length > 0 && allLoaded
        const totalPairsSelected = selectedOrders.reduce(
          (s, o) => s + (printItemsMap[o.id] ?? []).reduce((ss, i) => ss + i.quantityOrdered, 0), 0
        )
        return (
          <div className="fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur-sm border-t border-border">
            <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2.5 flex items-center gap-3">
              {/* Left stat pills — only shown when something is selected */}
              {selectedOrders.length > 0 && (
                <div className="flex items-center gap-2 mr-auto flex-wrap">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
                    <svg className="w-3 h-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    {selectedOrders.length} order{selectedOrders.length !== 1 ? 's' : ''}
                  </span>
                  {allLoaded && totalPairsSelected > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
                      <svg className="w-3 h-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 014-4z" />
                      </svg>
                      {totalPairsSelected} pairs
                    </span>
                  )}
                  {!allLoaded && (
                    <svg className="w-3.5 h-3.5 text-muted-foreground animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={!canPrint}
                onClick={() => setPrintConfigOpen(true)}
                className={`flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selectedOrders.length === 0 ? 'w-full sm:w-auto sm:ml-auto' : 'shrink-0'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                {canPrint ? 'Print' : selectedOrders.length === 0 ? 'Select orders to print' : 'Loading…'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* ── Print config modal ── */}
      {printConfigOpen && (() => {
        const assignedOrders = orders.filter(o => o.status === 'assigned' || o.status === 'pending')
        const selectedOrders = assignedOrders.filter(o => printSelectedIds.has(o.id))
        return (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setPrintConfigOpen(false) }}
          >
            <div className="w-full sm:max-w-sm bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl overflow-hidden">

              {/* Modal header */}
              <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <h2 className="text-sm font-semibold text-foreground">Print Settings</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setPrintConfigOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-4 py-4 space-y-4">

                {/* Page size */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Page Size</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'A4',     label: 'A4',     sub: '210 × 297 mm' },
                      { value: 'A5',     label: 'A5',     sub: '148 × 210 mm' },
                    ] as const).map(({ value, label, sub }) => (
                      <button key={value} type="button"
                        onClick={() => setPrintPageSize(value)}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          printPageSize === value
                            ? 'border-primary bg-primary/8 ring-1 ring-primary'
                            : 'border-border bg-background hover:bg-muted'
                        }`}>
                        {/* Paper icon */}
                        <span className={`flex h-8 w-6 shrink-0 items-center justify-center rounded-sm border-2 ${
                          printPageSize === value ? 'border-primary bg-primary/10' : 'border-muted-foreground/40 bg-muted/40'
                        }`}>
                          <svg className={`w-2.5 h-3 ${printPageSize === value ? 'text-primary' : 'text-muted-foreground'}`} fill="currentColor" viewBox="0 0 8 10">
                            <rect x="1" y="1" width="6" height="8" rx="0.5"/>
                          </svg>
                        </span>
                        <div>
                          <p className={`text-sm font-semibold leading-tight ${printPageSize === value ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientation */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Orientation</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'portrait',  label: 'Portrait',  sub: '1 bill / row',  w: 24, h: 32 },
                      { value: 'landscape', label: 'Landscape', sub: '2 bills / row', w: 32, h: 24 },
                    ] as const).map(({ value, label, sub, w, h }) => (
                      <button key={value} type="button"
                        onClick={() => setPrintOrientation(value)}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          printOrientation === value
                            ? 'border-primary bg-primary/8 ring-1 ring-primary'
                            : 'border-border bg-background hover:bg-muted'
                        }`}>
                        {/* Page shape icon */}
                        <span className={`shrink-0 rounded-sm border-2 ${
                          printOrientation === value ? 'border-primary bg-primary/10' : 'border-muted-foreground/40 bg-muted/40'
                        }`} style={{ width: w, height: h }} />
                        <div>
                          <p className={`text-sm font-semibold leading-tight ${printOrientation === value ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selected orders summary */}
                <div className="rounded-lg bg-muted/40 border border-border px-3 py-2.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span><span className="font-semibold text-foreground">{selectedOrders.length}</span> order{selectedOrders.length !== 1 ? 's' : ''} will be printed</span>
                  <span className="font-mono text-[11px]">{printPageSize} · {printOrientation === 'portrait' ? '↕' : '↔'}</span>
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex gap-2 px-4 pb-4 pt-0">
                <button type="button"
                  onClick={() => setPrintConfigOpen(false)}
                  className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Cancel
                </button>
                <button type="button"
                  onClick={() => {
                    setPrintConfigOpen(false)
                    handlePrintOrders(selectedOrders, printPageSize, printOrientation)
                  }}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Single confirmation dialog ── */}
      {singleConfirm && (
        <ConfirmDialog
          title="Replace current quantities?"
          message={<>This will set qty 1 for every size of <strong>{selectedColor?.colorName}</strong>.</>}
          confirmLabel="Apply Single"
          onCancel={() => setSingleConfirm(false)}
          onConfirm={confirmApplySingle}
        />
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

    </div>
  )
}
