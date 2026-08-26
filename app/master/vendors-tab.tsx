'use client'

import { useState, useMemo, useTransition, useRef } from 'react'
import { saveVendor, importVendors } from '@/app/actions/vendors'
import type { Vendor } from '@/app/actions/vendors'

export type { Vendor }

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
type Day = typeof DAYS[number]

// ── CSV parser ────────────────────────────────────────────────────────────────
// Expected columns (case-insensitive, order flexible):
// partyName, partyOwner, phone, address, city, area, day, salesman, status
function parseCsv(text: string): Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''))
  const idx = (name: string) => headers.indexOf(name.toLowerCase())

  return lines.slice(1).flatMap(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const get = (name: string) => cols[idx(name)] ?? ''
    const partyName = get('partyname') || get('party')
    if (!partyName) return []
    const status = (get('status') || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active'
    return [{
      partyName,
      partyOwner: get('partyowner') || get('owner') || '',
      phone:      get('phone') || '',
      address:    get('address') || '',
      city:       get('city') || '',
      area:       get('area') || '',
      day:        get('day') || '',
      salesman:   get('salesman') || '',
      status,
    }] as Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>[]
  })
}

type VendorForm = {
  partyName: string
  partyOwner: string
  phone: string
  address: string
  city: string
  area: string
  day: Day | ''
  salesman: string
  status: 'active' | 'inactive'
}

