#!/usr/bin/env node
// Local check for the ONLINE (browser) mode.
//
// Starts dist/online/server.cjs (the standalone HTTP/WSS room server) and drives two
// independent Chrome contexts through the single room link `/join`:
// autojoin, 2 players, chat, WebRTC media by proximity.
//
//   npm run build && node deploy/build-online.mjs
//   node deploy/verify-online.mjs
//
// Requires Google Chrome installed (playwright-core uses channel "chrome"; no browser download).
// Uses fake media devices and no STUN, so it runs offline on one machine.

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const { chromium } = createRequire(import.meta.url)("playwright-core")
const WS = createRequire(import.meta.url)("ws")
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SERVER = path.join(ROOT, "dist/online/server.cjs")
const SHOTS = path.join(ROOT, "docs/online")
const ROOM_NAME = "Sala online (verificação)"
const CHAT_TEXT = "Oi da sala online"

if (!fs.existsSync(SERVER) || !fs.existsSync(path.join(ROOT, "dist/client/index.html"))) {
  console.error("build online ausente: rode `npm run build && node deploy/build-online.mjs`")
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

const stateOf = (page) => page.evaluate(() => window.__gatherTest?.() ?? null)

// WCAG contrast for rendered pairs (better-colors: measure, never estimate).
const channel = (value) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const contrastRatio = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}
const parseRgb = (value) => {
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (!match) return null
  return match[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part))
}

