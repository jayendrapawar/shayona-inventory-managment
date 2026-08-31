'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Polls `router.refresh()` every `intervalMs` (default 30 s) so the page
 * receives fresh server-component props without a full reload.
 * Also returns a manual `refresh()` function for on-demand refreshes.
 *
 * Pauses polling while the tab is hidden (visibilitychange) to avoid
 * unnecessary DB queries when the user isn't looking at the page.
 */
export function useAutoRefresh(intervalMs = 30_000) {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(() => {
    router.refresh()
  }, [router])

  const start = useCallback(() => {
    if (timerRef.current) return
    timerRef.current = setInterval(refresh, intervalMs)
  }, [refresh, intervalMs])

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    // Start polling only when tab is visible
    if (!document.hidden) start()

    function onVisibility() {
      if (document.hidden) {
        stop()
      } else {
        refresh()   // immediate refresh when tab becomes visible again
        start()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [start, stop, refresh])

  return { refresh }
}
