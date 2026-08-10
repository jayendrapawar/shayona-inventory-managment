'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, Filter, Package, PieChart, QrCode, Tag, TrendingUp, User } from 'lucide-react'
import {
  exportOverallStockToCSV,
  exportToExcel,
  getInventorySummary,
  getLoggedInUserName,
  getOverallChartData,
  getOverallStockStats,
  getOverallStockSummary,
  getScannedChartData,
  getStatistics,
} from '@/app/actions/dashboard'
import { LanguageToggle } from '@/components/language-toggle'
import { CHART_COLORS, DRILLDOWN_EMPTY_LABEL } from '@/components/dashboard/constants'
import type {
  DivisionBreakdownItem,
  EntryTypeItem,
  InventoryItem,
  OverallChartData,
  OverallStockItem,
  OverallStockStats,
  ScannedChartData,
  ScansByUserItem,
  ScansOverTimePoint,
  Statistics,
  SubTab,
  Tab,
  TopSKUItem,
} from '@/components/dashboard/types'
import { EmptyState, FilterBadge, KpiCard, OfflineBanner, SectionLabel, UserPill } from '@/components/dashboard/ui'
import { downloadCSV } from '@/components/dashboard/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { signOut } from '@/lib/auth-client'
import { useLanguage } from '@/lib/language-context'
import { useOnline } from '@/lib/use-online'
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