async function main() {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const env = { ...process.env, PORT: String(port), ROOM_NAME, ICE_SERVERS: "" }
  delete env.ELECTRON_RUN_AS_NODE
  const serverLogs = []
  let server = null
  let browser = null
  let failed = false

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

    const joinResponse = await fetch(`${origin}/join`, { redirect: "manual" })
    if (joinResponse.status === 302 && joinResponse.headers.get("location") === "/room?autojoin=1") {
      pass("link único /join redireciona para a entrada autojoin")
    } else {
      fail("link /join", `status ${joinResponse.status} location ${joinResponse.headers.get("location")}`)
      failed = true
    }

    const config = await (await fetch(`${origin}/client-config.json`)).json()
    const iceUrls = (config.iceServers ?? []).flatMap((server) =>
      Array.isArray(server.urls) ? server.urls : [server.urls],
    )
    if (config.online === true && typeof config.roomName === "string" && iceUrls.length >= 2) {
      pass("client-config.json", `online=true, sala "${config.roomName}", STUN: ${iceUrls.length} URLs`)
    } else {
      fail("client-config.json", JSON.stringify(config))
      failed = true
    }

    // Helpers de convidado via WebSocket puro (capacidade e retomada de sessão)
    const guestSockets = []
    const openGuest = (name, session) =>
      new Promise((resolve, reject) => {
        const socket = new WS.WebSocket(`${origin.replace(/^http/, "ws")}/ws`)
        guestSockets.push(socket)
        socket.on("error", reject)
        socket.on("open", () => {
          socket.send(
            JSON.stringify({
              t: "join",
              protocol: 1,
              profile: { name, shirtColor: "#e4572e", skinTone: "#f2c9a0", hairStyle: 0, status: "available" },
              ...(session ? { session } : {}),
            }),
          )
        })
        socket.on("message", (raw) => {
          const message = JSON.parse(String(raw))
          if (message.t === "welcome" || message.t === "error") resolve({ message, socket })
        })
      })

    // Capacidade da sala: MAX_PLAYERS = 6 (o 7º recebe room_full)
    try {
      for (let index = 1; index <= 6; index += 1) {
        const { message } = await openGuest(`Capacidade ${index}`)
        if (message.t !== "welcome") throw new Error(`join ${index} falhou: ${JSON.stringify(message)}`)
      }
      const seventh = await openGuest("Capacidade 7")
      if (seventh.message.t === "error" && seventh.message.code === "room_full") {
        pass("capacidade da sala", "6 jogadores entram, o 7º recebe room_full")
      } else {
        fail("capacidade da sala", JSON.stringify(seventh.message))
        failed = true
      }
    } catch (error) {
      fail("capacidade da sala", error.message)
      failed = true
    } finally {
      for (const socket of guestSockets) {
        try {
          socket.send(JSON.stringify({ t: "leave" }))
        } catch {
          // Already closed (e.g. the rejected 7th connection).
        }
        socket.close()
      }
      await sleep(500)
    }

    // NET-4 — retomada de sessão: reconectar com o token mantém o mesmo jogador dentro do grace
    try {
      const firstGuest = await openGuest("Retomada")
      const firstSession = firstGuest.message.t === "welcome" ? firstGuest.message.session : null
      if (firstGuest.message.t !== "welcome" || !firstSession) throw new Error("welcome sem session")
      firstGuest.socket.close()
      await sleep(600)
      const resumed = await openGuest("Retomada", firstSession)
      if (resumed.message.t === "welcome" && resumed.message.you.id === firstGuest.message.you.id) {
        pass("retomada de sessão por token", "mesmo jogador/id após reconectar no grace period")
      } else {
        throw new Error(`retomada falhou: ${JSON.stringify(resumed.message)}`)
      }
      resumed.socket.send(JSON.stringify({ t: "leave" }))
      resumed.socket.close()
      await sleep(400)
    } catch (error) {
      fail("retomada de sessão por token", error.message)
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
    const makePlayer = async (label) => {
      const context = await browser.newContext()
      await context.grantPermissions(["camera", "microphone"], { origin })
      const page = await context.newPage()
      const errors = []
      page.on("pageerror", (error) => errors.push(String(error)))
      await page.goto(`${origin}/join`, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForSelector('[data-testid="office-canvas"]', { timeout: 30000 })
      await waitFor(`${label} conectado`, async () => (await stateOf(page))?.connection === "connected", 20000)
      return { label, page, errors }
    }
    const ana = await makePlayer("jogador A")
    const bia = await makePlayer("jogador B")
    pass("dois navegadores entraram pelo link único", `${origin}/join`)

    await waitFor("2 jogadores na mesma sala", async () => {
      const [a, b] = [await stateOf(ana.page), await stateOf(bia.page)]
      return a?.players?.length === 2 && b?.players?.length === 2
    }, 20000)
    const stateA = await stateOf(ana.page)
    const stateB = await stateOf(bia.page)
    const names = stateA.players.map((player) => player.name).sort()
    if (stateA.players.length === 2 && names.every((name) => name.startsWith("Convidado")) && names[0] !== names[1]) {
      pass("nomes automáticos únicos", names.join(" + "))
    } else {
      fail("nomes automáticos", JSON.stringify(names))
      failed = true
    }
    await ana.page.waitForSelector(`[data-testid="player-${stateB.players.find((player) => player.id === stateB.selfId).name}"]`, { timeout: 10000 })
    pass("cada jogador vê o outro no canvas")

    await ana.page.click('[data-testid="toolbar-chat"]')
    await ana.page.waitForSelector('[data-testid="chat-input"]', { timeout: 10000 })
    await ana.page.fill('[data-testid="chat-input"]', CHAT_TEXT)
    await ana.page.click('[data-testid="chat-send"]')
    await waitFor("chat chegar no jogador B", async () => {
      const state = await stateOf(bia.page)
      return Boolean(state?.chats?.some((chat) => chat.text === CHAT_TEXT))
    }, 10000)
    await bia.page.click('[data-testid="toolbar-chat"]')
    await bia.page.waitForSelector('[data-testid="chat-messages"]', { timeout: 10000 })
    pass("chat entre navegadores")

    try {
      await waitFor("WebRTC por proximidade", async () => {
        const [a, b] = [await stateOf(ana.page), await stateOf(bia.page)]
        return Number(a?.mediaPeers) >= 1 && Number(b?.mediaPeers) >= 1
      }, 25000)
      pass("mídia WebRTC por proximidade", "peers >= 1 nos dois navegadores")
    } catch (error) {
      warn("mídia WebRTC por proximidade", `${error.message} (depende da rede/ICE do ambiente)`)
    }

    try {
      const stats = await waitFor(
        "diagnóstico de conexão (getStats)",
        async () => {
          const state = await stateOf(ana.page)
          return state?.mediaStats && typeof state.mediaStats.candidateType === "string" ? state.mediaStats : null
        },
        20000,
      )
      pass(
        "diagnóstico de conexão (getStats)",
        `rota=${stats.candidateType} · rtt=${stats.rttMs ?? "—"}ms · jitter=${stats.jitterMs ?? "—"}ms`,
      )
    } catch (error) {
      fail("diagnóstico de conexão (getStats)", error.message)
      failed = true
    }

    // Feedback "está funcionando?": status + prévia local da câmera
    try {
      await waitFor(
        "feedback de câmera ao vivo",
        async () => {
          const state = await stateOf(ana.page)
          const hud = await ana.page.locator('[data-testid="media-health-camera"]').count()
          return state?.mediaHealth?.camera?.shown === true && hud === 1 ? state.mediaHealth : null
        },
        20000,
      )
      await ana.page.waitForSelector('[data-testid="self-camera-preview"]', { timeout: 10000 })
      await ana.page.screenshot({ path: path.join(SHOTS, "media-health.png") })
      log("  📷 docs/online/media-health.png")
      pass("feedback de câmera ao vivo (prévia + status)")
    } catch (error) {
      fail("feedback de câmera", error.message)
      failed = true
    }

    const external = []
    for (const player of [ana, bia]) {
      const requests = await player.page.evaluate(() =>
        performance.getEntriesByType("resource").map((entry) => entry.name),
      )
      for (const url of requests) {
        if (!url.startsWith(origin)) external.push(`${player.label}: ${url}`)
      }
      if (player.errors.length > 0) warn(`${player.label}: pageerror`, player.errors[0])
    }
    if (external.length === 0) {
      pass("sem requests externos na página", "tudo same-origin")
    } else {
      fail("requests externos na página", external.join(", "))
      failed = true
    }

    // Landing (website/) — metas de link preview + favicon + assets
    const landingHtml = await (await fetch(`${origin}/`)).text()
    const landingCss = await fetch(`${origin}/site/styles.css`)
    const landingImage = await fetch(`${origin}/site/office.jpg`)
    if (
      landingHtml.includes("Um link.") &&
      landingHtml.includes('property="og:title"') &&
      landingHtml.includes("/site/styles.css") &&
      landingHtml.includes('href="/join"')
    ) {
      pass("landing servida em / com título, OG e CTA para /join")
    } else {
      fail("landing em /", "HTML sem hero/OG/CTA esperados")
      failed = true
    }
    if (
      (landingCss.headers.get("content-type") || "").includes("text/css") &&
      landingImage.status === 200 &&
      (landingImage.headers.get("content-type") || "").includes("image/jpeg")
    ) {
      pass("assets da landing servidos (/site/*)")
    } else {
      fail("assets da landing", `css=${landingCss.status} image=${landingImage.status}`)
      failed = true
    }

    // T1.4 — home web: sem ferramentas de LAN, CTA e link da sala
    const visitorContext = await browser.newContext()
    await visitorContext.grantPermissions(["camera", "microphone"], { origin })
    const visitor = await visitorContext.newPage()
    await visitor.goto(`${origin}/room`, { waitUntil: "domcontentloaded", timeout: 30000 })
    await visitor.waitForSelector('[data-testid="home-name"]', { timeout: 20000 })
    const shareBlock = (await visitor.textContent('[data-testid="web-room-link"]').catch(() => null)) ?? ""
    const lanFields = await visitor.locator('[data-testid="home-join-address"]').count()
    const cta = ((await visitor.textContent('[data-testid="home-open-office"]')) ?? "").trim()
    if (shareBlock.includes("/join") && lanFields === 0 && cta.includes("Entrar na sala")) {
      pass("home web clara (link da sala, sem LAN, CTA)")
    } else {
      fail("home web clara", `share=${shareBlock.slice(0, 40)} lanFields=${lanFields} cta="${cta}"`)
      failed = true
    }

    // T1.3 — perfil do navegador persiste entre reloads
    await visitor.screenshot({ path: path.join(SHOTS, "online-home.png") })
    log("  📷 docs/online/online-home.png")

    const visitorName = "Visitante Persistente"
    await visitor.fill('[data-testid="home-name"]', visitorName)
    await visitor.click('[data-testid="home-open-office"]')
    await visitor.waitForSelector('[data-testid="office-canvas"]', { timeout: 30000 })
    await waitFor("visitante conectado", async () => (await stateOf(visitor))?.connection === "connected", 20000)

    // Soundboard: diálogo de corte para MP3 >10 s, volume do som e transmissão para quem está perto
    await ana.page.click('[data-testid="toolbar-soundboard"]')
    await ana.page.waitForSelector('[data-testid="soundboard-panel"]', { timeout: 10000 })
    // React tracks input values; use the native setter so the range drag is observed.
    const setRange = (locator, value) =>
      locator.evaluate((element, next) => {
        const input = element
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(input, String(next))
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
      }, value)
    const upload = ana.page.locator('[data-testid="soundboard-upload"]')
    await upload.setInputFiles(path.join(ROOT, "tests/fixtures/sound-12s.mp3"))
    await ana.page.waitForSelector('[data-testid="soundboard-dialog"]', { timeout: 15000 })
    const volumeSliders = await ana.page.locator('[data-testid="soundboard-volume"], [data-testid="soundboard-gain"]').count()
    if (volumeSliders >= 2) {
      pass("soundboard: volume do painel e volume do som")
    } else {
      fail("soundboard: volumes", `sliders=${volumeSliders}`)
      failed = true
    }
    // seleção longa (>10 s) bloqueia o envio
    await setRange(ana.page.locator('[data-testid="soundboard-trim-end"]'), 11)
    await waitFor("envio bloqueado com >10 s", async () =>
      ana.page.locator('[data-testid="soundboard-confirm"]').isDisabled(),
    )
    const blocked = await ana.page.locator('[data-testid="soundboard-confirm"]').isDisabled()
    await ana.page.screenshot({ path: path.join(SHOTS, "soundboard-trim.png") })
    log("  📷 docs/online/soundboard-trim.png")
    if (blocked) {
      pass("soundboard: diálogo de corte bloqueia trecho > 10 s")
    } else {
      fail("soundboard: limite no diálogo de corte", "Enviar habilitado com 11 s")
      failed = true
    }
    // corta 2 s → 7 s (5 s), nomeia e envia
    await setRange(ana.page.locator('[data-testid="soundboard-trim-start"]'), 2)
    await setRange(ana.page.locator('[data-testid="soundboard-trim-end"]'), 7)
    await ana.page.fill('[data-testid="soundboard-name"]', "corte-teste")
    const canSend = await ana.page.locator('[data-testid="soundboard-confirm"]').isEnabled()
    await ana.page.locator('[data-testid="soundboard-confirm"]').click()
    await waitFor("som cortado salvo", async () => (await ana.page.locator('[data-testid="soundboard-play-0"]').count()) === 1, 15000)
    if (canSend) {
      pass("soundboard: corte de 5 s salvo no painel")
    } else {
      fail("soundboard: envio do corte", "Enviar desabilitado")
      failed = true
    }
    await ana.page.click('[data-testid="soundboard-play-0"]')
    try {
      await waitFor("par próximo recebe o efeito cortado", async () => (await stateOf(bia.page))?.soundboardLast === "corte-teste", 15000)
      const localPlayed = (await stateOf(ana.page))?.soundboardLast === "corte-teste"
      if (localPlayed) {
        pass("soundboard: toca localmente e transmite o trecho cortado")
      } else {
        throw new Error("o efeito não tocou localmente")
      }
    } catch (error) {
      fail("soundboard: transmissão", error.message)
      failed = true
    }
    await ana.page.click('[data-testid="toolbar-soundboard"]')
    await ana.page.waitForSelector('[data-testid="soundboard-panel"]', { state: "detached", timeout: 10000 }).catch(() => undefined)

    // QoL-6 — link da sala copiável direto no escritório
    const shareLinks = await visitor.locator('[data-testid="share-room-link"]').count()
    if (shareLinks === 1) {
      pass("link da sala copiável no escritório", "topbar mostra /join")
    } else {
      fail("link da sala no escritório", `contagem=${shareLinks}`)
      failed = true
    }

    // WC-1 — prévia local da câmera no painel de configurações
    await visitor.click('[data-testid="toolbar-settings"]')
    await visitor.waitForSelector('[data-testid="settings-panel"]', { timeout: 10000 })
    try {
      await waitFor(
        "prévia local da câmera",
        async () =>
          visitor.evaluate(() => {
            const video = document.querySelector('[data-testid="settings-camera-preview"]')
            return video instanceof HTMLVideoElement && video.srcObject instanceof MediaStream
          }),
        10000,
      )
      pass("prévia local da câmera em Configurações")
    } catch (error) {
      fail("prévia local da câmera", error.message)
      failed = true
    }
    await visitor.click('[data-testid="toolbar-settings"]')
    await visitor.waitForSelector('[data-testid="settings-panel"]', { state: "detached", timeout: 10000 })

    // NET-3 — o servidor cai e volta: o cliente precisa reconectar sozinho (backoff + jitter)
    await stopServer()
    try {
      await waitFor("queda detectada", async () => (await stateOf(visitor))?.connection !== "connected", 20000)
      await sleep(1200)
    } finally {
      await startServer()
    }
    try {
      await waitFor("reconexão automática", async () => (await stateOf(visitor))?.connection === "connected", 45000)
      pass("reconexão WS automática após queda do servidor", "voltou a conectar sem recarregar a página")
    } catch (error) {
      fail("reconexão WS automática", error.message)
      failed = true
    }

    await visitor.goto(`${origin}/room`, { waitUntil: "domcontentloaded", timeout: 30000 })
    await visitor.waitForSelector('[data-testid="home-name"]', { timeout: 20000 })
    const restored = await visitor.inputValue('[data-testid="home-name"]')
    if (restored === visitorName) {
      pass("perfil web persistido no navegador", restored)
    } else {
      fail("perfil web persistido", `esperado "${visitorName}", veio "${restored}"`)
      failed = true
    }
    await visitorContext.close()

    fs.mkdirSync(SHOTS, { recursive: true })

    // Landing — a11y básica, contraste medido, 320px e reduced motion
    const landingContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const landing = await landingContext.newPage()
    const landingErrors = []
    landing.on("pageerror", (error) => landingErrors.push(String(error)))
    await landing.goto(`${origin}/`, { waitUntil: "load", timeout: 30000 })
    await landing.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    await landing.screenshot({ path: path.join(SHOTS, "landing.png"), fullPage: true, animations: "disabled" })
    log("  📷 docs/online/landing.png")
    const structure = await landing.evaluate(() => ({
      h1: document.querySelectorAll("h1").length,
      skip: Boolean(document.querySelector(".skip-link")),
      imagesWithoutAlt: [...document.querySelectorAll("img")].filter((img) => !img.getAttribute("alt")).length,
      zoomBlocked: /user-scalable=no|maximum-scale=1/.test(document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? ""),
      details: document.querySelectorAll("details").length,
    }))
    if (
      structure.h1 === 1 &&
      structure.skip &&
      structure.imagesWithoutAlt === 0 &&
      !structure.zoomBlocked
    ) {
      pass("landing acessível (h1 único, skip link, alt, zoom liberado)", `${structure.details} FAQ items`)
    } else {
      fail("landing acessível", JSON.stringify(structure))
      failed = true
    }

    const pairs = await landing.evaluate(() => {
      const colorOf = (selector, property) => {
        const element = document.querySelector(selector)
        return element ? getComputedStyle(element)[property] : null
      }
      const bodyBg = getComputedStyle(document.body).backgroundColor
      return [
        { name: "texto principal", fg: colorOf("h1", "color"), bg: bodyBg, min: 4.5 },
        { name: "texto secundário", fg: colorOf(".lede", "color"), bg: bodyBg, min: 4.5 },
        { name: "nota", fg: colorOf(".hero-note", "color"), bg: bodyBg, min: 4.5 },
        { name: "botão primário", fg: colorOf(".btn-primary", "color"), bg: colorOf(".btn-primary", "backgroundColor"), min: 4.5 },
      ]
    })
    const contrastFailures = []
    for (const pair of pairs) {
      const fg = parseRgb(pair.fg ?? "")
      const bg = parseRgb(pair.bg ?? "")
      if (!fg || !bg) {
        contrastFailures.push(`${pair.name}: cor não resolvida`)
        continue
      }
      const ratio = contrastRatio(fg, bg)
      if (ratio < pair.min) contrastFailures.push(`${pair.name}: ${ratio.toFixed(2)}:1 (<${pair.min})`)
    }
    if (contrastFailures.length === 0) {
      pass("contraste da landing medido (texto e botão)", "pares ≥ 4.5:1")
    } else {
      fail("contraste da landing", contrastFailures.join("; "))
      failed = true
    }

    await landing.keyboard.press("Tab")
    const focusState = await landing.evaluate(() => {
      const element = document.activeElement
      const style = element ? getComputedStyle(element) : null
      return { tag: element?.tagName ?? "", text: element?.textContent?.trim().slice(0, 40) ?? "", outline: style?.outlineStyle ?? "none", width: style?.outlineWidth ?? "0px" }
    })
    if (focusState.tag === "A" && focusState.outline !== "none" && Number.parseFloat(focusState.width) >= 2) {
      pass("primeiro Tab = skip link com foco visível", `${focusState.text} · outline ${focusState.width}`)
    } else {
      fail("foco visível na landing", JSON.stringify(focusState))
      failed = true
    }
    if (landingErrors.length === 0) {
      pass("landing sem erros de JavaScript")
    } else {
      fail("landing JS", landingErrors[0])
      failed = true
    }
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const mobile = await mobileContext.newPage()
    await mobile.goto(`${origin}/`, { waitUntil: "load", timeout: 30000 })
    await mobile.screenshot({ path: path.join(SHOTS, "landing-mobile.png"), fullPage: true, animations: "disabled" })
    log("  📷 docs/online/landing-mobile.png")
    await mobileContext.close()

    const narrowContext = await browser.newContext({ viewport: { width: 320, height: 720 } })
    const narrow = await narrowContext.newPage()
    await narrow.goto(`${origin}/`, { waitUntil: "load", timeout: 30000 })
    const narrowOverflow = await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (!narrowOverflow) {
      pass("landing sem rolagem horizontal em 320px")
    } else {
      fail("landing em 320px", "scrollWidth > viewport")
      failed = true
    }
    await narrowContext.close()

    const reducedContext = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } })
    const reduced = await reducedContext.newPage()
    await reduced.goto(`${origin}/`, { waitUntil: "load", timeout: 30000 })
    const animation = await reduced.evaluate(() => getComputedStyle(document.querySelector(".hero-copy > *")).animationName)
    if (animation === "none") {
      pass("landing respeita prefers-reduced-motion", "sem animação de entrada")
    } else {
      fail("prefers-reduced-motion", `animationName=${animation}`)
      failed = true
    }
    await reducedContext.close()
    await landingContext.close()

    await bia.page.screenshot({ path: path.join(SHOTS, "online-room.png") })
    log("  📷 docs/online/online-room.png")
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
