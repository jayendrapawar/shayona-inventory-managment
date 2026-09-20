'use client'

import { useState, useCallback, useEffect } from 'react'
import { PageNav } from '@/components/page-nav'
import { AdminDashboard } from './admin-dashboard'
import { SalesmanDashboard } from '../salesman/salesman-dashboard'
import { PickerDashboard } from '../picker/picker-dashboard'
import { BillerDashboard } from '../biller/biller-dashboard'
import { DispatcherDashboard } from '../dispatcher/dispatcher-dashboard'
import { ProcurementSummary } from './procurement-summary'
import type { ProcurementRow } from '@/app/actions/orders'
import type { CatalogueData } from '@/app/actions/catalogue'
import type { BillingVendor } from '@/components/billing-scanner-page'
import type { OrderSet } from '@/app/actions/sets'

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
  billerOrders: any[]
  dispatchOrders: DispatchOrder[]
  procurementRows: ProcurementRow[]
  catalogue: CatalogueData
  sets: OrderSet[]
  pickers_list: { id: string; name: string | null }[]
  billingVendors?: BillingVendor[]
}

// ── Grid-based tab bar ────────────────────────────────────────────────────────
// Mobile (<sm): 2-row segment container matching desktop pill style
// Desktop (sm+): single row muted-pill segment control
function gridColsClass(n: number): string {
  if (n <= 3) return `grid-cols-${n}`
  if (n === 4) return 'grid-cols-2'
  return 'grid-cols-3'
}

interface Tab { value: string; label: string; icon?: React.ReactNode }

function GridTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[]
  active: string
  onChange: (v: string) => void
}) {
  const mobileGrid = gridColsClass(tabs.length)
  return (
    <>
      {/* Mobile: segmented pill style arranged in grid / 2 rows */}
      <div className="sm:hidden mb-5">
        <div className={`grid ${mobileGrid} w-full items-center justify-center rounded-lg bg-muted p-[3px] gap-1 text-muted-foreground`}>
          {tabs.map(tab => {
            const isActive = tab.value === active
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onChange(tab.value)}
                className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border border-transparent px-2 py-2 text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-foreground/60 hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Desktop: single row pill/segment control */}
      <div className="hidden sm:block mb-6">
        <div
          className="grid w-full items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map(tab => {
            const isActive = active === tab.value
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onChange(tab.value)}
                className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border border-transparent px-2 py-1.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-foreground/60 hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ── Hub ───────────────────────────────────────────────────────────────────────

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
  billerOrders,
  dispatchOrders,
  procurementRows,
  catalogue,
  sets,
  pickers_list,
  billingVendors = [],
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

  // For accountants: show picker/biller/dispatcher tabs only if those roles are explicitly assigned
  const showPicker     = !isAccountant || userRoles.includes('picker')
  const showBiller     = !isAccountant || userRoles.includes('biller')
  const showDispatcher = !isAccountant || userRoles.includes('dispatcher')

  const TABS: Tab[] = [
    { value: 'overview',     label: 'Overview' },
    { value: 'salesman',     label: 'Salesman' },
    ...(showPicker     ? [{ value: 'picker',      label: 'Picker' }]      : []),
    ...(showBiller     ? [{ value: 'biller',      label: 'Biller' }]      : []),
    ...(showDispatcher ? [{ value: 'dispatcher',  label: 'Dispatcher' }]  : []),
    { value: 'procurement',  label: 'Procurement' },
  ]

  const VALID_TABS = TABS.map(t => t.value)
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

        {/* Tab bar — grid on mobile, row on desktop */}
        <GridTabBar tabs={TABS} active={activeTab} onChange={handleTabChange} />

        {/* Tab content */}
        {activeTab === 'overview' && (
          <AdminDashboard
            stats={stats}
            orders={allOrders}
            pickers={pickers}
            embedded
            readOnly={isAccountant}
            pickerMapOverride={sharedPickerMap}
            onPickerChange={handlePickerChange}
          />
        )}

        {activeTab === 'salesman' && (
          <SalesmanDashboard orders={salesmanOrders} userName={adminName} embedded catalogue={catalogue} sets={sets} pickers={pickers_list} />
        )}

        {showPicker && activeTab === 'picker' && (
          <PickerDashboard
            queue={pickerQueue}
            currentPickerId={adminId}
            embedded
            onPickerChange={handlePickerChange}
          />
        )}

        {showBiller && (
          <div className={activeTab === 'biller' ? '' : 'hidden'}>
            <BillerDashboard orders={billerOrders} currentBillerId={adminId} vendors={billingVendors} articles={catalogue.articles.map(a => a.artNumber)} embedded />
          </div>
        )}

        {showDispatcher && activeTab === 'dispatcher' && (
          <DispatcherDashboard orders={dispatchOrders} currentDispatcherId={adminId} embedded />
        )}

        {activeTab === 'procurement' && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">Procurement Requirements</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Total pairs needed per article · colour · vendor — use these numbers to place upstream orders.
              </p>
            </div>
            <ProcurementSummary initialRows={procurementRows} />
          </div>
        )}

      </div>
    </div>
  )
}
