'use client'

import { useState, useTransition, useMemo, useEffect, useCallback } from 'react'
import { fuzzyFilter } from '@/lib/fuzzy'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { adminAssignPicker, adminUnassignPicker, getOrderWithItems, getPickerAssignments, deleteOrder, getBillLines } from '@/app/actions/orders'

interface MrpLine {
  artNumber: string
  mrp: number
  qty: number
  lineDiscPct?: number
}

interface OrderRow {
  id: number
  orderNumber: string
  shopkeeperName: string
  status: string
  orderedAt: Date
  updatedAt: Date
  salesmanId: string | null
  pickerId: string | null
  dispatcherId: string | null
}

interface Props {
  stats: { total: number; pending: number; packed: number; dispatched: number; delivered: number; cancelled: number }
  orders: OrderRow[]
  pickers: { id: string; name: string | null; email: string; role: string | null; createdAt: Date }[]
  embedded?: boolean
  /** When true, hides destructive actions (Delete Order) — used for accountant role */
  readOnly?: boolean
  /** Externally controlled picker map — when provided, overrides local state */
  pickerMapOverride?: Record<number, string>
  onPickerChange?: (orderId: number, pickerId: string | null) => void
}

interface DetailItem {
  id: number
  artNumber: string
  colorNumber: string | null
  sizeNumber: string | null
  quantityOrdered: number
  quantityPacked: number
  status: string
}

/** Returns 'new' if created within 24 h and never edited, 'updated' if edited after creation, else null */
function orderTag(orderedAt: Date, updatedAt: Date): 'new' | 'updated' | null {
  const now = Date.now()
  const created = new Date(orderedAt).getTime()
  const updated = new Date(updatedAt).getTime()
  if (Math.abs(updated - created) > 5000) return 'updated'
  if (now - created < 24 * 60 * 60 * 1000) return 'new'
  return null
}

const ALL_STATUSES = ['pending', 'assigned', 'packed', 'dispatched', 'delivered', 'cancelled']

