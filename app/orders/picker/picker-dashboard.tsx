'use client'
import { useState, useTransition, useMemo } from 'react'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
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
}

interface Props {
  queue: QueueItem[]
  currentPickerId: string
  embedded?: boolean
}

type SubTab = 'all' | 'mine'

export function PickerDashboard({ queue: initialQueue, currentPickerId, embedded }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue)
  const [selectedOrder, setSelectedOrder] = useState<{ order: Order; items: OrderItem[] } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [claimingId, setClaimingId] = useState<number | null>(null)
  const [unassigningId, setUnassigningId] = useState<number | null>(null)
  const [subTab, setSubTab] = useState<SubTab>('all')
  const [claimError, setClaimError] = useState<string | null>(null)

  // ── Split lists ──────────────────────────────────────────────────────────────
  // "All" = only pending + unassigned (available to claim)
  const availableOrders = useMemo(() => queue.filter(o => !o.pickerId && o.status === 'pending'), [queue])
  const myOrders        = useMemo(() => queue.filter(o => o.pickerId === currentPickerId), [queue, currentPickerId])

  const counts = {
    available: availableOrders.length,
    mine:      myOrders.length,
  }

  // ── Open order detail ────────────────────────────────────────────────────────
  function openOrder(orderId: number) {
    setLoadingId(orderId)
    startTransition(async () => {
      try {
        const data = await getOrderWithItems(orderId)
        setSelectedOrder(data)
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
        await selfAssignOrder(orderId)
        // Optimistic update: mark the order as assigned + set pickerId
        setQueue(prev =>
          prev.map(o =>
            o.id === orderId ? { ...o, status: 'assigned', pickerId: currentPickerId } : o
          )
        )
        // Switch to "My Orders" so the picker sees their claimed order
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
        setSelectedOrder(data)
      }
    })
  }

  function handleOutOfStock(itemId: number) {
    startTransition(async () => {
      await markItemOutOfStock(itemId)
      if (selectedOrder) {
        const data = await getOrderWithItems(selectedOrder.order.id)
        setSelectedOrder(data)
      }
    })
  }

  function handleMarkPacked() {
    if (!selectedOrder) return
    startTransition(async () => {
      await markOrderPacked(selectedOrder.order.id)
      // Remove from local queue
      setQueue(prev => prev.filter(o => o.id !== selectedOrder.order.id))
      setSelectedOrder(null)
    })
  }

  const allItemsDone = selectedOrder?.items.every(
    i => i.status === 'packed' || i.status === 'out_of_stock'
  ) ?? false

  // ── Order detail view ────────────────────────────────────────────────────────
  if (selectedOrder) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <PageHeader
            title={selectedOrder.order.orderNumber}
            subtitle={selectedOrder.order.shopkeeperName}
            back="/orders/picker"
          />
          <button
            onClick={() => setSelectedOrder(null)}
            className="mb-4 text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to queue
          </button>

          <div className="rounded-xl border border-border bg-card p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{selectedOrder.order.shopkeeperName}</p>
                <p className="text-xs text-muted-foreground font-mono">{selectedOrder.order.orderNumber}</p>
              </div>
              <StatusPill status={selectedOrder.order.status} />
            </div>
          </div>

          <div className="rounded-xl border border-border overflow-hidden mb-4">
            <div className="bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground grid grid-cols-12 gap-2">
              <span className="col-span-4">Article</span>
              <span className="col-span-2">Color</span>
              <span className="col-span-2">Size</span>
              <span className="col-span-2">Ordered</span>
              <span className="col-span-2">Action</span>
            </div>
            {selectedOrder.items.map(item => (
              <div
                key={item.id}
                className={`grid grid-cols-12 gap-2 items-center px-4 py-3 border-t border-border text-sm ${item.status === 'out_of_stock' ? 'opacity-50' : ''}`}
              >
                <span className="col-span-4 font-mono text-xs font-medium">{item.artNumber}</span>
                <span className="col-span-2 text-muted-foreground text-xs">{item.colorNumber ?? '—'}</span>
                <span className="col-span-2 text-muted-foreground text-xs">{item.sizeNumber ?? '—'}</span>
                <span className="col-span-2 text-center">
                  {(item.status as OrderItemStatus) === 'out_of_stock'
                    ? <span className="text-xs text-red-500 font-medium">OOS</span>
                    : (
                      <input
                        type="number"
                        min={0}
                        max={item.quantityOrdered}
                        defaultValue={item.quantityPacked}
                        disabled={isPending || (item.status as OrderItemStatus) === 'out_of_stock'}
                        onBlur={e => handleQtyChange(item.id, parseInt(e.target.value) || 0)}
                        className="w-14 rounded-md border border-border bg-background px-2 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    )
                  }
                  <span className="text-xs text-muted-foreground ml-1">/{item.quantityOrdered}</span>
                </span>
                <span className="col-span-2">
                  {item.status === 'packed'
                    ? <span className="text-xs text-green-600 font-medium">✓ Packed</span>
                    : (item.status as OrderItemStatus) === 'out_of_stock'
                      ? <span className="text-xs text-red-500 font-medium">OOS</span>
                      : (
                        <button
                          onClick={() => handleOutOfStock(item.id)}
                          disabled={isPending}
                          className="text-xs text-red-500 hover:underline disabled:opacity-50"
                        >
                          OOS
                        </button>
                      )
                  }
                </span>
              </div>
            ))}
          </div>

          {subTab === 'mine' && (
            <button
              onClick={handleMarkPacked}
              disabled={!allItemsDone || isPending}
              className="w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Saving…' : allItemsDone ? '✓ Pack Order' : 'Pack all items first'}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Unassign handler ─────────────────────────────────────────────────────────
  function doUnassign(orderId: number) {
    setClaimError(null)
    setUnassigningId(orderId)
    startTransition(async () => {
      try {
        await unassignOrder(orderId)
        setQueue(prev =>
          prev.map(o =>
            o.id === orderId ? { ...o, status: 'pending', pickerId: null } : o
          )
        )
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
      <div className={embedded ? '' : 'max-w-2xl mx-auto px-4 py-6'}>
        {!embedded && (
          <div className="flex items-center justify-between mb-6">
            <PageHeader title="Packing Queue" subtitle="Orders awaiting packing" />
            <a href="/home" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
          </div>
        )}

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <StatCard label="Available to claim" value={counts.available} color="text-yellow-600" />
          <StatCard label="My picked orders"   value={counts.mine}      color="text-blue-600"   />
        </div>

        {/* ── Sub-tabs ── */}
        <div className="flex rounded-lg border border-border bg-muted/40 p-1 mb-4 gap-1">
          <button
            type="button"
            onClick={() => setSubTab('all')}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
              subTab === 'all'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All Orders
            <span className="ml-1.5 tabular-nums text-muted-foreground">({counts.available})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('mine')}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
              subTab === 'mine'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            My Picked Orders
            <span className="ml-1.5 tabular-nums text-muted-foreground">({counts.mine})</span>
          </button>
        </div>

        {/* ── Error banner ── */}
        {claimError && (
          <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-400 flex items-center justify-between gap-2">
            <span>{claimError}</span>
            <button type="button" onClick={() => setClaimError(null)} className="shrink-0 text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* ── Order list ── */}
        <div className="space-y-3">
          {displayList.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {subTab === 'mine'
                ? 'No orders assigned to you yet — claim one from All Orders.'
                : 'No available orders right now 🎉'}
            </div>
          )}

          {displayList.map(order => {
            const isClaiming = claimingId === order.id

            return (
              <div
                key={order.id}
                className={`rounded-xl border bg-card flex items-center gap-3 px-3 py-2.5 transition-all ${
                  subTab === 'mine'
                    ? 'border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20'
                    : 'border-border'
                }`}
              >
                {/* Info — click to open */}
                <button
                  type="button"
                  onClick={() => openOrder(order.id)}
                  disabled={loadingId === order.id}
                  className="flex-1 min-w-0 text-left disabled:opacity-60"
                >
                  <p className="text-sm font-medium text-foreground truncate">{order.shopkeeperName}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{order.orderNumber} · {fmt(order.orderedAt)}</p>
                </button>

                {/* Status + action */}
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill status={order.status} />
                  {loadingId === order.id
                    ? <span className="text-xs text-muted-foreground">Loading…</span>
                    : subTab === 'all'
                      ? (
                        <button
                          type="button"
                          onClick={e => handleClaim(e, order.id)}
                          disabled={isPending || isClaiming}
                          className="rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-2.5 py-1 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {isClaiming ? 'Claiming…' : 'Claim'}
                        </button>
                      )
                      : (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); doUnassign(order.id) }}
                          disabled={isPending || unassigningId === order.id}
                          className="rounded-lg border border-border text-muted-foreground px-2.5 py-1 text-xs font-medium hover:border-red-300 hover:text-red-600 dark:hover:border-red-700 dark:hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {unassigningId === order.id ? 'Releasing…' : 'Release'}
                        </button>
                      )
                  }
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
