'use client'

import { useState, useMemo } from 'react'
import { fuzzyFilter } from '@/lib/fuzzy'

export interface Supplier {
  id: string
  name: string
  contactPerson: string
  phone: string
  email: string
  city: string
  supplyCategory: string
  paymentTerms: string
  status: 'active' | 'inactive'
}

const EMPTY_FORM: Omit<Supplier, 'id'> = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  city: '',
  supplyCategory: '',
  paymentTerms: '',
  status: 'active',
}

function genId(existing: Supplier[]): string {
  const nums = existing.map(s => parseInt(s.id.replace('S', ''), 10)).filter(n => !isNaN(n))
  const next = nums.length ? Math.max(...nums) + 1 : 1
  return `S${String(next).padStart(3, '0')}`
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

interface Props {
  initialSuppliers: Supplier[]
  onListChange?: (list: Supplier[]) => void
}

export function SuppliersTab({ initialSuppliers, onListChange }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)

  function updateSuppliers(next: Supplier[]) {
    setSuppliers(next)
    onListChange?.(next)
  }
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')

  // ── Modal state ──
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [editTarget, setEditTarget] = useState<Supplier | null>(null)
  const [form, setForm] = useState<Omit<Supplier, 'id'>>(EMPTY_FORM)
  const [formError, setFormError] = useState('')

  // ── Copy JSON state ──
  const [copied, setCopied] = useState(false)

  const filtered = useMemo(() => {
    let list = suppliers
    if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus)
    return fuzzyFilter(list, search, s => [s.name, s.contactPerson, s.city, s.supplyCategory])
  }, [suppliers, search, filterStatus])

  function openAdd() {
    setForm(EMPTY_FORM)
    setFormError('')
    setEditTarget(null)
    setModalMode('add')
  }

  function openEdit(s: Supplier) {
    const { id: _id, ...rest } = s
    setForm(rest)
    setFormError('')
    setEditTarget(s)
    setModalMode('edit')
  }

  function handleSave() {
    if (!form.name.trim()) { setFormError('Name is required.'); return }
    if (!form.contactPerson.trim()) { setFormError('Contact person is required.'); return }
    if (!form.phone.trim()) { setFormError('Phone is required.'); return }
    setFormError('')
    if (modalMode === 'add') {
      const newSupplier: Supplier = { id: genId(suppliers), ...form }
      updateSuppliers([...suppliers, newSupplier])
    } else if (modalMode === 'edit' && editTarget) {
      updateSuppliers(suppliers.map(s => s.id === editTarget.id ? { ...editTarget, ...form } : s))
    }
    setModalMode(null)
  }

  function handleCopyJson() {
    navigator.clipboard.writeText(JSON.stringify(suppliers, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          placeholder="Search suppliers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
          className="rounded-lg border border-border bg-background px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          onClick={handleCopyJson}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
        >
          {copied ? '✓ Copied!' : 'Copy JSON'}
        </button>
        <button
          onClick={openAdd}
          className="rounded-lg bg-foreground text-background px-3 py-2 text-xs font-semibold hover:opacity-90 transition-opacity"
        >
          + Add Supplier
        </button>
      </div>

      {filtered.length === 0 && (
        <p className="text-center py-10 text-sm text-muted-foreground">No suppliers found</p>
      )}

      {/* ── Mobile: card list ── */}
      <div className="sm:hidden space-y-3">
        {filtered.map(s => (
          <div key={s.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{s.id}</p>
              </div>
              <StatusBadge status={s.status} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">Contact</span><span className="text-foreground">{s.contactPerson}</span>
              <span className="text-muted-foreground">Phone</span><span className="text-foreground">{s.phone}</span>
              <span className="text-muted-foreground">Email</span><span className="text-foreground break-all">{s.email || '—'}</span>
              <span className="text-muted-foreground">City</span><span className="text-foreground">{s.city || '—'}</span>
              <span className="text-muted-foreground">Category</span><span className="text-foreground">{s.supplyCategory || '—'}</span>
              <span className="text-muted-foreground">Payment</span><span className="text-foreground">{s.paymentTerms || '—'}</span>
            </div>
            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={() => openEdit(s)} className="flex-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted transition-colors">Edit</button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Desktop: table ── */}
      <div className="hidden sm:block rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">ID</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact Person</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">City</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Payment Terms</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.id}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.contactPerson}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.city || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.supplyCategory || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.paymentTerms || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(s)} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors">Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add / Edit Modal ── */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={() => setModalMode(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="font-semibold text-sm text-foreground">{modalMode === 'add' ? 'Add Supplier' : 'Edit Supplier'}</p>
              <button onClick={() => setModalMode(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-5 space-y-3">
              {formError && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{formError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="Supplier name" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Contact Person *</label>
                  <input value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} className={inputCls} placeholder="Full name" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Phone *</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="+91 …" />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Email</label>
                  <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="email@example.com" type="email" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">City</label>
                  <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className={inputCls} placeholder="City" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Supply Category</label>
                  <input value={form.supplyCategory} onChange={e => setForm(f => ({ ...f, supplyCategory: e.target.value }))} className={inputCls} placeholder="e.g. Footwear" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Payment Terms</label>
                  <input value={form.paymentTerms} onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))} className={inputCls} placeholder="e.g. Net 30" />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as 'active' | 'inactive' }))} className={inputCls}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setModalMode(null)} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleSave} className="flex-1 rounded-lg bg-foreground text-background px-3 py-2 text-sm font-semibold hover:opacity-90 transition-opacity">
                {modalMode === 'add' ? 'Add Supplier' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
