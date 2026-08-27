'use client'

import { useState, useTransition } from 'react'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { markDispatched, markDelivered } from '@/app/actions/orders'

interface DispatchOrder {
  id: number; orderNumber: string; shopkeeperName: string; shopkeeperPhone: string | null
  shopkeeperAddress: string | null; status: string; packedAt: Date | null
}
interface Props { orders: DispatchOrder[]; embedded?: boolean }

interface PickupModalState {
  orderId: number
  orderNumber: string
  shopkeeperName: string
}

export function DispatcherDashboard({ orders: initialOrders, embedded }: Props) {
  const [orders, setOrders] = useState(initialOrders)
  const [isPending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<number | null>(null)

  // Pickup confirmation modal state
  const [pickupModal, setPickupModal] = useState<PickupModalState | null>(null)
  const [totalBundles, setTotalBundles] = useState('')
  const [deliveryAgent, setDeliveryAgent] = useState('')

  const counts = {
    total: orders.length,
    packed: orders.filter(o => o.status === 'packed').length,
    dispatched: orders.filter(o => o.status === 'dispatched').length,
  }

  function openPickupModal(order: DispatchOrder) {
    setTotalBundles('')
    setDeliveryAgent('')
    setPickupModal({ orderId: order.id, orderNumber: order.orderNumber, shopkeeperName: order.shopkeeperName })
  }

  function closePickupModal() {
    setPickupModal(null)
  }

  function handleConfirmPickup() {
    if (!pickupModal) return
    const bundles = parseInt(totalBundles, 10)
    if (!bundles || bundles < 1) return
    if (!deliveryAgent.trim()) return

    const { orderId } = pickupModal
    setPickupModal(null)
    setActiveId(orderId)
    startTransition(async () => {
      await markDispatched(orderId, bundles, deliveryAgent.trim())
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

  const canConfirm = totalBundles.trim() !== '' && parseInt(totalBundles, 10) >= 1 && deliveryAgent.trim() !== ''

  return (
    <div className={embedded ? '' : 'min-h-screen bg-background'}>
      <div className={embedded ? '' : 'max-w-2xl mx-auto px-4 py-6'}>
        {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="Dispatch Queue" subtitle="Packed orders ready for delivery" />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
        </div>
        )}

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
                      onClick={() => openPickupModal(order)}
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

      {/* Pickup confirmation modal */}
      {pickupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-background border border-border p-6 shadow-lg">
            <h2 className="text-base font-semibold mb-1">Confirm Pick Up</h2>
            <p className="text-xs text-muted-foreground mb-5">
              {pickupModal.shopkeeperName}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" htmlFor="totalBundles">
                  Total No. of Bundles <span className="text-red-500">*</span>
                </label>
                <input
                  id="totalBundles"
                  type="number"
                  min="1"
                  value={totalBundles}
                  onChange={e => setTotalBundles(e.target.value)}
                  placeholder="e.g. 5"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" htmlFor="deliveryAgent">
                  Delivery Agent Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="deliveryAgent"
                  type="text"
                  value={deliveryAgent}
                  onChange={e => setDeliveryAgent(e.target.value)}
                  placeholder="Agent name"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={closePickupModal}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPickup}
                disabled={!canConfirm}
                className="flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Confirm Pick Up
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