const EMPTY_FORM: VendorForm = {
  partyName: '',
  partyOwner: '',
  phone: '',
  address: '',
  city: '',
  area: '',
  day: '',
  salesman: '',
  status: 'active',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
      status === 'active'
        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    }`}>
      {status === 'active' ? 'Active' : 'Inactive'}
    </span>
  )
}

function DayPill({ day }: { day: string }) {
  if (!day) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
      {day.slice(0, 3)}
    </span>
  )
}

interface Props {
  initialVendors: Vendor[]
  onListChange?: (list: Vendor[]) => void
}

export function VendorsTab({ initialVendors, onListChange }: Props) {
  const [vendors, setVendors] = useState<Vendor[]>(initialVendors)

  function updateVendors(next: Vendor[]) {
    setVendors(next)
    onListChange?.(next)
  }

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')

  // ── Modal state ──
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [editTarget, setEditTarget] = useState<Vendor | null>(null)
  const [form, setForm] = useState<VendorForm>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [isSaving, startSave] = useTransition()

  // ── CSV import state ──
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [isImporting, startImport] = useTransition()
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!e.target.files) return
    e.target.value = ''          // reset so same file can be re-selected
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseCsv(text)
      if (rows.length === 0) {
        setImportMsg({ type: 'err', text: 'No valid rows found in CSV.' })
        return
      }
      startImport(async () => {
        try {
          const { imported, skipped, list } = await importVendors(rows)
          updateVendors(list)
          const msg = imported === 0
            ? `All ${skipped} row${skipped !== 1 ? 's' : ''} already exist — nothing imported.`
            : skipped > 0
              ? `Imported ${imported} vendor${imported !== 1 ? 's' : ''}. Skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}.`
              : `Imported ${imported} vendor${imported !== 1 ? 's' : ''}.`
          setImportMsg({ type: imported === 0 ? 'err' : 'ok', text: msg })
          setTimeout(() => setImportMsg(null), 4000)
        } catch {
          setImportMsg({ type: 'err', text: 'Import failed. Please try again.' })
        }
      })
    }
    reader.readAsText(file)
  }

  const filtered = useMemo(() => {
    let list = vendors
    if (filterStatus !== 'all') list = list.filter(v => v.status === filterStatus)
    if (search) list = list.filter(v =>
      v.partyName.toLowerCase().includes(search.toLowerCase()) ||
      v.partyOwner.toLowerCase().includes(search.toLowerCase()) ||
      v.city.toLowerCase().includes(search.toLowerCase()) ||
      v.area.toLowerCase().includes(search.toLowerCase()) ||
      v.salesman.toLowerCase().includes(search.toLowerCase())
    )
    return list
  }, [vendors, search, filterStatus])

  function openAdd() {
    setForm(EMPTY_FORM)
    setFormError('')
    setEditTarget(null)
    setModalMode('add')
  }

  function openEdit(v: Vendor) {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = v
    setForm(rest as VendorForm)
    setFormError('')
    setEditTarget(v)
    setModalMode('edit')
  }

  function handleSave() {
    if (!form.partyName.trim()) { setFormError('Party name is required.'); return }
    if (!form.phone.trim()) { setFormError('Phone is required.'); return }
    setFormError('')
    // For add: omit id so the server generates it. For edit: pass the existing id.
    const payload = modalMode === 'edit' && editTarget
      ? { ...form, id: editTarget.id }
      : { ...form }
    startSave(async () => {
      const updated = await saveVendor(payload)
      updateVendors(updated)
      setModalMode(null)
    })
  }

  const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div>
      {/* ── Hidden CSV file input ── */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleCsvFile}
      />

      {/* ── Toolbar ── */}
      {/* Row 1: search (full width on mobile) */}
      <div className="mb-2">
        <input
          type="search"
          placeholder="Search vendors…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {/* Row 2: filter + actions */}
      <div className="flex items-center gap-2 mb-4">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
          className="rounded-lg border border-border bg-background px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {/* Import CSV */}
        <button
          onClick={() => csvInputRef.current?.click()}
          disabled={isImporting}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          {isImporting ? 'Importing…' : '↑ Import CSV'}
        </button>
        <button
          onClick={openAdd}
          className="ml-auto rounded-lg bg-foreground text-background px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          + Add Vendor
        </button>
      </div>

      {/* Import feedback */}
      {importMsg && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${
          importMsg.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400'
            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400'
        }`}>
          {importMsg.text}
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-center py-10 text-sm text-muted-foreground">No vendors found</p>
      )}

      {/* ── Mobile: card list ── */}
      <div className="sm:hidden space-y-3">
        {filtered.map(v => (
          <div key={v.id} className="rounded-2xl border border-border bg-card overflow-hidden">
            {/* Card header */}
            <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
              <div className="min-w-0">
                <p className="font-semibold text-base text-foreground truncate">{v.partyName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground font-mono">{v.id}</span>
                  {v.day && <DayPill day={v.day} />}
                </div>
              </div>
              <StatusBadge status={v.status} />
            </div>

            {/* Card body */}
            <div className="px-4 pb-3 space-y-2">
              {v.partyOwner && (
                <div className="flex items-center gap-2 text-sm">
                  {/* person icon */}
                  <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  <span className="text-foreground">{v.partyOwner}</span>
                </div>
              )}
              <a href={`tel:${v.phone}`} className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                {/* phone icon */}
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                <span className="font-medium">{v.phone}</span>
              </a>
              {(v.address || v.city || v.area) && (
                <div className="flex items-start gap-2 text-sm">
                  {/* location icon */}
                  <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <span className="text-muted-foreground leading-snug">
                    {[v.address, v.area, v.city].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
              {v.salesman && (
                <div className="flex items-center gap-2 text-sm">
                  {/* tag icon */}
                  <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z" /></svg>
                  <span className="text-muted-foreground">{v.salesman}</span>
                </div>
              )}
            </div>

            {/* Card footer */}
            <div className="border-t border-border px-4 py-3">
              <button
                onClick={() => openEdit(v)}
                className="w-full rounded-xl border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted active:scale-95 transition-all"
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Desktop: table ── */}
      <div className="hidden sm:block rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left pl-4 pr-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap w-[58px]">ID</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Party Name</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Owner</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Phone</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Location</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Day</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Salesman</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Status</th>
                <th className="pr-4 pl-2 py-2.5 w-[56px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(v => (
                <tr key={v.id} className="hover:bg-muted/30 transition-colors">
                  <td className="pl-4 pr-2 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{v.id}</td>
                  <td className="px-2 py-3 max-w-[160px]">
                    <p className="font-medium text-foreground truncate text-sm" title={v.partyName}>{v.partyName}</p>
                  </td>
                  <td className="px-2 py-3 max-w-[120px]">
                    <p className="text-sm text-muted-foreground truncate" title={v.partyOwner || ''}>{v.partyOwner || '—'}</p>
                  </td>
                  <td className="px-2 py-3 text-xs text-muted-foreground whitespace-nowrap">{v.phone}</td>
                  <td className="px-2 py-3 max-w-[180px]">
                    <p className="text-xs text-foreground truncate" title={[v.address, v.area, v.city].filter(Boolean).join(', ')}>
                      {v.address || '—'}
                    </p>
                    {(v.area || v.city) && (
                      <p className="text-[11px] text-muted-foreground truncate">{[v.area, v.city].filter(Boolean).join(', ')}</p>
                    )}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap"><DayPill day={v.day} /></td>
                  <td className="px-2 py-3 max-w-[120px]">
                    <p className="text-sm text-muted-foreground truncate" title={v.salesman || ''}>{v.salesman || '—'}</p>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap"><StatusBadge status={v.status} /></td>
                  <td className="pr-4 pl-2 py-3">
                    <button onClick={() => openEdit(v)} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors whitespace-nowrap">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add / Edit Modal ── */}
      {/* On mobile: bottom sheet. On desktop: centered dialog. */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setModalMode(null)}
        >
          <div
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-border bg-background shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle (mobile only) */}
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="font-semibold text-base text-foreground">{modalMode === 'add' ? 'Add Vendor' : 'Edit Vendor'}</p>
              <button onClick={() => setModalMode(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto max-h-[65vh] sm:max-h-[70vh]">
              {formError && (
                <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{formError}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Party Name *</label>
                  <input value={form.partyName} onChange={e => setForm(f => ({ ...f, partyName: e.target.value }))} className={inputCls} placeholder="Party / shop name" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Party Owner</label>
                  <input value={form.partyOwner} onChange={e => setForm(f => ({ ...f, partyOwner: e.target.value }))} className={inputCls} placeholder="Owner name" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Phone *</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="+91 …" type="tel" inputMode="tel" />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Address</label>
                  <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={inputCls} placeholder="Street address" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">City</label>
                  <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className={inputCls} placeholder="City" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Area</label>
                  <input value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} className={inputCls} placeholder="Area / locality" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Day</label>
                  <select value={form.day} onChange={e => setForm(f => ({ ...f, day: e.target.value as Day | '' }))} className={inputCls}>
                    <option value="">— Select day —</option>
                    {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Salesman</label>
                  <input value={form.salesman} onChange={e => setForm(f => ({ ...f, salesman: e.target.value }))} className={inputCls} placeholder="Salesman name" />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as 'active' | 'inactive' }))} className={inputCls}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setModalMode(null)} disabled={isSaving} className="flex-1 rounded-xl border border-border px-3 py-3 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={isSaving} className="flex-1 rounded-xl bg-foreground text-background px-3 py-3 text-sm font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-60">
                {isSaving ? 'Saving…' : modalMode === 'add' ? 'Add Vendor' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
