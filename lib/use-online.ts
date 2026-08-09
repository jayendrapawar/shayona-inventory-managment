'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Returns the current online/offline state.
 * Fires onReconnect() when the browser transitions offline → online.
 *
 * Always starts as `true` on the first render (matches the server-rendered
 * HTML) then syncs to the real navigator.onLine value after mount.
 * This avoids the React hydration mismatch caused by reading
 * navigator.onLine during SSR vs the initial client render.
 */
export function useOnline(onReconnect?: () => void): boolean {
  // Start with true so server and first-client render agree
  const [isOnline, setIsOnline] = useState(true)

  // Keep callback ref stable so the effect never re-registers
  const onReconnectRef = useRef(onReconnect)
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  useEffect(() => {
    // Sync to real value immediately after mount
    setIsOnline(navigator.onLine)

    function handleOnline() {
      setIsOnline(true)
      onReconnectRef.current?.()
    }
    function handleOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}
