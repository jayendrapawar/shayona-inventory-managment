'use client'

import { useState, useTransition } from 'react'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { getOrderWithItems, updateItemPacked, markItemOutOfStock, markOrderPacked } from '@/app/actions/orders'
import type { Order, OrderItem, OrderItemStatus } from '@/lib/db/schema'

interface QueueItem {
  id: number; orderNumber: string; shopkeeperName: string; status: string; orderedAt: Date; pickerId: string | null
}
interface Props { queue: QueueItem[] }

export function PickerDashboard({ queue }: Props) {
  const [selectedOrder, setSelectedOrder] = useState<{ order: Order; items: OrderItem[] } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [loadingId, setLoadingId] = useState<number | null>(null)

  const counts = {
    total: queue.length,
    pending: queue.filter(o => o.status === 'pending').length,
    assigned: queue.filter(o => o.status === 'assigned').length,
  }

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
      setSelectedOrder(null)
    })
  }

  const allItemsDone = selectedOrder?.items.every(i => i.status === 'packed' || i.status === 'out_of_stock') ?? false

  if (selectedOrder) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <PageHeader
            title={selectedOrder.order.orderNumber}
            subtitle={selectedOrder.order.shopkeeperName}
            back="/orders/picker"
          />
          <button onClick={() => setSelectedOrder(null)} className="mb-4 text-sm text-muted-foreground hover:text-foreground">← Back to queue</button>

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
              <div key={item.id} className={`grid grid-cols-12 gap-2 items-center px-4 py-3 border-t border-border text-sm ${item.status === 'out_of_stock' ? 'opacity-50' : ''}`}>
                <span className="col-span-4 font-mono text-xs font-medium">{item.artNumber}</span>
                <span className="col-span-2 text-muted-foreground text-xs">{item.colorNumber ?? '—'}</span>
                <span className="col-span-2 text-muted-foreground text-xs">{item.sizeNumber ?? '—'}</span>
                <span className="col-span-2 text-center">
                  {(item.status as OrderItemStatus) === 'out_of_stock'
                    ? <span className="text-xs text-red-500 font-medium">OOS</span>
                    : (
                      <input type="number" min={0} max={item.quantityOrdered} defaultValue={item.quantityPacked}
                        disabled={isPending || (item.status as OrderItemStatus) === 'out_of_stock'}
                        onBlur={e => handleQtyChange(item.id, parseInt(e.target.value) || 0)}
                        className="w-14 rounded-md border border-border bg-background px-2 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-ring" />
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
                        <button onClick={() => handleOutOfStock(item.id)} disabled={isPending}
                          className="text-xs text-red-500 hover:underline disabled:opacity-50">OOS</button>
                      )
                  }
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={handleMarkPacked}
            disabled={!allItemsDone || isPending}
            className="w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Saving…' : allItemsDone ? '✓ Mark Order as Packed' : 'Pack all items to continue'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="Packing Queue" subtitle="Orders awaiting packing" />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Total" value={counts.total} />
          <StatCard label="Pending" value={counts.pending} color="text-yellow-600" />
          <StatCard label="Assigned" value={counts.assigned} color="text-blue-600" />
        </div>

        <div className="space-y-3">
          {queue.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No orders in queue 🎉</div>
          )}
          {queue.map(order => (
            <button key={order.id} onClick={() => openOrder(order.id)} disabled={loadingId === order.id}
              className="w-full text-left rounded-xl border border-border bg-card p-4 hover:shadow-sm transition-all active:scale-99 disabled:opacity-60">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{order.shopkeeperName}</p>
                  <p className="text-xs font-mono text-muted-foreground">{order.orderNumber}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={order.status} />
                  {loadingId === order.id && <span className="text-xs text-muted-foreground">Loading…</span>}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{fmt(order.orderedAt)}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
