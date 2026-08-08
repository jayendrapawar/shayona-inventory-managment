'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  getInventorySummary,
  getStatistics,
  exportToExcel,
  getOverallStockSummary,
  getOverallStockStats,
  exportOverallStockToCSV,
} from '@/app/actions/dashboard'
import type { OverallStockItem, OverallStockStats } from '@/app/actions/dashboard'
import { signOut } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'
import { QrCode, Package, Tag, BarChart3, Filter } from 'lucide-react'

type Tab = 'scanned' | 'overall'

interface InventoryItem {
  artNumber?: string
  colorNumber?: string
  sizeNumber?: string
  division?: string
  mrp?: number
  mfgMonth?: number
  mfgYear?: number
  scannedByName?: string
  entryType?: string
  quantity: number
  lastScanned: Date
  count: number
}

interface Statistics {
  totalScans: number
  totalItems: number
  uniqueItems: number
  scansLast24h: number
}

function downloadCSV(rows: Record<string, string | number>[], filename: string) {
  if (!rows.length) return
  const csv = [
    Object.keys(rows[0]).join(','),
    ...rows.map((row) => Object.values(row).map((v) => `"${v}"`).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.URL.revokeObjectURL(url)
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode
  iconBg: string
  title: string
  value: string | number
  subtitle: string
}

function KpiCard({ icon, iconBg, title, value, subtitle }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 sm:gap-4 px-3 py-3 sm:px-5 sm:py-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground leading-tight">{title}</p>
          <p className="text-2xl sm:text-3xl font-bold leading-tight">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DashboardPage() {
  const router = useRouter()
  const { t } = useLanguage()

  const [activeTab, setActiveTab] = useState<Tab>('scanned')

  // Scanned Inventory state
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [filteredInventory, setFilteredInventory] = useState<InventoryItem[]>([])
  const [stats, setStats] = useState<Statistics | null>(null)

  // Overall Stock state
  const [stockItems, setStockItems] = useState<OverallStockItem[]>([])
  const [filteredStock, setFilteredStock] = useState<OverallStockItem[]>([])
  const [stockStats, setStockStats] = useState<OverallStockStats | null>(null)
  const [stockLoaded, setStockLoaded] = useState(false)

  // Shared
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load Scanned Inventory on mount
  useEffect(() => {
    loadScannedInventory()
  }, [])

  // Load Overall Stock when tab first switches to it
  useEffect(() => {
    if (activeTab === 'overall' && !stockLoaded) {
      loadOverallStock()
    }
  }, [activeTab])

  // Re-filter when tab or search changes
  useEffect(() => {
    applySearch(searchQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, inventory, stockItems])

  async function loadScannedInventory() {
    try {
      setLoading(true)
      setError(null)
      const [summaryData, statsData] = await Promise.all([
        getInventorySummary(),
        getStatistics(),
      ])
      setInventory(summaryData as InventoryItem[])
      setFilteredInventory(summaryData as InventoryItem[])
      setStats(statsData as Statistics)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scanned inventory')
    } finally {
      setLoading(false)
    }
  }

  async function loadOverallStock() {
    try {
      setLoading(true)
      setError(null)
      const [items, overallStats] = await Promise.all([
        getOverallStockSummary(),
        getOverallStockStats(),
      ])
      setStockItems(items)
      setFilteredStock(items)
      setStockStats(overallStats)
      setStockLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overall stock')
    } finally {
      setLoading(false)
    }
  }

  function applySearch(query: string) {
    const q = query.toLowerCase().trim()
    if (activeTab === 'scanned') {
      setFilteredInventory(
        q
          ? inventory.filter(
              (item) =>
                item.artNumber?.toLowerCase().includes(q) ||
                item.colorNumber?.toLowerCase().includes(q) ||
                item.sizeNumber?.toLowerCase().includes(q)
            )
          : inventory
      )
    } else {
      setFilteredStock(
        q
          ? stockItems.filter(
              (item) =>
                item.artNumber?.toLowerCase().includes(q) ||
                item.colorNumber?.toLowerCase().includes(q) ||
                item.sizeNumber?.toLowerCase().includes(q)
            )
          : stockItems
      )
    }
  }

  function handleSearch(query: string) {
    setSearchQuery(query)
    applySearch(query)
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab)
    setSearchQuery('')
    // Reset filter to show all when switching tabs
    if (tab === 'scanned') setFilteredInventory(inventory)
    else setFilteredStock(stockItems)
  }

  async function handleExport() {
    try {
      if (activeTab === 'scanned') {
        const data = await exportToExcel()
        downloadCSV(data, `scanned-inventory-${new Date().toISOString().split('T')[0]}.csv`)
      } else {
        const data = await exportOverallStockToCSV()
        downloadCSV(data, `overall-stock-${new Date().toISOString().split('T')[0]}.csv`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export data')
    }
  }

  async function handleLogout() {
    await signOut()
    router.push('/sign-in')
  }

  // ─── Render helpers ─────────────────────────────────────────────────────

  function renderScannedKPIs() {
    if (!stats) return null
    const avg = stats.uniqueItems > 0 ? (stats.totalItems / stats.uniqueItems).toFixed(1) : '0'
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<QrCode className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-50"
          title={t('totalScans')}
          value={stats.totalScans}
          subtitle={`${stats.scansLast24h} ${t('inLast24h')}`}
        />
        <KpiCard
          icon={<Package className="h-5 w-5 text-green-600" />}
          iconBg="bg-green-50"
          title={t('totalItemsScanned')}
          value={stats.totalItems}
          subtitle={t('unitsScanned')}
        />
        <KpiCard
          icon={<Tag className="h-5 w-5 text-purple-600" />}
          iconBg="bg-purple-50"
          title={t('uniqueItemsScannedKPI')}
          value={stats.uniqueItems}
          subtitle={t('differentSKUs')}
        />
        <KpiCard
          icon={<BarChart3 className="h-5 w-5 text-orange-500" />}
          iconBg="bg-orange-50"
          title={t('avgPerItemScanned')}
          value={avg}
          subtitle={t('unitsPerSKU')}
        />
      </div>
    )
  }

  function renderOverallKPIs() {
    if (!stockStats) return null
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<Package className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-50"
          title={t('totalStockItems')}
          value={stockStats.totalStockItems.toLocaleString()}
          subtitle={t('totalUnits')}
        />
        <KpiCard
          icon={<Package className="h-5 w-5 text-green-600" />}
          iconBg="bg-green-50"
          title={t('uniqueSKUs')}
          value={stockStats.uniqueSKUs.toLocaleString()}
          subtitle={t('differentSKUs')}
        />
        <KpiCard
          icon={<Tag className="h-5 w-5 text-purple-600" />}
          iconBg="bg-purple-50"
          title={t('totalLocations')}
          value={stockStats.totalLocations}
          subtitle={t('storageLocations')}
        />
        <KpiCard
          icon={<BarChart3 className="h-5 w-5 text-orange-500" />}
          iconBg="bg-orange-50"
          title={t('lowStockItems')}
          value={stockStats.lowStockItems}
          subtitle={t('itemsBelowThreshold')}
        />
      </div>
    )
  }

  function renderScannedTable() {
    return (
      <Card>
        <CardHeader className="px-3 sm:px-6">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50">
                <QrCode className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base sm:text-lg">{t('scannedInventoryTitle')}</CardTitle>
                <CardDescription className="text-xs sm:text-sm">{t('scannedInventoryDesc')}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
              <Filter className="h-3 w-3" />
              {t('filteredByCurrentUser')}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {filteredInventory.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground px-3">
              {inventory.length === 0 ? t('noInventoryYet') : t('noSearchResults')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('artNumberCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('colorCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('sizeCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell">{t('divisionCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell text-right">{t('mrpCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('mfgCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('scannedByCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 text-right">{t('quantityCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 text-right hidden sm:table-cell">{t('scansCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('lastScannedCol')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInventory.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs sm:text-sm font-semibold px-3 sm:px-4">
                        {item.artNumber || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm px-3 sm:px-4">
                        {item.colorNumber || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm px-3 sm:px-4">
                        {item.sizeNumber || '-'}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell">
                        {item.division || '-'}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell text-right">
                        {item.mrp != null ? `₹${item.mrp.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">
                        {item.mfgMonth && item.mfgYear
                          ? `${String(item.mfgMonth).padStart(2, '0')}/${item.mfgYear}`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">
                        {item.scannedByName || '-'}
                      </TableCell>
                      <TableCell className="text-right px-3 sm:px-4">
                        <Badge variant="secondary">{item.quantity}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs sm:text-sm text-muted-foreground px-3 sm:px-4 hidden sm:table-cell">
                        {item.count}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm text-muted-foreground px-3 sm:px-4 hidden md:table-cell">
                        {new Date(item.lastScanned).toLocaleDateString(undefined, {
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="px-3 sm:px-4 pt-3 pb-1 text-xs sm:text-sm text-blue-600 font-medium">
            {t('showing')} {filteredInventory.length} {t('of')} {inventory.length} {t('items')}
          </p>
        </CardContent>
      </Card>
    )
  }

  function renderOverallTable() {
    return (
      <Card>
        <CardHeader className="px-3 sm:px-6">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50">
                <Package className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <CardTitle className="text-base sm:text-lg">{t('overallStockTitle')}</CardTitle>
                <CardDescription className="text-xs sm:text-sm">{t('overallStockDesc')}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-600">
              <Filter className="h-3 w-3" />
              {t('filteredByAllUsers')}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {filteredStock.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground px-3">
              {stockItems.length === 0 ? t('noInventoryYet') : t('noSearchResults')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('artNumberCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('colorCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('sizeCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell">{t('divisionCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell text-right">{t('mrpCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('mfgCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 text-right">{t('totalQuantityCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 text-right hidden sm:table-cell">{t('totalScansCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('lastUpdatedCol')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStock.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs sm:text-sm font-semibold px-3 sm:px-4">
                        {item.artNumber || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm px-3 sm:px-4">
                        {item.colorNumber || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm px-3 sm:px-4">
                        {item.sizeNumber || '-'}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell">
                        {item.division || '-'}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell text-right">
                        {item.mrp != null ? `₹${item.mrp.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">
                        {item.mfgMonth && item.mfgYear
                          ? `${String(item.mfgMonth).padStart(2, '0')}/${item.mfgYear}`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right px-3 sm:px-4">
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          {item.totalQuantity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs sm:text-sm text-muted-foreground px-3 sm:px-4 hidden sm:table-cell">
                        {item.totalScans}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm text-muted-foreground px-3 sm:px-4 hidden md:table-cell">
                        {new Date(item.lastUpdated).toLocaleDateString(undefined, {
                          year: 'numeric', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="px-3 sm:px-4 pt-3 pb-1 text-xs sm:text-sm text-blue-600 font-medium">
            {t('showing')} {filteredStock.length} {t('of')} {stockItems.length} {t('items')}
          </p>
        </CardContent>
      </Card>
    )
  }

  // ─── Layout ──────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">

        {/* Header */}
        <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('dashboard')}</h1>
            <p className="text-sm text-muted-foreground">{t('dashboardSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 justify-end">
            <LanguageToggle />
            <Button variant="outline" size="sm" onClick={() => router.push('/scanner')}>
              {t('scanner')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              {t('signOut')}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as Tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="scanned">{t('scannedInventoryTab')}</TabsTrigger>
            <TabsTrigger value="overall">{t('overallStockTab')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Error */}
        {error && (
          <div className="rounded-md bg-destructive/15 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-4 text-sm text-muted-foreground">{t('loading')}</div>
        )}

        {/* KPI Cards */}
        {!loading && (activeTab === 'scanned' ? renderScannedKPIs() : renderOverallKPIs())}

        {/* Search + Export */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:flex-1 sm:max-w-sm">
            <Label htmlFor="search" className="sr-only">
              {t('searchPlaceholder')}
            </Label>
            <Input
              id="search"
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button className="w-full sm:w-auto" onClick={handleExport}>
              {t('exportToCSV')}
            </Button>
          </div>
        </div>

        {/* Table */}
        {!loading && (activeTab === 'scanned' ? renderScannedTable() : renderOverallTable())}

      </div>
    </main>
  )
}
