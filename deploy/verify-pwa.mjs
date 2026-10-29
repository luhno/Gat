#!/usr/bin/env node
// Local check for the PWA (T1.6): manifest + PNG icons, service worker registration, the
// cached app shell and the offline fallback of the web app.
//
//   npm run build && node deploy/build-online.mjs
//   node deploy/verify-pwa.mjs
//
// Uses the standalone online server (dist/online/server.cjs) on an ephemeral port and
// playwright-core channel "chrome" (no browser download). Exits non-zero on any failure.

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const { chromium } = createRequire(import.meta.url)("playwright-core")
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SERVER = path.join(ROOT, "dist/online/server.cjs")
const CLIENT = path.join(ROOT, "dist/client")

if (!fs.existsSync(SERVER) || !fs.existsSync(path.join(CLIENT, "index.html"))) {
  console.error("build ausente: rode `npm run build && node deploy/build-online.mjs`")
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
const log = (...args) => console.log(...args)
const pass = (name, detail = "") => { checks.push({ name, ok: true }); log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`) }
const warn = (name, detail) => { checks.push({ name, ok: true, warn: true }); log(`  ⚠ ${name} — ${detail}`) }
const fail = (name, detail) => { checks.push({ name, ok: false }); log(`  ✗ ${name} — ${detail}`) }

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitFor(what, probe, timeout = 20000, interval = 100) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeout) {
    try {
      const value = await probe()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(interval)
  }
  throw new Error(`timeout esperando ${what}${lastError ? ` (${lastError.message})` : ""}`)
}

/** PNG dimensions from the IHDR chunk; null when the bytes are not a PNG. */
function pngDimensions(buffer) {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(magic)) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function main() {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const env = { ...process.env, PORT: String(port), ROOM_NAME: "Sala PWA (verificação)", ICE_SERVERS: "" }
  delete env.ELECTRON_RUN_AS_NODE
  const serverLogs = []
  let server = null
  let browser = null
  let failed = false
  let page = null
  let appRegistered = false

  const startServer = async () => {
    server = spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] })
    server.stdout.on("data", (chunk) => serverLogs.push(String(chunk)))
    server.stderr.on("data", (chunk) => serverLogs.push(String(chunk)))
    await waitFor("servidor /healthz", async () => {
      try {
        return (await fetch(`${origin}/healthz`)).ok
      } catch {
        return false
      }
    }, 20000)
  }
  const stopServer = async () => {
    if (!server) return
    server.kill("SIGTERM")
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), sleep(5000)])
    if (server.exitCode === null) server.kill("SIGKILL")
    server = null
  }

  try {
    await startServer()
    log(`servidor online em ${origin}`)

    // ── Manifest ───────────────────────────────────────────────────────────
    const manifestResponse = await fetch(`${origin}/manifest.webmanifest`)
    const manifestType = manifestResponse.headers.get("content-type") ?? ""
    let manifest = null
    try {
      manifest = await manifestResponse.json()
    } catch {
      manifest = null
    }
    const manifestOk =
      manifestResponse.ok &&
      manifest !== null &&
      manifest.name === "DittoApp" &&
      manifest.short_name === "Ditto" &&
      manifest.start_url === "/room" &&
      manifest.scope === "/" &&
      manifest.display === "standalone" &&
      manifest.lang === "pt-BR" &&
      typeof manifest.description === "string" &&
      typeof manifest.theme_color === "string" &&
      typeof manifest.background_color === "string"
    if (manifestOk) {
      pass("manifest.webmanifest", `name/start_url/scope/display/lang + theme ${manifest.theme_color}`)
    } else {
      fail("manifest.webmanifest", `status ${manifestResponse.status}: ${JSON.stringify(manifest).slice(0, 200)}`)
      failed = true
      manifest = null
    }
    if (/manifest\+json/.test(manifestType)) {
      pass("MIME type do manifest", "application/manifest+json")
    } else {
      warn("MIME type do manifest", `${manifestType || "vazio"} (ideal: application/manifest+json; servidor serve static sem o mapa .webmanifest)`)
    }

    // ── Icons (real PNGs, dimensions match the manifest) ───────────────────
    const icons = Array.isArray(manifest?.icons) ? manifest.icons : []
    const iconProblems = []
    for (const icon of icons) {
      const response = await fetch(new URL(icon.src, origin))
      const body = Buffer.from(await response.arrayBuffer())
      const size = pngDimensions(body)
      const [width, height] = String(icon.sizes ?? "").split("x").map(Number)
      const contentType = response.headers.get("content-type") ?? ""
      if (!response.ok) iconProblems.push(`${icon.src}: status ${response.status}`)
      else if (!contentType.includes("image/png") || !size) iconProblems.push(`${icon.src}: não é PNG (${contentType})`)
      else if (size.width !== width || size.height !== height) iconProblems.push(`${icon.src}: ${size.width}x${size.height} != ${icon.sizes}`)
      else if (body.length < 1000) iconProblems.push(`${icon.src}: arquivo suspeito (${body.length} bytes)`)
    }
    const purposes = new Set(icons.flatMap((icon) => String(icon.purpose ?? "any").split(" ")))
    if (icons.length >= 2 && iconProblems.length === 0 && purposes.has("any") && purposes.has("maskable")) {
      const sizes = icons.map((icon) => icon.sizes).join(", ")
      pass("ícones PNG do manifest", `${icons.length} ícones (${sizes}) any+maskable`)
    } else {
      fail("ícones PNG do manifest", iconProblems.join("; ") || `icons=${icons.length} purposes=${[...purposes]}`)
      failed = true
    }

    // ── App shell HTML ─────────────────────────────────────────────────────
    const roomHtml = await (await fetch(`${origin}/room`)).text()
    const html = roomHtml.replace(/<!--[\s\S]*?-->/g, "")
    const metas = {
      manifest: /rel="manifest"[^>]*href="\/manifest\.webmanifest"/.test(html),
      themeColor: /name="theme-color"/.test(html),
      appleIcon: /rel="apple-touch-icon"[^>]*href="([^"]+)"/.test(html),
      appleCapable: /name="apple-mobile-web-app-capable"\s+content="yes"/.test(html),
      statusBar: /name="apple-mobile-web-app-status-bar-style"/.test(html),
      viewportFit: /viewport-fit=cover/.test(html),
      csp: /http-equiv="Content-Security-Policy"/.test(html),
      zoomBlocked: /maximum-scale|user-scalable=no/.test(html),
    }
    const metasOk = Object.entries(metas).every(([key, ok]) => key === "zoomBlocked" || ok)
    if (metasOk && !metas.zoomBlocked && metas.csp) {
      pass("metas do app no index.html", "manifest, theme-color, apple-*, viewport-fit=cover, CSP intacta")
    } else {
      fail("metas do app no index.html", JSON.stringify(metas))
      failed = true
    }
    if (!metas.zoomBlocked) {
      pass("zoom acessível", "viewport sem maximum-scale/user-scalable=no")
    } else {
      fail("zoom acessível", "viewport bloqueia pinch zoom")
      failed = true
    }

    const appleHref = /rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(html)?.[1] ?? "/icons/apple-touch-icon.png"
    const appleResponse = await fetch(new URL(appleHref, origin))
    const appleBody = Buffer.from(await appleResponse.arrayBuffer())
    const appleSize = pngDimensions(appleBody)
    if (appleResponse.ok && appleSize?.width === 180 && appleSize?.height === 180) {
      pass("apple-touch-icon 180x180", appleHref)
    } else {
      fail("apple-touch-icon", `${appleHref}: status ${appleResponse.status} ${JSON.stringify(appleSize)}`)
      failed = true
    }

    // ── Service worker file ────────────────────────────────────────────────
    const swResponse = await fetch(`${origin}/sw.js`)
    const swText = await swResponse.text()
    const swOk =
      swResponse.ok &&
      (swResponse.headers.get("content-type") ?? "").includes("javascript") &&
      swText.includes('addEventListener("install"') &&
      swText.includes('addEventListener("fetch"') &&
      ["/ws", "/join", "/client-config.json", "/healthz", "/site/"].every((prefix) => swText.includes(prefix))
    if (swOk) {
      pass("sw.js servido na raiz", `install/fetch handlers + bypass de /ws, /join, /client-config.json, /healthz, /site/*`)
    } else {
      fail("sw.js", `status ${swResponse.status} · ${swText.length} bytes`)
      failed = true
    }

    // ── Browser: shell, service worker, installability ─────────────────────
    browser = await chromium.launch({ channel: "chrome", headless: true })
    const context = await browser.newContext()
    page = await context.newPage()
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(String(error)))
    await page.goto(`${origin}/room`, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForSelector('[data-testid="home-name"]', { timeout: 30000 })
    pass("app shell carrega em /room")

    // The app registers the SW itself once the Lead wires `registerPwa()` in main.tsx.
    appRegistered = await waitFor(
      "SW registrado pelo app",
      () => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration())),
      5000,
    ).catch(() => false)
    if (!appRegistered) {
      warn("SW registrado pelo app", "pendente: main.tsx ainda não chama registerPwa(); registrando /sw.js direto para testar o shell offline")
      await page.evaluate(() => navigator.serviceWorker.register("/sw.js").catch(() => undefined))
    }
    try {
      await waitFor("SW instalado", () => page.evaluate(() => navigator.serviceWorker.ready.then(() => true)), 20000)
      if (appRegistered) pass("SW registrado pelo app")
    } catch (error) {
      fail("SW instalado", error.message)
      failed = true
    }

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForSelector('[data-testid="home-name"]', { timeout: 30000 })
    const controlling = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)
    if (controlling?.endsWith("/sw.js")) {
      pass("SW controla a página após reload", controlling)
    } else {
      fail("SW controlando a página", `controller=${controlling}`)
      failed = true
    }

    const cached = await page.evaluate(async () => {
      const out = []
      for (const key of await caches.keys()) out.push(...(await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname))
      return out
    })
    if (cached.includes("/room") && cached.some((url) => url.startsWith("/assets/"))) {
      pass("shell e assets no cache", `${cached.length} entradas (${cached.filter((url) => url.startsWith("/assets/")).length} assets)`)
    } else {
      fail("cache do shell", cached.join(", ") || "cache vazio")
      failed = true
    }

    // Chrome's own verdicts: manifest accepted and installability criteria met.
    let cdp = null
    try {
      cdp = await context.newCDPSession(page)
      const appManifest = await cdp.send("Page.getAppManifest")
      if (appManifest.url?.endsWith("/manifest.webmanifest") && (appManifest.errors ?? []).length === 0) {
        pass("Chrome aceita o manifest", "sem erros de parsing")
      } else {
        fail("Chrome aceita o manifest", JSON.stringify(appManifest.errors))
        failed = true
      }
      try {
        const installability = (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors ?? []
        const blocking = installability.filter((error) => error.errorId !== "in-incognito")
        if (blocking.length === 0) {
          pass("critérios de instalabilidade do Chrome", "só falta a sessão não ser anônima (contexto headless é incógnito)")
        } else {
          fail("instalabilidade do Chrome", blocking.map((error) => error.errorId).join(", "))
          failed = true
        }
      } catch (error) {
        warn("instalabilidade do Chrome", `CDP indisponível: ${error.message}`)
      }
    } catch (error) {
      warn("Chrome aceita o manifest", `CDP indisponível: ${error.message}`)
    }

    // ── Offline: navigation falls back to the cached shell ─────────────────
    await context.setOffline(true)
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 })
      await page.waitForSelector('[data-testid="home-name"]', { timeout: 20000 })
      pass("shell abre offline (reload sem rede)", "documento servido pelo service worker")
    } catch (error) {
      fail("shell offline", error.message)
      failed = true
    }
    const offlineBanner = await page.locator("[data-pwa-offline]").count()
    if (offlineBanner === 1) {
      pass("aviso \"sem conexão\" offline", page ? (await page.textContent("[data-pwa-offline]"))?.slice(0, 60) : "")
    } else if (appRegistered) {
      fail("aviso sem conexão offline", "banner ausente")
      failed = true
    } else {
      warn("aviso sem conexão offline", "pendente da integração de main.tsx (registerPwa) — o shell abriu offline")
    }

    const bypass = await page.evaluate(async () => {
      const probe = (url) => fetch(url).then((response) => `status ${response.status}`).catch(() => "blocked")
      return {
        healthz: await probe("/healthz"),
        config: await probe("/client-config.json"),
      }
    })
    if (bypass.healthz === "blocked" && bypass.config === "blocked") {
      pass("rotas de runtime não são cacheadas", "offline: /healthz e /client-config.json falham (sw bypass)")
    } else {
      fail("rotas de runtime não cacheadas", JSON.stringify(bypass))
      failed = true
    }

    await context.setOffline(false)
    if (pageErrors.length === 0) {
      pass("zero erros de JavaScript", "shell online e offline")
    } else {
      fail("erros de JavaScript", pageErrors[0])
      failed = true
    }
  } catch (error) {
    failed = true
    log(`  ✗ erro: ${error instanceof Error ? error.message : String(error)}`)
    if (serverLogs.length > 0) log(`  log do servidor:\n${serverLogs.join("")}`)
  } finally {
    await browser?.close().catch(() => undefined)
    await stopServer()
  }

  log("\n══════════════════════════════════════════")
  for (const check of checks) log(`  ${check.ok ? (check.warn ? "⚠" : "✓") : "✗"} ${check.name}`)
  const failures = checks.filter((check) => !check.ok).length
  log(`\n  ${checks.filter((check) => check.ok).length}/${checks.length} checks ok, ${failures} falha(s)`)
  log(failed || failures > 0 ? "  VEREDITO: FALHOU" : "  VEREDITO: VERDE")
  log("══════════════════════════════════════════")
  process.exitCode = failed || failures > 0 ? 1 : 0
}

void main()
