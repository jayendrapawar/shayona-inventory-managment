'use client'

import { useState, useCallback, useEffect } from 'react'
import { PageNav } from '@/components/page-nav'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { AdminDashboard } from './admin-dashboard'
import { SalesmanDashboard } from '../salesman/salesman-dashboard'
import { PickerDashboard } from '../picker/picker-dashboard'
import { DispatcherDashboard } from '../dispatcher/dispatcher-dashboard'
import { ProcurementSummary } from './procurement-summary'
import type { ProcurementRow } from '@/app/actions/orders'
import type { CatalogueData } from '@/app/actions/catalogue'

// ── Prop types (mirroring what each dashboard expects) ────────────────────────

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

interface SalesmanOrder {
  id: number
  orderNumber: string
  shopkeeperName: string
  status: string
  notes: string | null
  orderedAt: Date
  updatedAt: Date
}

interface QueueItem {
  totalPairs: number
  packedPairs: number
  id: number
  orderNumber: string
  shopkeeperName: string
  status: string
  orderedAt: Date
  pickerId: string | null
}

interface DispatchOrder {
  id: number
  orderNumber: string
  shopkeeperName: string
  shopkeeperPhone: string | null
  shopkeeperAddress: string | null
  status: string
  packedAt: Date | null
  totalBundles: number | null
  dispatcherId: string | null
}

interface Picker {
  id: string
  name: string | null
  email: string
  role: string | null
  createdAt: Date
}

interface Props {
  adminName: string
  adminId: string
  isAccountant?: boolean
  userRoles?: string[]
  stats: { total: number; pending: number; packed: number; dispatched: number; delivered: number; cancelled: number }
  allOrders: OrderRow[]
  pickers: Picker[]
  salesmanOrders: SalesmanOrder[]
  pickerQueue: QueueItem[]
  dispatchOrders: DispatchOrder[]
  procurementRows: ProcurementRow[]
  catalogue: CatalogueData
}

export function AdminHub({
  adminName,
  adminId,
  isAccountant = false,
  userRoles = [],
  stats,
  allOrders,
  pickers,
  salesmanOrders,
  pickerQueue,
  dispatchOrders,
  procurementRows,
  catalogue,
}: Props) {
  // Shared picker assignment map — owned here so Overview + Picker tab stay in sync
  const [sharedPickerMap, setSharedPickerMap] = useState<Record<number, string>>(() =>
    Object.fromEntries(allOrders.filter(o => o.pickerId).map(o => [o.id, o.pickerId!]))
  )

  const handlePickerChange = useCallback((orderId: number, pickerId: string | null) => {
    setSharedPickerMap(prev => {
      const next = { ...prev }
      if (pickerId) next[orderId] = pickerId
      else delete next[orderId]
      return next
    })
  }, [])

  // For accountants: show picker/dispatcher tabs only if those roles are explicitly assigned
  const showPicker     = !isAccountant || userRoles.includes('picker')
  const showDispatcher = !isAccountant || userRoles.includes('dispatcher')

  const VALID_TABS = [
    'overview',
    'salesman',
    showPicker     && 'picker',
    showDispatcher && 'dispatcher',
    'procurement',
  ].filter(Boolean) as string[]
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (VALID_TABS.includes(hash)) setActiveTab(hash)
  }, [])

  function handleTabChange(tab: string) {
    setActiveTab(tab)
    window.location.hash = tab
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {isAccountant ? 'Accountant Hub' : 'Admin Hub'}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isAccountant ? 'View orders & procurement overview' : 'Manage all orders across every role'}
            </p>
          </div>
          <PageNav />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList
            className="grid w-full mb-6"
            style={{ gridTemplateColumns: `repeat(${VALID_TABS.length}, minmax(0, 1fr))` }}
          >
            <TabsTrigger value="overview"    className="text-xs sm:text-sm">Overview</TabsTrigger>
              <TabsTrigger value="salesman"    className="text-xs sm:text-sm">Salesman</TabsTrigger>
              {showPicker     && <TabsTrigger value="picker"      className="text-xs sm:text-sm">Picker</TabsTrigger>}
              {showDispatcher && <TabsTrigger value="dispatcher"  className="text-xs sm:text-sm">Dispatcher</TabsTrigger>}
              <TabsTrigger value="procurement" className="text-xs sm:text-sm">Procurement</TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview">
            <AdminDashboard
              stats={stats}
              orders={allOrders}
              pickers={pickers}
              embedded
              readOnly={isAccountant}
              pickerMapOverride={sharedPickerMap}
              onPickerChange={handlePickerChange}
            />
          </TabsContent>

          <TabsContent value="salesman">
            <SalesmanDashboard orders={salesmanOrders} userName={adminName} embedded catalogue={catalogue} />
          </TabsContent>

          {showPicker && (
          <TabsContent value="picker">
            <PickerDashboard
              queue={pickerQueue}
              currentPickerId={adminId}
              embedded
              onPickerChange={handlePickerChange}
            />
          </TabsContent>
          )}

          {showDispatcher && (
          <TabsContent value="dispatcher">
            <DispatcherDashboard orders={dispatchOrders} currentDispatcherId={adminId} embedded />
          </TabsContent>
          )}

          {/* ── Procurement ── */}
          <TabsContent value="procurement">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-foreground">Procurement Requirements</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Total pairs needed per article · colour · vendor — use these numbers to place upstream orders.
                </p>
              </div>
              <ProcurementSummary initialRows={procurementRows} />
            </div>
          </TabsContent>
        </Tabs>

      </div>
    </div>
  )
}
