'use client'

import { useState, useTransition } from 'react'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { createOrder } from '@/app/actions/orders'
import type { OrderItemInput } from '@/app/actions/orders'

interface Order {
  id: number; orderNumber: string; shopkeeperName: string; shopkeeperPhone: string | null
  shopkeeperAddress: string | null; status: string; notes: string | null; orderedAt: Date
}

interface Props { orders: Order[]; userName: string }

const EMPTY_ITEM: OrderItemInput = { artNumber: '', colorNumber: '', sizeNumber: '', quantityOrdered: 1 }

export function SalesmanDashboard({ orders, userName }: Props) {
  const [view, setView] = useState<'list' | 'new'>('list')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // New order form state
  const [shopName, setShopName] = useState('')
  const [shopPhone, setShopPhone] = useState('')
  const [shopAddress, setShopAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<OrderItemInput[]>([{ ...EMPTY_ITEM }])

  function addItem() { setItems(prev => [...prev, { ...EMPTY_ITEM }]) }
  function removeItem(i: number) { setItems(prev => prev.filter((_, idx) => idx !== i)) }
  function updateItem(i: number, field: keyof OrderItemInput, val: string | number) {
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!shopName.trim()) { setError('Shopkeeper name is required'); return }
    if (items.some(it => !it.artNumber.trim())) { setError('All items need an Article Number'); return }

    startTransition(async () => {
      try {
        await createOrder({ shopkeeperName: shopName, shopkeeperPhone: shopPhone, shopkeeperAddress: shopAddress, notes, items })
        setSuccess('Order created successfully!')
        setShopName(''); setShopPhone(''); setShopAddress(''); setNotes('')
        setItems([{ ...EMPTY_ITEM }])
        setTimeout(() => { setView('list'); setSuccess('') }, 1500)
      } catch {
        setError('Failed to create order. Try again.')
      }
    })
  }

  const counts = { total: orders.length, pending: orders.filter(o => o.status === 'pending').length, delivered: orders.filter(o => o.status === 'delivered').length }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="My Orders" subtitle={`Welcome, ${userName}`} />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground">← Home</a>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Total" value={counts.total} />
          <StatCard label="Pending" value={counts.pending} color="text-yellow-600" />
          <StatCard label="Delivered" value={counts.delivered} color="text-green-600" />
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border mb-4">
          {(['list', 'new'] as const).map(t => (
            <button key={t} onClick={() => setView(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${view === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {t === 'list' ? 'All Orders' : '+ New Order'}
            </button>
          ))}
        </div>

        {/* Orders List */}
        {view === 'list' && (
          <div className="space-y-3">
            {orders.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">No orders yet.</p>
                <button onClick={() => setView('new')} className="mt-2 text-sm text-primary hover:underline">Create your first order →</button>
              </div>
            )}
            {orders.map(order => (
              <div key={order.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{order.shopkeeperName}</p>
                    {order.shopkeeperPhone && <p className="text-xs text-muted-foreground">{order.shopkeeperPhone}</p>}
                    {order.shopkeeperAddress && <p className="text-xs text-muted-foreground">{order.shopkeeperAddress}</p>}
                  </div>
                  <StatusPill status={order.status} />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{order.orderNumber}</span>
                  <span className="text-xs text-muted-foreground">{fmt(order.orderedAt)}</span>
                </div>
                {order.notes && <p className="mt-2 text-xs text-muted-foreground italic">{order.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {/* New Order Form */}
        {view === 'new' && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <p className="text-sm font-medium text-foreground">Shopkeeper Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
                  <input value={shopName} onChange={e => setShopName(e.target.value)} placeholder="Ramesh Footwear"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label>
                  <input value={shopPhone} onChange={e => setShopPhone(e.target.value)} placeholder="9876543210"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Address</label>
                <input value={shopAddress} onChange={e => setShopAddress(e.target.value)} placeholder="Shop address"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any special instructions…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Order Items</p>
                <button type="button" onClick={addItem}
                  className="text-xs text-primary hover:underline font-medium">+ Add Item</button>
              </div>
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
                <span className="col-span-4">Art No. *</span>
                <span className="col-span-3">Color</span>
                <span className="col-span-3">Size</span>
                <span className="col-span-1">Qty</span>
                <span className="col-span-1"></span>
              </div>
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={item.artNumber} onChange={e => updateItem(i, 'artNumber', e.target.value)}
                    placeholder="ART-001" className="col-span-4 rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  <input value={item.colorNumber} onChange={e => updateItem(i, 'colorNumber', e.target.value)}
                    placeholder="BLK" className="col-span-3 rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  <input value={item.sizeNumber} onChange={e => updateItem(i, 'sizeNumber', e.target.value)}
                    placeholder="7" className="col-span-3 rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  <input type="number" min={1} value={item.quantityOrdered} onChange={e => updateItem(i, 'quantityOrdered', parseInt(e.target.value) || 1)}
                    className="col-span-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring" />
                  <button type="button" onClick={() => removeItem(i)} disabled={items.length === 1}
                    className="col-span-1 text-muted-foreground hover:text-red-500 disabled:opacity-30 transition-colors text-lg leading-none text-center">×</button>
                </div>
              ))}
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            {success && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{success}</p>}

            <div className="flex gap-3">
              <button type="button" onClick={() => setView('list')}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={isPending}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {isPending ? 'Creating…' : 'Create Order'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
