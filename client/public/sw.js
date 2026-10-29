// DittoApp web shell service worker.
//
// Keeps the app bootable from cache when the network drops: the UI loads and shows the
// "sem conexão" notice instead of the browser error page. Nothing that depends on a live
// connection (/ws, /join, /client-config.json, /healthz, landing /site/*) is ever cached,
// and only GETs are intercepted — the room itself still talks to the server untouched.

const CACHE = "ditto-shell-v1"
const SHELL = "/room" // start_url; the server serves the same index.html for any app route
const BYPASS = ["/ws", "/join", "/client-config.json", "/healthz", "/site/"]
const HTML_ASSET = /(?:src|href)="(\/assets\/[^"]+)"/g

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const response = await fetch(SHELL, { cache: "no-store" })
      // Cache the shell HTML and every hashed asset it references, so the first offline open works.
      const assets = [...(await response.clone().text()).matchAll(HTML_ASSET)].map((match) => match[1])
      await cache.put(SHELL, response)
      await cache.addAll([...new Set(assets)])
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const stale = (await caches.keys()).filter((key) => key !== CACHE)
      await Promise.all(stale.map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

/** Network first, cached shell on failure; also refreshes the cached shell when online. */
async function navigation(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(SHELL, response.clone())
    return response
  } catch {
    const shell = await cache.match(SHELL)
    if (shell) return shell
    return new Response("DittoApp está offline e o shell não foi cacheado.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }
}

/** Hashed build assets never change under the same URL. */
async function asset(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (BYPASS.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return
  if (request.mode === "navigate" && url.pathname.startsWith("/room")) {
    event.respondWith(navigation(request))
    return
  }
  if (url.pathname.startsWith("/assets/")) event.respondWith(asset(request))
})
