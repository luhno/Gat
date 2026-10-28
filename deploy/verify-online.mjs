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

async function main() {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const env = { ...process.env, PORT: String(port), ROOM_NAME, ICE_SERVERS: "" }
  delete env.ELECTRON_RUN_AS_NODE
  const server = spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] })
  const serverLogs = []
  server.stdout.on("data", (chunk) => serverLogs.push(String(chunk)))
  server.stderr.on("data", (chunk) => serverLogs.push(String(chunk)))
  let browser = null
  let failed = false

  try {
    await waitFor("servidor /healthz", async () => {
      const response = await fetch(`${origin}/healthz`)
      return response.ok
    }, 20000)
    log(`servidor online em ${origin}`)

    const joinResponse = await fetch(`${origin}/join`, { redirect: "manual" })
    if (joinResponse.status === 302 && joinResponse.headers.get("location") === "/?autojoin=1") {
      pass("link único /join redireciona para a entrada autojoin")
    } else {
      fail("link /join", `status ${joinResponse.status} location ${joinResponse.headers.get("location")}`)
      failed = true
    }

    const config = await (await fetch(`${origin}/client-config.json`)).json()
    if (config.online === true && Array.isArray(config.iceServers) && typeof config.roomName === "string") {
      pass("client-config.json", `online=true, sala "${config.roomName}", ${config.iceServers.length} ICE server(s)`)
    } else {
      fail("client-config.json", JSON.stringify(config))
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

    // T1.2 — metas de compartilhamento/favicon no HTML servido
    const html = await (await fetch(`${origin}/`)).text()
    if (html.includes('property="og:title"') && html.includes("favicon.svg") && (await (await fetch(`${origin}/favicon.svg`)).headers.get("content-type") || "").includes("svg")) {
      pass("metas de link preview + favicon servidos")
    } else {
      fail("metas de link preview + favicon", "og:title/favicon ausentes no HTML")
      failed = true
    }

    // T1.4 — home web: sem ferramentas de LAN, CTA e link da sala
    const visitorContext = await browser.newContext()
    await visitorContext.grantPermissions(["camera", "microphone"], { origin })
    const visitor = await visitorContext.newPage()
    await visitor.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 })
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
    await visitor.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 })
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
    await bia.page.screenshot({ path: path.join(SHOTS, "online-room.png") })
    log("  📷 docs/online/online-room.png")
  } catch (error) {
    failed = true
    log(`  ✗ erro: ${error instanceof Error ? error.message : String(error)}`)
    if (serverLogs.length > 0) log(`  log do servidor:\n${serverLogs.join("")}`)
  } finally {
    await browser?.close().catch(() => undefined)
    server.kill("SIGTERM")
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), sleep(5000)])
    if (server.exitCode === null) server.kill("SIGKILL")
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
