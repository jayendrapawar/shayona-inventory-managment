'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useOnline } from '@/lib/use-online'
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
  getLoggedInUserName,
  getScannedChartData,
  getOverallChartData,
} from '@/app/actions/dashboard'
import type {
  OverallStockItem,
  OverallStockStats,
  ScansOverTimePoint,
  DivisionBreakdownItem,
  TopSKUItem,
  EntryTypeItem,
  ScansByUserItem,
} from '@/app/actions/dashboard'
import { signOut } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'
import { QrCode, Package, Tag, BarChart3, Filter, TrendingUp, PieChart, User } from 'lucide-react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

type Tab = 'scanned' | 'overall'
type SubTab = 'data' | 'stats'

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

interface ScannedChartData {
  scansOverTime: ScansOverTimePoint[]
  divisionBreakdown: DivisionBreakdownItem[]
  topSKUs: TopSKUItem[]
  entryTypeBreakdown: EntryTypeItem[]
}

interface OverallChartData extends ScannedChartData {
  scansByUser: ScansByUserItem[]
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
      <CardContent className="flex items-center gap-2 sm:gap-4 px-2.5 py-2.5 sm:px-5 sm:py-4">
        <div className={`flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] sm:text-xs font-medium text-muted-foreground leading-tight truncate">{title}</p>
          <p className="text-xl sm:text-2xl lg:text-3xl font-bold leading-tight">{value}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Chart colour palette ────────────────────────────────────────────────────

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

// ─── Main Component ───────────────────────────────────────────────────────────

export function DashboardPage() {
  const router = useRouter()
  const { t } = useLanguage()

  const [activeTab, setActiveTab] = useState<Tab>('scanned')
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('data')
  const [loggedInUser, setLoggedInUser] = useState<string | null>(null)

  // Scanned Inventory state
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [filteredInventory, setFilteredInventory] = useState<InventoryItem[]>([])
  const [stats, setStats] = useState<Statistics | null>(null)

  // Overall Stock state
  const [stockItems, setStockItems] = useState<OverallStockItem[]>([])
  const [filteredStock, setFilteredStock] = useState<OverallStockItem[]>([])
  const [stockStats, setStockStats] = useState<OverallStockStats | null>(null)
  const [stockLoaded, setStockLoaded] = useState(false)

  // Chart data
  const [scannedChartData, setScannedChartData] = useState<ScannedChartData | null>(null)
  const [overallChartData, setOverallChartData] = useState<OverallChartData | null>(null)
  const [chartLoading, setChartLoading] = useState(false)

  // Shared
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOnline = useOnline()

  // Load user name + Scanned Inventory on mount
  useEffect(() => {
    getLoggedInUserName().then(setLoggedInUser).catch(() => {})
    loadScannedInventory()
  }, [])

  // Load Overall Stock when tab first switches to it
  useEffect(() => {
    if (activeTab === 'overall' && !stockLoaded) {
      loadOverallStock()
    }
  }, [activeTab])

  // Load chart data when sub-tab switches to 'stats'
  useEffect(() => {
    if (activeSubTab !== 'stats') return
    if (activeTab === 'scanned' && !scannedChartData) {
      loadScannedCharts()
    } else if (activeTab === 'overall' && !overallChartData) {
      loadOverallCharts()
    }
  }, [activeSubTab, activeTab])

  // Re-filter when tab or search changes
  useEffect(() => {
    applySearch(searchQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, inventory, stockItems])

  async function loadScannedInventory() {
    if (!navigator.onLine) { setLoading(false); return }
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
      if (navigator.onLine) {
        setError(err instanceof Error ? err.message : 'Failed to load scanned inventory')
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadOverallStock() {
    if (!navigator.onLine) { setLoading(false); return }
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
      if (navigator.onLine) {
        setError(err instanceof Error ? err.message : 'Failed to load overall stock')
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadScannedCharts() {
    if (!navigator.onLine) return
    try {
      setChartLoading(true)
      const data = await getScannedChartData()
      setScannedChartData(data)
    } catch {
      // non-critical
    } finally {
      setChartLoading(false)
    }
  }

  async function loadOverallCharts() {
    if (!navigator.onLine) return
    try {
      setChartLoading(true)
      const data = await getOverallChartData()
      setOverallChartData(data)
    } catch {
      // non-critical
    } finally {
      setChartLoading(false)
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
    setActiveSubTab('data')
    setSearchQuery('')
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
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('entryTypeCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('artNumberCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('colorCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('sizeCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell">{t('divisionCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell text-right">{t('mrpCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('mfgCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('scannedByCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 text-right">{t('totalQuantityCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 text-right hidden sm:table-cell">{t('totalScansCol')}</TableHead>
                    <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('lastUpdatedCol')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStock.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="px-3 sm:px-4">
                        <Badge variant={item.entryType === 'scan' ? 'default' : 'secondary'} className="text-xs">
                          {item.entryType}
                        </Badge>
                      </TableCell>
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

  // ── Shared chart sub-components ─────────────────────────────────────────────

  function ChartScansOverTime({ data }: { data: ScansOverTimePoint[] }) {
    if (!data.some((d) => d.scans > 0)) return null
    return (
      <Card>
        <CardHeader className="px-3 sm:px-6 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50">
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </div>
            <CardTitle className="text-sm sm:text-base">{t('scansOverTime')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-4 pb-4">
          <ResponsiveContainer width="100%" aspect={2.2} minHeight={180}>
            <LineChart data={data} margin={{ top: 5, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
              <Tooltip />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="scans" name={t('scansCount')} stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="quantity" name={t('quantityLabel')} stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    )
  }

  function ChartDivisionBreakdown({ data }: { data: DivisionBreakdownItem[] }) {
    if (!data.length) return null
    return (
      <Card>
        <CardHeader className="px-3 sm:px-6 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-50">
              <BarChart3 className="h-4 w-4 text-purple-600" />
            </div>
            <CardTitle className="text-sm sm:text-base">{t('divisionBreakdown')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-4 pb-4">
          <ResponsiveContainer width="100%" height={Math.max(140, data.length * 32)}>
            <BarChart layout="vertical" data={data} margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis dataKey="division" type="category" tick={{ fontSize: 10 }} width={64} />
              <Tooltip />
              <Bar dataKey="quantity" name={t('quantityLabel')} fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    )
  }

  function ChartEntryType({ data }: { data: EntryTypeItem[] }) {
    if (!data.length) return null
    return (
      <Card>
        <CardHeader className="px-3 sm:px-6 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-50">
              <PieChart className="h-4 w-4 text-orange-500" />
            </div>
            <CardTitle className="text-sm sm:text-base">{t('entryTypeBreakdown')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-center pb-4">
          <ResponsiveContainer width="100%" aspect={1.6} minHeight={160}>
            <RechartsPieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="type"
                cx="50%"
                cy="50%"
                outerRadius="38%"
                label={({ name, percent }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v, name) => [v, name]} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            </RechartsPieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    )
  }

  function ChartTopSKUs({ data }: { data: TopSKUItem[] }) {
    if (!data.length) return null
    return (
      <Card>
        <CardHeader className="px-3 sm:px-6 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50">
              <Tag className="h-4 w-4 text-green-600" />
            </div>
            <CardTitle className="text-sm sm:text-base">{t('topSKUs')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-4 pb-4">
          <ResponsiveContainer width="100%" height={Math.max(160, data.length * 32)}>
            <BarChart layout="vertical" data={data} margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis dataKey="sku" type="category" tick={{ fontSize: 10 }} width={90} />
              <Tooltip />
              <Bar dataKey="quantity" name={t('quantityLabel')} radius={[0, 4, 4, 0]}>
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    )
  }

  function ChartScansByUser({ data }: { data: ScansByUserItem[] }) {
    if (!data.length) return null
    return (
      <Card>
        <CardHeader className="px-3 sm:px-6 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50">
              <QrCode className="h-4 w-4 text-blue-600" />
            </div>
            <CardTitle className="text-sm sm:text-base">{t('scansByUser')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-4 pb-4">
          <ResponsiveContainer width="100%" height={Math.max(140, data.length * 40)}>
            <BarChart layout="vertical" data={data} margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis dataKey="user" type="category" tick={{ fontSize: 10 }} width={90} />
              <Tooltip />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="scans" name={t('scansCount')} fill="#3b82f6" radius={[0, 4, 4, 0]} />
              <Bar dataKey="quantity" name={t('quantityLabel')} fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    )
  }

  // ── Per-tab chart renderers ──────────────────────────────────────────────────

  function renderScannedCharts() {
    if (chartLoading) return <div className="text-center py-8 text-sm text-muted-foreground">{t('loading')}</div>
    if (!scannedChartData) return null

    const hasData =
      scannedChartData.scansOverTime.some((d) => d.scans > 0) ||
      scannedChartData.divisionBreakdown.length > 0 ||
      scannedChartData.topSKUs.length > 0 ||
      scannedChartData.entryTypeBreakdown.length > 0

    if (!hasData) return <div className="text-center py-12 text-sm text-muted-foreground">{t('noChartData')}</div>

    return (
      <div className="space-y-6">
        {/* Section label */}
        <div className="flex items-center gap-2 pb-1 border-b">
          <QrCode className="h-4 w-4 text-blue-600 shrink-0" />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t('myStatsTitle')}</h3>
        </div>

        <ChartScansOverTime data={scannedChartData.scansOverTime} />

        <div className="grid gap-6 md:grid-cols-2">
          <ChartDivisionBreakdown data={scannedChartData.divisionBreakdown} />
          <ChartEntryType data={scannedChartData.entryTypeBreakdown} />
        </div>

        <ChartTopSKUs data={scannedChartData.topSKUs} />
      </div>
    )
  }

  function renderOverallCharts() {
    if (chartLoading) return <div className="text-center py-8 text-sm text-muted-foreground">{t('loading')}</div>
    if (!overallChartData) return null

    const hasData =
      overallChartData.scansOverTime.some((d) => d.scans > 0) ||
      overallChartData.divisionBreakdown.length > 0 ||
      overallChartData.topSKUs.length > 0 ||
      overallChartData.entryTypeBreakdown.length > 0 ||
      overallChartData.scansByUser.length > 0

    if (!hasData) return <div className="text-center py-12 text-sm text-muted-foreground">{t('noChartData')}</div>

    return (
      <div className="space-y-6">
        {/* Section label */}
        <div className="flex items-center gap-2 pb-1 border-b">
          <Package className="h-4 w-4 text-green-600 shrink-0" />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t('warehouseStatsTitle')}</h3>
        </div>

        {/* Scans by user — prominent at top */}
        <ChartScansByUser data={overallChartData.scansByUser} />

        <ChartScansOverTime data={overallChartData.scansOverTime} />

        <div className="grid gap-6 md:grid-cols-2">
          <ChartDivisionBreakdown data={overallChartData.divisionBreakdown} />
          <ChartEntryType data={overallChartData.entryTypeBreakdown} />
        </div>

        <ChartTopSKUs data={overallChartData.topSKUs} />
      </div>
    )
  }

  // ─── Layout ──────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-3 sm:space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight truncate">{t('dashboard')}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground truncate">
              {activeTab === 'scanned' && loggedInUser
                ? `${t('scannedInventoryTab')} — ${loggedInUser}`
                : t('dashboardSubtitle')}
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <LanguageToggle />
            <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3" onClick={() => router.push('/scanner')}>
              {t('scanner')}
            </Button>
            <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3" onClick={handleLogout}>
              {t('signOut')}
            </Button>
          </div>
        </div>

        {/* Offline notice */}
        {!isOnline && (
          <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="h-4 w-4 shrink-0 mt-0.5">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
            <span>You are offline. Dashboard data requires an internet connection.</span>
          </div>
        )}

        {/* Main Tabs — Scanned Inventory / Overall Stock */}
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as Tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="scanned" className="flex items-center gap-1.5 text-xs sm:text-sm truncate">
              <User className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('scannedInventoryTab')}</span>
            </TabsTrigger>
            <TabsTrigger value="overall" className="text-xs sm:text-sm truncate">{t('overallStockTab')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Logged-in user context pill — only on Scanned Inventory tab */}
        {activeTab === 'scanned' && loggedInUser && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <User className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-blue-800 truncate">{loggedInUser}</p>
              <p className="text-[10px] text-blue-600 leading-tight">{t('filteredByCurrentUser')}</p>
            </div>
          </div>
        )}

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

        {/* Sub-tabs + Export on one line */}
        <div className="flex items-center gap-2">
          <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as SubTab)} className="flex-1">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="data" className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Package className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('inventoryItems')}</span>
              </TabsTrigger>
              <TabsTrigger value="stats" className="flex items-center gap-1.5 text-xs sm:text-sm">
                <BarChart3 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('statisticsTab')}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" className="shrink-0" onClick={handleExport}>
            {t('exportToCSV')}
          </Button>
        </div>

        {activeSubTab === 'data' && (
          <>
            {/* Search */}
            <div className="w-full">
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

            {/* Table */}
            {!loading && (activeTab === 'scanned' ? renderScannedTable() : renderOverallTable())}
          </>
        )}

        {activeSubTab === 'stats' && (
          <div className="space-y-4">
            {activeTab === 'scanned' ? renderScannedCharts() : renderOverallCharts()}
          </div>
        )}

      </div>
    </main>
  )
}
