// Electron main process for the offline Gather rewrite.
//
// Boot shape: one embedded HTTPS+WSS room server per instance, a single window
// loading https://127.0.0.1:<port>/ (or a LAN host URL for guests), tray and
// global shortcuts. Nothing here may reach the public internet.

import fs from "node:fs"
import path from "node:path"

import { app, BrowserWindow } from "electron"

import type { AppMode, JoinResult } from "@shared/bridge"
import { APP_DISPLAY_NAME } from "@shared/constants"

import { installCertificateVerifier } from "./cert"
import { parseCli } from "./cli"
import { registerIpc } from "./ipc"
import { IPC } from "./ipcChannels"
import { initLogging, log } from "./logger"
import { normalizeJoinAddress } from "./address"
import { installNavigationGuards, installSessionSecurity, offlineGuardBlockedCount } from "./security"
import { startLocalServer, type LocalServer } from "./server-host"
import { SettingsStore } from "./settings"
import { registerShortcuts, unregisterShortcuts } from "./shortcuts"
import { createTray, type TrayController } from "./tray"

const userDataOverride = process.env.GATHER_OFFLINE_USER_DATA?.trim()
if (userDataOverride) app.setPath("userData", path.resolve(userDataOverride))
initLogging(path.join(app.getPath("userData"), "logs"))

const cli = parseCli(process.argv)

// WebRTC mDNS would hide LAN IPs from the mesh, breaking host/guest media.
app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns")
if (cli.fakeMedia) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream")
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream")
}

let settings: SettingsStore
let localServer: LocalServer | null = null
let localUrl = ""
let lanUrls: string[] = []
let mainWindow: BrowserWindow | null = null
let tray: TrayController | null = null
/** URL the window should show; re-used when the window is recreated from the tray. */
let currentTargetUrl = ""
/** Explicit app mode: URL comparison is not enough when the embedded server fails to bind. */
let guestMode = false
let audioEnabled = true
let videoEnabled = true

if (!cli.multiInstance && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => showWindow())
  void app.whenReady().then(boot).catch((error: unknown) => {
    log(`[boot] falha fatal: ${String(error)}`)
    app.exit(1)
  })
}

app.on("window-all-closed", () => {
  // macOS apps stay alive (tray) without windows; other platforms quit as usual.
  if (process.platform !== "darwin") app.quit()
})
app.on("activate", () => showWindow())
app.on("will-quit", () => {
  unregisterShortcuts()
  log(`[offline-guard] total bloqueado=${offlineGuardBlockedCount()}`)
  void localServer?.close()
})

async function boot(): Promise<void> {
  settings = new SettingsStore(path.join(app.getPath("userData"), "settings.json"))
  installCertificateVerifier()
  installSessionSecurity(cli.offlineGuardStrict)

  const clientDir = path.join(app.getAppPath(), "dist/client")
  if (fs.existsSync(path.join(clientDir, "index.html"))) {
    try {
      localServer = await startLocalServer({ port: cli.port, clientDir, storageDir: app.getPath("userData") })
      localUrl = localServer.url
      lanUrls = localServer.lanUrls
    } catch (error) {
      log(`[boot] servidor embutido falhou: ${String(error)}`)
    }
  } else {
    log(`[boot] cliente não compilado em ${clientDir}; rode "npm run build"`)
  }
  if (!localUrl) localUrl = `https://127.0.0.1:${cli.port}/`

  currentTargetUrl = localUrl
  let bootMode: AppMode = "host"
  if (cli.join) {
    const target = normalizeJoinAddress(cli.join)
    if ("error" in target) {
      log(`[boot] --join inválido: ${target.error}`)
    } else {
      currentTargetUrl = target.page
      bootMode = "guest"
      settings.set({ lastJoinedAddress: target.url })
    }
  }

  guestMode = bootMode === "guest"
  log(`[boot] localUrl=${localUrl} port=${localServer?.port ?? cli.port} mode=${bootMode}`)

  registerIpc({
    settings,
    localUrl: () => localUrl,
    lanUrls: () => lanUrls,
    mode: currentMode,
    window: getWindow,
    join: joinRoom,
    leave: leaveRoom,
  })

  openWindow()

  if (process.env.GATHER_OFFLINE_NO_TRAY !== "1") {
    tray = createTray({
      showWindow,
      toggleAudio,
      toggleVideo,
      leaveRoom: () => void leaveRoom(),
      quit: () => app.quit(),
      isGuest: () => currentMode() === "guest",
      isAudioEnabled: () => audioEnabled,
      isVideoEnabled: () => videoEnabled,
    })
  }
  registerShortcuts({ toggleAudio, toggleVideo, showWindow })
}

function getWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: APP_DISPLAY_NAME,
    backgroundColor: "#16181d",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  mainWindow = window
  installNavigationGuards(window)
  log("[window] janela criada")
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show()
  })
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null
  })
  return window
}

function openWindow(): void {
  const window = getWindow() ?? createWindow()
  void loadTarget(window, currentTargetUrl)
}

function showWindow(): void {
  const window = getWindow()
  if (!window) {
    openWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function loadTarget(window: BrowserWindow, targetUrl: string): Promise<boolean> {
  if (!clientBuilt() && sameOrigin(targetUrl, localUrl)) {
    await showPage(
      window,
      "Cliente não compilado",
      `O bundle web não foi encontrado em <code>dist/client</code>.<br>Rode <code>npm run build</code> e abra o app novamente.`,
    )
    return false
  }
  try {
    await window.loadURL(targetUrl)
    log(`[window] carregado ${targetUrl}`)
    return true
  } catch (error) {
    log(`[window] falha ao carregar ${targetUrl}: ${String(error)}`)
    await showPage(
      window,
      "Falha ao abrir a sala",
      `Não foi possível abrir <code>${escapeHtml(targetUrl)}</code>.<br>Verifique se o host está ligado e na mesma rede.
       <p><button onclick="window.gather && window.gather.leaveRoom()">Voltar ao início</button></p>`,
    )
    return false
  }
}

/** Renderer-initiated actions that change the window URL (join/leave). */
async function navigateTo(targetUrl: string): Promise<boolean> {
  currentTargetUrl = targetUrl
  const window = getWindow()
  if (!window) {
    openWindow()
    return true
  }
  const loaded = await loadTarget(window, targetUrl)
  tray?.refresh()
  return loaded
}

function currentMode(): AppMode {
  return guestMode ? "guest" : "host"
}

function clientBuilt(): boolean {
  return fs.existsSync(path.join(app.getAppPath(), "dist/client/index.html"))
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

async function showPage(window: BrowserWindow, title: string, body: string): Promise<void> {
  try {
    await window.loadURL(dataPage(title, body))
  } catch (error) {
    log(`[window] falha ao mostrar página de erro: ${String(error)}`)
  }
}

function dataPage(title: string, body: string): string {
  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font: 15px/1.6 system-ui, sans-serif; background: #16181d; color: #e8e8ea; margin: 0;
             display: grid; place-items: center; min-height: 100vh; }
      main { max-width: 560px; padding: 32px; text-align: center; }
      code { background: #24272e; padding: 2px 6px; border-radius: 4px; }
      button { font: inherit; padding: 10px 18px; border: 0; border-radius: 8px; background: #e4572e;
               color: #fff; cursor: pointer; }
    </style>
  </head>
  <body><main><h1>${escapeHtml(title)}</h1><p>${body}</p></main></body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

async function joinRoom(address: string): Promise<JoinResult> {
  const target = normalizeJoinAddress(address)
  if ("error" in target) return { ok: false, error: target.error }
  settings.set({ lastJoinedAddress: target.url })
  guestMode = true
  const loaded = await navigateTo(target.page)
  return loaded ? { ok: true } : { ok: false, error: "Não foi possível abrir o host informado." }
}

async function leaveRoom(): Promise<void> {
  guestMode = false
  await navigateTo(localUrl)
}

function sendToRenderer(channel: string): void {
  getWindow()?.webContents.send(channel)
}

function toggleAudio(): void {
  audioEnabled = !audioEnabled
  sendToRenderer(IPC.toggleAudio)
  tray?.refresh()
}

function toggleVideo(): void {
  videoEnabled = !videoEnabled
  sendToRenderer(IPC.toggleVideo)
  tray?.refresh()
}
