#!/usr/bin/env node
// Local check for the MOBILE/touch mode of the online room (T1.7).
//
// Starts dist/online/server.cjs on an ephemeral port and drives Chromium with a phone profile
// (390x844, touch, DPR 2): joystick walks the avatar, chat/settings/participants open as bottom
// sheets, no horizontal overflow at 320px, safe-area + dynamic viewport wired. A second 1280x800
// desktop context proves the touch HUD does not leak into the desktop layout.
//
//   npm run build && node deploy/build-online.mjs
//   node deploy/verify-mobile.mjs
//
// Requires Google Chrome installed (playwright-core channel "chrome"; no browser download).
// Fake media devices and no STUN, so it runs offline on one machine.

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const { chromium } = createRequire(import.meta.url)("playwright-core")
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SERVER = path.join(ROOT, "dist/online/server.cjs")
const SHOTS = path.join(ROOT, "docs/online")
const MOBILE_VIEWPORT = { width: 390, height: 844 }
const DESKTOP_VIEWPORT = { width: 1280, height: 800 }
const HOME_NAME = "Mobile QA"
const CHAT_TEXT = "Oi do celular"

if (!fs.existsSync(SERVER) || !fs.existsSync(path.join(ROOT, "dist/client/index.html"))) {
  console.error("build online ausente: rode `npm run build && node deploy/build-online.mjs`")
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
const log = (...args) => console.log(...args)
const pass = (name, detail = "") => {
  checks.push({ name, ok: true })
  log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`)
}
const fail = (name, detail) => {
  checks.push({ name, ok: false })
  log(`  ✗ ${name} — ${detail}`)
}

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

async function waitFor(what, probe, timeout = 15000, interval = 100) {
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

const stateOf = (page) => page.evaluate(() => window.__gatherTest?.() ?? null)
const selfOf = (state) => state?.players?.find((player) => player.id === state.selfId) ?? null

async function main() {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const env = { ...process.env, PORT: String(port), ROOM_NAME: "Sala mobile (verificação)", ICE_SERVERS: "" }
  delete env.ELECTRON_RUN_AS_NODE
  const serverLogs = []
  let server = null
  let browser = null
  let failed = false

  const startServer = async () => {
    server = spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] })
    server.stdout.on("data", (chunk) => serverLogs.push(String(chunk)))
    server.stderr.on("data", (chunk) => serverLogs.push(String(chunk)))
    await waitFor(
      "servidor /healthz",
      async () => {
        try {
          return (await fetch(`${origin}/healthz`)).ok
        } catch {
          return false
        }
      },
      20000,
    )
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

    const joinResponse = await fetch(`${origin}/join`, { redirect: "manual" })
    if (joinResponse.status === 302 && joinResponse.headers.get("location") === "/room?autojoin=1") {
      pass("link único /join continua redirecionando para autojoin")
    } else {
      fail("link /join", `status ${joinResponse.status} location ${joinResponse.headers.get("location")}`)
      failed = true
    }

    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
    })

    // ── 390x844, touch: the phone experience ────────────────────────────────
    const mobileContext = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
    await mobileContext.grantPermissions(["camera", "microphone"], { origin })
    const page = await mobileContext.newPage()
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(String(error)))

    await page.goto(`${origin}/room`, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForSelector('[data-testid="home-name"]', { timeout: 20000 })
    const home = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      hintHidden: (() => {
        const hint = document.querySelector(".home-footer-hint")
        return !hint || getComputedStyle(hint).display === "none"
      })(),
    }))
    if (!home.overflow) pass("home web sem rolagem horizontal no celular")
    else {
      fail("home web no celular", "scrollWidth > viewport")
      failed = true
    }
    if (home.hintHidden) pass("dicas de atalho de teclado escondidas em touch")
    else {
      fail("dicas de teclado", "footer com atalhos visível no celular")
      failed = true
    }

    await page.fill('[data-testid="home-name"]', HOME_NAME)
    await page.click('[data-testid="home-open-office"]')
    await page.waitForSelector('[data-testid="office-canvas"]', { timeout: 30000 })
    await waitFor("entrar na sala", async () => (await stateOf(page))?.connection === "connected", 20000)
    pass("entrou na sala pelo celular (nome preenchido)", HOME_NAME)

    // Detecção touch + viewport dinâmico
    const viewport = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="office-canvas"]')
      const rect = canvas.getBoundingClientRect()
      return {
        coarse: window.matchMedia("(pointer: coarse)").matches,
        touchPoints: navigator.maxTouchPoints,
        appHeight: getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim(),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        canvasCss: { width: rect.width, height: rect.height },
        canvasBacking: { width: canvas.width, height: canvas.height },
        dpr: Math.min(2, window.devicePixelRatio),
      }
    })
    if (viewport.coarse || viewport.touchPoints > 0) {
      pass("detecção touch (pointer coarse ou touch points)", `coarse=${viewport.coarse} touchPoints=${viewport.touchPoints}`)
    } else {
      fail("detecção touch", "contexto emulado não reporta toque")
      failed = true
    }
    const expectedAppHeight = `${viewport.innerHeight}px`
    if (viewport.appHeight === expectedAppHeight) {
      pass("viewport dinâmico (--app-height = visual viewport)", viewport.appHeight)
    } else {
      fail("viewport dinâmico", `--app-height=${viewport.appHeight || "(vazio)"}, esperado ${expectedAppHeight}`)
      failed = true
    }
    const scaleOk =
      Math.abs(viewport.canvasCss.width - viewport.innerWidth) <= 1 &&
      Math.abs(viewport.canvasCss.height - viewport.innerHeight) <= 1
    const backingOk =
      Math.abs(viewport.canvasBacking.width - Math.round(viewport.canvasCss.width * viewport.dpr)) <= 1 &&
      Math.abs(viewport.canvasBacking.height - Math.round(viewport.canvasCss.height * viewport.dpr)) <= 1
    if (scaleOk && backingOk) {
      pass("canvas ocupa a viewport com DPR correto", `${viewport.canvasCss.width}x${viewport.canvasCss.height} @${viewport.dpr}x`)
    } else {
      fail("canvas/DPR", JSON.stringify(viewport))
      failed = true
    }

    // Joystick visível + ações flutuantes com alvo de toque e aria-label
    const joystick = page.locator('[data-testid="virtual-joystick"]')
    if ((await joystick.count()) === 1 && (await joystick.isVisible())) {
      pass("joystick virtual visível no celular")
    } else {
      fail("joystick virtual", "não renderizado no contexto touch")
      failed = true
    }
    const toolbar = await page.evaluate(() => {
      const element = document.querySelector(".toolbar")
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        direction: getComputedStyle(element).flexDirection,
        orientation: element.getAttribute("aria-orientation"),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        buttons: Array.from(element.querySelectorAll("button")).map((button) => {
          const buttonRect = button.getBoundingClientRect()
          return {
            label: button.getAttribute("aria-label") ?? "",
            width: buttonRect.width,
            height: buttonRect.height,
          }
        }),
      }
    })
    if (
      toolbar &&
      toolbar.direction === "column" &&
      toolbar.orientation === "vertical" &&
      toolbar.buttons.length >= 7 &&
      toolbar.buttons.every((button) => button.label && button.width >= 44 && button.height >= 44)
    ) {
      pass(
        "ações flutuantes (rail vertical, alvos ≥44px, aria-labels)",
        `${toolbar.buttons.length} botões · ${Math.round(toolbar.buttons[0].width)}x${Math.round(toolbar.buttons[0].height)} · aria-orientation=vertical`,
      )
    } else {
      fail("ações flutuantes", JSON.stringify(toolbar))
      failed = true
    }

    // Andar com o joystick: o avatar se move de verdade (posição em __gatherTest)
    try {
      const before = selfOf(await stateOf(page))
      const box = await joystick.boundingBox()
      if (!before || !box) throw new Error("sem posição inicial ou bounding box do joystick")
      const centerX = box.x + box.width / 2
      const centerY = box.y + box.height / 2
      await page.mouse.move(centerX, centerY)
      await page.mouse.down()
      await page.mouse.move(centerX + 60, centerY, { steps: 8 })
      let after = before
      await waitFor(
        "avatar andar com o joystick",
        async () => {
          after = selfOf(await stateOf(page)) ?? before
          return Math.hypot(after.x - before.x, after.y - before.y) > 12
        },
        5000,
      )
      await page.mouse.up()
      pass("arrastar o joystick move o avatar", `(${before.x},${before.y}) → (${after.x},${after.y})`)
      // Moves are sent at ~90ms intervals, so let the last queued position land first.
      await sleep(300)
      const released = selfOf(await stateOf(page))
      await sleep(400)
      const later = selfOf(await stateOf(page))
      const drift = released && later ? Math.hypot(later.x - released.x, later.y - released.y) : 0
      if (drift <= 2) pass("soltar o joystick para o avatar", `deriva ${drift.toFixed(1)}px`)
      else {
        fail("parada ao soltar o joystick", `deriva de ${drift.toFixed(1)}px`)
        failed = true
      }
    } catch (error) {
      fail("arrastar o joystick", error.message)
      failed = true
    }

    // Chat como bottom sheet: abre, envia e a mensagem aparece
    const sheetInfo = async (selector) =>
      page.evaluate((testId) => {
        const panel = document.querySelector(`[data-testid="${testId}"]`)
        if (!panel) return null
        const rect = panel.getBoundingClientRect()
        const head = panel.querySelector(".panel-head")
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          radius: getComputedStyle(panel).borderTopLeftRadius,
          headTouchAction: head ? getComputedStyle(head).touchAction : "",
        }
      }, selector)
    const isBottomSheet = (sheet) =>
      Boolean(
        sheet &&
          Math.abs(sheet.x) <= 1 &&
          Math.abs(sheet.width - sheet.viewportWidth) <= 1 &&
          Math.abs(sheet.bottom - sheet.viewportHeight) <= 1 &&
          sheet.y > sheet.viewportHeight * 0.15,
      )

    try {
      await page.click('[data-testid="toolbar-chat"]')
      await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 10000 })
      await sleep(250) // panel-in animation (6px) must settle before measuring the sheet
      const chatSheet = await sheetInfo("chat-panel")
      if (isBottomSheet(chatSheet) && chatSheet.radius !== "0px" && chatSheet.headTouchAction === "none") {
        pass("chat abre como bottom sheet (tela cheia na largura, cabeçalho arrastável)", `altura ${Math.round(chatSheet.height)}px`)
      } else {
        fail("chat como bottom sheet", JSON.stringify(chatSheet))
        failed = true
      }
      await page.fill('[data-testid="chat-input"]', CHAT_TEXT)
      await page.click('[data-testid="chat-send"]')
      await waitFor(
        "mensagem aparecer no chat",
        async () => ((await page.textContent('[data-testid="chat-messages"]')) ?? "").includes(CHAT_TEXT),
        10000,
      )
      pass("chat: abre e envia mensagem no celular", CHAT_TEXT)
      const inputVisible = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="chat-input"]')
        if (!input) return false
        const rect = input.getBoundingClientRect()
        return rect.top >= 0 && rect.bottom <= window.innerHeight + 1
      })
      if (inputVisible) pass("input do chat acima da safe-area (dentro da viewport)")
      else {
        fail("input do chat", "fora da viewport")
        failed = true
      }
      await page.keyboard.press("Escape")
      await page.waitForSelector('[data-testid="chat-panel"]', { state: "detached", timeout: 10000 })
      pass("Esc fecha o bottom sheet")
    } catch (error) {
      fail("chat no celular", error.message)
      failed = true
    }

    // Configurações abrem e fecham pelo botão
    try {
      await page.click('[data-testid="toolbar-settings"]')
      await page.waitForSelector('[data-testid="settings-panel"]', { timeout: 10000 })
      await sleep(250)
      const settingsSheet = await sheetInfo("settings-panel")
      if (!isBottomSheet(settingsSheet)) throw new Error(`não virou bottom sheet: ${JSON.stringify(settingsSheet)}`)
      await page.click('[aria-label="Fechar configurações"]')
      await page.waitForSelector('[data-testid="settings-panel"]', { state: "detached", timeout: 10000 })
      pass("configurações abrem como bottom sheet e fecham")
    } catch (error) {
      fail("configurações no celular", error.message)
      failed = true
    }

    // Participantes: abre e fecha com swipe para baixo no cabeçalho
    try {
      await page.click('[data-testid="toolbar-participants"]')
      await page.waitForSelector('[data-testid="participants-panel"]', { timeout: 10000 })
      await sleep(250)
      const head = await page.locator('[data-testid="participants-panel"] .panel-head').boundingBox()
      if (!head) throw new Error("cabeçalho sem bounding box")
      const startX = head.x + head.width / 2
      const startY = head.y + head.height / 2
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(startX, startY + 120, { steps: 10 })
      await page.mouse.up()
      await page.waitForSelector('[data-testid="participants-panel"]', { state: "detached", timeout: 10000 })
      pass("participantes abrem como bottom sheet e fecham com swipe para baixo")
    } catch (error) {
      fail("participantes no celular", error.message)
      failed = true
    }

    // Mídia: câmera alterna e a prévia local aparece
    try {
      const before = Boolean(selfOf(await stateOf(page))?.videoEnabled)
      await page.click('[data-testid="toolbar-camera"]')
      await waitFor("câmera alternar", async () => Boolean(selfOf(await stateOf(page))?.videoEnabled) !== before, 10000)
      const off = Boolean(selfOf(await stateOf(page))?.videoEnabled)
      await page.click('[data-testid="toolbar-camera"]')
      await waitFor("câmera voltar", async () => Boolean(selfOf(await stateOf(page))?.videoEnabled) === before, 10000)
      if (before) {
        await page.waitForSelector('[data-testid="self-camera-preview"]', { timeout: 15000 })
      }
      pass("mídia: câmera alterna e prévia local aparece", `ligada=${before} → ${off} → ${before}`)
    } catch (error) {
      fail("mídia no celular", error.message)
      failed = true
    }

    // Sem overflow horizontal em 390px e em 320px; HUD inteira dentro da viewport
    const overflowAt = async () =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        appHeight: getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim(),
        joystick: (() => {
          const element = document.querySelector('[data-testid="virtual-joystick"]')
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, bottom: rect.bottom }
        })(),
        toolbar: (() => {
          const element = document.querySelector(".toolbar")
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
        })(),
        connectionVisible: (() => {
          const label = document.querySelector('[data-testid="connection-status"]')
          if (!label) return false
          const rect = label.getBoundingClientRect()
          return rect.left >= 0 && rect.right <= window.innerWidth + 1
        })(),
      }))
    try {
      const wide = await overflowAt()
      if (wide.scrollWidth <= wide.innerWidth + 1) pass("sem rolagem horizontal em 390px", `scrollWidth=${wide.scrollWidth}`)
      else {
        fail("overflow em 390px", JSON.stringify(wide))
        failed = true
      }
      await page.setViewportSize({ width: 320, height: 640 })
      await sleep(300)
      const narrow = await overflowAt()
      const inside =
        narrow.joystick &&
        narrow.toolbar &&
        narrow.joystick.left >= 0 &&
        narrow.joystick.right <= 320 + 1 &&
        narrow.joystick.bottom <= 640 + 1 &&
        narrow.toolbar.left >= 0 &&
        narrow.toolbar.right <= 320 + 1 &&
        narrow.connectionVisible
      if (narrow.scrollWidth <= narrow.innerWidth + 1 && inside) {
        pass("sem rolagem horizontal em 320px e HUD dentro da viewport", `scrollWidth=${narrow.scrollWidth}`)
      } else {
        fail("320px", JSON.stringify(narrow))
        failed = true
      }
      if (narrow.appHeight === "640px") pass("viewport dinâmico acompanha o resize", narrow.appHeight)
      else {
        fail("viewport dinâmico no resize", `--app-height=${narrow.appHeight || "(vazio)"}`)
        failed = true
      }
      await page.setViewportSize(MOBILE_VIEWPORT)
      await sleep(300)
    } catch (error) {
      fail("overflow no celular", error.message)
      failed = true
    }

    // Toque: nada de zoom acidental (double-tap) nos controles e no canvas
    const touchActions = await page.evaluate(() => ({
      canvas: getComputedStyle(document.querySelector('[data-testid="office-canvas"]')).touchAction,
      joystick: getComputedStyle(document.querySelector('[data-testid="virtual-joystick"]')).touchAction,
      button: getComputedStyle(document.querySelector('[data-testid="toolbar-chat"]')).touchAction,
    }))
    if (touchActions.canvas === "none" && touchActions.joystick === "none" && touchActions.button === "manipulation") {
      pass("toque sem zoom/scroll acidental (touch-action)", JSON.stringify(touchActions))
    } else {
      fail("touch-action", JSON.stringify(touchActions))
      failed = true
    }

    // Safe-area: CSS servido e HUD afastada do notch/home indicator
    const safeArea = await page.evaluate(() => {
      const collect = (rules) => {
        let count = 0
        for (const rule of Array.from(rules)) {
          if (rule.cssText && rule.cssText.includes("safe-area-inset")) count += 1
          if (rule.cssRules) count += collect(rule.cssRules)
        }
        return count
      }
      let rules = 0
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          rules += collect(sheet.cssRules)
        } catch {
          // Cross-origin sheet (não há nenhuma na página servida).
        }
      }
      const topbar = document.querySelector(".topbar")?.getBoundingClientRect()
      return {
        rules,
        viewportFit: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
        topbarTop: topbar ? topbar.top : null,
      }
    })
    if (safeArea.rules > 0 && safeArea.viewportFit.includes("viewport-fit=cover") && (safeArea.topbarTop ?? -1) >= 7) {
      pass("safe-area aplicada (env(safe-area-inset), viewport-fit=cover)", `${safeArea.rules} regras no CSS`)
    } else {
      fail("safe-area", JSON.stringify(safeArea))
      failed = true
    }

    // Screenshot de evidência com a HUD mobile
    fs.mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, "mobile-office.png") })
    log("  📷 docs/online/mobile-office.png")
    pass("screenshot docs/online/mobile-office.png")

    if (pageErrors.length === 0) pass("celular sem erros de JavaScript")
    else {
      fail("erros de JavaScript no celular", pageErrors[0])
      failed = true
    }
    await mobileContext.close()

    // ── 1280x800, mouse: desktop continua sendo desktop ─────────────────────
    const desktopContext = await browser.newContext({ viewport: DESKTOP_VIEWPORT })
    await desktopContext.grantPermissions(["camera", "microphone"], { origin })
    const desktop = await desktopContext.newPage()
    const desktopErrors = []
    desktop.on("pageerror", (error) => desktopErrors.push(String(error)))
    await desktop.goto(`${origin}/join`, { waitUntil: "domcontentloaded", timeout: 30000 })
    await desktop.waitForSelector('[data-testid="office-canvas"]', { timeout: 30000 })
    await waitFor("desktop conectado", async () => (await stateOf(desktop))?.connection === "connected", 20000)
    const desktopLayout = await desktop.evaluate(() => {
      const toolbar = document.querySelector(".toolbar")
      const rect = toolbar.getBoundingClientRect()
      const lan = document.querySelector('[data-testid="lan-address"], [data-testid="share-room-link"]')
      return {
        joysticks: document.querySelectorAll('[data-testid="virtual-joystick"]').length,
        direction: getComputedStyle(toolbar).flexDirection,
        orientation: toolbar.getAttribute("aria-orientation"),
        width: rect.width,
        height: rect.height,
        topbarLink: Boolean(lan) && getComputedStyle(lan).display !== "none",
      }
    })
    if (
      desktopLayout.joysticks === 0 &&
      desktopLayout.direction === "row" &&
      desktopLayout.orientation === "horizontal" &&
      desktopLayout.width > 300 &&
      desktopLayout.height < 100 &&
      desktopLayout.topbarLink
    ) {
      pass("desktop inalterado (1280x800 sem joystick, toolbar horizontal, link da sala no topbar)")
    } else {
      fail("desktop inalterado", JSON.stringify(desktopLayout))
      failed = true
    }
    if (desktopErrors.length === 0) pass("desktop sem erros de JavaScript")
    else {
      fail("erros de JavaScript no desktop", desktopErrors[0])
      failed = true
    }
    await desktopContext.close()
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
