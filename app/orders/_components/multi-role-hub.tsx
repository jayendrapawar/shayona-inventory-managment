'use client'

import { useState, useEffect } from 'react'
import { PageNav } from '@/components/page-nav'
import { SalesmanDashboard } from '../salesman/salesman-dashboard'
import { PickerDashboard } from '../picker/picker-dashboard'
import { BillerDashboard } from '../biller/biller-dashboard'
import { DispatcherDashboard } from '../dispatcher/dispatcher-dashboard'
import type { CatalogueData } from '@/app/actions/catalogue'

interface Props {
  roles: string[]
  salesmanOrders: any[]
  userName: string
  pickerQueue: any[]
  currentPickerId: string
  billerOrders: any[]
  currentBillerId: string
  dispatcherOrders: any[]
  catalogue: CatalogueData
}

// ── Shared GridTabBar ─────────────────────────────────────────────────────────
function gridColsClass(n: number): string {
  if (n <= 3) return `grid-cols-${n}`
  if (n === 4) return 'grid-cols-2'
  return 'grid-cols-3'
}

interface Tab { value: string; label: string }

function GridTabBar({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (v: string) => void }) {
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

export function MultiRoleOrdersHub({
  roles,
  salesmanOrders,
  userName,
  pickerQueue,
  currentPickerId,
  billerOrders,
  currentBillerId,
  dispatcherOrders,
  catalogue,
}: Props) {
  const hasSalesman   = roles.includes('salesman')
  const hasPicker     = roles.includes('picker')
  const hasBiller     = roles.includes('biller')
  const hasDispatcher = roles.includes('dispatcher')

  const TABS: Tab[] = [
    ...(hasSalesman   ? [{ value: 'salesman',   label: 'Salesman' }]   : []),
    ...(hasPicker     ? [{ value: 'picker',     label: 'Picker' }]     : []),
    ...(hasBiller     ? [{ value: 'biller',     label: 'Biller' }]     : []),
    ...(hasDispatcher ? [{ value: 'dispatcher', label: 'Dispatcher' }] : []),
  ]

  const defaultTab = TABS[0]?.value || 'salesman'
  const [activeTab, setActiveTab] = useState(defaultTab)

  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (TABS.some(t => t.value === hash)) setActiveTab(hash)
  }, [])

  function handleTabChange(tab: string) {
    setActiveTab(tab)
    window.location.hash = tab
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Order Hub</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Switch between your order roles</p>
          </div>
          <PageNav />
        </div>

        <GridTabBar tabs={TABS} active={activeTab} onChange={handleTabChange} />

        {hasSalesman && activeTab === 'salesman' && (
          <SalesmanDashboard orders={salesmanOrders} userName={userName} embedded catalogue={catalogue} />
        )}

        {hasPicker && activeTab === 'picker' && (
          <PickerDashboard queue={pickerQueue} currentPickerId={currentPickerId} embedded />
        )}

        {hasBiller && activeTab === 'biller' && (
          <BillerDashboard orders={billerOrders} currentBillerId={currentBillerId} embedded />
        )}

        {hasDispatcher && activeTab === 'dispatcher' && (
          <DispatcherDashboard orders={dispatcherOrders} embedded />
        )}
      </div>
    </div>
  )
}
