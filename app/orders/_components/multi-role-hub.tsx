'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageNav } from '@/components/page-nav'
import { SalesmanDashboard } from '../salesman/salesman-dashboard'
import { PickerDashboard } from '../picker/picker-dashboard'
import { DispatcherDashboard } from '../dispatcher/dispatcher-dashboard'
import type { CatalogueData } from '@/app/actions/catalogue'

interface Props {
  roles: string[]
  salesmanOrders: any[]
  userName: string
  pickerQueue: any[]
  currentPickerId: string
  dispatcherOrders: any[]
  catalogue: CatalogueData
}

export function MultiRoleOrdersHub({
  roles,
  salesmanOrders,
  userName,
  pickerQueue,
  currentPickerId,
  dispatcherOrders,
  catalogue,
}: Props) {
  const hasSalesman = roles.includes('salesman')
  const hasPicker = roles.includes('picker')
  const hasDispatcher = roles.includes('dispatcher')

  const availableTabs = [
    hasSalesman && { value: 'salesman', label: 'Salesman' },
    hasPicker && { value: 'picker', label: 'Picker' },
    hasDispatcher && { value: 'dispatcher', label: 'Dispatcher' },
  ].filter(Boolean) as { value: string; label: string }[]

  const defaultTab = availableTabs[0]?.value || 'salesman'

  const [activeTab, setActiveTab] = useState(defaultTab)

  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (availableTabs.some(t => t.value === hash)) setActiveTab(hash)
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

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <div className="overflow-x-auto mb-6">
          <TabsList className="flex w-max min-w-full h-auto p-[3px]">
            {availableTabs.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex-1 text-xs px-3 py-1.5 whitespace-nowrap">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          </div>

          {hasSalesman && (
            <TabsContent value="salesman">
              <SalesmanDashboard orders={salesmanOrders} userName={userName} embedded catalogue={catalogue} />
            </TabsContent>
          )}

          {hasPicker && (
            <TabsContent value="picker">
              <PickerDashboard queue={pickerQueue} currentPickerId={currentPickerId} embedded />
            </TabsContent>
          )}

          {hasDispatcher && (
            <TabsContent value="dispatcher">
              <DispatcherDashboard orders={dispatcherOrders} embedded />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}
