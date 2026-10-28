// Security perimeter of the Electron shell:
// - permissions and screen sharing only for loopback/private origins;
// - navigation/window.open cannot leave the LAN;
// - every network request outside loopback/private is aborted and logged.

import path from "node:path"

import { app, desktopCapturer, session, type BrowserWindow } from "electron"

import { isPrivateHostname } from "./address"
import { log, logsDirectory, offlineGuardLog } from "./logger"

const ALLOWED_PERMISSIONS = new Set(["media", "notifications", "display-capture", "speaker-selection"])
const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"])

/** Loopback/private http(s)/ws(s) URL, and anything out of the network (data:, blob:, devtools:). */
export function isPrivateUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (!NETWORK_PROTOCOLS.has(url.protocol)) return true
  return isPrivateHostname(url.hostname)
}

let blockedCount = 0

export function offlineGuardBlockedCount(): number {
  return blockedCount
}

export function installOfflineGuard(strict: boolean): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (isPrivateUrl(details.url)) {
      callback({})
      return
    }
    blockedCount += 1
    offlineGuardLog(details.url)
    log(`[offline-guard] blocked #${blockedCount} ${details.url}`)
    if (strict) {
      // --offline-guard-strict: an external request before the window is up is fatal.
      log("[offline-guard] strict mode: encerrando o app")
      app.exit(1)
    }
    callback({ cancel: true })
  })
}

export function installSessionSecurity(strictOffline: boolean): void {
  const ses = session.defaultSession
  installOfflineGuard(strictOffline)

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isPrivateUrl(webContents.getURL()))
  })

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isPrivateUrl(requestingOrigin)
  })

  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        })
        const video = sources[0]
        if (!video) {
          callback({})
          return
        }
        callback({
          video,
          // System loopback capture is only supported on Windows.
          ...(request.audioRequested && process.platform === "win32" ? { audio: "loopback" as const } : {}),
        })
      } catch (error) {
        log(`[security] falha ao listar fontes de tela: ${String(error)}`)
        callback({})
      }
    },
    { useSystemPicker: true },
  )
  log(`[security] sessão configurada (logs em ${path.join(logsDirectory(), "offline-guard.log")})`)
}

export function installNavigationGuards(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    log(`[security] bloqueado window.open ${url}`)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event) => {
    if (!isPrivateUrl(event.url)) {
      log(`[security] bloqueada navegação ${event.url}`)
      event.preventDefault()
    }
  })
}
