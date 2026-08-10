import { DAILY_SCAN_KEY, FLAG_KEY, USER_KEY } from '@/components/scanner/constants'

function getTodayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getStoredActiveFlag(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(FLAG_KEY) ?? ''
}

export function saveStoredActiveFlag(flag: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(FLAG_KEY, flag)
}

export function getDailyScanCount(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(DAILY_SCAN_KEY)
    if (!raw) return 0
    const { date, count } = JSON.parse(raw) as { date: string; count: number }
    if (date !== getTodayDateStr()) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

export function incrementDailyScanCount(): number {
  if (typeof window === 'undefined') return 0
  const next = getDailyScanCount() + 1
  localStorage.setItem(DAILY_SCAN_KEY, JSON.stringify({ date: getTodayDateStr(), count: next }))
  return next
}

export function getCachedUser(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(USER_KEY) ?? ''
}

export function setCachedUser(name: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(USER_KEY, name)
}
