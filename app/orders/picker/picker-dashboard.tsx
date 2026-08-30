'use client'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { StatusPill, fmt } from '../_components/shared'
import { PageNav } from '@/components/page-nav'
import {
  getOrderWithItems,
  updateItemPacked,
  markItemOutOfStock,
  markOrderPacked,
  selfAssignOrder,
  unassignOrder,
} from '@/app/actions/orders'
import type { Order, OrderItem, OrderItemStatus } from '@/lib/db/schema'

interface QueueItem {
  id: number
  orderNumber: string
  shopkeeperName: string
  status: string
  orderedAt: Date
  pickerId: string | null
  totalPairs: number
}

interface Props {
  queue: QueueItem[]
  currentPickerId: string
  embedded?: boolean
  /** Called when a picker claims (pickerId set) or releases (pickerId null) an order */
  onPickerChange?: (orderId: number, pickerId: string | null) => void
}

type SubTab = 'all' | 'mine'

export function PickerDashboard({ queue: initialQueue, currentPickerId, embedded, onPickerChange }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue)
  const [selectedOrder, setSelectedOrder] = useState<{ order: Order; items: OrderItem[]; readOnly: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [claimingId, setClaimingId] = useState<number | null>(null)
  const [unassigningId, setUnassigningId] = useState<number | null>(null)
  const [subTab, setSubTab] = useState<SubTab>('all')
  const [claimError, setClaimError] = useState<string | null>(null)
  // touched: itemId → confirmed qty
  const [touched, setTouched] = useState<Record<number, number>>({})
  // pending: itemId → staged (selected but not yet confirmed) qty
  const [pending, setPending] = useState<Record<number, number | undefined>>({})
  // customDraft: staged value in the "other" input before the user confirms
  const [customDraft, setCustomDraft] = useState<Record<number, string>>({})

  // ── Split lists ──────────────────────────────────────────────────────────────
  const availableOrders = useMemo(() => queue.filter(o => !o.pickerId && o.status === 'pending'), [queue])
  const myOrders        = useMemo(() => queue.filter(o => o.pickerId === currentPickerId), [queue, currentPickerId])

  const counts = {
    available: availableOrders.length,
    mine:      myOrders.length,
  }

  // ── Open order detail ────────────────────────────────────────────────────────
  function openOrder(orderId: number) {
    setLoadingId(orderId)
    const readOnly = subTab === 'all'
    startTransition(async () => {
      try {
        const data = await getOrderWithItems(orderId)
        setSelectedOrder({ ...data, readOnly })
      } finally {
        setLoadingId(null)
      }
    })
  }

  // ── Claim an order ───────────────────────────────────────────────────────────
  function handleClaim(e: React.MouseEvent, orderId: number) {
    e.stopPropagation()
    setClaimError(null)
    setClaimingId(orderId)
    startTransition(async () => {
      try {
        const result = await selfAssignOrder(orderId)
        setQueue(prev =>
          prev.map(o =>
            o.id === orderId ? { ...o, status: 'assigned', pickerId: currentPickerId } : o
          )
        )
        onPickerChange?.(result.orderId, result.pickerId)
        setSubTab('mine')
      } catch (err) {
        setClaimError(err instanceof Error ? err.message : 'Failed to claim order')
      } finally {
        setClaimingId(null)
      }
    })
  }

  // ── Item packing handlers ────────────────────────────────────────────────────
  function handleQtyChange(itemId: number, qty: number) {
    startTransition(async () => {
      await updateItemPacked(itemId, qty)
      if (selectedOrder) {
        const data = await getOrderWithItems(selectedOrder.order.id)
        setSelectedOrder({ ...data, readOnly: selectedOrder.readOnly })
      }
    })
  }

  function handleOutOfStock(itemId: number) {
    startTransition(async () => {
      await markItemOutOfStock(itemId)
      if (selectedOrder) {
        const data = await getOrderWithItems(selectedOrder.order.id)
        setSelectedOrder({ ...data, readOnly: selectedOrder.readOnly })
      }
    })
  }

  function handleMarkPacked() {
    if (!selectedOrder) return
    startTransition(async () => {
      await markOrderPacked(selectedOrder.order.id)
      setQueue(prev => prev.filter(o => o.id !== selectedOrder.order.id))
      setSelectedOrder(null)
    })
  }

  // Pre-seed touched/pending/customDraft whenever selectedOrder changes
  useEffect(() => {
    if (!selectedOrder) { setTouched({}); setPending({}); setCustomDraft({}); return }
    const touchedSeed: Record<number, number> = {}
    const pendingSeed: Record<number, number> = {}
    const draftSeed: Record<number, string> = {}
    for (const item of selectedOrder.items) {
      if (item.status === 'packed' || item.status === 'out_of_stock') {
        touchedSeed[item.id] = item.quantityPacked
      } else if (item.quantityOrdered <= 5) {
        // fits on a chip — pre-select it
        pendingSeed[item.id] = item.quantityOrdered
      } else {
        // exceeds fixed chips — pre-fill the custom input box instead
        draftSeed[item.id] = String(item.quantityOrdered)
      }
    }
    setTouched(touchedSeed)
    setPending(pendingSeed)
    setCustomDraft(draftSeed)
  }, [selectedOrder?.order.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const allItemsDone = selectedOrder
    ? selectedOrder.items.every(i => i.status === 'out_of_stock' || i.id in touched)
    : false

  const doneCount  = selectedOrder ? selectedOrder.items.filter(i => i.status === 'out_of_stock' || i.id in touched).length : 0
  const totalCount = selectedOrder ? selectedOrder.items.length : 0

  // ── Grouped article view (article → distinct colors → sizes) ─────────────────
  const articleGroups = useMemo(() => {
    if (!selectedOrder) return []
    // level 1: artNumber
    const artMap = new Map<string, OrderItem[]>()
    for (const item of selectedOrder.items) {
      if (!artMap.has(item.artNumber)) artMap.set(item.artNumber, [])
      artMap.get(item.artNumber)!.push(item)
    }
    return Array.from(artMap.entries()).map(([artNumber, items]) => {
      // level 2: colorNumber (deduplicated)
      const colorMap = new Map<string, OrderItem[]>()
      for (const item of items) {
        const color = item.colorNumber ?? '—'
        if (!colorMap.has(color)) colorMap.set(color, [])
        colorMap.get(color)!.push(item)
      }
      const colorGroups = Array.from(colorMap.entries()).map(([color, colorItems]) => ({
        color,
        items: colorItems,
      }))
      return { artNumber, colorGroups }
    })
  }, [selectedOrder])

  // active color tab per article: artNumber → color string
  const [activeColorTab, setActiveColorTab] = useState<Record<string, string>>({})

  // whenever selectedOrder changes, reset color tabs to first color of each article
  useEffect(() => {
    if (!selectedOrder) { setActiveColorTab({}); return }
    const init: Record<string, string> = {}
    for (const { artNumber, colorGroups } of articleGroups) {
      init[artNumber] = colorGroups[0].color
    }
    setActiveColorTab(init)
  }, [selectedOrder?.order.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Order detail view ────────────────────────────────────────────────────────
  if (selectedOrder) {
    return (
      <div className="min-h-screen bg-background">
        {/* Sticky top bar */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <button
              onClick={() => setSelectedOrder(null)}
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
              aria-label="Back"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{selectedOrder.order.shopkeeperName}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{selectedOrder.order.orderNumber}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill status={selectedOrder.order.status} />
              {!selectedOrder.readOnly && (
                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                  {doneCount}/{totalCount}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-4 pb-28">

          {/* ── READ-ONLY consolidated table (All orders tab) ── */}
          {selectedOrder.readOnly ? (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/20 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Article</th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground w-28">Color</th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Size / Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {articleGroups.map(({ artNumber, colorGroups }) =>
                    colorGroups.map(({ color, items }, ci) => (
                      <tr key={`${artNumber}-${color}`} className="border-b border-border hover:bg-muted/20">
                        {ci === 0 && (
                          <td
                            className="px-4 py-2.5 font-semibold text-xs align-top border-r border-border"
                            rowSpan={colorGroups.length}
                          >
                            {artNumber}
                            <span className="block font-normal text-muted-foreground tabular-nums">
                              {colorGroups.flatMap(cg => cg.items).reduce((s, i) => s + i.quantityOrdered, 0)} pairs
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-xs font-medium text-foreground align-top w-28 border-r border-border">{color}</td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {items.map(item => (
                              <span key={item.id} className="text-xs tabular-nums whitespace-nowrap">
                                <span className="text-muted-foreground">{item.sizeNumber ?? '—'}</span>
                                <span className="mx-0.5 text-muted-foreground">/</span>
                                <span className="font-semibold text-foreground">{item.quantityOrdered}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted/20">
                  <tr>
                    <td colSpan={2} className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Total pairs</td>
                    <td className="px-3 py-2.5 text-xs font-bold">
                      {selectedOrder.items.reduce((s, i) => s + i.quantityOrdered, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (

          /* ── INTERACTIVE packing view (Mine tab) ── */
          <div className="space-y-3">
            {articleGroups.map(({ artNumber, colorGroups }) => {
              const allItems = colorGroups.flatMap(cg => cg.items)
              const allDone  = allItems.every(i => i.status === 'out_of_stock' || i.id in touched)
              const activeColor = activeColorTab[artNumber] ?? colorGroups[0].color
              const activeColorGroup = colorGroups.find(cg => cg.color === activeColor) ?? colorGroups[0]

              return (
                <div
                  key={artNumber}
                  className={`rounded-xl border bg-card transition-colors ${
                    allDone ? 'border-green-200 dark:border-green-800' : 'border-border'
                  }`}
                >
                  {/* Article header row */}
                  <div className="flex items-center justify-between px-3.5 pt-3 pb-2 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`shrink-0 w-2 h-2 rounded-full ${allDone ? 'bg-green-500' : 'bg-border'}`} />
                      <p className="text-sm font-bold font-mono text-foreground">
                        {artNumber}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                          ({allItems.reduce((s, i) => s + i.quantityOrdered, 0)} pairs)
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Color tabs — one per DISTINCT color */}
                  <div className="flex gap-1 px-3.5 pb-2 overflow-x-auto">
                      {colorGroups.map(cg => {
                        const cgTotal   = cg.items.reduce((s, i) => s + i.quantityOrdered, 0)
                        const cgAllDone = cg.items.every(i => i.status === 'out_of_stock' || i.id in touched)
                        const isActive  = cg.color === activeColor
                        return (
                          <button
                            key={cg.color}
                            type="button"
                            onClick={() => setActiveColorTab(prev => ({ ...prev, [artNumber]: cg.color }))}
                            className={`shrink-0 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
                              isActive
                                ? 'bg-foreground text-background border-foreground'
                                : cgAllDone
                                  ? 'border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20'
                                  : 'border-border text-muted-foreground bg-background hover:border-foreground hover:text-foreground'
                            }`}
                          >
                            {cg.color} <span className="opacity-60 font-normal">({cgTotal})</span>
                          </button>
                        )
                      })}
                  </div>

                  {/* Active color — list all size rows */}
                  <div className="border-t border-border divide-y divide-border">
                    {activeColorGroup.items.map(item => {
                      const isOOS     = (item.status as OrderItemStatus) === 'out_of_stock'
                      const isDone    = isOOS || item.id in touched
                      const chips     = [1, 2, 3, 4, 5]
                      const staged    = pending[item.id]
                      const confirmed = touched[item.id]
                      const selected  = staged

                      function stageQty(qty: number) {
                        setPending(prev => ({ ...prev, [item.id]: prev[item.id] === qty ? undefined : qty }))
                        setCustomDraft(prev => { const n = { ...prev }; delete n[item.id]; return n })
                      }

                      function confirmQty() {
                        const draftVal = customDraft[item.id] !== undefined && customDraft[item.id] !== ''
                          ? parseInt(customDraft[item.id]!)
                          : NaN
                        const qty = !isNaN(draftVal) && draftVal >= 0 ? draftVal : staged
                        if (qty === undefined || qty === null) return
                        setTouched(prev => ({ ...prev, [item.id]: qty as number }))
                        setPending(prev => { const n = { ...prev }; delete n[item.id]; return n })
                        setCustomDraft(prev => { const n = { ...prev }; delete n[item.id]; return n })
                        if (qty === 0) {
                          handleOutOfStock(item.id)
                        } else {
                          handleQtyChange(item.id, qty as number)
                        }
                      }

                      const hasSelection = staged !== undefined || (customDraft[item.id] !== undefined && customDraft[item.id] !== '')

                      return (
                        <div key={item.id} className="px-3.5 pt-2.5 pb-3">
                          {/* Size / ordered row */}
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                              {item.sizeNumber ? `Size: ${item.sizeNumber}` : activeColorGroup.color}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Ordered: <span className="font-semibold text-foreground tabular-nums">{item.quantityOrdered}</span>
                            </span>
                          </div>

                          {/* Packed qty / action */}
                          {isDone ? (
                            confirmed === 0 || isOOS ? (
                              <div className="flex items-center gap-1 text-xs font-medium text-red-500">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                Out of stock
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="20 6 9 17 4 12"/></svg>
                                {confirmed} packed
                              </div>
                            )
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Packed qty</p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => stageQty(0)}
                                  disabled={isPending}
                                  className={`min-w-[2.25rem] h-8 rounded-lg border px-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
                                    selected === 0
                                      ? 'border-red-400 bg-red-400 text-white shadow-sm'
                                      : 'border-red-200 dark:border-red-800 bg-background text-red-500 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950/20'
                                  }`}
                                >
                                  0
                                </button>
                                {chips.map(n => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => stageQty(n)}
                                    disabled={isPending}
                                    className={`min-w-[2.25rem] h-8 rounded-lg border px-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
                                      selected === n
                                        ? 'border-orange-400 bg-orange-400 text-white shadow-sm'
                                        : 'border-border bg-background text-foreground hover:border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/20'
                                    }`}
                                  >
                                    {n}
                                  </button>
                                ))}
                                <input
                                  type="number"
                                  min={0}
                                  placeholder="…"
                                  value={customDraft[item.id] ?? ''}
                                  onChange={e => {
                                    setCustomDraft(prev => ({ ...prev, [item.id]: e.target.value }))
                                    setPending(prev => { const n = { ...prev }; delete n[item.id]; return n })
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') confirmQty() }}
                                  disabled={isPending}
                                  className="w-14 h-8 rounded-lg border border-border bg-background px-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 placeholder:text-muted-foreground disabled:opacity-40"
                                />
                                <button
                                  type="button"
                                  onClick={confirmQty}
                                  disabled={isPending || !hasSelection}
                                  className="h-8 ml-auto rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                                >
                                  {isPending ? '…' : 'Confirm'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          )}
        </div>

        {/* Sticky bottom CTA — only for mine tab */}
        {!selectedOrder.readOnly && (
          <div className="fixed bottom-0 inset-x-0 bg-background/95 backdrop-blur border-t border-border px-4 py-3 safe-area-inset-bottom">
            <div className="max-w-2xl mx-auto">
              <button
                onClick={handleMarkPacked}
                disabled={!allItemsDone || isPending}
                className={`w-full rounded-xl py-3.5 text-sm font-semibold transition-colors shadow-sm ${
                  allItemsDone
                    ? 'bg-purple-600 hover:bg-purple-700 text-white'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                }`}
              >
                {isPending ? 'Saving…' : allItemsDone ? '✓ Pack Order' : `Confirm all items first (${doneCount}/${totalCount} done)`}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Unassign handler ─────────────────────────────────────────────────────────
  function doUnassign(orderId: number) {
    setClaimError(null)
    setUnassigningId(orderId)
    startTransition(async () => {
      try {
        const result = await unassignOrder(orderId)
        setQueue(prev =>
          prev.map(o =>
            o.id === orderId ? { ...o, status: 'pending', pickerId: null } : o
          )
        )
        onPickerChange?.(result.orderId, null)
        setSubTab('all')
      } catch (err) {
        setClaimError(err instanceof Error ? err.message : 'Failed to release order')
      } finally {
        setUnassigningId(null)
      }
    })
  }

  // ── Queue view ───────────────────────────────────────────────────────────────
  const displayList = subTab === 'all' ? availableOrders : myOrders

  return (
    <div className={embedded ? '' : 'min-h-screen bg-background'}>
      <div className={embedded ? '' : 'max-w-2xl mx-auto px-4 py-4 sm:py-6'}>

        {/* Header */}
        {!embedded && (
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Packing Queue</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Orders awaiting packing</p>
            </div>
            <PageNav />
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Available</p>
            <p className="text-2xl font-bold text-yellow-600 tabular-nums mt-0.5">{counts.available}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">My Orders</p>
            <p className="text-2xl font-bold text-blue-600 tabular-nums mt-0.5">{counts.mine}</p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex rounded-xl border border-border bg-muted/40 p-1 mb-4 gap-1">
          {(['all', 'mine'] as SubTab[]).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setSubTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                subTab === tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'all' ? 'All Orders' : 'My Orders'}
              <span className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ${
                subTab === tab ? 'bg-foreground text-background' : 'bg-muted-foreground/20 text-muted-foreground'
              }`}>
                {tab === 'all' ? counts.available : counts.mine}
              </span>
            </button>
          ))}
        </div>

        {/* Error banner */}
        {claimError && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-400">
            <span>{claimError}</span>
            <button type="button" onClick={() => setClaimError(null)} className="shrink-0 text-red-400 hover:text-red-600">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}

        {/* Order list */}
        <div className="space-y-2">
          {displayList.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 opacity-40">
                <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><polyline points="16 3 12 7 8 3"/>
              </svg>
              <p className="text-sm">
                {subTab === 'mine'
                  ? 'No orders assigned to you yet'
                  : 'No available orders right now 🎉'}
              </p>
              {subTab === 'mine' && (
                <button type="button" onClick={() => setSubTab('all')} className="text-xs text-blue-600 hover:underline">
                  Browse All Orders →
                </button>
              )}
            </div>
          )}

          {displayList.map(order => {
            const isClaiming   = claimingId === order.id
            const isLoading    = loadingId === order.id
            const isUnassigning = unassigningId === order.id

            return (
              <div
                key={order.id}
                className={`rounded-xl border bg-card transition-all ${
                  subTab === 'mine'
                    ? 'border-blue-200 dark:border-blue-800'
                    : 'border-border'
                }`}
              >
                {/* Clickable row — using div to avoid nested <button> hydration error */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => !isLoading && openOrder(order.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openOrder(order.id) }}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 text-left cursor-pointer select-none ${isLoading ? 'opacity-60 pointer-events-none' : ''}`}
                >
                  {/* Leading color dot */}
                  <div className={`shrink-0 w-2 h-2 rounded-full ${subTab === 'mine' ? 'bg-blue-500' : 'bg-yellow-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {order.shopkeeperName}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">({order.totalPairs} pairs)</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono">{order.orderNumber} · {fmt(order.orderedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isLoading && <span className="text-[11px] text-muted-foreground">Loading…</span>}
                    {subTab === 'all' ? (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); handleClaim(e, order.id) }}
                        disabled={isPending || isClaiming}
                        className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isClaiming ? 'Claiming…' : 'Claim →'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); doUnassign(order.id) }}
                        disabled={isPending || isUnassigning}
                        className="rounded-lg border border-border text-muted-foreground px-3 py-1.5 text-xs font-medium hover:border-red-300 hover:text-red-600 dark:hover:border-red-700 dark:hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isUnassigning ? 'Releasing…' : 'Release'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