export function DashboardPage() {
  const router = useRouter()
  const { t } = useLanguage()

  const [activeTab, setActiveTab] = useState<Tab>('scanned')
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('data')
  const [loggedInUser, setLoggedInUser] = useState<string | null>(null)

  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [filteredInventory, setFilteredInventory] = useState<InventoryItem[]>([])
  const [stats, setStats] = useState<Statistics | null>(null)

  const [stockItems, setStockItems] = useState<OverallStockItem[]>([])
  const [filteredStock, setFilteredStock] = useState<OverallStockItem[]>([])
  const [stockStats, setStockStats] = useState<OverallStockStats | null>(null)
  const [stockLoaded, setStockLoaded] = useState(false)

  const [scannedChartData, setScannedChartData] = useState<ScannedChartData | null>(null)
  const [overallChartData, setOverallChartData] = useState<OverallChartData | null>(null)
  const [chartLoading, setChartLoading] = useState(false)

  const [drillArt, setDrillArt] = useState<string | null>(null)
  const [drillColor, setDrillColor] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOnline = useOnline()

  useEffect(() => {
    getLoggedInUserName().then(setLoggedInUser).catch(() => {})
    loadScannedInventory()
  }, [])

  useEffect(() => {
    if (activeTab === 'overall' && !stockLoaded) {
      loadOverallStock()
    }
  }, [activeTab, stockLoaded])

  // Load chart data when sub-tab switches to 'stats'
  useEffect(() => {
    if (activeSubTab !== 'stats') return
    if (activeTab === 'scanned' && !scannedChartData) {
      loadScannedCharts()
    } else if (activeTab === 'overall' && !overallChartData) {
      loadOverallCharts()
    }
  }, [activeSubTab, activeTab, overallChartData, scannedChartData])

  const applySearch = useCallback((query: string) => {
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
  }, [activeTab, inventory, stockItems])

  useEffect(() => {
    applySearch(searchQuery)
  }, [applySearch, searchQuery])

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
    } finally {
      setChartLoading(false)
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
            <FilterBadge icon={<Filter className="h-3 w-3" />} className="bg-blue-50 text-blue-600">
              {t('filteredByCurrentUser')}
            </FilterBadge>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {filteredInventory.length === 0 ? (
            <EmptyState>
              {inventory.length === 0 ? t('noInventoryYet') : t('noSearchResults')}
            </EmptyState>
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
            <FilterBadge icon={<Filter className="h-3 w-3" />} className="bg-green-50 text-green-600">
              {t('filteredByAllUsers')}
            </FilterBadge>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {filteredStock.length === 0 ? (
            <EmptyState>
              {stockItems.length === 0 ? t('noInventoryYet') : t('noSearchResults')}
            </EmptyState>
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

  function ChartArticleDrillDown() {
    if (!inventory.length) return null

    const artMap: Record<string, number> = {}
    for (const item of inventory) {
      const art = item.artNumber || DRILLDOWN_EMPTY_LABEL
      artMap[art] = (artMap[art] ?? 0) + item.quantity
    }
    const artData = Object.entries(artMap)
      .map(([art, qty]) => ({ name: art, qty }))
      .sort((a, b) => b.qty - a.qty)

    const colorData: { name: string; qty: number }[] = []
    if (drillArt) {
      const colorMap: Record<string, number> = {}
      for (const item of inventory) {
        if ((item.artNumber || DRILLDOWN_EMPTY_LABEL) !== drillArt) continue
        const color = item.colorNumber || DRILLDOWN_EMPTY_LABEL
        colorMap[color] = (colorMap[color] ?? 0) + item.quantity
      }
      Object.entries(colorMap)
        .sort((a, b) => b[1] - a[1])
        .forEach(([color, qty]) => colorData.push({ name: color, qty }))
    }

    const sizeData: { name: string; qty: number }[] = []
    if (drillArt && drillColor) {
      const sizeMap: Record<string, number> = {}
      for (const item of inventory) {
        if ((item.artNumber || DRILLDOWN_EMPTY_LABEL) !== drillArt) continue
        if ((item.colorNumber || DRILLDOWN_EMPTY_LABEL) !== drillColor) continue
        const size = item.sizeNumber || DRILLDOWN_EMPTY_LABEL
        sizeMap[size] = (sizeMap[size] ?? 0) + item.quantity
      }
      Object.entries(sizeMap)
        .sort((a, b) => {
          const na = parseFloat(a[0]), nb = parseFloat(b[0])
          return isNaN(na) || isNaN(nb) ? a[0].localeCompare(b[0]) : na - nb
        })
        .forEach(([size, qty]) => sizeData.push({ name: size, qty }))
    }

    const chartData  = drillArt && drillColor ? sizeData : drillArt ? colorData : artData
    const titleText  = drillArt && drillColor
      ? `${drillArt} › ${drillColor} — Size breakdown`
      : drillArt
      ? `${drillArt} — Color breakdown`
      : 'Items per Article'
    const xLabel     = drillArt && drillColor ? 'Size' : drillArt ? 'Color' : 'Article'

    const barHeight  = Math.max(180, chartData.length * 36)

    return (
      <Card>
        <CardHeader className="px-3 sm:px-6 pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50">
                <BarChart3 className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-sm sm:text-base">{titleText}</CardTitle>
                {drillArt && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {drillArt && drillColor ? 'Click a bar to go deeper · ' : 'Click a bar to see sizes · '}
                    tap breadcrumb to go back
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs flex-wrap">
              <button
                className="text-blue-600 hover:underline font-medium"
                onClick={() => { setDrillArt(null); setDrillColor(null) }}
              >
                All Articles
              </button>
              {drillArt && (
                <>
                  <span className="text-muted-foreground">›</span>
                  <button
                    className={`hover:underline font-medium ${drillColor ? 'text-blue-600' : 'text-foreground'}`}
                    onClick={() => setDrillColor(null)}
                  >
                    {drillArt}
                  </button>
                </>
              )}
              {drillColor && (
                <>
                  <span className="text-muted-foreground">›</span>
                  <span className="font-medium text-foreground">{drillColor}</span>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-4 pb-4">
          {chartData.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={barHeight}>
              <BarChart
                layout="vertical"
                data={chartData}
                margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
                onClick={(e) => {
                  const ev = e as unknown as { activePayload?: { payload: { name: string } }[] }
                  if (!ev?.activePayload?.length) return
                  const clicked = ev.activePayload[0].payload.name
                  if (!drillArt) {
                    setDrillArt(clicked)
                    setDrillColor(null)
                  } else if (!drillColor) {
                    setDrillColor(clicked)
                  }
                }}
                style={{ cursor: drillArt && drillColor ? 'default' : 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} label={{ value: xLabel, angle: -90, position: 'insideLeft', offset: -2, style: { fontSize: 9, fill: '#9ca3af' } }} />
                <Tooltip formatter={(v) => [v, 'Qty']} />
                <Bar dataKey="qty" name="Qty" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {!drillArt && (
            <p className="px-3 pt-2 text-[11px] text-muted-foreground">Tap a bar to drill into color breakdown</p>
          )}
          {drillArt && !drillColor && (
            <p className="px-3 pt-2 text-[11px] text-muted-foreground">Tap a bar to drill into size breakdown</p>
          )}
        </CardContent>
      </Card>
    )
  }

  function renderScannedCharts() {
    const drillSection = (
      <div className="space-y-6">
        <SectionLabel icon={<QrCode className="h-4 w-4 shrink-0 text-blue-600" />} title={t('myStatsTitle')} />
        <ChartArticleDrillDown />
      </div>
    )

    if (chartLoading) return <div className="space-y-6">{drillSection}<div className="text-center py-8 text-sm text-muted-foreground">{t('loading')}</div></div>
    if (!scannedChartData) return drillSection

    const hasOtherData =
      scannedChartData.scansOverTime.some((d) => d.scans > 0) ||
      scannedChartData.divisionBreakdown.length > 0 ||
      scannedChartData.topSKUs.length > 0 ||
      scannedChartData.entryTypeBreakdown.length > 0

    return (
      <div className="space-y-6">
        <SectionLabel icon={<QrCode className="h-4 w-4 shrink-0 text-blue-600" />} title={t('myStatsTitle')} />

        <ChartArticleDrillDown />

        {hasOtherData && (
          <>
            <ChartScansOverTime data={scannedChartData.scansOverTime} />
            <div className="grid gap-6 md:grid-cols-2">
              <ChartDivisionBreakdown data={scannedChartData.divisionBreakdown} />
              <ChartEntryType data={scannedChartData.entryTypeBreakdown} />
            </div>
            <ChartTopSKUs data={scannedChartData.topSKUs} />
          </>
        )}
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
        <SectionLabel icon={<Package className="h-4 w-4 shrink-0 text-green-600" />} title={t('warehouseStatsTitle')} />

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

  return (
    <main className="min-h-screen bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-3 sm:space-y-5">

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">{t('dashboard')}</h1>
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
          {loggedInUser && <UserPill icon={<User className="h-2.5 w-2.5" />} name={loggedInUser} />}
        </div>

        {!isOnline && (
          <OfflineBanner>You are offline. Dashboard data requires an internet connection.</OfflineBanner>
        )}

        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as Tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="scanned" className="flex items-center gap-1.5 text-xs sm:text-sm truncate">
              <User className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('scannedInventoryTab')}</span>
            </TabsTrigger>
            <TabsTrigger value="overall" className="text-xs sm:text-sm truncate">{t('overallStockTab')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {error && (
          <div className="rounded-md bg-destructive/15 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-4 text-sm text-muted-foreground">{t('loading')}</div>
        )}

        {!loading && (activeTab === 'scanned' ? renderScannedKPIs() : renderOverallKPIs())}

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
