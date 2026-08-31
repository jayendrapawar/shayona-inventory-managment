'use client'

import { useState, useMemo, useTransition, useRef } from 'react'
import { fuzzyFilter } from '@/lib/fuzzy'
import { saveArticle, importArticles, deleteArticle, getArticleSizes } from '@/app/actions/articles'
import type { Article } from '@/app/actions/articles'

// ── CSV parser ────────────────────────────────────────────────────────────────
// Expected columns (case-insensitive, order flexible):
// artName, artCode, color, colorCode, maxSize, minSize
function parseCsv(text: string): Omit<Article, 'id' | 'createdAt' | 'updatedAt'>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''))
  const idx = (name: string) => headers.indexOf(name.toLowerCase())

  return lines.slice(1).flatMap(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const get = (name: string) => cols[idx(name)] ?? ''
    const artName = get('artname') || get('name')
    if (!artName) return []
    return [{
      artName,
      artCode:   get('artcode') || get('code') || '',
      color:     get('color') || '',
      colorCode: get('colorcode') || '',
      maxSize:   get('maxsize') || get('max') || '',
      minSize:   get('minsize') || get('min') || '',
    }] as Omit<Article, 'id' | 'createdAt' | 'updatedAt'>[]
  })
}

export type { Article }

type ArticleForm = {
  artName: string
  artCode: string
  color: string
  colorCode: string
  maxSize: string
  minSize: string
  customSizes: string
}

const EMPTY_FORM: ArticleForm = {
  artName: '',
  artCode: '',
  color: '',
  colorCode: '',
  maxSize: '',
  minSize: '',
  customSizes: '',
}

interface Props {
  initialArticles: Article[]
  onListChange?: (list: Article[]) => void
}

