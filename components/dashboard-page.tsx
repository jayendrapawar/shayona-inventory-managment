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
  addManualEntry,
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

  // Manual entry form state
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualForm, setManualForm] = useState({
    artNumber: '',
    colorNumber: '',
    sizeNumber: '',
    quantity: 1,
    notes: '',
  })

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

  async function handleAddManualEntry(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    try {
      await addManualEntry(
        manualForm.artNumber,
        manualForm.colorNumber,
        manualForm.sizeNumber,
        manualForm.quantity,
        manualForm.notes
      )

      setManualForm({
        artNumber: '',
        colorNumber: '',
        sizeNumber: '',
        quantity: 1,
        notes: '',
      })
      setShowManualForm(false)

      // Reload inventory
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add entry')
    }
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
    <main className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('dashboard')}</h1>
            <p className="text-muted-foreground">{t('dashboardSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <Button variant="outline" onClick={() => router.push('/scanner')}>
              {t('scanner')}
            </Button>
            <Button variant="outline" onClick={handleLogout}>
              {t('signOut')}
            </Button>
          </div>
        </div>

        {/* Statistics Cards */}
        {stats && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('totalScans')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalScans}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.scansLast24h} {t('inLast24h')}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('totalItems')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalItems}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('unitsCounted')}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('uniqueItems')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.uniqueItems}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('differentSKUs')}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('avgPerItem')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 max-w-sm">
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
            <Button variant="outline" onClick={() => setShowManualForm(!showManualForm)}>
              {showManualForm ? t('cancel') : t('addManualEntry')}
            </Button>
            <Button onClick={handleExport}>{t('exportToCSV')}</Button>
          </div>
        </div>

        {/* Manual Entry Form */}
        {showManualForm && (
          <Card>
            <CardHeader>
              <CardTitle>{t('addManualEntryTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddManualEntry} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="artNumber">{t('artNumber')}</Label>
                    <Input
                      id="artNumber"
                      placeholder={t('artNumberPlaceholder')}
                      value={manualForm.artNumber}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, artNumber: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="colorNumber">{t('colorNumber')}</Label>
                    <Input
                      id="colorNumber"
                      placeholder={t('colorNumberPlaceholder')}
                      value={manualForm.colorNumber}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, colorNumber: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sizeNumber">{t('sizeNumber')}</Label>
                    <Input
                      id="sizeNumber"
                      placeholder={t('sizeNumberPlaceholder')}
                      value={manualForm.sizeNumber}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, sizeNumber: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="quantity">{t('quantity')}</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min="1"
                      value={manualForm.quantity}
                      onChange={(e) =>
                        setManualForm({
                          ...manualForm,
                          quantity: parseInt(e.target.value) || 1,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="notes">{t('notes')}</Label>
                    <Input
                      id="notes"
                      placeholder={t('notesPlaceholder')}
                      value={manualForm.notes}
                      onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button type="submit">{t('addEntry')}</Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowManualForm(false)}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Inventory Table */}
        <Card>
          <CardHeader>
            <CardTitle>{t('inventoryItems')}</CardTitle>
            <CardDescription>
              {t('showing')} {filteredInventory.length} {t('of')} {inventory.length} {t('items')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredInventory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {inventory.length === 0 ? t('noInventoryYet') : t('noSearchResults')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('artNumberCol')}</TableHead>
                      <TableHead>{t('colorCol')}</TableHead>
                      <TableHead>{t('sizeCol')}</TableHead>
                      <TableHead className="text-right">{t('quantityCol')}</TableHead>
                      <TableHead className="text-right">{t('scansCol')}</TableHead>
                      <TableHead>{t('lastScannedCol')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInventory.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-sm font-semibold">
                          {item.artNumber || '-'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {item.colorNumber || '-'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {item.sizeNumber || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{item.quantity}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {item.count}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
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
