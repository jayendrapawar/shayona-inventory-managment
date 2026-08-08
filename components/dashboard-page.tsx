'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  searchInventory,
  getInventorySummary,
  getStatistics,
  exportToExcel,
} from '@/app/actions/dashboard'
import { signOut } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'

interface InventoryItem {
  artNumber?: string
  colorNumber?: string
  sizeNumber?: string
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

export function DashboardPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [filteredInventory, setFilteredInventory] = useState<InventoryItem[]>([])
  const [stats, setStats] = useState<Statistics | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
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
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(query: string) {
    setSearchQuery(query)

    if (!query.trim()) {
      setFilteredInventory(inventory)
      return
    }

    // Filter locally for instant search
    const filtered = inventory.filter(
      (item) =>
        item.artNumber?.toLowerCase().includes(query.toLowerCase()) ||
        item.colorNumber?.toLowerCase().includes(query.toLowerCase()) ||
        item.sizeNumber?.toLowerCase().includes(query.toLowerCase())
    )

    setFilteredInventory(filtered)
  }

  async function handleExport() {
    try {
      const data = await exportToExcel()
      const csv = [
        Object.keys(data[0]).join(','),
        ...data.map((row) => Object.values(row).map((v) => `"${v}"`).join(',')),
      ].join('\n')

      const blob = new Blob([csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inventory-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export data')
    }
  }

  async function handleLogout() {
    await signOut()
    router.push('/sign-in')
  }

  return (
    <main className="min-h-screen bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('dashboard')}</h1>
            <p className="text-sm text-muted-foreground">{t('dashboardSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LanguageToggle />
            <Button variant="outline" size="sm" onClick={() => router.push('/scanner')}>
              {t('scanner')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              {t('signOut')}
            </Button>
          </div>
        </div>

        {/* Statistics Cards — 2×2 on mobile, 4 across on lg */}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2 pt-3 px-3 sm:px-6 sm:pt-6 sm:pb-3">
                <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                  {t('totalScans')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
                <div className="text-2xl sm:text-3xl font-bold">{stats.totalScans}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.scansLast24h} {t('inLast24h')}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-3 px-3 sm:px-6 sm:pt-6 sm:pb-3">
                <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                  {t('totalItems')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
                <div className="text-2xl sm:text-3xl font-bold">{stats.totalItems}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('unitsCounted')}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-3 px-3 sm:px-6 sm:pt-6 sm:pb-3">
                <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                  {t('uniqueItems')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
                <div className="text-2xl sm:text-3xl font-bold">{stats.uniqueItems}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('differentSKUs')}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-3 px-3 sm:px-6 sm:pt-6 sm:pb-3">
                <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                  {t('avgPerItem')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
                <div className="text-2xl sm:text-3xl font-bold">
                  {stats.uniqueItems > 0
                    ? (stats.totalItems / stats.uniqueItems).toFixed(1)
                    : '0'}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t('unitsPerSKU')}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="rounded-md bg-destructive/15 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Actions */}
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
            <Button className="w-full sm:w-auto" onClick={handleExport}>{t('exportToCSV')}</Button>
          </div>
        </div>

        {/* Inventory Table */}
        <Card>
          <CardHeader className="px-3 sm:px-6">
            <CardTitle className="text-base sm:text-lg">{t('inventoryItems')}</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {t('showing')} {filteredInventory.length} {t('of')} {inventory.length} {t('items')}
            </CardDescription>
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
                        <TableCell className="text-right px-3 sm:px-4">
                          <Badge variant="secondary">{item.quantity}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs sm:text-sm text-muted-foreground px-3 sm:px-4 hidden sm:table-cell">
                          {item.count}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm text-muted-foreground px-3 sm:px-4 hidden md:table-cell">
                          {new Date(item.lastScanned).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
