/**
 * Shayona Inventory — Service Worker v4
 *
 * Strategies:
 *   - App shell JS/CSS (_next/static)          → CacheFirst  (versioned hashes, safe forever)
 *   - Page HTML (all app routes)               → NetworkFirst with 5 s timeout → cache fallback
 *   - Images / icons / manifest                → CacheFirst
 *   - Catalogue API route (/api/catalogue)     → StaleWhileRevalidate (30 min TTL)
 *   - Server Actions (POST)                    → NetworkOnly (never cache mutations)
 *   - Everything else                          → NetworkFirst
 */

const CACHE_VERSION  = 'v4'
const CACHE_NAME     = `shayona-${CACHE_VERSION}`
const STATIC_CACHE   = `shayona-static-${CACHE_VERSION}`
const PAGES_CACHE    = `shayona-pages-${CACHE_VERSION}`
const CAT_CACHE      = `shayona-catalogue-${CACHE_VERSION}`

// Pages to pre-cache on install (must be navigable without live DB)
const PRECACHE_URLS = [
  '/sign-in',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
]

// All HTML page path prefixes — anything here gets NetworkFirst + cache fallback
const PAGE_PATHS = [
  '/',
  '/orders',
  '/scanner',
  '/dashboard',
  '/sign-in',
  '/sign-up',
  '/master',
  '/billing',
  '/reports',
  '/purchases',
  '/home',
]

// ── Install: pre-cache critical shell ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGES_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  )
})

// ── Activate: evict all old caches ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const valid = new Set([CACHE_NAME, STATIC_CACHE, PAGES_CACHE, CAT_CACHE])
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !valid.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// ── Fetch: route-based strategies ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only intercept same-origin GETs
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // _next/static — immutable versioned assets
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Icons, manifest, static images
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    /\.(png|ico|svg|webp|jpg|jpeg|gif)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, CACHE_NAME))
    return
  }

  // Catalogue API — stale-while-revalidate, 30 min TTL
  if (url.pathname === '/api/catalogue') {
    event.respondWith(staleWhileRevalidate(request, CAT_CACHE, 30 * 60 * 1000))
    return
  }

  // All HTML pages — NetworkFirst with 5 s timeout
  const isHtmlPage =
    request.headers.get('accept')?.includes('text/html') ||
    PAGE_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'))

  if (isHtmlPage) {
    event.respondWith(networkFirstWithTimeout(request, PAGES_CACHE, 5000))
    return
  }

  // _next/data and internal Next routes
  if (url.pathname.startsWith('/_next/')) {
    event.respondWith(networkFirstWithTimeout(request, CACHE_NAME, 5000))
    return
  }

  // Default
  event.respondWith(networkFirstWithTimeout(request, CACHE_NAME, 5000))
})

// ── Strategies ────────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(cacheName)
    cache.put(request, response.clone())
  }
  return response
}

async function networkFirstWithTimeout(request, cacheName, timeoutMs) {
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(request, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    clearTimeout(timeoutId)
    const cached = await caches.match(request)
    if (cached) return cached
    if (request.headers.get('accept')?.includes('text/html')) {
      const fallback = await caches.match('/sign-in')
      if (fallback) return fallback
    }
    return new Response('Offline — open the app while connected first.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

/**
 * Stale-while-revalidate with TTL.
 * Returns cached response immediately if within TTL, while fetching a fresh
 * copy in the background. If cache is stale or missing, waits for network.
 */
async function staleWhileRevalidate(request, cacheName, ttlMs) {
  const cache  = await caches.open(cacheName)
  const cached = await cache.match(request)

  const fetchAndStore = fetch(request).then((response) => {
    if (response.ok) {
      const clone = response.clone()
      // Stamp the cached-at time in a custom header via a wrapper Response
      clone.headers // can't mutate; store timestamp separately via a meta key
      cache.put(request, response.clone())
      cache.put(request.url + '__ts', new Response(String(Date.now())))
    }
    return response
  }).catch(() => null)

  if (cached) {
    const tsResponse = await cache.match(request.url + '__ts')
    const ts = tsResponse ? Number(await tsResponse.text()) : 0
    if (Date.now() - ts < ttlMs) {
      // Fresh enough — return cached immediately, revalidate in background
      fetchAndStore // fire and forget
      return cached
    }
  }

  // Stale or missing — wait for network
  const fresh = await fetchAndStore
  if (fresh) return fresh
  if (cached) return cached  // network failed, serve stale rather than error
  return new Response('Catalogue unavailable offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  })
}
