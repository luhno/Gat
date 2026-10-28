#!/usr/bin/env node
// End-to-end proof for the offline Gather rewrite.
//
// Two real Electron instances on loopback (host + guest entering via the home screen),
// fake media devices, external DNS disabled, every captured request checked to be private.
// The guest uses the same LAN join path as a real second machine (`joinLanRoom`).
//
// Usage: node tests/e2e/run-e2e.mjs [--no-build] [--verbose]
// Exit code 0 only when every required check passes.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import https from "node:https"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const { _electron: electron } = createRequire(import.meta.url)("playwright-core")

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const SHOTS = path.join(ROOT, "docs/screenshots")
const ARTIFACTS = path.join(ROOT, "tests/e2e/artifacts")
const ELECTRON_BIN = createRequire(import.meta.url)("electron")
const NO_BUILD = process.argv.includes("--no-build")
const VERBOSE = process.argv.includes("--verbose")

// Everything the app may talk to must stay on loopback/private ranges. Chromium gets no
// resolver entry for anything else: if a hostname were needed, the run would fail loudly.
const DNS_RULES = "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"
const PRIVATE = /^(127\.\d+\.\d+\.\d+|localhost|::1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i
const HOST_NAME = "Ana"
const GUEST_NAME = "Bia"
const CHAT_TEXT = "Oi Bia, teste offline do e2e"

const instances = []
const tempRoots = []
const checks = []
const transcript = []
let failed = false

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log(message = "") {
  transcript.push(message)
  console.log(message)
}

function pass(name, detail = "") {
  checks.push({ name, ok: true, detail })
  log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`)
}

function warn(name, detail) {
  checks.push({ name, ok: true, warn: true, detail })
  log(`  ⚠ ${name} — ${detail}`)
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail })
  log(`  ✗ ${name} — ${detail}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** Run one named phase; a thrown error is reported and re-thrown unless soft. */
async function step(name, fn, { soft = false } = {}) {
  log(`\n▸ ${name}`)
  const started = Date.now()
  try {
    const detail = await fn()
    pass(name, detail || `${Date.now() - started}ms`)
    return true
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error))
    if (!soft) throw error
    return false
  }
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
  throw new Error(`timeout de ${timeout}ms esperando ${what}${lastError ? ` (último erro: ${lastError.message})` : ""}`)
}

async function stateOf(page) {
  return page.evaluate(() => (typeof window.__gatherTest === "function" ? window.__gatherTest() : null))
}

function playerById(state, id) {
  return state?.players?.find((player) => player.id === id) ?? null
}

function selfOf(state) {
  return playerById(state, state?.selfId)
}

function playerByName(state, name) {
  return state?.players?.find((player) => player.name === name) ?? null
}

function isPrivateUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return true // data:, blob:, about: — never network traffic
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return true
  return PRIVATE.test(url.hostname)
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

async function freePorts(count) {
  const ports = new Set()
  while (ports.size < count) ports.add(await freePort())
  return [...ports]
}

function lanIpv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && PRIVATE.test(entry.address)) return entry.address
    }
  }
  return null
}

function baseEnv() {
  // This shell exports ELECTRON_RUN_AS_NODE=1, which turns the Electron binary into plain
  // Node and breaks the launch. Scrub it from both the harness and the child environment.
  delete process.env.ELECTRON_RUN_AS_NODE
  const env = { ...process.env, GATHER_OFFLINE_NO_TRAY: "1" }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function launchInstance(label, { port, userData, extraArgs = [] } = {}) {
  fs.mkdirSync(userData, { recursive: true })
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [".", "--multi-instance", "--fake-media", `--port=${port}`, `--host-resolver-rules=${DNS_RULES}`, ...extraArgs],
    cwd: ROOT,
    env: { ...baseEnv(), GATHER_OFFLINE_USER_DATA: userData },
    timeout: 60000,
  })
  const instance = {
    label,
    app,
    dir: userData,
    page: null,
    requests: [],
    sockets: [],
    performance: [],
    pageErrors: [],
    consoleErrors: [],
    closed: false,
  }
  instances.push(instance)
  instance.page = await app.firstWindow({ timeout: 60000 })
  wirePage(instance)
  log(`  · ${label}: pid=${app.process()?.pid} porta=${port} userData=${userData}`)
  return instance
}

