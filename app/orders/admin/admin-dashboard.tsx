'use client'

import { useState, useTransition } from 'react'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { adminUpdateOrderStatus, adminAssignPicker } from '@/app/actions/orders'
import type { OrderStatus } from '@/lib/db/schema'

interface Props {
  stats: { total: number; pending: number; packed: number; dispatched: number; delivered: number; cancelled: number }
  orders: {
    id: number; orderNumber: string; shopkeeperName: string; status: string
    orderedAt: Date; salesmanId: string | null; pickerId: string | null; dispatcherId: string | null
  }[]
  pickers: { id: string; name: string | null; email: string; role: string | null; createdAt: Date }[]
}

const ORDER_STATUSES: OrderStatus[] = ['pending', 'assigned', 'packed', 'dispatched', 'delivered', 'cancelled']

export function AdminDashboard({ stats, orders, pickers }: Props) {
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

  const filteredOrders = orders.filter(o =>
    !search || o.shopkeeperName.toLowerCase().includes(search.toLowerCase()) || o.orderNumber.toLowerCase().includes(search.toLowerCase())
  )

  function handleStatusChange(orderId: number, status: string) {
    startTransition(async () => {
      await adminUpdateOrderStatus(orderId, status as OrderStatus)
    })
  }

  function handleAssignPicker(orderId: number, pickerId: string) {
    startTransition(async () => {
      await adminAssignPicker(orderId, pickerId)
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="Orders Dashboard" subtitle="Manage and track all orders" />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Home</a>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          <StatCard label="Active" value={stats.total} />
          <StatCard label="Pending" value={stats.pending} color="text-yellow-600" />
          <StatCard label="Packed" value={stats.packed} color="text-purple-600" />
          <StatCard label="Dispatched" value={stats.dispatched} color="text-orange-600" />
          <StatCard label="Delivered" value={stats.delivered} color="text-green-600" />
          <StatCard label="Cancelled" value={stats.cancelled} color="text-red-600" />
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Search orders…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full mb-4 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        {/* Orders Table */}
        <div className="rounded-xl border border-border overflow-hidden">
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
                {filteredOrders.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No orders found</td></tr>
                )}
                {filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium">{order.orderNumber}</td>
                    <td className="px-4 py-3">{order.shopkeeperName}</td>
                    <td className="px-4 py-3"><StatusPill status={order.status} /></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{fmt(order.orderedAt)}</td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
