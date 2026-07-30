'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  getMyScans,
  getMyStatistics,
  getOverallStock,
  getOverallStatistics,
  addManualEntry,
  exportToExcel,
} from '@/app/actions/dashboard'
import { signOut } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────

interface MyScan {
  id: number
  artNumber: string | null
  colorNumber: string | null
  sizeNumber: string | null
  quantity: number
  scannedAt: Date
  userName: string | null
}

interface StockItem {
  artNumber: string | null
  colorNumber: string | null
  sizeNumber: string | null
  quantity: number
  lastScanned: Date
  lastScannedBy: string
  scanCount: number
}

interface Statistics {
  totalScans: number
  totalItems: number
  uniqueItems: number
  scansLast24h: number
}

// ── Stats bar (shared) ────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: Statistics }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
      {[
        { label: 'Total Scans', value: stats.totalScans, sub: `${stats.scansLast24h} in last 24h` },
        { label: 'Total Items', value: stats.totalItems, sub: 'units counted' },
        { label: 'Unique Items', value: stats.uniqueItems, sub: 'different SKUs' },
        {
          label: 'Avg Per Item',
          value: stats.uniqueItems > 0 ? (stats.totalItems / stats.uniqueItems).toFixed(1) : '0',
          sub: 'units per SKU',
        },
      ].map(({ label, value, sub }) => (
        <Card key={label} className="lg:block">
          <CardHeader className="p-2 pb-0 lg:pb-3 lg:pt-6 lg:px-6">
            <CardTitle className="text-[11px] leading-tight font-medium text-muted-foreground lg:text-sm">
              {label}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-1 lg:px-6 lg:pb-6">
            <div className="text-xl font-bold leading-none lg:text-3xl">{value}</div>
            <p className="text-[10px] text-muted-foreground mt-1 leading-tight lg:text-xs">{sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardPage({ userName }: { userName: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<'mine' | 'overall'>('mine')

  // My Scans state
  const [myScans, setMyScans] = useState<MyScan[]>([])
  const [myStats, setMyStats] = useState<Statistics | null>(null)
  const [mySearch, setMySearch] = useState('')

  // Overall state
  const [stock, setStock] = useState<StockItem[]>([])
  const [overallStats, setOverallStats] = useState<Statistics | null>(null)
  const [overallSearch, setOverallSearch] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Manual entry form
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ artNumber: '', colorNumber: '', sizeNumber: '', quantity: 1, notes: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [scansData, statsData, stockData, overallStatsData] = await Promise.all([
        getMyScans(),
        getMyStatistics(),
        getOverallStock(),
        getOverallStatistics(),
      ])
      setMyScans(scansData as MyScan[])
      setMyStats(statsData)
      setStock(stockData as StockItem[])
      setOverallStats(overallStatsData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await addManualEntry(form.artNumber, form.colorNumber, form.sizeNumber, form.quantity, form.notes)
      setForm({ artNumber: '', colorNumber: '', sizeNumber: '', quantity: 1, notes: '' })
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add entry')
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export')
    }
  }

  async function handleLogout() {
    await signOut()
    router.push('/sign-in')
  }

  // Filtered data
  const filteredMyScans = mySearch
    ? myScans.filter(
        (s) =>
          s.artNumber?.toLowerCase().includes(mySearch.toLowerCase()) ||
          s.colorNumber?.toLowerCase().includes(mySearch.toLowerCase()) ||
          s.sizeNumber?.toLowerCase().includes(mySearch.toLowerCase())
      )
    : myScans

  const filteredStock = overallSearch
    ? stock.filter(
        (s) =>
          s.artNumber?.toLowerCase().includes(overallSearch.toLowerCase()) ||
          s.colorNumber?.toLowerCase().includes(overallSearch.toLowerCase()) ||
          s.sizeNumber?.toLowerCase().includes(overallSearch.toLowerCase()) ||
          s.lastScannedBy.toLowerCase().includes(overallSearch.toLowerCase())
      )
    : stock

  return (
    <main className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-7xl space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{userName}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/scanner')}>
              Scanner
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Sign Out
            </Button>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 rounded-lg border p-1 w-fit bg-muted">
          <button
            onClick={() => setTab('mine')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'mine'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            My Scans
          </button>
          <button
            onClick={() => setTab('overall')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'overall'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Overall Stock
          </button>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/15 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {/* ── MY SCANS TAB ─────────────────────────────────────────────────── */}
        {tab === 'mine' && (
          <>
            {myStats && <StatsBar stats={myStats} />}

            {/* Actions row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Input
                placeholder="Search by art, color, or size…"
                value={mySearch}
                onChange={(e) => setMySearch(e.target.value)}
                className="max-w-xs"
              />
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
                  {showForm ? 'Cancel' : 'Add Entry'}
                </Button>
                <Button size="sm" onClick={handleExport}>Export CSV</Button>
              </div>
            </div>

            {/* Manual entry form */}
            {showForm && (
              <Card>
                <CardHeader><CardTitle className="text-base">Add Manual Entry</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={handleAddEntry} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {(['artNumber', 'colorNumber', 'sizeNumber'] as const).map((field) => (
                        <div key={field} className="space-y-1">
                          <Label htmlFor={field} className="text-xs capitalize">
                            {field.replace('Number', ' No.')}
                          </Label>
                          <Input
                            id={field}
                            placeholder={field === 'artNumber' ? '12345' : field === 'colorNumber' ? '01' : '40'}
                            value={form[field]}
                            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                            required
                          />
                        </div>
                      ))}
                      <div className="space-y-1">
                        <Label htmlFor="quantity" className="text-xs">Qty</Label>
                        <Input
                          id="quantity"
                          type="number"
                          min="1"
                          value={form.quantity}
                          onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="notes" className="text-xs">Notes (optional)</Label>
                      <Input
                        id="notes"
                        placeholder="Any notes…"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm">Add</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* My scans table */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">My Scan Log</CardTitle>
                <CardDescription>
                  {filteredMyScans.length} of {myScans.length} entries — scanned by {userName}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {filteredMyScans.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    {myScans.length === 0
                      ? 'No scans yet. Head to the Scanner to start.'
                      : 'No entries match your search.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Art No.</TableHead>
                          <TableHead>Color</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead>Scanned By</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMyScans.map((scan) => (
                          <TableRow key={scan.id}>
                            <TableCell className="font-mono text-sm font-semibold">{scan.artNumber || '—'}</TableCell>
                            <TableCell className="font-mono text-sm">{scan.colorNumber || '—'}</TableCell>
                            <TableCell className="font-mono text-sm">{scan.sizeNumber || '—'}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="secondary">{scan.quantity}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {scan.userName ?? userName}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {new Date(scan.scannedAt).toLocaleDateString()}{' '}
                              <span className="text-xs opacity-60">
                                {new Date(scan.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ── OVERALL STOCK TAB ─────────────────────────────────────────────── */}
        {tab === 'overall' && (
          <>
            {overallStats && <StatsBar stats={overallStats} />}

            {/* Search */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Input
                placeholder="Search by art, color, size, or person…"
                value={overallSearch}
                onChange={(e) => setOverallSearch(e.target.value)}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                Aggregated across all users · {filteredStock.length} SKUs
              </p>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Overall Stock</CardTitle>
                <CardDescription>
                  All scanned inventory consolidated by SKU, showing who last updated each item
                </CardDescription>
              </CardHeader>
              <CardContent>
                {filteredStock.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    {stock.length === 0
                      ? 'No inventory yet. Start scanning items.'
                      : 'No items match your search.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Art No.</TableHead>
                          <TableHead>Color</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead className="text-right">Total Qty</TableHead>
                          <TableHead className="text-right">Scans</TableHead>
                          <TableHead>Last Updated By</TableHead>
                          <TableHead>Last Scan</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredStock.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm font-semibold">{item.artNumber || '—'}</TableCell>
                            <TableCell className="font-mono text-sm">{item.colorNumber || '—'}</TableCell>
                            <TableCell className="font-mono text-sm">{item.sizeNumber || '—'}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="secondary">{item.quantity}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {item.scanCount}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {item.lastScannedBy}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {new Date(item.lastScanned).toLocaleDateString()}{' '}
                              <span className="text-xs opacity-60">
                                {new Date(item.lastScanned).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {loading && (
          <div className="text-center py-4 text-sm text-muted-foreground">Loading…</div>
        )}
      </div>
    </main>
  )
}