export function ArticlesTab({ initialArticles, onListChange }: Props) {
  const [articleList, setArticleList] = useState<Article[]>(initialArticles)

  function updateArticles(next: Article[]) {
    setArticleList(next)
    onListChange?.(next)
  }

  const [search, setSearch] = useState('')

  // ── Modal state ──
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [editTarget, setEditTarget] = useState<Article | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null)
  const [form, setForm] = useState<ArticleForm>(EMPTY_FORM)
  const [colors, setColors] = useState<{ color: string; colorCode: string }[]>([
    { color: '', colorCode: '' }
  ])
  const [formError, setFormError] = useState('')
  const [isSaving, startSave] = useTransition()
  const [isDeleting, startDelete] = useTransition()

  // ── CSV import state ──
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [isImporting, startImport] = useTransition()
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!e.target.files) return
    e.target.value = ''
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
          const { imported, skipped, list } = await importArticles(rows)
          updateArticles(list)
          const msg = imported === 0
            ? `Nothing imported — all ${skipped} row${skipped !== 1 ? 's' : ''} already exist in the database (matched by Article Name + Color).`
            : skipped > 0
              ? `Imported ${imported} new article${imported !== 1 ? 's' : ''}. Skipped ${skipped} already-existing row${skipped !== 1 ? 's' : ''}.`
              : `Imported ${imported} article${imported !== 1 ? 's' : ''} successfully.`
          setImportMsg({ type: imported === 0 ? 'err' : 'ok', text: msg })
          setTimeout(() => setImportMsg(null), 4000)
        } catch {
          setImportMsg({ type: 'err', text: 'Import failed. Please try again.' })
        }
      })
    }
    reader.readAsText(file)
  }

  const filtered = useMemo(() =>
    fuzzyFilter(articleList, search, a => [a.artName, a.artCode, a.color, a.colorCode])
  , [articleList, search])

  function openAdd() {
    setForm(EMPTY_FORM)
    setColors([{ color: '', colorCode: '' }])
    setFormError('')
    setEditTarget(null)
    setModalMode('add')
  }

  async function openEdit(a: Article) {
    setForm({
      artName:   a.artName,
      artCode:   a.artCode,
      color:     a.color,
      colorCode: a.colorCode,
      maxSize:   a.maxSize,
      minSize:   a.minSize,
      customSizes: '',
    })
    setColors([{ color: a.color, colorCode: a.colorCode }])
    setFormError('')
    setEditTarget(a)
    setModalMode('edit')

    try {
      const dbSizes = await getArticleSizes(a.id)
      const min = parseInt(a.minSize, 10)
      const max = parseInt(a.maxSize, 10)
      const customs = dbSizes.filter(s => {
        const n = parseInt(s, 10)
        if (isNaN(min) || isNaN(max) || min > max) return true
        return isNaN(n) || n < min || n > max
      })
      const customSizesStr = customs.join(', ')
      setForm(f => ({ ...f, customSizes: customSizesStr }))
      setColors([{ color: a.color, colorCode: a.colorCode }])
    } catch {
      // Graceful fallback
    }
  }

  function handleSave() {
    if (!form.artName.trim()) { setFormError('Article name is required.'); return }
    
    if (modalMode === 'add') {
      const emptyColorIdx = colors.findIndex(c => !c.color.trim())
      if (emptyColorIdx !== -1) {
        setFormError(`Color name is required (Color #${emptyColorIdx + 1}).`)
        return
      }
      const colorNames = colors.map(c => c.color.trim().toLowerCase())
      const uniqueColors = new Set(colorNames)
      if (uniqueColors.size !== colorNames.length) {
        setFormError('Duplicate color names are not allowed in the same article.')
        return
      }
    }
    
    setFormError('')

    startSave(async () => {
      try {
        let updated: Article[] = []
        if (modalMode === 'add') {
          for (const c of colors) {
            const payload = {
              artName: form.artName,
              artCode: form.artCode,
              color: c.color,
              colorCode: c.colorCode,
              minSize: form.minSize,
              maxSize: form.maxSize,
              customSizes: form.customSizes,
            }
            updated = await saveArticle(payload)
          }
        } else if (modalMode === 'edit' && editTarget) {
          const payload = {
            id: editTarget.id,
            artName: form.artName,
            artCode: form.artCode,
            color: form.color,
            colorCode: form.colorCode,
            minSize: form.minSize,
            maxSize: form.maxSize,
            customSizes: form.customSizes,
          }
          updated = await saveArticle(payload)
        }
        updateArticles(updated)
        setModalMode(null)
      } catch {
        setFormError('Failed to save article. Please try again.')
      }
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
      <div className="mb-2">
        <input
          type="search"
          placeholder="Search articles…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-2 mb-4">
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
          + Add Article
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
        <p className="text-center py-10 text-sm text-muted-foreground">No articles found</p>
      )}

      {/* ── Mobile: card list ── */}
      <div className="sm:hidden space-y-3">
        {filtered.map(a => (
          <div key={a.id} className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
              <div className="min-w-0">
                <p className="font-semibold text-base text-foreground truncate">{a.artName || '—'}</p>
                {a.artCode && <p className="text-xs text-muted-foreground font-mono mt-0.5">{a.artCode}</p>}
              </div>
              {a.colorCode && (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border border-border bg-muted">
                  <span
                    className="w-3 h-3 rounded-full border border-border"
                    style={{ backgroundColor: a.colorCode.startsWith('#') ? a.colorCode : undefined }}
                  />
                  {a.color || a.colorCode}
                </span>
              )}
            </div>
            <div className="px-4 pb-3 flex gap-4 text-sm">
              {a.minSize && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block">Min Size</span>
                  <span className="text-foreground font-medium">{a.minSize}</span>
                </div>
              )}
              {a.maxSize && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block">Max Size</span>
                  <span className="text-foreground font-medium">{a.maxSize}</span>
                </div>
              )}
            </div>
            <div className="border-t border-border px-4 py-3 flex gap-2">
              <button
                onClick={() => openEdit(a)}
                className="flex-1 rounded-xl border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted active:scale-95 transition-all"
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteTarget(a)}
                className="flex-1 rounded-xl border border-red-200 bg-red-50 text-red-600 py-2.5 text-sm font-medium hover:bg-red-100 active:scale-95 transition-all"
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
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left pl-4 pr-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">#</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Article Name</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Article Code</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Color</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Color Code</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Min Size</th>
                <th className="text-left px-2 py-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">Max Size</th>
                <th className="pr-4 pl-2 py-2.5 w-[140px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(a => (
                <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                  <td className="pl-4 pr-2 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{a.id}</td>
                  <td className="px-2 py-3 max-w-[160px]">
                    <p className="font-medium text-foreground truncate text-sm" title={a.artName}>{a.artName || '—'}</p>
                  </td>
                  <td className="px-2 py-3 font-mono text-xs text-foreground whitespace-nowrap">{a.artCode || '—'}</td>
                  <td className="px-2 py-3 text-sm text-foreground whitespace-nowrap">{a.color || '—'}</td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    {a.colorCode ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                        {a.colorCode.startsWith('#') && (
                          <span
                            className="w-3 h-3 rounded-sm border border-border inline-block"
                            style={{ backgroundColor: a.colorCode }}
                          />
                        )}
                        {a.colorCode}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-3 text-sm text-muted-foreground whitespace-nowrap">{a.minSize || '—'}</td>
                  <td className="px-2 py-3 text-sm text-muted-foreground whitespace-nowrap">{a.maxSize || '—'}</td>
                  <td className="pr-4 pl-2 py-3 w-[140px]">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button onClick={() => openEdit(a)} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors whitespace-nowrap">Edit</button>
                      <button onClick={() => setDeleteTarget(a)} className="rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap">Delete</button>
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
            className={`w-full ${modalMode === 'add' ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-3xl sm:rounded-2xl border border-border bg-background shadow-2xl overflow-hidden`}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle (mobile only) */}
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 flex items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-foreground tracking-tight">
                    {modalMode === 'add' ? 'Add Article' : 'Edit Article'}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setModalMode(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
              >
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh] sm:max-h-[80vh]">
              {formError && (
                <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{formError}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Article Name *</label>
                  <input
                    value={form.artName}
                    onChange={e => setForm(f => ({ ...f, artName: e.target.value }))}
                    className={inputCls}
                    placeholder="Enter article name"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Article Code</label>
                  <input
                    value={form.artCode}
                    onChange={e => setForm(f => ({ ...f, artCode: e.target.value }))}
                    className={inputCls}
                    placeholder="e.g. AC-2024"
                  />
                </div>

                {modalMode === 'add' ? (
                  <div className="col-span-2 space-y-5">

                    {/* ── Sizes section ── */}
                    <div className="border-t border-border pt-4 mt-2">
                      <span className="text-sm font-semibold text-foreground block mb-3">Sizes</span>
                      <div className="rounded-xl border border-border bg-muted/10 p-4 grid grid-cols-3 gap-4">
                        <div>
                          <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Min Size</label>
                          <input
                            value={form.minSize}
                            onChange={e => setForm(f => ({ ...f, minSize: e.target.value }))}
                            className={inputCls}
                            placeholder="e.g. 6"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Max Size</label>
                          <input
                            value={form.maxSize}
                            onChange={e => setForm(f => ({ ...f, maxSize: e.target.value }))}
                            className={inputCls}
                            placeholder="e.g. 12"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Custom Sizes</label>
                          <input
                            value={form.customSizes}
                            onChange={e => setForm(f => ({ ...f, customSizes: e.target.value }))}
                            className={inputCls}
                            placeholder="e.g. 2, 5"
                          />
                        </div>
                      </div>
                    </div>

                    {/* ── Colors section ── */}
                    <div>
                      <div className="flex items-end justify-between mb-3">
                        <div>
                          <span className="text-sm font-semibold text-foreground block">Colors</span>
                          <span className="text-xs text-muted-foreground block mt-0.5">Color name &amp; code for each variant.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setColors(prev => [...prev, { color: '', colorCode: '' }])}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add Color
                        </button>
                      </div>

                    <div className="border border-border rounded-xl p-3 bg-muted/10 space-y-3">
                      {/* Grid Headers */}
                      <div className="hidden sm:grid grid-cols-12 gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 pb-1 border-b border-border/60">
                        <div className="col-span-5">Color Name *</div>
                        <div className="col-span-6">Color Code</div>
                        <div className="col-span-1 text-center">Del</div>
                      </div>

                      <div className="space-y-3.5 max-h-[250px] overflow-y-auto pr-1">
                        {colors.map((c, idx) => (
                          <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center bg-background sm:bg-transparent border border-border sm:border-transparent p-3 sm:p-0 rounded-lg sm:rounded-none">

                            <div className="col-span-1 sm:col-span-5">
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider sm:hidden block mb-1">Color Name *</label>
                              <input
                                value={c.color}
                                onChange={e => {
                                  const next = [...colors]
                                  next[idx] = { ...next[idx], color: e.target.value }
                                  setColors(next)
                                }}
                                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                placeholder="e.g. Red"
                              />
                            </div>

                            <div className="col-span-1 sm:col-span-6">
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider sm:hidden block mb-1">Color Code</label>
                              <input
                                value={c.colorCode}
                                onChange={e => {
                                  const next = [...colors]
                                  next[idx] = { ...next[idx], colorCode: e.target.value }
                                  setColors(next)
                                }}
                                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                placeholder="e.g. #FF0000"
                              />
                            </div>

                            <div className="col-span-1 sm:col-span-1 flex justify-end sm:justify-center items-center pt-2 sm:pt-0 border-t border-border/40 sm:border-transparent">
                              {colors.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => setColors(prev => prev.filter((_, i) => i !== idx))}
                                  className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-border sm:border-transparent hover:border-red-200 transition-all"
                                  title="Remove color"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground/60 select-none hidden sm:inline">—</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>{/* end colors card */}
                    </div>{/* end colors section */}
                  </div>
                ) : (
                  <>
                    <div className="col-span-1">
                      <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Color Name *</label>
                      <input
                        value={form.color}
                        onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. Red"
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Color Code</label>
                      <input
                        value={form.colorCode}
                        onChange={e => setForm(f => ({ ...f, colorCode: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. #FF0000 or C01"
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Min Size</label>
                      <input
                        value={form.minSize}
                        onChange={e => setForm(f => ({ ...f, minSize: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. S or 28"
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Max Size</label>
                      <input
                        value={form.maxSize}
                        onChange={e => setForm(f => ({ ...f, maxSize: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. XXL or 44"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider block mb-1.5">Custom Sizes (comma-separated)</label>
                      <input
                        value={form.customSizes}
                        onChange={e => setForm(f => ({ ...f, customSizes: e.target.value }))}
                        className={inputCls}
                        placeholder="e.g. 2, 5"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-border bg-muted/10">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                disabled={isSaving}
                className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-semibold hover:bg-muted transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 rounded-xl bg-foreground text-background px-4 py-3 text-sm font-bold hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center"
              >
                {isSaving ? 'Saving…' : modalMode === 'add' ? 'Add Article' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl m-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Article</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete <span className="font-semibold text-foreground">&quot;{deleteTarget.artName}&quot;</span> ({deleteTarget.color || 'no color'})? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-muted transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  startDelete(async () => {
                    try {
                      const updated = await deleteArticle(deleteTarget.id)
                      updateArticles(updated)
                      setDeleteTarget(null)
                    } catch {
                      setFormError('Failed to delete article. Please try again.')
                      setDeleteTarget(null)
                    }
                  })
                }}
                disabled={isDeleting}
                className="flex-1 rounded-xl bg-red-600 text-white py-2.5 text-sm font-semibold hover:bg-red-700 active:scale-95 transition-all disabled:opacity-50"
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
