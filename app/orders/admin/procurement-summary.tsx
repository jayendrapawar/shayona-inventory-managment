'use client'

import { useState, useTransition, useMemo } from 'react'
import { getProcurementSummary } from '@/app/actions/orders'
import type { ProcurementRow } from '@/app/actions/orders'

const ORDER_STATUSES = ['pending', 'assigned', 'packed', 'dispatched', 'delivered', 'cancelled']

interface GroupedArticle {
  artNumber: string
  colorNumber: string
  vendors: { vendorName: string; totalPairs: number; orderCount: number }[]
  grandTotal: number
}

function groupRows(rows: ProcurementRow[]): GroupedArticle[] {
  const map = new Map<string, GroupedArticle>()
  for (const row of rows) {
    const key = `${row.artNumber}||${row.colorNumber}`
    if (!map.has(key)) {
      map.set(key, { artNumber: row.artNumber, colorNumber: row.colorNumber, vendors: [], grandTotal: 0 })
    }
    const g = map.get(key)!
    g.vendors.push({ vendorName: row.vendorName, totalPairs: row.totalPairs, orderCount: row.orderCount })
    g.grandTotal += row.totalPairs
  }
  return Array.from(map.values())
}

interface Props {
  initialRows: ProcurementRow[]
}

export function ProcurementSummary({ initialRows }: Props) {
  const [rows, setRows]         = useState<ProcurementRow[]>(initialRows)
  const [isPending, startTrans] = useTransition()

  const [status,     setStatus]     = useState('pending')
  const [artFilter,  setArtFilter]  = useState('')
  const [colorFilter, setColorFilter] = useState('')

  // expandedKey = "artNumber||colorNumber" of the currently opened card
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  function refresh(newStatus: string, newArt: string, newColor: string) {
    startTrans(async () => {
      const data = await getProcurementSummary({
        status:      newStatus,
        artNumber:   newArt,
        colorNumber: newColor,
      })
      setRows(data)
    })
  }

  function handleStatusChange(s: string) {
    setStatus(s)
    refresh(s, artFilter, colorFilter)
  }

  function handleSearch() {
    refresh(status, artFilter, colorFilter)
  }

  const grouped = useMemo(() => groupRows(rows), [rows])
  const grandTotalPairs  = useMemo(() => rows.reduce((s, r) => s + r.totalPairs, 0), [rows])
  const uniqueVendors    = useMemo(() => new Set(rows.map(r => r.vendorName)).size, [rows])

  return (
    <div className="space-y-4">

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 items-end">
        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Status</label>
          <select
            value={status}
            onChange={e => handleStatusChange(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ORDER_STATUSES.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Article */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Article</label>
          <input
            type="text"
            value={artFilter}
            onChange={e => setArtFilter(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="e.g. A123"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

        {/* Color */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Color</label>
          <input
            type="text"
            value={colorFilter}
            onChange={e => setColorFilter(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="e.g. RED"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

        <button
          type="button"
          onClick={handleSearch}
          disabled={isPending}
          className="rounded-lg bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-40 self-end"
        >
          {isPending ? 'Loading…' : 'Apply'}
        </button>
      </div>

      {/* ── Summary badges ── */}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
            <span className="font-bold">{grouped.length}</span> article–colour combos
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
            <span className="font-bold">{uniqueVendors}</span> vendors
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950 px-3 py-1 text-xs font-bold text-blue-700 dark:text-blue-300">
            {grandTotalPairs} total pairs to procure
          </span>
        </div>
      )}

      {/* ── Results ── */}
      {isPending && (
        <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
      )}

      {!isPending && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card py-10 text-center">
          <p className="text-sm text-muted-foreground">No orders found for <strong>{status}</strong>{artFilter ? ` · article "${artFilter}"` : ''}{colorFilter ? ` · color "${colorFilter}"` : ''}.</p>
        </div>
      )}

      {!isPending && grouped.length > 0 && (
        <div className="space-y-2">
          {grouped.map(g => {
            const key = `${g.artNumber}||${g.colorNumber}`
            const open = expandedKey === key
            return (
              <div key={key} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Card header — click to expand */}
                <button
                  type="button"
                  onClick={() => setExpandedKey(open ? null : key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-foreground">{g.artNumber}</span>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">{g.colorNumber}</span>
                    <span className="text-xs text-muted-foreground">{g.vendors.length} vendor{g.vendors.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold text-foreground">{g.grandTotal} pairs</span>
                    <svg
                      className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Vendor breakdown */}
                {open && (
                  <div className="border-t border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Vendor / Shopkeeper</th>
                          <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Orders</th>
                          <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Pairs Required</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {g.vendors.map(v => (
                          <tr key={v.vendorName} className="hover:bg-muted/20">
                            <td className="px-4 py-2.5 font-medium text-xs">{v.vendorName}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground text-right">{v.orderCount}</td>
                            <td className="px-4 py-2.5 text-xs font-semibold text-right">{v.totalPairs}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-border bg-muted/20">
                        <tr>
                          <td colSpan={2} className="px-4 py-2 text-xs font-medium text-muted-foreground text-right">Total</td>
                          <td className="px-4 py-2 text-xs font-bold text-right">{g.grandTotal}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
