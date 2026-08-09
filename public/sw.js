/**
 * Shayona Inventory — Service Worker
 *
 * Strategy:
 *   - App shell JS/CSS (_next/static)  → CacheFirst  (versioned, safe to cache forever)
 *   - Page HTML (/scanner, /dashboard) → NetworkFirst with 5s timeout → cache fallback
 *   - Images / icons / manifest        → CacheFirst
 *   - Server Actions (POST requests)   → NetworkOnly (never cache DB calls)
 *   - Everything else                  → NetworkFirst
 */

const CACHE_NAME    = 'shayona-v1'
const STATIC_CACHE  = 'shayona-static-v1'
const PAGES_CACHE   = 'shayona-pages-v1'

// App shell pages to pre-cache on install
const PRECACHE_URLS = [
  '/scanner',
  '/dashboard',
  '/sign-in',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
]

// ── Install: pre-cache critical shell ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGES_CACHE).then((cache) =>
      // Use individual requests so one failure doesn't block the rest
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  )
})

// ── Activate: clean up old caches ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const valid = new Set([CACHE_NAME, STATIC_CACHE, PAGES_CACHE])
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !valid.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// ── Fetch: route-based caching strategies ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Never intercept non-GET, non-same-origin, or server actions
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) return

  // _next/static — versioned build assets, safe CacheFirst forever
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Icons, manifest, images
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    /\.(png|ico|svg|webp|jpg|jpeg|gif)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, CACHE_NAME))
    return
  }

  // HTML pages — NetworkFirst with 5s timeout, fall back to cache
  if (
    request.headers.get('accept')?.includes('text/html') ||
    url.pathname === '/' ||
    url.pathname.startsWith('/scanner') ||
    url.pathname.startsWith('/dashboard') ||
    url.pathname.startsWith('/sign-in') ||
    url.pathname.startsWith('/sign-up')
  ) {
    event.respondWith(networkFirstWithTimeout(request, PAGES_CACHE, 5000))
    return
  }

  // _next/data and other internal Next routes — NetworkFirst
  if (url.pathname.startsWith('/_next/')) {
    event.respondWith(networkFirstWithTimeout(request, CACHE_NAME, 5000))
    return
  }

  // Default — NetworkFirst
  event.respondWith(networkFirstWithTimeout(request, CACHE_NAME, 5000))
})

// ── Strategies ─────────────────────────────────────────────────────────────

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
    // Offline fallback for HTML pages
    if (request.headers.get('accept')?.includes('text/html')) {
      const fallback = await caches.match('/scanner')
      if (fallback) return fallback
    }
    return new Response('Offline — please open the app on the scanner page first.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}
