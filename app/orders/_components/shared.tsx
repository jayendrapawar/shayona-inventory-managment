// Shared utilities for the orders UI

export type BadgeColor = 'gray' | 'blue' | 'yellow' | 'green' | 'red' | 'purple' | 'orange'

export const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  pending:    { label: 'Pending',     color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  assigned:   { label: 'Assigned',    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  packed:     { label: 'Packed',      color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  dispatched: { label: 'Dispatched',  color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' },
  delivered:  { label: 'Delivered',   color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  cancelled:  { label: 'Cancelled',   color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  out_of_stock: { label: 'Out of Stock', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
}

export const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  admin:      { label: 'Admin',       color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  accountant: { label: 'Accountant',  color: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400' },
  salesman:   { label: 'Salesman',    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  picker:     { label: 'Picker',      color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  dispatcher: { label: 'Dispatcher',  color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' },
  user:       { label: 'No Role',     color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
}

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { label: status, color: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  )
}

export function RolePill({ role }: { role: string | null | undefined }) {
  if (!role) {
    const r = ROLE_BADGE.user
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${r.color}`}>
        {r.label}
      </span>
    )
  }

  const roles = role.split(',').map(r => r.trim()).filter(Boolean)
  if (roles.length === 0) {
    const r = ROLE_BADGE.user
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${r.color}`}>
        {r.label}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap gap-1">
      {roles.map(r => {
        const badge = ROLE_BADGE[r] ?? ROLE_BADGE.user
        return (
          <span key={r} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.color}`}>
            {badge.label}
          </span>
        )
      })}
    </div>
  )
}

export function fmt(d: Date | null | undefined) {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
}

export function PageHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      {back && (
        <a href={back} className="flex items-center justify-center w-8 h-8 rounded-lg border border-border hover:bg-muted transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
      )}
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  )
}

export function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? 'text-foreground'}`}>{value}</p>
    </div>
  )
}
