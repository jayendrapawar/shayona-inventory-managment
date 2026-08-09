'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export function GlobalNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true)
  const pathname = usePathname()

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const handleOnline  = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Only show on pages where internet is required
  const needsInternet =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname === '/'

  if (isOnline || !needsInternet) return null

  // Crisp, small pill anchored just below the top of the screen
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full border border-red-200 bg-red-50 pl-3 pr-2 py-1.5 shadow-md">
      {/* wifi-off icon */}
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0 text-red-500">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span className="text-xs font-medium text-red-700">No internet — page unavailable</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-full bg-red-100 hover:bg-red-200 border border-red-200 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 transition-colors"
      >
        Reload
      </button>
    </div>
  )
}
