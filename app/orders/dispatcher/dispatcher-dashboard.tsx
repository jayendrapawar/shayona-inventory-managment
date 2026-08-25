'use client'

import { useState, useTransition } from 'react'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { markDispatched, markDelivered } from '@/app/actions/orders'

interface DispatchOrder {
  id: number; orderNumber: string; shopkeeperName: string; shopkeeperPhone: string | null
  shopkeeperAddress: string | null; status: string; packedAt: Date | null
}
interface Props { orders: DispatchOrder[] }

export function DispatcherDashboard({ orders: initialOrders }: Props) {
  const [orders, setOrders] = useState(initialOrders)
  const [isPending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<number | null>(null)

  const counts = {
    total: orders.length,
    packed: orders.filter(o => o.status === 'packed').length,
    dispatched: orders.filter(o => o.status === 'dispatched').length,
  }

  function handleDispatch(orderId: number) {
    setActiveId(orderId)
    startTransition(async () => {
      await markDispatched(orderId)
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'dispatched' } : o))
      setActiveId(null)
    })
  }

  function handleDeliver(orderId: number) {
    setActiveId(orderId)
    startTransition(async () => {
      await markDelivered(orderId)
      setOrders(prev => prev.filter(o => o.id !== orderId))
      setActiveId(null)
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="Dispatch Queue" subtitle="Packed orders ready for delivery" />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Total" value={counts.total} />
          <StatCard label="Ready" value={counts.packed} color="text-purple-600" />
          <StatCard label="Out for Delivery" value={counts.dispatched} color="text-orange-600" />
        </div>

        <div className="space-y-3">
          {orders.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No orders to dispatch 🎉</div>
          )}
          {orders.map(order => (
            <div key={order.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="font-medium text-sm">{order.shopkeeperName}</p>
                  {order.shopkeeperPhone && (
                    <a href={`tel:${order.shopkeeperPhone}`} className="text-xs text-primary hover:underline">{order.shopkeeperPhone}</a>
                  )}
                  {order.shopkeeperAddress && <p className="text-xs text-muted-foreground mt-0.5">{order.shopkeeperAddress}</p>}
                </div>
                <StatusPill status={order.status} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{order.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">Packed: {fmt(order.packedAt)}</p>
                </div>
                <div className="flex gap-2">
                  {order.status === 'packed' && (
                    <button
                      onClick={() => handleDispatch(order.id)}
                      disabled={isPending && activeId === order.id}
                      className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                    >
                      {isPending && activeId === order.id ? '…' : 'Pick Up'}
                    </button>
                  )}
                  {order.status === 'dispatched' && (
                    <button
                      onClick={() => handleDeliver(order.id)}
                      disabled={isPending && activeId === order.id}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {isPending && activeId === order.id ? '…' : '✓ Delivered'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
