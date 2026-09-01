'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { addGlobalNote, deleteGlobalNote, togglePinGlobalNote } from '@/app/actions/notes'
import type { NoteRow } from '@/app/actions/notes'

interface Props {
  initialNotes: NoteRow[]
  /** If true, deleting and pinning are hidden (read-only viewer) */
  readOnly?: boolean
}

function timeAgo(date: Date): string {
  const diff = (Date.now() - new Date(date).getTime()) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function NotesDashboard({ initialNotes, readOnly = false }: Props) {
  const [notes, setNotes] = useState<NoteRow[]>(initialNotes)
  const [draft, setDraft]   = useState('')
  const [isPending, start]  = useTransition()
  const [error, setError]   = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function handleAdd() {
    const trimmed = draft.trim()
    if (!trimmed) return
    setError('')
    start(async () => {
      try {
        const note = await addGlobalNote(trimmed)
        setNotes(prev => [note, ...prev])
        setDraft('')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add note')
      }
    })
  }

  function handleDelete(id: number) {
    start(async () => {
      try {
        await deleteGlobalNote(id)
        setNotes(prev => prev.filter(n => n.id !== id))
      } catch {
        setError('Failed to delete note')
      }
    })
  }

  function handleTogglePin(note: NoteRow) {
    const next = !note.pinned
    // Optimistic update
    setNotes(prev =>
      [...prev.map(n => n.id === note.id ? { ...n, pinned: next } : n)]
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    )
    start(async () => {
      try {
        await togglePinGlobalNote(note.id, next)
      } catch {
        // revert on failure
        setNotes(prev =>
          [...prev.map(n => n.id === note.id ? { ...n, pinned: note.pinned } : n)]
            .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        )
      }
    })
  }

  const pinned   = notes.filter(n => n.pinned)
  const unpinned = notes.filter(n => !n.pinned)

  return (
    <div className="space-y-4">

      {/* ── Compose box ── */}
      {!readOnly && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd()
            }}
            placeholder="Write a note visible to all roles… (Ctrl+Enter to post)"
            rows={2}
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-colors placeholder:text-muted-foreground disabled:opacity-50 overflow-hidden"
          />
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
          <div className="flex items-center justify-between">
            <span className={`text-xs tabular-nums ${draft.length > 900 ? 'text-red-500' : 'text-muted-foreground'}`}>
              {draft.length}/1000
            </span>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!draft.trim() || isPending}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                </svg>
              )}
              Post Note
            </button>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {notes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
          <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm">No notes yet. Be the first to post one.</p>
        </div>
      )}

      {/* ── Pinned notes ── */}
      {pinned.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">📌 Pinned</p>
          {pinned.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              readOnly={readOnly}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              isPending={isPending}
            />
          ))}
        </div>
      )}

      {/* ── Recent notes ── */}
      {unpinned.length > 0 && (
        <div className="space-y-2">
          {pinned.length > 0 && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">Recent</p>
          )}
          {unpinned.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              readOnly={readOnly}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              isPending={isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Single note card ──────────────────────────────────────────────────────────

function NoteCard({
  note,
  readOnly,
  onDelete,
  onTogglePin,
  isPending,
}: {
  note: NoteRow
  readOnly: boolean
  onDelete: (id: number) => void
  onTogglePin: (note: NoteRow) => void
  isPending: boolean
}) {
  return (
    <div className={`rounded-xl border px-3.5 py-3 group relative ${
      note.pinned
        ? 'border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-900/10'
        : 'border-border bg-card'
    }`}>
      {/* Content */}
      <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed pr-14">
        {note.content}
      </p>

      {/* Meta */}
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
        {note.authorName && (
          <span className="font-medium text-foreground/70">{note.authorName}</span>
        )}
        <span>{timeAgo(note.createdAt)}</span>
      </div>

      {/* Actions — top-right */}
      {!readOnly && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {/* Pin toggle */}
          <button
            type="button"
            title={note.pinned ? 'Unpin' : 'Pin'}
            disabled={isPending}
            onClick={() => onTogglePin(note)}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
              note.pinned
                ? 'text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill={note.pinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
            </svg>
          </button>
          {/* Delete */}
          <button
            type="button"
            title="Delete"
            disabled={isPending}
            onClick={() => onDelete(note.id)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-red-500 transition-colors disabled:opacity-40"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
