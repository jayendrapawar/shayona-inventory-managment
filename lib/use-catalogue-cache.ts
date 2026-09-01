'use client'

/**
 * useCatalogueCache
 *
 * Stale-while-revalidate catalogue caching using the Cache API.
 *
 * Flow on every mount:
 *   1. Read the cached response from Cache API (shayona-catalogue-v4).
 *      If it exists → return it IMMEDIATELY (zero network latency).
 *   2. In parallel, fetch /api/catalogue from the server.
 *   3. When the fresh response arrives, update the cache and merge into state.
 *
 * This means:
 *   - First visit:   shows server-rendered catalogue (already fast via page props).
 *   - Second visit:  catalogue is available from Cache API before the page even
 *                    finishes loading — instant search from the first keystroke.
 *   - Offline:       last cached catalogue is served indefinitely.
 *
 * The hook merges incoming `serverCatalogue` (from page props) with whatever it
 * finds in cache — whichever arrives first wins, and the fresher one replaces it.
 */

import { useState, useEffect, useRef } from 'react'
import type { CatalogueData } from '@/app/actions/catalogue'

const CACHE_NAME    = 'shayona-catalogue-v4'
const CACHE_KEY     = '/api/catalogue'
const TTL_MS        = 30 * 60 * 1000   // 30 minutes — don't re-fetch if cache is this fresh
const TS_KEY        = CACHE_KEY + '__ts'

export function useCatalogueCache(serverCatalogue: CatalogueData): CatalogueData {
  // Start with what the server already gave us (never null/loading)
  const [catalogue, setCatalogue] = useState<CatalogueData>(serverCatalogue)
  const revalidated = useRef(false)

  useEffect(() => {
    if (revalidated.current) return
    revalidated.current = true

    if (typeof caches === 'undefined') return   // SSR guard

    ;(async () => {
      const cache = await caches.open(CACHE_NAME)

      // ── 1. Return cached copy immediately if present ──────────────────────
      const cachedResponse = await cache.match(CACHE_KEY)
      if (cachedResponse) {
        try {
          const data: CatalogueData = await cachedResponse.json()
          setCatalogue(data)
        } catch { /* corrupt cache — will be overwritten below */ }
      }

      // ── 2. Check age — skip re-fetch if still fresh ───────────────────────
      const tsResp = await cache.match(TS_KEY)
      const ts = tsResp ? Number(await tsResp.text()) : 0
      if (Date.now() - ts < TTL_MS) return   // fresh enough, no network call

      // ── 3. Fetch fresh in background ──────────────────────────────────────
      try {
        const response = await fetch(CACHE_KEY)
        if (!response.ok) return

        const data: CatalogueData = await response.clone().json()

        // Update cache
        await cache.put(CACHE_KEY, response)
        await cache.put(TS_KEY, new Response(String(Date.now())))

        // Update UI with fresh data
        setCatalogue(data)
      } catch { /* network offline — cached version is already in state */ }
    })()
  }, [])   // run once per mount — serverCatalogue intentionally excluded

  return catalogue
}
