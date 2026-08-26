'use client'

import { useState, useTransition, useMemo } from 'react'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { adminUpdateOrderStatus, adminAssignPicker, getOrderWithItems } from '@/app/actions/orders'
import type { OrderStatus } from '@/lib/db/schema'

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

const ORDER_STATUSES: OrderStatus[] = ['pending', 'assigned', 'packed', 'dispatched', 'delivered', 'cancelled']
const ALL_STATUSES = ORDER_STATUSES as string[]

export function AdminDashboard({ stats, orders, pickers }: Props) {
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

  // ── Filter + sort ──
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'order'>('date-desc')

  // ── Detail panel ──
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null)
  const [detailItems, setDetailItems] = useState<DetailItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  async function handleViewOrder(order: OrderRow) {
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

  function handleStatusChange(orderId: number, status: string) {
    startTransition(async () => { await adminUpdateOrderStatus(orderId, status as OrderStatus) })
  }

  function handleAssignPicker(orderId: number, pickerId: string) {
    startTransition(async () => { await adminAssignPicker(orderId, pickerId) })
  }

  const filteredOrders = useMemo(() => {
    let list = orders.filter(o =>
      !search ||
      o.shopkeeperName.toLowerCase().includes(search.toLowerCase()) ||
      o.orderNumber.toLowerCase().includes(search.toLowerCase())
    )
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus)
    if (sortBy === 'date-desc') list = [...list].sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime())
    if (sortBy === 'date-asc')  list = [...list].sort((a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime())
    if (sortBy === 'order')     list = [...list].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))
    return list
  }, [orders, search, filterStatus, sortBy])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="Orders Dashboard" subtitle="Manage and track all orders" />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Home</a>
        </div>

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
          <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm"
            onClick={() => setDetailOrder(null)}>
            <div
              className="relative w-full max-w-md bg-background border-l border-border h-full overflow-y-auto shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
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
                        defaultValue={detailOrder.pickerId ?? ''}
                        onChange={e => e.target.value && handleAssignPicker(detailOrder.id, e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                      >
                        <option value="">Select picker</option>
                        {pickers.map(p => (
                          <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Change Status</p>
                      <select
                        disabled={isPending}
                        defaultValue={detailOrder.status}
                        onChange={e => handleStatusChange(detailOrder.id, e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                      >
                        {ORDER_STATUSES.map(s => (
                          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
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
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Change Status</th>
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
                          defaultValue={order.pickerId ?? ''}
                          onChange={e => e.target.value && handleAssignPicker(order.id, e.target.value)}
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        >
                          <option value="">Select picker</option>
                          {pickers.map(p => (
                            <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <select
                          disabled={isPending}
                          defaultValue={order.status}
                          onChange={e => handleStatusChange(order.id, e.target.value)}
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        >
                          {ORDER_STATUSES.map(s => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
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
