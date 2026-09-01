'use client'

import { useState, useEffect } from 'react'
import { PageNav } from '@/components/page-nav'
import { SalesmanDashboard } from '../salesman/salesman-dashboard'
import { PickerDashboard } from '../picker/picker-dashboard'
import { DispatcherDashboard } from '../dispatcher/dispatcher-dashboard'
import { NotesDashboard } from '../_components/notes-dashboard'
import type { CatalogueData } from '@/app/actions/catalogue'
import type { NoteRow } from '@/app/actions/notes'

interface Props {
  roles: string[]
  salesmanOrders: any[]
  userName: string
  pickerQueue: any[]
  currentPickerId: string
  dispatcherOrders: any[]
  catalogue: CatalogueData
  initialNotes: NoteRow[]
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
      {/* Mobile: grid */}
      <div className={`grid ${mobileGrid} gap-1.5 mb-5 sm:hidden`}>
        {tabs.map(tab => {
          const isActive = tab.value === active
          return (
            <button key={tab.value} type="button" onClick={() => onChange(tab.value)}
              className={`rounded-xl border py-2.5 px-2 text-xs font-semibold text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {/* Desktop: pill/segment control (matches TabsList/TabsTrigger visuals) */}
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
  dispatcherOrders,
  catalogue,
  initialNotes,
}: Props) {
  const hasSalesman   = roles.includes('salesman')
  const hasPicker     = roles.includes('picker')
  const hasDispatcher = roles.includes('dispatcher')

  const TABS: Tab[] = [
    ...(hasSalesman   ? [{ value: 'salesman',   label: 'Salesman' }]   : []),
    ...(hasPicker     ? [{ value: 'picker',     label: 'Picker' }]     : []),
    ...(hasDispatcher ? [{ value: 'dispatcher', label: 'Dispatcher' }] : []),
    { value: 'notes', label: 'Notes' },
  ]

  const defaultTab = TABS[0]?.value || 'notes'
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

        {hasDispatcher && activeTab === 'dispatcher' && (
          <DispatcherDashboard orders={dispatcherOrders} embedded />
        )}

        {activeTab === 'notes' && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">Notes</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shared notes visible to all users and roles. Pin important items to keep them at the top.
              </p>
            </div>
            <NotesDashboard initialNotes={initialNotes} />
          </div>
        )}
      </div>
    </div>
  )
}