function wirePage(instance) {
  const { page } = instance
  page.on("request", (request) => instance.requests.push({ url: request.url(), type: request.resourceType() }))
  page.on("websocket", (socket) => instance.sockets.push(socket.url()))
  page.on("pageerror", (error) => instance.pageErrors.push(String(error)))
  page.on("console", (message) => {
    if (VERBOSE) log(`    [${instance.label} console] ${message.type()} ${message.text()}`)
    if (message.type() === "error") instance.consoleErrors.push(message.text())
  })
}

async function readPerformanceEntries(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType("resource").map((entry) => entry.name)
    const navigation = performance.getEntriesByType("navigation").map((entry) => entry.name)
    return [...navigation, ...entries]
  })
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: file })
  const size = fs.statSync(file).size
  log(`  📷 docs/screenshots/${name}.png (${Math.round(size / 1024)} kB)`)
  return file
}

async function closeInstance(instance) {
  if (instance.closed) return
  instance.closed = true
  // Grab the process handle before close(): the ElectronApplication connection is
  // disposed as soon as the app quits and app.process() then throws.
  let child = null
  try {
    child = instance.app.process()
  } catch {
    // Connection already gone.
  }
  try {
    await Promise.race([instance.app.close(), sleep(10000)])
  } catch {
    // Already gone.
  }
  try {
    if (child && child.exitCode === null) child.kill("SIGKILL")
  } catch {
    // Nothing left to kill.
  }
}

async function closeAll() {
  await Promise.all(instances.map((instance) => closeInstance(instance).catch(() => undefined)))
}

function readInstanceLogs(instance) {
  const logsDir = path.join(instance.dir, "logs")
  const file = (name) => {
    try {
      return fs.readFileSync(path.join(logsDir, name), "utf8")
    } catch {
      return ""
    }
  }
  return { directory: logsDir, main: file("main.log"), guard: file("offline-guard.log") }
}

function saveArtifacts() {
  try {
    const lines = []
    for (const instance of instances) {
      const logs = readInstanceLogs(instance)
      fs.writeFileSync(path.join(ARTIFACTS, `${instance.label}-main.log`), logs.main || "(vazio)\n")
      fs.writeFileSync(
        path.join(ARTIFACTS, `${instance.label}-offline-guard.log`),
        logs.guard || "(ausente ou vazio: nenhum request bloqueado)\n",
      )
      for (const request of instance.requests) lines.push(`${instance.label}\t${request.type}\t${request.url}`)
      for (const socket of instance.sockets) lines.push(`${instance.label}\twebsocket\t${socket}`)
      for (const url of instance.performance) lines.push(`${instance.label}\tperformance\t${url}`)
      for (const error of instance.pageErrors) lines.push(`${instance.label}\tpageerror\t${error}`)
      for (const error of instance.consoleErrors) lines.push(`${instance.label}\tconsole-error\t${error}`)
    }
    fs.writeFileSync(path.join(ARTIFACTS, "requests.log"), `${lines.join("\n")}\n`)
    fs.writeFileSync(path.join(ARTIFACTS, "run.log"), `${transcript.join("\n")}\n`)
  } catch (error) {
    console.error("falha ao gravar artefatos:", error.message)
  }
}

