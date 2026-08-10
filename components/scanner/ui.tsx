import type { ReactNode } from 'react'

interface ScanSummaryCardProps {
  label: string
  artNumber?: string | null
  colorNumber?: string | null
  sizeNumber?: string | null
  mrp?: string | number | null
  division?: string | null
  scannedByName?: string | null
}

export function ScanSummaryCard({ label, artNumber, colorNumber, sizeNumber, mrp, division, scannedByName }: ScanSummaryCardProps) {
  return (
    <div className="rounded-xl border bg-zinc-900 p-4 text-white space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <p className="mb-0.5 text-[11px] text-zinc-400">Article</p>
          <p className="text-base font-bold leading-tight">{artNumber || '—'}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[11px] text-zinc-400">Color</p>
          <p className="text-base font-bold leading-tight">{colorNumber || '—'}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[11px] text-zinc-400">Size</p>
          <p className="text-base font-bold leading-tight">{sizeNumber || '—'}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[11px] text-zinc-400">MRP</p>
          <p className="text-base font-bold leading-tight">{mrp != null ? `₹${Number(mrp).toFixed(2)}` : '—'}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[11px] text-zinc-400">Division</p>
          <p className="text-base font-bold leading-tight">{division || '—'}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[11px] text-zinc-400">By</p>
          <p className="text-base font-bold leading-tight">{scannedByName || '—'}</p>
        </div>
      </div>
    </div>
  )
}

interface FlagSelectorProps {
  activeFlag: string
  flags: string[]
  flagsLoading: boolean
  newFlagInput: string
  newFlagSaving: boolean
  showNewFlagInput: boolean
  onActiveFlagChange: (value: string) => void
  onAddFlag: () => void
  onCancelNewFlag: () => void
  onNewFlagInputChange: (value: string) => void
  onShowNewFlagInput: () => void
}

export function FlagSelector(props: FlagSelectorProps) {
  const {
    activeFlag,
    flags,
    flagsLoading,
    newFlagInput,
    newFlagSaving,
    showNewFlagInput,
    onActiveFlagChange,
    onAddFlag,
    onCancelNewFlag,
    onNewFlagInputChange,
    onShowNewFlagInput,
  } = props

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">Select Flag:</span>
        <span className="inline-flex max-w-[120px] shrink-0 items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 truncate">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          <span className="truncate">{activeFlag || '…'}</span>
        </span>
        <select
          value={activeFlag}
          disabled={flagsLoading}
          onChange={(e) => (e.target.value === '__new__' ? onShowNewFlagInput() : onActiveFlagChange(e.target.value))}
          className="h-7 min-w-0 flex-1 cursor-pointer rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {flags.map((flag) => <option key={flag} value={flag}>{flag}</option>)}
          <option value="__new__">＋ New flag</option>
        </select>
      </div>

      {showNewFlagInput && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            autoFocus
            placeholder="Flag name…"
            value={newFlagInput}
            disabled={newFlagSaving}
            onChange={(e) => onNewFlagInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onAddFlag() }
              if (e.key === 'Escape') onCancelNewFlag()
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <InlineButton disabled={newFlagSaving} onClick={onAddFlag} primary>{newFlagSaving ? '…' : 'Add'}</InlineButton>
          <InlineButton disabled={newFlagSaving} onClick={onCancelNewFlag}>Cancel</InlineButton>
        </div>
      )}
    </div>
  )
}

function InlineButton({ children, disabled, onClick, primary = false }: { children: ReactNode; disabled: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={primary
        ? 'h-7 shrink-0 rounded-md border border-blue-300 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50'
        : 'h-7 shrink-0 rounded-md border border-input bg-background px-3 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50'}
    >
      {children}
    </button>
  )
}
