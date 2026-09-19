'use client'

import { useState, useTransition } from 'react'
import { saveSet, deleteSet } from '@/app/actions/sets'
import type { OrderSet } from '@/app/actions/sets'

export type { OrderSet }

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Serialize quantities map to a display string like "6×1, 7×2, 8×2, 9×2, 10×1" */
function qtyDisplay(q: Record<string, number>): string {
  return Object.entries(q)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}×${v}`)
    .join(', ')
}

/** Parse "6:1, 7:2, 8:2, 9:2, 10:1" into a quantities map */
function parseQuantities(raw: string): Record<string, number> | null {
  const pairs = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (pairs.length === 0) return null
  const result: Record<string, number> = {}
  for (const pair of pairs) {
    const [sizeRaw, qtyRaw] = pair.split(':').map(s => s.trim())
    if (!sizeRaw) return null
    const qty = qtyRaw ? parseInt(qtyRaw, 10) : 1
    if (isNaN(qty) || qty < 0) return null
    result[sizeRaw] = qty
  }
  return result
}

/** Convert quantities map back to comma-separated text "6:1, 7:2, ..." */
function qtyToText(q: Record<string, number>): string {
  return Object.entries(q)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ')
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  initialSets: OrderSet[]
  onListChange?: (list: OrderSet[]) => void
}

export function SetsTab({ initialSets, onListChange }: Props) {
  const [sets, setSets] = useState<OrderSet[]>(initialSets)

  function updateSets(next: OrderSet[]) {
    setSets(next)
    onListChange?.(next)
  }

  // ── Modal state ──
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [editTarget, setEditTarget] = useState<OrderSet | null>(null)
  const [formName, setFormName] = useState('')
  const [formQtyText, setFormQtyText] = useState('')
  const [formError, setFormError] = useState('')
  const [isSaving, startSave] = useTransition()

  // ── Delete state ──
  const [deleteTarget, setDeleteTarget] = useState<OrderSet | null>(null)
  const [isDeleting, startDelete] = useTransition()

  function openAdd() {
    setFormName('')
    setFormQtyText('')
    setFormError('')
    setEditTarget(null)
    setModalMode('add')
  }

  function openEdit(s: OrderSet) {
    setFormName(s.name)
    setFormQtyText(qtyToText(s.quantities))
    setFormError('')
    setEditTarget(s)
    setModalMode('edit')
  }

  function handleSave() {
    if (!formName.trim()) { setFormError('Set name is required.'); return }
    const quantities = parseQuantities(formQtyText)
    if (!quantities || Object.keys(quantities).length === 0) {
      setFormError('Enter at least one size entry, e.g. "6:1" (size:qty). Separate entries with commas or new lines.')
      return
    }
    setFormError('')
    startSave(async () => {
      try {
        const updated = await saveSet({
          name: formName,
          quantities,
          ...(editTarget ? { id: editTarget.id } : {}),
        })
        updateSets(updated)
        setModalMode(null)
      } catch (err) {
        setFormError((err as Error).message ?? 'Save failed.')
      }
    })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    startDelete(async () => {
      const updated = await deleteSet(deleteTarget.id)
      updateSets(updated)
      setDeleteTarget(null)
    })
  }

  const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">
          Define size+quantity templates that salesmen can apply in one tap when creating orders.
        </p>
        <button
          onClick={openAdd}
          className="ml-4 shrink-0 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          + Add Set
        </button>
      </div>

      {sets.length === 0 && (
        <p className="text-center py-10 text-sm text-muted-foreground">No sets defined yet</p>
      )}

      {/* ── Mobile: card list ── */}
      <div className="sm:hidden space-y-3">
        {sets.map(s => (
          <div key={s.id} className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 pt-4 pb-3">
              <p className="font-semibold text-base text-foreground">{s.name}</p>
              <p className="text-xs text-muted-foreground mt-1 break-all">
                {qtyDisplay(s.quantities) || '—'}
              </p>
            </div>
            <div className="border-t border-border px-4 py-3 flex gap-2">
              <button
                onClick={() => openEdit(s)}
                className="flex-1 rounded-xl border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted active:scale-95 transition-all"
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteTarget(s)}
                className="flex-1 rounded-xl border border-red-200 bg-background py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 active:scale-95 transition-all dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Desktop: table ── */}
      <div className="hidden sm:block rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left pl-4 pr-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap w-[48px]">ID</th>
              <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap w-[140px]">Set Name</th>
              <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">Sizes × Qtys</th>
              <th className="pr-4 pl-2 py-2.5 w-[140px] whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sets.map(s => (
              <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                <td className="pl-4 pr-2 py-3 font-mono text-xs text-muted-foreground">{s.id}</td>
                <td className="px-2 py-3 font-medium text-foreground truncate">{s.name}</td>
                <td className="px-2 py-3 text-xs text-muted-foreground truncate">
                  {qtyDisplay(s.quantities) || '—'}
                </td>
                <td className="pr-4 pl-2 py-3 whitespace-nowrap w-[140px]">
                  <div className="flex gap-1.5 justify-end">
                    <button
                      onClick={() => openEdit(s)}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(s)}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Delete
                    </button>
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
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setModalMode(null)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-border bg-background shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle (mobile only) */}
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="font-semibold text-base text-foreground">
                {modalMode === 'add' ? 'Add Set' : 'Edit Set'}
              </p>
              <button
                onClick={() => setModalMode(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
              >
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto max-h-[65vh]">
              {formError && (
                <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{formError}</p>
              )}

              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">
                  Set Name *
                </label>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Standard Set, Half Set, Full Set…"
                />
              </div>

              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">
                  Size : Qty pairs *
                </label>
                <input
                  type="text"
                  value={formQtyText}
                  onChange={e => setFormQtyText(e.target.value)}
                  className={`${inputCls} font-mono`}
                  placeholder="6:1, 7:2, 8:2, 9:2, 10:1"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Comma-separated. Format: <code className="font-mono bg-muted px-1 rounded">size:qty</code> — e.g. <code className="font-mono bg-muted px-1 rounded">6:1, 7:2, 8:2</code>
                </p>
              </div>

              {/* Preview */}
              {formQtyText.trim() && (() => {
                const preview = parseQuantities(formQtyText)
                if (!preview) return null
                const total = Object.values(preview).reduce((s, n) => s + n, 0)
                return (
                  <div className="rounded-lg bg-muted/50 border border-border px-3 py-2">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Preview</p>
                    <p className="text-sm text-foreground">{qtyDisplay(preview)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Total: <span className="font-semibold text-foreground">{total}</span> pairs</p>
                  </div>
                )
              })()}
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={() => setModalMode(null)}
                disabled={isSaving}
                className="flex-1 rounded-xl border border-border px-3 py-3 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 rounded-xl bg-foreground text-background px-3 py-3 text-sm font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
              >
                {isSaving ? 'Saving…' : modalMode === 'add' ? 'Add Set' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm dialog ── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-border bg-background shadow-2xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="sm:hidden flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <p className="font-semibold text-base text-foreground mb-1">Delete Set</p>
            <p className="text-sm text-muted-foreground mb-5">
              Delete <span className="font-medium text-foreground">{deleteTarget.name}</span>? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="flex-1 rounded-xl border border-border px-3 py-3 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="flex-1 rounded-xl bg-red-600 text-white px-3 py-3 text-sm font-semibold hover:bg-red-700 active:scale-95 transition-all disabled:opacity-60"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
