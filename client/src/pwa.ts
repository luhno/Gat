// PWA glue for the web build: service worker registration (offline shell) + offline notice.
// The Electron shell is already installed and works on the LAN, so it is left untouched.

const isElectron = "gather" in window

/**
 * navigator.onLine can be true while the room server is unreachable (service worker up,
 * flaky Wi-Fi, captive portal), so the banner probes the room server itself.
 */
async function isReachable(): Promise<boolean> {
  if (!navigator.onLine) return false
  try {
    const response = await fetch("/healthz", { cache: "no-store" })
    return response.ok
  } catch {
    return false
  }
}

/** Fixed banner while the browser cannot reach the room server; the cached shell still opens. */
function mountOfflineNotice(): void {
  let check = 0
  const update = async (): Promise<void> => {
    const current = ++check
    const existing = document.querySelector<HTMLElement>("[data-pwa-offline]")
    const online = await isReachable()
    // A newer check (online/offline event) may have started while probing.
    if (current !== check) return
    if (online) {
      existing?.remove()
      return
    }
    if (existing) return
    const notice = document.createElement("div")
    notice.dataset.pwaOffline = ""
    notice.setAttribute("role", "status")
    notice.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:10px 16px calc(10px + env(safe-area-inset-bottom, 0px));background:#f2b134;color:#16181d;font:600 13px/1.4 system-ui,sans-serif;text-align:center"
    notice.textContent = "Sem conexão — o app abriu offline pela última cópia salva. Entre na sala quando a internet voltar."
    document.body.append(notice)
  }
  window.addEventListener("online", () => void update())
  window.addEventListener("offline", () => void update())
  void update()
}

/** Register the app-shell service worker (secure contexts only) and show the offline notice. */
export function registerPwa(): void {
  if (isElectron || !window.isSecureContext || !("serviceWorker" in navigator)) return
  // Progressive enhancement: if registration fails (private mode, unsupported) the app still works online.
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  mountOfflineNotice()
}
