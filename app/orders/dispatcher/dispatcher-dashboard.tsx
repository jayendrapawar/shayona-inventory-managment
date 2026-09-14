'use client'

import { useState, useTransition } from 'react'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { markDispatched, markDelivered, getOrderWithItems } from '@/app/actions/orders'
import { PageNav } from '@/components/page-nav'

interface DispatchOrder {
  id: number; orderNumber: string; shopkeeperName: string; shopkeeperPhone: string | null
  shopkeeperAddress: string | null; status: string; packedAt: Date | null
  totalBundles: number | null; dispatcherId: string | null
}
interface Props { orders: DispatchOrder[]; currentDispatcherId?: string; embedded?: boolean }

interface PickupModalState {
  orderId: number
  orderNumber: string
  shopkeeperName: string
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

export function DispatcherDashboard({ orders: initialOrders, currentDispatcherId = '', embedded }: Props) {
  const [orders, setOrders] = useState(initialOrders)
  const [isPending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<number | null>(null)

  // Pickup confirmation modal state
  const [pickupModal, setPickupModal] = useState<PickupModalState | null>(null)
  const [totalBundles, setTotalBundles] = useState('')
  const [deliveryAgent, setDeliveryAgent] = useState('')

  // Order detail panel state
  const [detailOrder, setDetailOrder] = useState<DispatchOrder | null>(null)
  const [detailItems, setDetailItems] = useState<DetailItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  const counts = {
    active:         orders.length,
    billed:         orders.filter(o => o.status === 'billed').length,
    dispatched:     orders.filter(o => o.status === 'dispatched').length,
    myBundlesOut:   orders
      .filter(o => o.status === 'dispatched' && o.dispatcherId === currentDispatcherId)
      .reduce((s, o) => s + (o.totalBundles ?? 0), 0),
  }

  async function handleViewOrder(order: DispatchOrder) {
    setDetailOrder(order)
    setDetailItems([])
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
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'dispatched', totalBundles: bundles, dispatcherId: currentDispatcherId } : o))
      if (detailOrder?.id === orderId) setDetailOrder(prev => prev ? { ...prev, status: 'dispatched', totalBundles: bundles, dispatcherId: currentDispatcherId } : prev)
      setActiveId(null)
    })
  }

  function handleDeliver(orderId: number) {
    setActiveId(orderId)
    startTransition(async () => {
      await markDelivered(orderId)
      setOrders(prev => prev.filter(o => o.id !== orderId))
      if (detailOrder?.id === orderId) setDetailOrder(null)
      setActiveId(null)
    })
  }

  const canConfirm = totalBundles.trim() !== '' && parseInt(totalBundles, 10) >= 1 && deliveryAgent.trim() !== ''

  // Build consolidated grouping for the detail panel
  const articleGroups = (() => {
    const artMap = new Map<string, Map<string, DetailItem[]>>()
    for (const item of detailItems) {
      if (!artMap.has(item.artNumber)) artMap.set(item.artNumber, new Map())
      const colorKey = item.colorNumber ?? '—'
      if (!artMap.get(item.artNumber)!.has(colorKey)) artMap.get(item.artNumber)!.set(colorKey, [])
      artMap.get(item.artNumber)!.get(colorKey)!.push(item)
    }
    return Array.from(artMap.entries()).map(([artNumber, colorMap]) => ({
      artNumber,
      colorGroups: Array.from(colorMap.entries()).map(([color, items]) => ({ color, items })),
    }))
  })()

  return (
    <div className={embedded ? '' : 'min-h-screen bg-background'}>
      <div className={embedded ? '' : 'max-w-2xl mx-auto px-4 py-6'}>
        {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="Dispatch Queue" subtitle="Packed orders ready for delivery" />
          <PageNav />
        </div>
        )}

        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard label="Active" value={counts.active} />
          <StatCard label="Ready" value={counts.billed} color="text-blue-600" />
          <StatCard label="Out for Delivery" value={counts.dispatched} color="text-orange-600" />
          <StatCard label="My Bundles" value={counts.myBundlesOut} color="text-orange-600" />
        </div>

        <div className="space-y-3">
          {orders.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No orders to dispatch 🎉</div>
          )}
          {orders.map(order => (
            <div
              key={order.id}
              onClick={() => handleViewOrder(order)}
              className="w-full text-left rounded-xl border border-border bg-card p-4 hover:bg-muted/30 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="font-medium text-sm">{order.shopkeeperName}</p>
                  {order.shopkeeperPhone && (
                    <span className="text-xs text-primary">{order.shopkeeperPhone}</span>
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
                <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                  {order.status === 'billed' && (
                    <button
                      type="button"
                      onClick={() => openPickupModal(order)}
                      disabled={isPending && activeId === order.id}
                      className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                    >
                      {isPending && activeId === order.id ? '…' : 'Pick Up'}
                    </button>
                  )}
                  {order.status === 'dispatched' && (
                    <button
                      type="button"
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

      {/* ── Order detail panel ── */}
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
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {detailOrder.shopkeeperPhone && (
                    <>
                      <span className="text-muted-foreground">Phone</span>
                      <a href={`tel:${detailOrder.shopkeeperPhone}`} className="text-primary hover:underline">{detailOrder.shopkeeperPhone}</a>
                    </>
                  )}
                  {detailOrder.shopkeeperAddress && (
                    <>
                      <span className="text-muted-foreground">Address</span>
                      <span className="text-foreground">{detailOrder.shopkeeperAddress}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Packed</span>
                  <span className="text-foreground">{fmt(detailOrder.packedAt)}</span>
                </div>
              </div>

              {/* Order Items */}
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
                {!detailLoading && detailItems.length > 0 && (
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/20 border-b border-border">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Article</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground w-28">Color</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                          Size
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground/50">→</span>
                          <span className="text-[10px] font-semibold text-muted-foreground/70">ord</span>
                          <span className="mx-0.5 text-[10px] text-muted-foreground/40">→</span>
                          <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">pkd</span>
                          <span className="mx-0.5 text-[10px] text-muted-foreground/40">→</span>
                          <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">ver</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {articleGroups.map(({ artNumber, colorGroups }) =>
                        colorGroups.map(({ color, items }, ci) => {
                          const allItems = colorGroups.flatMap(cg => cg.items)
                          const allOrd   = allItems.reduce((s, i) => s + i.quantityOrdered, 0)
                          const allPkd   = allItems.reduce((s, i) => s + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0)
                          // dispatcher always sees post-biller orders → ver always shown
                          const allVer   = allPkd
                          return (
                            <tr key={`${artNumber}-${color}`} className="border-b border-border hover:bg-muted/20">
                              {ci === 0 && (
                                <td
                                  className="px-4 py-2.5 font-semibold text-xs align-top border-r border-border"
                                  rowSpan={colorGroups.length}
                                >
                                  {artNumber}
                                  {/* ord = salesman → muted */}
                                  <span className="block font-normal text-muted-foreground tabular-nums mt-0.5">{allOrd} ord</span>
                                  {/* pkd = picker → always green */}
                                  <span className="block font-semibold tabular-nums text-green-600 dark:text-green-400">{allPkd} pkd</span>
                                  {/* ver = biller → always blue */}
                                  <span className="block font-semibold tabular-nums text-blue-600 dark:text-blue-400">{allVer} ver</span>
                                </td>
                              )}
                              <td className="px-3 py-2.5 text-xs font-medium text-foreground align-top w-28 border-r border-border">{color}</td>
                              <td className="px-3 py-2.5 align-top">
                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                  {items.map(item => {
                                    const isOOS    = item.status === 'out_of_stock'
                                    const pkd      = isOOS ? 0 : item.quantityPacked
                                    const verified = pkd
                                    return (
                                      <span
                                        key={item.id}
                                        className="inline-flex items-baseline gap-0.5 tabular-nums whitespace-nowrap"
                                      >
                                        <span className="text-xs text-muted-foreground">{item.sizeNumber ?? '—'}</span>
                                        <span className="text-[10px] text-muted-foreground/50 mx-px">/</span>
                                        {/* ord = salesman → always muted */}
                                        <span className="text-xs font-bold text-muted-foreground">{item.quantityOrdered}</span>
                                        <span className="text-[10px] text-muted-foreground/40">→</span>
                                        {/* pkd = picker → always green (red if OOS) */}
                                        <span className={`text-xs font-bold ${isOOS ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                                          {isOOS ? 'OOS' : pkd}
                                        </span>
                                        {/* ver = biller → always blue */}
                                        {!isOOS && (
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
                          {(() => {
                            const totalOrd = detailItems.reduce((s, i) => s + i.quantityOrdered, 0)
                            const totalPkd = detailItems.reduce((s, i) => s + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0)
                            const totalVer = totalPkd
                            return (
                              <>
                                {/* ord = salesman → muted */}
                                <span className="font-bold tabular-nums text-muted-foreground">{totalOrd}</span>
                                <span className="text-muted-foreground mx-1">ord /</span>
                                {/* pkd = picker → green */}
                                <span className="font-bold tabular-nums text-green-600 dark:text-green-400">{totalPkd}</span>
                                <span className="text-muted-foreground mx-1">pkd /</span>
                                {/* ver = biller → blue */}
                                <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">{totalVer}</span>
                                <span className="text-muted-foreground ml-1">ver</span>
                              </>
                            )
                          })()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                {detailOrder.status === 'billed' && (
                    <button
                      type="button"
                      onClick={() => { setDetailOrder(null); openPickupModal(detailOrder) }}
                      className="flex-1 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
                    >
                      Pick Up
                    </button>
                  )}
                {detailOrder.status === 'dispatched' && (
                  <button
                    type="button"
                    disabled={isPending && activeId === detailOrder.id}
                    onClick={() => handleDeliver(detailOrder.id)}
                    className="flex-1 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {isPending && activeId === detailOrder.id ? 'Saving…' : '✓ Delivered'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
