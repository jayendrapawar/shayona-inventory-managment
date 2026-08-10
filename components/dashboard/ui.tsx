import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'

interface KpiCardProps {
  icon: ReactNode
  iconBg: string
  title: string
  value: string | number
  subtitle: string
}

export function KpiCard({ icon, iconBg, title, value, subtitle }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 px-2.5 py-2.5 sm:gap-4 sm:px-5 sm:py-4">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg} sm:h-10 sm:w-10`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">{title}</p>
          <p className="text-xl font-bold leading-tight sm:text-2xl lg:text-3xl">{value}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground sm:text-xs">{subtitle}</p>
        </div>
      </CardContent>
    </Card>
  )
}

interface SectionLabelProps {
  icon: ReactNode
  title: string
}

export function SectionLabel({ icon, title }: SectionLabelProps) {
  return (
    <div className="flex items-center gap-2 border-b pb-1">
      {icon}
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    </div>
  )
}

interface EmptyStateProps {
  children: ReactNode
}

export function EmptyState({ children }: EmptyStateProps) {
  return <div className="px-3 py-8 text-center text-sm text-muted-foreground">{children}</div>
}

interface OfflineBannerProps {
  children: ReactNode
}

export function OfflineBanner({ children }: OfflineBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span>{children}</span>
    </div>
  )
}

interface FilterBadgeProps {
  icon: ReactNode
  className: string
  children: ReactNode
}

export function FilterBadge({ icon, className, children }: FilterBadgeProps) {
  return (
    <div className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${className}`}>
      {icon}
      {children}
    </div>
  )
}

interface UserPillProps {
  icon: ReactNode
  name: string
}

export function UserPill({ icon, name }: UserPillProps) {
  return (
    <div className="ml-auto mt-0.5 flex items-center gap-1">
      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white">
        {icon}
      </div>
      <span className="text-xs font-semibold text-muted-foreground">{name}</span>
    </div>
  )
}
