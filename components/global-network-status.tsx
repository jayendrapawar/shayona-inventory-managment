'use client'

/**
 * GlobalNetworkStatus
 *
 * Mounted once in RootLayout — covers every page automatically.
 *
 * Behaviour per page:
 *  /scanner     → compact bottom toast  (app still works offline)
 *  /dashboard,
 *  /sign-in,
 *  /sign-up, /  → red top banner + Reload button (internet required)
 *  other pages  → generic bottom toast
 *
 * Coming back online → brief "✓ Back online" green toast for 3 s.
 */

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

type PageKind = 'scanner' | 'needs-internet' | 'other'

function getPageKind(pathname: string): PageKind {
  if (pathname.startsWith('/scanner')) return 'scanner'
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname === '/'
  ) return 'needs-internet'
  return 'other'
}

interface BannerCfg {
  icon: string
  message: string
  sub: string
  bg: string
  border: string
  text: string
  subText: string
}

function getCfg(kind: PageKind): BannerCfg {
  if (kind === 'scanner') {
    return {
      icon: '📶',
      message: 'Working offline',
      sub: 'Scans save locally and sync automatically when internet returns.',
      bg: 'bg-yellow-50',
      border: 'border-yellow-300',
      text: 'text-yellow-900',
      subText: 'text-yellow-700',
    }
  }
  if (kind === 'needs-internet') {
    return {
      icon: '🚫',
      message: 'No internet connection',
      sub: 'This page requires internet to work. Connect and reload.',
      bg: 'bg-red-50',
      border: 'border-red-300',
      text: 'text-red-900',
      subText: 'text-red-700',
    }
  }
  return {
    icon: '📶',
    message: 'No internet connection',
    sub: 'Some features may not work until you are back online.',
    bg: 'bg-yellow-50',
    border: 'border-yellow-300',
    text: 'text-yellow-900',
    subText: 'text-yellow-700',
  }
}

export function GlobalNetworkStatus() {
  // Start true — matches SSR, avoids hydration mismatch
  const [isOnline, setIsOnline]       = useState(true)
  const [showRestored, setShowRestored] = useState(false)
  const restoredTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    // Sync to real value after hydration
    setIsOnline(navigator.onLine)

    function handleOnline() {
      setIsOnline(true)
      setShowRestored(true)
      if (restoredTimer.current) clearTimeout(restoredTimer.current)
      restoredTimer.current = setTimeout(() => setShowRestored(false), 3000)
    }
    function handleOffline() {
      setIsOnline(false)
      setShowRestored(false)
    }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (restoredTimer.current) clearTimeout(restoredTimer.current)
    }
  }, [])

  // ── "Back online" toast ────────────────────────────────────────────────────
  if (showRestored) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full border border-green-300 bg-green-50 px-4 py-2 shadow-lg text-sm text-green-800">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="h-4 w-4 shrink-0 text-green-600">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="font-medium">Back online</span>
      </div>
    )
  }

  // ── Offline banners ────────────────────────────────────────────────────────
  if (!isOnline) {
    const kind   = getPageKind(pathname)
    const cfg    = getCfg(kind)

    // Scanner — compact bottom toast (inline banner already on page)
    if (kind === 'scanner') {
      return (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-sm items-start gap-2.5 rounded-xl border ${cfg.border} ${cfg.bg} px-4 py-3 shadow-lg`}>
          <span className="shrink-0 text-base leading-none mt-0.5">{cfg.icon}</span>
          <div>
            <p className={`text-sm font-semibold ${cfg.text}`}>{cfg.message}</p>
            <p className={`mt-0.5 text-xs ${cfg.subText}`}>{cfg.sub}</p>
          </div>
        </div>
      )
    }

    // Dashboard / sign-in / other — top banner + Reload button
    return (
      <div className={`fixed top-0 inset-x-0 z-[100] flex items-start gap-3 border-b ${cfg.border} ${cfg.bg} px-4 py-3 shadow-sm`}>
        <span className="shrink-0 text-base leading-none mt-0.5">{cfg.icon}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${cfg.text}`}>{cfg.message}</p>
          <p className={`mt-0.5 text-xs ${cfg.subText}`}>{cfg.sub}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className={`shrink-0 rounded-md border ${cfg.border} bg-white px-3 py-1 text-xs font-medium ${cfg.text} hover:bg-gray-50 transition-colors`}
        >
          Reload
        </button>
      </div>
    )
  }

  return null
}