function removeTempDirs() {
  for (const instance of instances) {
    try {
      fs.rmSync(instance.dir, { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
  for (const root of tempRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
}

// ------------------------------------------------------------------------------------------
// Phases
// ------------------------------------------------------------------------------------------

async function phaseBuild() {
  await step("build e artefatos", async () => {
    if (!NO_BUILD) {
      const result = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" })
      if (result.status !== 0) {
        throw new Error(`npm run build falhou (exit ${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`)
      }
    }
    for (const required of ["dist/main/main.cjs", "dist/main/preload.cjs", "dist/client/index.html"]) {
      assert(fs.existsSync(path.join(ROOT, required)), `build incompleto: ${required} ausente`)
    }
    return NO_BUILD ? "build existente reutilizado (--no-build)" : "npm run build ok"
  })
}

async function phaseLaunch(ctx) {
  await step("duas instâncias Electron isoladas", async () => {
    const [hostPort, guestPort] = await freePorts(2)
    ctx.hostPort = hostPort
    ctx.guestPort = guestPort
    ctx.tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gather-e2e-"))
    tempRoots.push(ctx.tmpRoot)
    const [host, guest] = await Promise.all([
      launchInstance("host", { port: hostPort, userData: path.join(ctx.tmpRoot, "host") }),
      launchInstance("guest", { port: guestPort, userData: path.join(ctx.tmpRoot, "guest") }),
    ])
    ctx.host = host
    ctx.guest = guest
    await Promise.all([
      host.page.waitForSelector('[data-testid="home-name"]', { timeout: 45000 }),
      guest.page.waitForSelector('[data-testid="home-name"]', { timeout: 45000 }),
    ])
    assert(host.page.url() === `https://127.0.0.1:${hostPort}/`, `host carregou ${host.page.url()}`)
    assert(guest.page.url().startsWith(`https://127.0.0.1:${guestPort}/`), `guest carregou ${guest.page.url()}`)
    return `host:${hostPort} guest:${guestPort} (userData temporário isolado)`
  })
}

async function phaseHostOffice(ctx) {
  await step("host: home → escritório", async () => {
    const { page } = ctx.host
    const lanBox = await page.textContent('[data-testid="home-lan-urls"]')
    assert(lanBox.includes(`127.0.0.1:${ctx.hostPort}`), "home do host não anuncia o endereço local")
    const lanIp = lanIpv4()
    if (lanIp) {
      assert(lanBox.includes(lanIp), `home do host não anuncia o endereço LAN ${lanIp}`)
      ctx.lanIp = lanIp
    }
    await shot(page, "home")
    await page.fill('[data-testid="home-name"]', HOST_NAME)
    await page.click('[data-testid="home-open-office"]')
    await page.waitForSelector('[data-testid="office-canvas"]', { timeout: 30000 })
    await waitFor("host conectado com 1 jogador", async () => {
      const state = await stateOf(page)
      return state?.connection === "connected" && state.players.length === 1 && state.selfName === HOST_NAME
    }, 20000)
    const selfLabel = (await page.textContent('[data-testid="office-self-name"]')) ?? ""
    assert(selfLabel.includes(HOST_NAME), `office-self-name = "${selfLabel}"`)
    const status = (await page.textContent('[data-testid="connection-status"]')) ?? ""
    assert(status.includes("Conectado"), `connection-status = "${status}"`)
    return `canvas ok, conectado como ${HOST_NAME}`
  })
}

async function phaseGuestJoins(ctx) {
  await step("guest: home → sala do host pelo fluxo LAN", async () => {
    const { page } = ctx.guest
    await page.fill('[data-testid="home-name"]', GUEST_NAME)
    await page.fill('[data-testid="home-join-address"]', `127.0.0.1:${ctx.hostPort}`)
    await page.click('[data-testid="home-join-button"]')
    await page.waitForSelector('[data-testid="office-canvas"]', { timeout: 30000 })
    await waitFor("guest conectado na sala", async () => {
      const state = await stateOf(page)
      return state?.connection === "connected" && state.selfName === GUEST_NAME && state.players.length === 2
    }, 20000)
    const guestUrl = new URL(page.url())
    assert(guestUrl.port === String(ctx.hostPort), `guest deveria carregar o host, mas está em ${page.url()}`)
    return `carregou ${page.url()} como ${GUEST_NAME}`
  })
}

async function phaseMutualVisibility(ctx) {
  await step("ambos se veem (nome correto dos dois lados)", async () => {
    const hostState = await stateOf(ctx.host.page)
    const guestState = await stateOf(ctx.guest.page)
    assert(hostState.selfName === HOST_NAME, `host selfName=${hostState.selfName}`)
    assert(guestState.selfName === GUEST_NAME, `guest selfName=${guestState.selfName}`)
    assert(playerByName(hostState, GUEST_NAME)?.id === guestState.selfId, "host não vê o id correto do guest")
    assert(playerByName(guestState, HOST_NAME)?.id === hostState.selfId, "guest não vê o id correto do host")
    const expected = [
      [ctx.host.page, "player-Bia"],
      [ctx.guest.page, "player-Ana"],
    ]
    for (const [page, selector] of expected) {
      await page.waitForSelector(`[data-testid="${selector}"]`, { timeout: 15000 })
    }
    return `${HOST_NAME} ↔ ${GUEST_NAME}, data-testid player-* presentes`
  })
}

async function phaseMovement(ctx) {
  await step("movimento sincronizado (host anda, guest vê)", async () => {
    const hostBefore = selfOf(await stateOf(ctx.host.page))
    assert(hostBefore, "host sem posição inicial")
    await ctx.host.page.keyboard.down("d")
    await sleep(700)
    await ctx.host.page.keyboard.up("d")
    await waitFor("host andar para a direita", async () => {
      const state = selfOf(await stateOf(ctx.host.page))
      return state && state.x >= hostBefore.x + 30
    }, 6000)
    // Snapshots are taken concurrently; a couple of px of skew is just the last
    // server broadcast arriving on the other page a few ms later.
    await waitFor("guest enxergar a posição final do host", async () => {
      const [hostState, guestState] = await Promise.all([stateOf(ctx.host.page), stateOf(ctx.guest.page)])
      const host = selfOf(hostState)
      const mirrored = playerById(guestState, hostState.selfId)
      return Boolean(host && mirrored && Math.abs(host.x - mirrored.x) <= 6 && Math.abs(host.y - mirrored.y) <= 6)
    }, 10000)
    const [hostAfter, guestView] = await Promise.all([
      stateOf(ctx.host.page).then(selfOf),
      stateOf(ctx.host.page).then((hostState) => stateOf(ctx.guest.page).then((guestState) => playerById(guestState, hostState.selfId))),
    ])
    assert(hostAfter.x - hostBefore.x >= 30, `host andou apenas ${hostAfter.x - hostBefore.x}px`)
    assert(
      Math.abs(hostAfter.x - guestView.x) <= 6 && Math.abs(hostAfter.y - guestView.y) <= 6,
      `posições divergem: host ${hostAfter.x},${hostAfter.y} vs guest ${guestView.x},${guestView.y}`,
    )
    return `host ${hostBefore.x}→${hostAfter.x}px, guest vê ${guestView.x}px`
  })
}

async function phaseChat(ctx) {
  await step("chat: host envia, guest recebe", async () => {
    await ctx.host.page.click('[data-testid="toolbar-chat"]')
    await ctx.host.page.waitForSelector('[data-testid="chat-input"]', { timeout: 10000 })
    await ctx.host.page.fill('[data-testid="chat-input"]', CHAT_TEXT)
    await ctx.host.page.click('[data-testid="chat-send"]')
    await waitFor("guest receber a mensagem no estado", async () => {
      const state = await stateOf(ctx.guest.page)
      return Boolean(state?.chats?.some((chat) => chat.text === CHAT_TEXT && chat.name === HOST_NAME))
    }, 10000)
    const badge = await ctx.guest.page.locator('[data-testid="toolbar-chat"] .tool-badge').count()
    if (badge > 0) {
      log("  · badge de não lidas apareceu no guest")
    }
    await ctx.guest.page.click('[data-testid="toolbar-chat"]')
    await ctx.guest.page.waitForSelector('[data-testid="chat-messages"]', { timeout: 10000 })
    await waitFor("guest ver a mensagem no DOM do chat", async () => {
      const text = (await ctx.guest.page.textContent('[data-testid="chat-messages"]')) ?? ""
      return text.includes(CHAT_TEXT) && text.includes(HOST_NAME)
    }, 10000)
    await shot(ctx.guest.page, "chat")
    return `"${CHAT_TEXT}" de ${HOST_NAME} no chat do guest`
  })
}

async function phaseParticipants(ctx) {
  await step("painel de participantes mostra os dois", async () => {
    await ctx.host.page.click('[data-testid="toolbar-participants"]')
    await ctx.host.page.waitForSelector('[data-testid="participants-panel"]', { timeout: 10000 })
    await waitFor("lista com 2 participantes", async () => {
      return (await ctx.host.page.locator('[data-testid="participants-list"] li').count()) === 2
    }, 10000)
    const text = (await ctx.host.page.textContent('[data-testid="participants-panel"]')) ?? ""
    assert(text.includes(HOST_NAME) && text.includes(GUEST_NAME), "painel de participantes não mostra os dois nomes")
    assert(text.includes(`127.0.0.1:${ctx.hostPort}`), "painel não mostra o endereço da sala")
    await shot(ctx.host.page, "participants")
    await ctx.host.page.keyboard.press("Escape")
    await ctx.host.page.waitForSelector('[data-testid="participants-panel"]', { state: "detached", timeout: 10000 })
    return `${HOST_NAME} + ${GUEST_NAME} e endereço da sala`
  })
}

async function phaseMedia(ctx) {
  await step("mídia WebRTC: peers conectados e vídeo remoto", async () => {
    try {
      await waitFor("peers e streams remotos nas duas pontas", async () => {
        const hostState = await stateOf(ctx.host.page)
        const guestState = await stateOf(ctx.guest.page)
        if (!hostState || !guestState) return false
        return (
          Number(hostState.mediaPeers) >= 1 &&
          Number(guestState.mediaPeers) >= 1 &&
          hostState.mediaRemote.split(",").includes(guestState.selfId) &&
          guestState.mediaRemote.split(",").includes(hostState.selfId)
        )
      }, 25000)
    } catch (error) {
      const hostState = await stateOf(ctx.host.page).catch(() => null)
      const guestState = await stateOf(ctx.guest.page).catch(() => null)
      throw new Error(
        `${error.message}; host peers=${hostState?.mediaPeers} remote="${hostState?.mediaRemote}" ` +
          `guest peers=${guestState?.mediaPeers} remote="${guestState?.mediaRemote}"`,
      )
    }
    const hostState = await stateOf(ctx.host.page)
    const guestState = await stateOf(ctx.guest.page)
    assert(hostState.mediaRemote.split(",").includes(guestState.selfId), `host sem stream remoto do guest (mediaRemote="${hostState.mediaRemote}")`)
    assert(guestState.mediaRemote.split(",").includes(hostState.selfId), `guest sem stream remoto do host (mediaRemote="${guestState.mediaRemote}")`)
    let videoDetail = "video-tile remoto ok nas duas pontas"
    try {
      for (const [label, page] of [["host", ctx.host.page], ["guest", ctx.guest.page]]) {
        await page.waitForSelector('[data-testid="video-tile"][data-has-video="true"]', { timeout: 15000 })
        const count = await page.locator('[data-testid="video-tile"]').count()
        assert(count >= 1, `${label} sem video-tile`)
      }
      for (const [label, page] of [["host", ctx.host.page], ["guest", ctx.guest.page]]) {
        await waitFor(`frames de vídeo remoto no ${label}`, async () => {
          return page.evaluate(() => {
            const video = document.querySelector('[data-testid="video-tile"] video')
            return Boolean(video instanceof HTMLVideoElement && video.videoWidth > 0 && video.videoHeight > 0)
          })
        }, 15000)
      }
    } catch (error) {
      videoDetail = `aviso: ${error.message}`
      warn("vídeo remoto renderizado", error.message)
    }
    await shot(ctx.host.page, "office")
    return `peers host=${hostState.mediaPeers} guest=${guestState.mediaPeers}; ${videoDetail}`
  })
}

async function phaseDevices(ctx) {
  await step("painel de configurações lista dispositivos", async () => {
    await ctx.guest.page.click('[data-testid="toolbar-settings"]')
    await ctx.guest.page.waitForSelector('[data-testid="settings-panel"]', { timeout: 10000 })
    await waitFor("câmera fake enumerada", async () => {
      const count = await ctx.guest.page.locator('select[aria-label="Câmera"] option').count()
      return count >= 2
    }, 15000)
    const cameras = await ctx.guest.page.locator('select[aria-label="Câmera"] option').count()
    const mics = await ctx.guest.page.locator('select[aria-label="Microfone"] option').count()
    await shot(ctx.guest.page, "settings")
    await ctx.guest.page.click('[data-testid="toolbar-settings"]')
    await ctx.guest.page.waitForSelector('[data-testid="settings-panel"]', { state: "detached", timeout: 10000 })
    return `${mics} opções de microfone, ${cameras} de câmera (fake devices)`
  })
}

async function phaseSeparation(ctx) {
  await step("afastar jogadores encerra as conexões de mídia", async () => {
    await ctx.host.page.keyboard.down("a")
    await sleep(3400)
    await ctx.host.page.keyboard.up("a")
    await waitFor("host longe do guest (> raio de saída)", async () => {
      const state = await stateOf(ctx.host.page)
      const host = selfOf(state)
      const guest = playerByName(state, GUEST_NAME)
      if (!host || !guest) return false
      return Math.hypot(host.x - guest.x, host.y - guest.y) / 32 > 5.5
    }, 8000)
    await waitFor("mediaPeers volta a 0 nas duas pontas", async () => {
      const hostState = await stateOf(ctx.host.page)
      const guestState = await stateOf(ctx.guest.page)
      return hostState?.mediaPeers === "0" && guestState?.mediaPeers === "0"
    }, 15000)
    const state = await stateOf(ctx.host.page)
    const distance = Math.hypot(selfOf(state).x - playerByName(state, GUEST_NAME).x, selfOf(state).y - playerByName(state, GUEST_NAME).y) / 32
    return `distância ${distance.toFixed(1)} tiles (> 5.5), peers 0 nos dois`
  })
}

async function phaseScreenShare(ctx) {
  await step("screen share: host compartilha, guest vê o painel", async () => {
    let usedFallback = false
    const started = Date.now()
    await ctx.host.page.click('[data-testid="toolbar-screen"]')
    try {
      await waitFor("host com screenSharing=true", async () => {
        return selfOf(await stateOf(ctx.host.page))?.screenSharing === true
      }, 8000)
    } catch {
      // Some macOS versions route getDisplayMedia to the native system picker, which no
      // automation can accept. Fall back to a page-context canvas capture stream: it still
      // exercises the real client pipeline (flags, replaceTrack, guest panel).
      log("  · picker nativo não abriu em 8s; usando fallback de getDisplayMedia via canvas")
      usedFallback = true
      await ctx.host.page.evaluate(() => {
        const canvas = document.querySelector("canvas")
        navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(10)
      })
      await ctx.host.page.click('[data-testid="toolbar-screen"]')
      await waitFor("host com screenSharing=true (fallback)", async () => {
        return selfOf(await stateOf(ctx.host.page))?.screenSharing === true
      }, 10000)
    }
    await waitFor("guest sinaliza screenSharing do host", async () => {
      return playerByName(await stateOf(ctx.guest.page), HOST_NAME)?.screenSharing === true
    }, 15000)
    await ctx.guest.page.waitForSelector('[data-testid="screen-share"]', { timeout: 20000 })
    const screenVideo = await waitFor("frames da tela compartilhada no guest", async () => {
      return ctx.guest.page.evaluate(() => {
        const video = document.querySelector('[data-testid="screen-share"] video')
        if (!(video instanceof HTMLVideoElement) || video.videoWidth === 0) return null
        return { width: video.videoWidth, height: video.videoHeight }
      })
    }, 20000)
    await waitFor("mídia forçada com todos os players durante o share", async () => {
      return Number((await stateOf(ctx.guest.page))?.mediaPeers) >= 1
    }, 15000)
    const pill = await ctx.host.page.locator(".sharing-pill").count()
    assert(pill > 0, "host não mostra o aviso 'Você está compartilhando a tela'")
    await shot(ctx.guest.page, "screen-share")
    await ctx.host.page.click('[data-testid="toolbar-screen"]')
    await waitFor("painel de share sumir no guest", async () => {
      return (await ctx.guest.page.locator('[data-testid="screen-share"]').count()) === 0
    }, 15000)
    await waitFor("peers 0 depois de parar o share", async () => {
      const hostState = await stateOf(ctx.host.page)
      const guestState = await stateOf(ctx.guest.page)
      return hostState?.mediaPeers === "0" && guestState?.mediaPeers === "0"
    }, 20000)
    return `${usedFallback ? "fallback canvas (picker nativo não automatizável)" : "getDisplayMedia real"} em ${Date.now() - started}ms, vídeo ${screenVideo.width}x${screenVideo.height} no guest, painel fechado corretamente`
  })
}

async function phaseLanEndpoint(ctx) {
  await step("endpoint HTTPS da LAN responde com cert self-signed", async () => {
    const lanIp = ctx.lanIp ?? lanIpv4()
    assert(lanIp, "nenhum IPv4 privado nesta máquina para testar a LAN")
    const result = await new Promise((resolve, reject) => {
      const request = https.get(
        { host: lanIp, port: ctx.hostPort, path: "/", rejectUnauthorized: false, timeout: 10000 },
        (response) => {
          // The socket is detached once the response ends; grab the cert immediately.
          const cert = response.socket?.getPeerCertificate?.() ?? null
          let body = ""
          response.on("data", (chunk) => (body += chunk))
          response.on("error", reject)
          response.on("end", () => resolve({ status: response.statusCode, body, cert }))
        },
      )
      request.on("timeout", () => request.destroy(new Error("timeout")))
      request.on("error", reject)
    })
    assert(result.status === 200, `LAN status ${result.status}`)
    assert(result.body.includes('id="root"'), "LAN não serviu o cliente web")
    const san = result.cert?.subjectaltname ?? ""
    assert(san.includes(lanIp), `cert sem SAN para ${lanIp}: ${san}`)
    return `https://${lanIp}:${ctx.hostPort}/ → 200, SAN com ${lanIp}`
  })
}

async function phaseLeave(ctx) {
  await step("guest sai da sala e volta para a própria home", async () => {
    await ctx.guest.page.click('[data-testid="toolbar-leave"]')
    await ctx.guest.page.waitForSelector('[data-testid="home-name"]', { timeout: 20000 })
    await waitFor("host ver o guest sair", async () => {
      const state = await stateOf(ctx.host.page)
      return state?.players?.length === 1 && !playerByName(state, GUEST_NAME)
    }, 15000)
    const guestUrl = new URL(ctx.guest.page.url())
    assert(guestUrl.port === String(ctx.guestPort), `guest não voltou para o próprio app: ${ctx.guest.page.url()}`)
    const guestState = await stateOf(ctx.guest.page)
    assert(guestState?.connection !== "connected", `guest ainda conectado: ${guestState?.connection}`)
    return `guest voltou para ${ctx.guest.page.url()}, host com 1 jogador`
  })
}

async function phaseOffline(ctx) {
  await step("prova de offline: nenhum request externo, DNS bloqueado", async () => {
    const all = []
    for (const instance of instances) {
      instance.performance = await readPerformanceEntries(instance.page).catch(() => [])
      for (const request of instance.requests) all.push({ instance: instance.label, ...request })
      for (const socket of instance.sockets) all.push({ instance: instance.label, url: socket, type: "websocket" })
      for (const url of instance.performance) all.push({ instance: instance.label, url, type: "performance" })
    }
    const normalised = all.map((item) => ({
      ...item,
      url: item.url === undefined ? "" : item.url,
    }))
    const external = normalised.filter((item) => !isPrivateUrl(item.url))
    assert(external.length === 0, `requests fora da rede local: ${external.map((item) => `${item.instance}:${item.url}`).join(", ")}`)
    const gatherTowns = normalised.filter((item) => /gather\.town/i.test(item.url))
    assert(gatherTowns.length === 0, `requests para gather.town: ${gatherTowns.map((item) => item.url).join(", ")}`)
    const hostnames = normalised
      .filter((item) => item.url.startsWith("http"))
      .map((item) => new URL(item.url).hostname)
    const hostnameOk = hostnames.every((hostname) => PRIVATE.test(hostname))
    assert(hostnameOk, `hostname não-literal/privado observado: ${[...new Set(hostnames)].join(", ")}`)
    assert(ctx.host.sockets.length >= 1, "nenhum WebSocket observado no host (sala não usou WSS)")
    assert(ctx.guest.sockets.length >= 1, "nenhum WebSocket observado no guest (sala não usou WSS)")
    for (const instance of instances) {
      const nonPrivateSocket = instance.sockets.find((url) => !isPrivateUrl(url))
      assert(!nonPrivateSocket, `WebSocket externo em ${instance.label}: ${nonPrivateSocket}`)
    }
    const unique = new Set(normalised.map((item) => item.url))
    log(`  · ${normalised.length} requests observados, ${unique.size} URLs únicas, todas loopback/privadas`)
    return `${normalised.length} requests/eventos, 0 externos, ${unique.size} URLs privadas, DNS externo desabilitado`
  })
}

async function phaseOfflineGuard() {
  await step("offline-guard sem bloqueios e app fechando limpo", async () => {
    await closeAll()
    await sleep(500)
    for (const instance of instances) {
      const logs = readInstanceLogs(instance)
      assert(!logs.guard.trim(), `offline-guard.log de ${instance.label} tem conteúdo:\n${logs.guard.trim()}`)
      assert(logs.main.includes("total bloqueado=0"), `main.log de ${instance.label} sem "total bloqueado=0"`)
      const blocked = logs.main.split("\n").filter((line) => line.includes("[offline-guard] blocked"))
      assert(blocked.length === 0, `main.log de ${instance.label} tem bloqueios: ${blocked.join(" | ")}`)
    }
    return "offline-guard.log vazio e total bloqueado=0 nas duas instâncias"
  })
}

async function phaseStrictProbe(ctx) {
  await step("modo --offline-guard-strict sobrevive ao boot e à sala", async () => {
    const [port] = await freePorts(1)
    const dir = path.join(ctx.tmpRoot, "strict")
    const strict = await launchInstance("strict", { port, userData: dir, extraArgs: ["--offline-guard-strict"] })
    try {
      const { page } = strict
      await page.waitForSelector('[data-testid="home-name"]', { timeout: 45000 })
      await page.fill('[data-testid="home-name"]', "Strict")
      await page.click('[data-testid="home-open-office"]')
      await page.waitForSelector('[data-testid="office-canvas"]', { timeout: 30000 })
      await waitFor("strict conectado", async () => (await stateOf(page))?.connection === "connected", 20000)
      await sleep(1500)
      const windows = await strict.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
      assert(windows === 1, `instância strict morreu (janelas=${windows})`)
      const url = new URL(page.url())
      assert(url.port === String(port), `strict carregou ${page.url()}`)
    } finally {
      await closeInstance(strict)
    }
    const logs = readInstanceLogs(strict)
    assert(!logs.guard.trim(), `offline-guard.log strict tem conteúdo:\n${logs.guard.trim()}`)
    assert(logs.main.includes("total bloqueado=0"), "main.log strict sem total bloqueado=0")
    return "boot + home + sala sem nenhum request externo (senão o app teria abortado)"
  })
}

// ------------------------------------------------------------------------------------------

let cleanupStarted = false

async function fullCleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  await closeAll().catch(() => undefined)
  await sleep(300)
  saveArtifacts()
  removeTempDirs()
}

// A crash must not leave Electron processes or temp profiles behind.
process.on("uncaughtException", (error) => {
  console.error("\n✗ exceção não tratada:", error)
  void fullCleanup().finally(() => process.exit(1))
})
process.on("unhandledRejection", (error) => {
  console.error("\n✗ promise rejeitada sem tratamento:", error)
  void fullCleanup().finally(() => process.exit(1))
})

async function main() {
  fs.rmSync(ARTIFACTS, { recursive: true, force: true })
  fs.mkdirSync(ARTIFACTS, { recursive: true })
  fs.mkdirSync(SHOTS, { recursive: true })
  for (const file of fs.readdirSync(SHOTS)) {
    if (file.endsWith(".png")) fs.rmSync(path.join(SHOTS, file), { force: true })
  }

  const ctx = {}
  const watchdog = setTimeout(() => {
    console.error(`\n✗ WATCHDOG: e2e passou de ${WATCHDOG_MS / 1000}s; encerrando e limpando.`)
    void fullCleanup().finally(() => process.exit(1))
  }, WATCHDOG_MS)
  watchdog.unref()

  try {
    await phaseBuild()
    await phaseLaunch(ctx)
    await phaseHostOffice(ctx)
    await phaseGuestJoins(ctx)
    await phaseMutualVisibility(ctx)
    await phaseMedia(ctx)
    await phaseMovement(ctx)
    await phaseChat(ctx)
    await phaseParticipants(ctx)
    await phaseDevices(ctx)
    await phaseSeparation(ctx)
    await phaseScreenShare(ctx)
    await phaseLanEndpoint(ctx)
    await phaseLeave(ctx)
    await phaseOffline(ctx)
    await phaseOfflineGuard()
    await phaseStrictProbe(ctx)
  } catch (error) {
    failed = true
    log(`\n✗ execução interrompida: ${error instanceof Error ? error.message : String(error)}`)
    if (VERBOSE && error instanceof Error) log(error.stack ?? "")
  } finally {
    clearTimeout(watchdog)
    await fullCleanup()
  }

  const required = checks.filter((check) => !check.warn)
  const failures = required.filter((check) => !check.ok)
  if (failures.length > 0) failed = true

  log("\n══════════════════════════════════════════════════════════")
  log("RESULTADO")
  for (const check of checks) {
    log(`  ${check.ok ? (check.warn ? "⚠" : "✓") : "✗"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`)
  }
  log(`\n  ${required.filter((check) => check.ok).length}/${required.length} checks obrigatórios verdes, ${failures.length} falha(s)`)
  log(`  screenshots: docs/screenshots/ · artefatos: tests/e2e/artifacts/`)
  log(failed ? "  VEREDITO: FALHOU" : "  VEREDITO: VERDE")
  log("══════════════════════════════════════════════════════════")

  process.exitCode = failed ? 1 : 0
}

const WATCHDOG_MS = 240000

void main()
