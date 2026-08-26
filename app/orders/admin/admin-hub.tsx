'use client'

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { AdminDashboard } from './admin-dashboard'
import { SalesmanDashboard } from '../salesman/salesman-dashboard'
import { PickerDashboard } from '../picker/picker-dashboard'
import { DispatcherDashboard } from '../dispatcher/dispatcher-dashboard'

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
  stats: { total: number; pending: number; packed: number; dispatched: number; delivered: number; cancelled: number }
  allOrders: OrderRow[]
  pickers: Picker[]
  salesmanOrders: SalesmanOrder[]
  pickerQueue: QueueItem[]
  dispatchOrders: DispatchOrder[]
}

export function AdminHub({
  adminName,
  stats,
  allOrders,
  pickers,
  salesmanOrders,
  pickerQueue,
  dispatchOrders,
}: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Admin Hub</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage all orders across every role</p>
          </div>
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Home</a>
        </div>

        {/* Tabs — same pill style as scanner */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="overview"   className="text-xs sm:text-sm">Overview</TabsTrigger>
            <TabsTrigger value="salesman"   className="text-xs sm:text-sm">Salesman</TabsTrigger>
            <TabsTrigger value="picker"     className="text-xs sm:text-sm">Picker</TabsTrigger>
            <TabsTrigger value="dispatcher" className="text-xs sm:text-sm">Dispatcher</TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview">
            <AdminDashboard stats={stats} orders={allOrders} pickers={pickers} embedded />
          </TabsContent>

          <TabsContent value="salesman">
            <SalesmanDashboard orders={salesmanOrders} userName={adminName} embedded />
          </TabsContent>

          <TabsContent value="picker">
            <PickerDashboard queue={pickerQueue} embedded />
          </TabsContent>

          <TabsContent value="dispatcher">
            <DispatcherDashboard orders={dispatchOrders} embedded />
          </TabsContent>
        </Tabs>

      </div>
    </div>
  )
}
