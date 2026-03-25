const STATIC_CACHE = 'accessguard-static-v1'
const API_CACHE = 'accessguard-api-v1'
const PRECACHE_URLS = ['/', '/enroll', '/access']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => ![STATIC_CACHE, API_CACHE].includes(key))
        .map((key) => caches.delete(key))
    ))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request))
    return
  }

  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'manifest'
  ) {
    event.respondWith(cacheFirst(request))
  }
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) {
    return cached
  }

  const response = await fetch(request)
  const cache = await caches.open(STATIC_CACHE)
  cache.put(request, response.clone())
  return response
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(API_CACHE)
    cache.put(request, response.clone())
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) {
      return cached
    }

    return new Response(null, { status: 504, statusText: 'Gateway Timeout' })
  }
}
