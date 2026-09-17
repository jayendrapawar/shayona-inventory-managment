'use client'

import { useState, useTransition, useMemo } from 'react'
import { getProcurementSummary, getProcurementShortfall } from '@/app/actions/orders'
import type { ProcurementRow, ShortfallRow } from '@/app/actions/orders'

const ORDER_STATUSES = ['pending', 'assigned', 'packed', 'dispatched', 'delivered', 'cancelled']

// ── Ordered tab types & helpers ───────────────────────────────────────────────

interface GroupedArticle {
  artNumber: string
  colorNumber: string
  vendors: { vendorName: string; totalPairs: number; orderCount: number }[]
  grandTotal: number
}

function groupRows(rows: ProcurementRow[]): GroupedArticle[] {
  const map = new Map<string, GroupedArticle>()
  for (const row of rows) {
    const key = `${row.artNumber}||${row.colorNumber}`
    if (!map.has(key)) {
      map.set(key, { artNumber: row.artNumber, colorNumber: row.colorNumber, vendors: [], grandTotal: 0 })
    }
    const g = map.get(key)!
    g.vendors.push({ vendorName: row.vendorName, totalPairs: row.totalPairs, orderCount: row.orderCount })
    g.grandTotal += row.totalPairs
  }
  return Array.from(map.values())
}

// ── Shortfall tab types & helpers ─────────────────────────────────────────────

// vendor → article → color → size → qty
interface ShortfallVendor {
  vendorName: string
  artMap: Map<string, {          // artNumber
    colorMap: Map<string, {      // colorNumber
      sizeMap: Map<string, number> // sizeNumber → shortfall qty
    }>
    totalShortfall: number
  }>
  totalShortfall: number
}