export function AdminDashboard({ stats, orders, pickers, embedded, readOnly = false, pickerMapOverride, onPickerChange }: Props) {
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

  // ── Filter + sort ──
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'order'>('date-desc')

  // ── Picker assignments: orderId → pickerId ────────────────────────────────────
  // When pickerMapOverride is provided (AdminHub context), use it as the source of truth.
  // Otherwise fall back to local state (standalone page).
  const [localPickerMap, setLocalPickerMap] = useState<Record<number, string>>(() =>
    Object.fromEntries(orders.filter(o => o.pickerId).map(o => [o.id, o.pickerId!]))
  )
  const pickerMap = pickerMapOverride ?? localPickerMap

  // Sync local map whenever server re-renders with fresh orders prop (standalone page only)
  useEffect(() => {
    if (pickerMapOverride) return // AdminHub owns the map; don't clobber it
    setLocalPickerMap(prev => {
      const next = { ...prev }
      for (const o of orders) {
        if (o.pickerId) next[o.id] = o.pickerId
        else delete next[o.id]
      }
      return next
    })
  }, [orders, pickerMapOverride])

  // Poll every 15 s (standalone page) so picker self-assigns appear without reload
  const refreshPickerMap = useCallback(() => {
    if (pickerMapOverride) return // AdminHub handles sync via onPickerChange
    startTransition(async () => {
      const fresh = await getPickerAssignments()
      setLocalPickerMap(fresh)
    })
  }, [pickerMapOverride]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(refreshPickerMap, 15_000)
    return () => clearInterval(id)
  }, [refreshPickerMap])

  // ── Detail panel ──
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null)
  const [detailItems, setDetailItems] = useState<DetailItem[]>([])
  const [detailBillLines, setDetailBillLines] = useState<MrpLine[]>([])
  const [detailBillLinesLoading, setDetailBillLinesLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  // ── Delete confirmation ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [isDeleting, startDeleteTransition] = useTransition()
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set())

  function handleDeleteOrder(orderId: number) {
    startDeleteTransition(async () => {
      await deleteOrder(orderId)
      setDeleteConfirmId(null)
      setDetailOrder(null)
      setDeletedIds(prev => new Set([...prev, orderId]))
    })
  }

  async function handleViewOrder(order: OrderRow) {
    setDetailOrder(order)
    setDetailItems([])
    setDetailBillLines([])
    setDetailError('')
    setDetailLoading(true)
    try {
      const { items } = await getOrderWithItems(order.id)
      setDetailItems(items as DetailItem[])
    } catch (e: unknown) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load order details.')
    } finally {
      setDetailLoading(false)
    }

    // If billed (or later status), fetch persisted bill items
    if (['billed', 'dispatched', 'delivered'].includes(order.status)) {
      setDetailBillLinesLoading(true)
      try {
        const rows = await getBillLines(order.id)
        setDetailBillLines(rows)
      } catch {
        setDetailBillLines([])
      } finally {
        setDetailBillLinesLoading(false)
      }
    }
  }

  function handlePickerSelect(orderId: number, pickerId: string) {
    if (pickerId) {
      // Optimistic assign
      setLocalPickerMap(prev => ({ ...prev, [orderId]: pickerId }))
      onPickerChange?.(orderId, pickerId)
      startTransition(async () => {
        await adminAssignPicker(orderId, pickerId)
        // Refresh local map to authoritative state (standalone page only)
        if (!pickerMapOverride) {
          const fresh = await getPickerAssignments()
          setLocalPickerMap(fresh)
        }
      })
    } else {
      // Optimistic unassign
      setLocalPickerMap(prev => { const n = { ...prev }; delete n[orderId]; return n })
      onPickerChange?.(orderId, null)
      startTransition(async () => {
        await adminUnassignPicker(orderId)
      })
    }
  }

  const filteredOrders = useMemo(() => {
    let list = fuzzyFilter(
      orders.filter(o => !deletedIds.has(o.id)),
      search,
      o => [o.shopkeeperName, o.orderNumber]
    )
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus)
    if (sortBy === 'date-desc') list = [...list].sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime())
    if (sortBy === 'date-asc')  list = [...list].sort((a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime())
    if (sortBy === 'order')     list = [...list].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))
    return list
  }, [orders, deletedIds, search, filterStatus, sortBy])

  return (
    <div className={embedded ? '' : 'min-h-screen bg-background'}>
      <div className={embedded ? '' : 'max-w-6xl mx-auto px-4 py-6'}>
        {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="Orders Dashboard" subtitle="Manage and track all orders" />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Home</a>
        </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          <StatCard label="Active"     value={stats.total}      />
          <StatCard label="Pending"    value={stats.pending}    color="text-yellow-600" />
          <StatCard label="Packed"     value={stats.packed}     color="text-purple-600" />
          <StatCard label="Dispatched" value={stats.dispatched} color="text-orange-600" />
          <StatCard label="Delivered"  value={stats.delivered}  color="text-green-600"  />
          <StatCard label="Cancelled"  value={stats.cancelled}  color="text-red-600"    />
        </div>

        {/* ── Detail panel overlay ── */}
        {detailOrder && (
          <div
            className="fixed inset-0 z-40 flex flex-col justify-end sm:flex-row sm:justify-end bg-black/40 backdrop-blur-sm"
            onClick={() => setDetailOrder(null)}
          >
            <div
              className="relative w-full sm:max-w-md bg-background sm:border-l border-t sm:border-t-0 border-border sm:h-full max-h-[85vh] sm:max-h-none overflow-y-auto shadow-2xl rounded-t-2xl sm:rounded-none"
              onClick={e => e.stopPropagation()}
            >
              {/* Mobile drag handle */}
              <div className="sm:hidden flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-border" />
              </div>

              {/* Panel header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-background border-b border-border">
                <div>
                  <p className="font-semibold text-sm text-foreground">{detailOrder.shopkeeperName}</p>
                  <p className="font-mono text-xs text-muted-foreground mt-0.5">{detailOrder.orderNumber}</p>
                </div>
                <button type="button" onClick={() => setDetailOrder(null)}
                  className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-5 space-y-5">
                {/* Summary */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill status={detailOrder.status} />
                    {(() => {
                      const tag = orderTag(detailOrder.orderedAt, detailOrder.updatedAt)
                      return tag === 'new'
                        ? <span className="inline-flex items-center border-l-2 border-green-500 pl-1.5 pr-1 py-px text-[10px] font-medium text-green-600 dark:text-green-400 tracking-wide">NEW</span>
                        : tag === 'updated'
                          ? <span className="inline-flex items-center border-l-2 border-blue-400 pl-1.5 pr-1 py-px text-[10px] font-medium text-blue-500 dark:text-blue-400 tracking-wide">UPDATED</span>
                          : null
                    })()}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <span className="text-muted-foreground">Ordered</span>
                    <span className="text-foreground">{fmt(detailOrder.orderedAt)}</span>
                    {Math.abs(new Date(detailOrder.updatedAt).getTime() - new Date(detailOrder.orderedAt).getTime()) > 5000 && (
                      <>
                        <span className="text-muted-foreground">Last updated</span>
                        <span className="text-foreground">{fmt(detailOrder.updatedAt)}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Admin controls */}
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Admin Controls</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Assign Picker</p>
                      <select
                        disabled={isPending}
                        value={pickerMap[detailOrder.id] ?? ''}
                        onChange={e => handlePickerSelect(detailOrder.id, e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                      >
                        <option value="">Select picker</option>
                        {pickers.map(p => (
                          <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="px-4 py-3 bg-muted/30 border-b border-border">
                    <p className="text-sm font-semibold text-foreground">Order Items</p>
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
                    const showPacked = ['packed', 'billed', 'dispatched', 'delivered'].includes(detailOrder.status)
                    const isBilled   = ['billed', 'dispatched', 'delivered'].includes(detailOrder.status)
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
                      <table className="w-full text-sm border-collapse">
                        <thead className="bg-muted/20 border-b border-border">
                          <tr>
                            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Article</th>
                            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground w-28">Color</th>
                            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                              {showPacked ? (
                                <>
                                  Size
                                  <span className="ml-1 text-[10px] font-normal text-muted-foreground/50">→</span>
                                  <span className="text-[10px] font-semibold text-muted-foreground/70">ord</span>
                                  <span className="mx-0.5 text-[10px] text-muted-foreground/40">→</span>
                                  <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">pkd</span>
                                  {isBilled && (
                                    <>
                                      <span className="mx-0.5 text-[10px] text-muted-foreground/40">→</span>
                                      <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">ver</span>
                                    </>
                                  )}
                                </>
                              ) : (
                                'Size / Qty'
                              )}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {articleGroups.map(({ artNumber, colorGroups }) =>
                            colorGroups.map(({ color, items }, ci) => {
                              const allOrd = colorGroups.flatMap(cg => cg.items).reduce((s, i) => s + i.quantityOrdered, 0)
                              const allPkd = colorGroups.flatMap(cg => cg.items).reduce((s, i) => s + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0)
                              const allVer = isBilled ? allPkd : 0
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
                                          <span className="block font-semibold tabular-nums text-green-600 dark:text-green-400">{allPkd} pkd</span>
                                          {isBilled && <span className="block font-semibold tabular-nums text-blue-600 dark:text-blue-400">{allVer} ver</span>}
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
                                        const pkd    = isOOS ? 0 : item.quantityPacked
                                        const verified = isBilled ? pkd : 0
                                        return (
                                          <span key={item.id} className="inline-flex items-baseline gap-0.5 tabular-nums whitespace-nowrap">
                                            <span className="text-xs text-muted-foreground">{item.sizeNumber ?? '—'}</span>
                                            <span className="text-[10px] text-muted-foreground/50 mx-px">/</span>
                                            <span className="text-xs font-bold text-muted-foreground">{item.quantityOrdered}</span>
                                            <span className="text-[10px] text-muted-foreground/40">→</span>
                                            <span className={`text-xs font-bold ${isOOS ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                                              {isOOS ? 'OOS' : pkd}
                                            </span>
                                            {isBilled && !isOOS && (
                                              <>
                                                <span className="text-[10px] text-muted-foreground/40">→</span>
                                                <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{verified}</span>
                                              </>
                                            )}
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
                              {showPacked ? (() => {
                                const totalOrd = detailItems.reduce((s, i) => s + i.quantityOrdered, 0)
                                const totalPkd = detailItems.reduce((s, i) => s + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0)
                                const totalVer = isBilled ? totalPkd : 0
                                return (
                                  <>
                                    <span className="font-bold tabular-nums text-muted-foreground">{totalOrd}</span>
                                    <span className="text-muted-foreground mx-1">ord /</span>
                                    <span className="font-bold tabular-nums text-green-600 dark:text-green-400">{totalPkd}</span>
                                    <span className="text-muted-foreground mx-1">pkd</span>
                                    {isBilled && (
                                      <>
                                        <span className="text-muted-foreground mx-0.5">/</span>
                                        <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">{totalVer}</span>
                                        <span className="text-muted-foreground ml-1">ver</span>
                                      </>
                                    )}
                                  </>
                                )
                              })() : (
                                <span className="font-bold tabular-nums">{detailItems.reduce((s, i) => s + i.quantityOrdered, 0)}</span>
                              )}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    )
                  })()}
                </div>

                {/* ── Bill Details ── shown when billed / dispatched / delivered */}
                {['billed', 'dispatched', 'delivered'].includes(detailOrder.status) && (() => {
                  if (detailBillLinesLoading) {
                    return (
                      <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-3 bg-muted/30 border-b border-border">
                          <p className="text-sm font-semibold text-foreground">Bill Items</p>
                        </div>
                        <div className="px-4 py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Loading bill data…
                        </div>
                      </div>
                    )
                  }

                  if (detailBillLines.length === 0) {
                    return (
                      <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-3 bg-muted/30 border-b border-border">
                          <p className="text-sm font-semibold text-foreground">Bill Items</p>
                        </div>
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                          Bill data not available for this order.
                        </div>
                      </div>
                    )
                  }

                  const LINE_DISC_PCT = (detailBillLines[0] as { lineDiscPct?: number }).lineDiscPct ?? 30
                  const DISC_PCT = 4.75
                  const CGST_PCT = 2.50
                  const SGST_PCT = 2.50

                  const totalQty  = detailBillLines.reduce((s, l) => s + l.qty, 0)
                  const subTotal  = detailBillLines.reduce((s, l) => s + Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100)) * l.qty, 0)
                  const discAmt   = Math.round(subTotal * DISC_PCT / 100 * 100) / 100
                  const afterDisc = subTotal - discAmt
                  const cgstAmt   = Math.round(afterDisc * CGST_PCT / 100 * 100) / 100
                  const sgstAmt   = Math.round(afterDisc * SGST_PCT / 100 * 100) / 100
                  const netAmt    = Math.round((afterDisc + cgstAmt + sgstAmt) * 100) / 100
                  const fmtRs     = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

                  // group by artNumber for display
                  const artGroupMap = new Map<string, typeof detailBillLines>()
                  for (const l of detailBillLines) {
                    if (!artGroupMap.has(l.artNumber)) artGroupMap.set(l.artNumber, [])
                    artGroupMap.get(l.artNumber)!.push(l)
                  }

                  return (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                      {/* Header */}
                      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">Bill Items</p>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {detailBillLines.length} line{detailBillLines.length !== 1 ? 's' : ''} · {totalQty} box{totalQty !== 1 ? 'es' : ''} · {fmtRs(subTotal)}
                        </span>
                      </div>

                      {/* Discount % */}
                      <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Disc %</span>
                        <span className="text-xs font-bold text-foreground tabular-nums">{LINE_DISC_PCT}</span>
                      </div>

                      {/* Line items table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-muted/20 border-b border-border">
                            <tr>
                              <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Article</th>
                              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">MRP</th>
                              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Disc {LINE_DISC_PCT}%</th>
                              <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Qty</th>
                              <th className="text-right px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Amt</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {Array.from(artGroupMap.entries()).map(([artNumber, artLines]) =>
                              artLines.map((l, li) => {
                                const rate = Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100))
                                const amt  = rate * l.qty
                                return (
                                  <tr key={`${artNumber}-${li}`} className="odd:bg-card even:bg-muted/10">
                                    <td className="px-4 py-2 font-semibold text-foreground">{li === 0 ? artNumber : ''}</td>
                                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{fmtRs(l.mrp)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{fmtRs(rate)}</td>
                                    <td className="px-3 py-2 text-center font-bold tabular-nums">{l.qty}</td>
                                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtRs(amt)}</td>
                                  </tr>
                                )
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Totals */}
                      <div className="border-t border-border divide-y divide-border/60">
                        {[
                          { label: `Sub Total (${totalQty} boxes)`, value: fmtRs(subTotal), cls: 'font-semibold text-foreground' },
                          { label: `Discount (${DISC_PCT}%)`,       value: `− ${fmtRs(discAmt)}`, cls: 'text-red-600 dark:text-red-400' },
                          { label: `CGST (${CGST_PCT}%)`,           value: `+ ${fmtRs(cgstAmt)}`, cls: 'text-muted-foreground' },
                          { label: `SGST (${SGST_PCT}%)`,           value: `+ ${fmtRs(sgstAmt)}`, cls: 'text-muted-foreground' },
                        ].map(row => (
                          <div key={row.label} className="flex items-center justify-between px-4 py-2 text-xs">
                            <span className="text-muted-foreground">{row.label}</span>
                            <span className={`tabular-nums ${row.cls}`}>{row.value}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
                          <span className="text-sm font-bold text-foreground">Net Payable</span>
                          <span className="text-sm font-extrabold tabular-nums text-foreground">{fmtRs(netAmt)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Delete order — hidden for read-only roles (e.g. accountant) */}
                {!readOnly && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(detailOrder.id)}
                    className="w-full rounded-xl border border-red-200 dark:border-red-800 text-red-500 px-4 py-2.5 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                  >
                    Delete Order
                  </button>
                </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Delete confirmation dialog ── */}
        {deleteConfirmId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-background border border-border p-6 shadow-lg">
              <h2 className="text-base font-semibold mb-1 text-foreground">Delete Order?</h2>
              <p className="text-xs text-muted-foreground mb-5">
                This will permanently delete <span className="font-medium text-foreground">{detailOrder?.orderNumber}</span> and all its items. This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(null)}
                  disabled={isDeleting}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteOrder(deleteConfirmId)}
                  disabled={isDeleting}
                  className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <input
          type="search"
          placeholder="Search by order or shopkeeper…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full mb-3 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {/* Filter + Sort bar */}
        <div className="flex items-center gap-2 mb-4">
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

        {filteredOrders.length === 0 && (
          <p className="text-center py-10 text-sm text-muted-foreground">No orders found</p>
        )}

        {/* ── Mobile: card list ── */}
        <div className="sm:hidden space-y-3">
          {filteredOrders.map(order => {
            const tag = orderTag(order.orderedAt, order.updatedAt)
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => handleViewOrder(order)}
                className="w-full text-left rounded-xl border border-border bg-card p-4 hover:bg-muted/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs font-semibold text-foreground">{order.orderNumber}</p>
                    <p className="text-sm font-medium text-foreground mt-0.5">{order.shopkeeperName}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
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
                  </div>
                  <StatusPill status={order.status} />
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Desktop: table ── */}
        <div className="hidden sm:block rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Order</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Shopkeeper</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Assign Picker</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredOrders.map(order => {
                  const tag = orderTag(order.orderedAt, order.updatedAt)
                  return (
                    <tr key={order.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => handleViewOrder(order)}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium">{order.orderNumber}</td>
                      <td className="px-4 py-3">{order.shopkeeperName}</td>
                      <td className="px-4 py-3"><StatusPill status={order.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {tag === 'new' && (
                            <span className="inline-flex items-center border-l-2 border-green-500 pl-1.5 pr-1 py-px text-[10px] font-medium text-green-600 dark:text-green-400 tracking-wide">NEW</span>
                          )}
                          {tag === 'updated' && (
                            <span className="inline-flex items-center border-l-2 border-blue-400 pl-1.5 pr-1 py-px text-[10px] font-medium text-blue-500 dark:text-blue-400 tracking-wide">UPDATED</span>
                          )}
                          <span className="text-muted-foreground text-xs">
                            {tag === 'updated' ? fmt(order.updatedAt) : fmt(order.orderedAt)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <select
                          disabled={isPending}
                          value={pickerMap[order.id] ?? ''}
                          onChange={e => handlePickerSelect(order.id, e.target.value)}
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        >
                          <option value="">Select picker</option>
                          {pickers.map(p => (
                            <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