function groupShortfall(rows: ShortfallRow[]): ShortfallVendor[] {
  const vendorMap = new Map<string, ShortfallVendor>()
  for (const row of rows) {
    if (!vendorMap.has(row.vendorName)) {
      vendorMap.set(row.vendorName, { vendorName: row.vendorName, artMap: new Map(), totalShortfall: 0 })
    }
    const vendor = vendorMap.get(row.vendorName)!
    if (!vendor.artMap.has(row.artNumber)) {
      vendor.artMap.set(row.artNumber, { colorMap: new Map(), totalShortfall: 0 })
    }
    const art = vendor.artMap.get(row.artNumber)!
    if (!art.colorMap.has(row.colorNumber)) {
      art.colorMap.set(row.colorNumber, { sizeMap: new Map() })
    }
    const color = art.colorMap.get(row.colorNumber)!
    color.sizeMap.set(row.sizeNumber, (color.sizeMap.get(row.sizeNumber) ?? 0) + row.shortfall)
    art.totalShortfall   += row.shortfall
    vendor.totalShortfall += row.shortfall
  }
  return Array.from(vendorMap.values())
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  initialRows: ProcurementRow[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProcurementSummary({ initialRows }: Props) {
  const [subTab, setSubTab] = useState<'ordered' | 'shortfall'>('ordered')

  // ── Ordered state ──
  const [rows, setRows]         = useState<ProcurementRow[]>(initialRows)
  const [isPendingO, startO]    = useTransition()
  const [status,     setStatus] = useState('pending')
  const [artFilter,   setArtFilter]   = useState('')
  const [colorFilter, setColorFilter] = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // ── Shortfall state ──
  const [shortfallRows, setShortfallRows] = useState<ShortfallRow[]>([])
  const [shortfallLoaded, setShortfallLoaded] = useState(false)
  const [isPendingS, startS]    = useTransition()
  const [sfArtFilter,   setSfArtFilter]   = useState('')
  const [sfColorFilter, setSfColorFilter] = useState('')
  const [sfExpandedKey, setSfExpandedKey] = useState<string | null>(null)
  // dismissed: "vendor||art||color||size" keys marked as procured
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // ── Ordered helpers ──
  function refreshOrdered(s: string, art: string, color: string, from: string, to: string) {
    startO(async () => {
      const data = await getProcurementSummary({ status: s, artNumber: art, colorNumber: color, dateFrom: from || undefined, dateTo: to || undefined })
      setRows(data)
    })
  }

  function handleStatusChange(s: string) { setStatus(s); refreshOrdered(s, artFilter, colorFilter, dateFrom, dateTo) }
  function handleOrderedSearch() { refreshOrdered(status, artFilter, colorFilter, dateFrom, dateTo) }

  // ── Shortfall helpers ──
  function loadShortfall(art: string, color: string) {
    startS(async () => {
      const data = await getProcurementShortfall({ artNumber: art, colorNumber: color })
      setShortfallRows(data)
      setShortfallLoaded(true)
    })
  }

  function handleShortfallSearch() { loadShortfall(sfArtFilter, sfColorFilter) }

  function handleSubTab(tab: 'ordered' | 'shortfall') {
    setSubTab(tab)
    if (tab === 'shortfall' && !shortfallLoaded) loadShortfall('', '')
  }

  // ── Ordered derived ──
  const grouped         = useMemo(() => groupRows(rows), [rows])
  const grandTotalPairs = useMemo(() => rows.reduce((s, r) => s + r.totalPairs, 0), [rows])
  const uniqueVendors   = useMemo(() => new Set(rows.map(r => r.vendorName)).size, [rows])

  // ── Shortfall derived ──
  const activeShortfallRows = useMemo(
    () => shortfallRows.filter(r => !dismissed.has(`${r.vendorName}||${r.artNumber}||${r.colorNumber}||${r.sizeNumber}`)),
    [shortfallRows, dismissed]
  )
  const sfGrouped       = useMemo(() => groupShortfall(activeShortfallRows), [activeShortfallRows])
  const sfTotalPairs    = useMemo(() => activeShortfallRows.reduce((s, r) => s + r.shortfall, 0), [activeShortfallRows])
  const sfUniqueVendors = useMemo(() => new Set(activeShortfallRows.map(r => r.vendorName)).size, [activeShortfallRows])

  function dismiss(vendorName: string, artNumber: string, colorNumber: string, sizeNumber: string) {
    const key = `${vendorName}||${artNumber}||${colorNumber}||${sizeNumber}`
    setDismissed(prev => new Set([...prev, key]))
  }
  function dismissColor(vendorName: string, artNumber: string, colorNumber: string, sizes: string[]) {
    setDismissed(prev => {
      const next = new Set(prev)
      sizes.forEach(s => next.add(`${vendorName}||${artNumber}||${colorNumber}||${s}`))
      return next
    })
  }
  function dismissAll() {
    setDismissed(new Set(shortfallRows.map(r => `${r.vendorName}||${r.artNumber}||${r.colorNumber}||${r.sizeNumber}`)))
  }

  return (
    <div className="space-y-4">

      {/* ── Sub-tab bar ── */}
      <div className="flex gap-1 border-b border-border">
        {(['ordered', 'shortfall'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => handleSubTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              subTab === t
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'ordered' ? 'Ordered' : 'Shortfall'}
            {t === 'shortfall' && sfTotalPairs > 0 && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-[10px] font-bold px-1.5 py-0.5 tabular-nums">
                {sfTotalPairs}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════
          ORDERED TAB
      ════════════════════════════════════════════ */}
      {subTab === 'ordered' && (
        <>
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Status</label>
              <select
                value={status}
                onChange={e => handleStatusChange(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {ORDER_STATUSES.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Article</label>
              <input type="text" value={artFilter} onChange={e => setArtFilter(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleOrderedSearch()} placeholder="e.g. A123"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Color</label>
              <input type="text" value={colorFilter} onChange={e => setColorFilter(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleOrderedSearch()} placeholder="e.g. RED"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground" />
            </div>
            <button type="button" onClick={handleOrderedSearch} disabled={isPendingO}
              className="rounded-lg bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-40 self-end">
              {isPendingO ? 'Loading…' : 'Apply'}
            </button>
          </div>

          {/* Summary badges */}
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
                <span className="font-bold">{grouped.length}</span> article–colour combos
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
                <span className="font-bold">{uniqueVendors}</span> vendors
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950 px-3 py-1 text-xs font-bold text-blue-700 dark:text-blue-300">
                {grandTotalPairs} total pairs to procure
              </span>
            </div>
          )}

          {isPendingO && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}

          {!isPendingO && rows.length === 0 && (
            <div className="rounded-xl border border-border bg-card py-10 text-center">
              <p className="text-sm text-muted-foreground">No orders found for <strong>{status}</strong>
                {artFilter ? ` · article "${artFilter}"` : ''}{colorFilter ? ` · color "${colorFilter}"` : ''}.
              </p>
            </div>
          )}

          {!isPendingO && grouped.length > 0 && (
            <div className="space-y-2">
              {grouped.map(g => {
                const key  = `${g.artNumber}||${g.colorNumber}`
                const open = expandedKey === key
                return (
                  <div key={key} className="rounded-xl border border-border bg-card overflow-hidden">
                    <button type="button" onClick={() => setExpandedKey(open ? null : key)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-foreground">{g.artNumber}</span>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">{g.colorNumber}</span>
                        <span className="text-xs text-muted-foreground">{g.vendors.length} vendor{g.vendors.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-bold text-foreground">{g.grandTotal} pairs</span>
                        <svg className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {open && (
                      <div className="border-t border-border overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Vendor / Shopkeeper</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Orders</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Pairs Required</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {g.vendors.map(v => (
                              <tr key={v.vendorName} className="hover:bg-muted/20">
                                <td className="px-4 py-2.5 font-medium text-xs">{v.vendorName}</td>
                                <td className="px-4 py-2.5 text-xs text-muted-foreground text-right">{v.orderCount}</td>
                                <td className="px-4 py-2.5 text-xs font-semibold text-right">{v.totalPairs}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t border-border bg-muted/20">
                            <tr>
                              <td colSpan={2} className="px-4 py-2 text-xs font-medium text-muted-foreground text-right">Total</td>
                              <td className="px-4 py-2 text-xs font-bold text-right">{g.grandTotal}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════
          SHORTFALL TAB
      ════════════════════════════════════════════ */}
      {subTab === 'shortfall' && (
        <>
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Article</label>
              <input type="text" value={sfArtFilter} onChange={e => setSfArtFilter(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleShortfallSearch()} placeholder="e.g. A123"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Color</label>
              <input type="text" value={sfColorFilter} onChange={e => setSfColorFilter(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleShortfallSearch()} placeholder="e.g. RED"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground" />
            </div>
            <button type="button" onClick={handleShortfallSearch} disabled={isPendingS}
              className="rounded-lg bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-40 self-end">
              {isPendingS ? 'Loading…' : 'Apply'}
            </button>
          </div>

          {/* Summary badges */}
          {shortfallRows.length > 0 && (
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
                <span className="font-bold">{sfGrouped.length}</span> articles
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
                <span className="font-bold">{sfUniqueVendors}</span> vendors affected
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-1 text-xs font-bold text-yellow-700 dark:text-yellow-300">
                {sfTotalPairs} pairs short
              </span>
            </div>
          )}

          {isPendingS && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}

          {!isPendingS && shortfallLoaded && sfGrouped.length === 0 && (
            <div className="rounded-xl border border-border bg-card py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {shortfallRows.length > 0
                  ? 'All shortfalls marked as procured ✓'
                  : `No shortfalls found${sfArtFilter ? ` for article "${sfArtFilter}"` : ''}${sfColorFilter ? ` · color "${sfColorFilter}"` : ''}. All packed orders are fully fulfilled. 🎉`
                }
              </p>
            </div>
          )}

          {!isPendingS && sfGrouped.length > 0 && (
            <div className="space-y-2">
              {/* Mark all done */}
              <div className="flex justify-end">
                <button type="button" onClick={dismissAll}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors">
                  Mark all as procured
                </button>
              </div>

              {sfGrouped.map(vendor => {
                const open = sfExpandedKey === vendor.vendorName
                return (
                  <div key={vendor.vendorName} className="rounded-xl border border-border bg-card overflow-hidden">

                    {/* Vendor header */}
                    <button type="button" onClick={() => setSfExpandedKey(open ? null : vendor.vendorName)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
                        <span className="text-sm font-semibold text-foreground truncate">{vendor.vendorName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{vendor.artMap.size} article{vendor.artMap.size !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-bold text-yellow-600 dark:text-yellow-400 tabular-nums">{vendor.totalShortfall} short</span>
                        <svg className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {/* Article → Color → Size/Qty rows */}
                    {open && (
                      <div className="border-t border-border">
                        {Array.from(vendor.artMap.entries()).map(([artNumber, artData], artIdx) => {
                          const colorEntries = Array.from(artData.colorMap.entries())
                          return colorEntries.map(([color, colorData], ci) => {
                            const sizes = Array.from(colorData.sizeMap.keys()).sort((a, b) => {
                              const na = parseFloat(a), nb = parseFloat(b)
                              return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb
                            })
                            const colorTotal = Array.from(colorData.sizeMap.values()).reduce((s, q) => s + q, 0)
                            const isFirstColor = ci === 0
                            const isFirstRow = artIdx === 0 && ci === 0
                            return (
                              <div
                                key={`${artNumber}-${color}`}
                                className={`flex items-center gap-0 hover:bg-muted/10 border-b border-border/50 last:border-0 ${!isFirstRow ? '' : ''}`}
                              >
                                {/* Article cell — spans first color row only, blank for subsequent */}
                                <div className={`w-20 shrink-0 px-4 py-2.5 ${isFirstColor ? 'border-r border-border' : 'border-r border-border/30'}`}>
                                  {isFirstColor && (
                                    <span className="font-mono text-xs font-bold text-foreground block">{artNumber}</span>
                                  )}
                                </div>

                                {/* Color name */}
                                <span className="text-xs font-medium text-foreground w-28 shrink-0 px-3 py-2.5 border-r border-border/30">{color}</span>

                                {/* Size chips */}
                                <div className="flex flex-wrap gap-x-2 gap-y-1 flex-1 px-3 py-2.5">
                                  {sizes.map(size => {
                                    const qty = colorData.sizeMap.get(size)!
                                    return (
                                      <span key={size} className="inline-flex items-baseline gap-0.5 text-xs tabular-nums whitespace-nowrap">
                                        <span className="text-muted-foreground">{size}</span>
                                        <span className="text-muted-foreground/40 mx-px">/</span>
                                        <span className="font-bold text-yellow-600 dark:text-yellow-400">{qty}</span>
                                        <button
                                          type="button"
                                          title="Mark as procured"
                                          onClick={() => dismiss(vendor.vendorName, artNumber, color, size)}
                                          className="ml-0.5 text-muted-foreground/30 hover:text-green-500 transition-colors leading-none"
                                        >✓</button>
                                      </span>
                                    )
                                  })}
                                </div>

                                {/* Total + Done */}
                                <div className="flex items-center gap-2 shrink-0 px-3 py-2.5">
                                  <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400 tabular-nums w-6 text-right">{colorTotal}</span>
                                  <button
                                    type="button"
                                    onClick={() => dismissColor(vendor.vendorName, artNumber, color, sizes)}
                                    className="text-[10px] font-medium text-muted-foreground hover:text-green-600 dark:hover:text-green-400 border border-border hover:border-green-400 rounded px-1.5 py-0.5 transition-colors whitespace-nowrap"
                                  >✓ Done</button>
                                </div>
                              </div>
                            )
                          })
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
