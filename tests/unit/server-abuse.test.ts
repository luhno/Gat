import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { promises as fs } from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { WebSocket } from "ws"

import { DEFAULT_ICE_SERVERS, parseIceServers } from "../../src/online/ice"
import { startRoomServer, type IceServerConfig, type RoomServer, type StartRoomServerOptions } from "../../src/server/server"
import { WS_PATH } from "../../src/shared/constants"

// Transport abuse/edge cases for the public web deploy: Origin/Host, caps, budgets, security
// headers, SPA 404, ICE/TURN. Plain HTTP (tls: null) keeps it fast; the TLS path shares the code.

const tmpDirs: string[] = []
const openServers: RoomServer[] = []
const openSockets: WebSocket[] = []

after(async () => {
  for (const ws of openSockets) ws.terminate()
  for (const server of openServers) await server.close().catch(() => undefined)
  for (const dir of tmpDirs) await fs.rm(dir, { recursive: true, force: true })
})

const tmpDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dittoapp-abuse-"))
  tmpDirs.push(dir)
  return dir
}

const startServer = async (options: Partial<StartRoomServerOptions> = {}): Promise<RoomServer> => {
  const clientDir = await tmpDir()
  await fs.mkdir(clientDir, { recursive: true })
  await fs.writeFile(path.join(clientDir, "index.html"), "<!doctype html><html><body>abuse-client</body></html>")
  await fs.writeFile(path.join(clientDir, "app.js"), "globalThis.__fakeAbuse = true")
  await fs.writeFile(path.join(clientDir, "app.js.map"), "{}")
  const server = await startRoomServer({ port: 0, clientDir, tls: null, online: true, roomName: "Sala de abuso", ...options })
  openServers.push(server)
  return server
}

const baseUrl = (server: RoomServer): string => `http://127.0.0.1:${server.port}`
const wsUrl = (server: RoomServer): string => `ws://127.0.0.1:${server.port}${WS_PATH}`

const httpGet = async (url: string): Promise<{ status: number; headers: Headers; body: string }> => {
  const response = await fetch(url)
  return { status: response.status, headers: response.headers, body: await response.text() }
}

const openSocket = (url: string, options?: WebSocket.ClientOptions): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    openSockets.push(ws)
    ws.on("error", () => undefined)
    ws.once("open", () => resolve(ws))
    ws.once("error", reject)
  })

const expectRefusal = (url: string, options?: WebSocket.ClientOptions): Promise<number> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    openSockets.push(ws)
    ws.once("open", () => reject(new Error(`conexão aceita indevidamente: ${url}`)))
    ws.once("error", (error: Error) => {
      const status = Number(/response: (\d{3})/.exec(error.message)?.[1] ?? 0)
      resolve(status)
    })
  })

const closeSocket = (ws: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    ws.once("close", () => resolve())
    ws.close()
  })

const nextClose = (ws: WebSocket, timeoutMs = 3000): Promise<number> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout esperando close do servidor")), timeoutMs)
    ws.once("close", (code: number) => {
      clearTimeout(timer)
      resolve(code)
    })
  })

const joinMessage = (): string =>
  JSON.stringify({
    t: "join",
    protocol: 1,
    profile: { name: "Abuso", shirtColor: "#e4572e", skinTone: "#f2c9a0", hairStyle: 0, status: "available" },
  })

// --- P0-2: Origin/Host ----------------------------------------------------------------

test("upgrade: mesma origem/protocolo sem Origin é aceito; Origin estranho é 403", async () => {
  const server = await startServer()

  const sameOrigin = await openSocket(wsUrl(server), { headers: { origin: `http://127.0.0.1:${server.port}` } })
  await closeSocket(sameOrigin)

  const noOrigin = await openSocket(wsUrl(server))
  await closeSocket(noOrigin)

  assert.equal(await expectRefusal(wsUrl(server), { headers: { origin: "https://evil.example" } }), 403)
  assert.equal(await expectRefusal(wsUrl(server), { headers: { origin: "null" } }), 403)
})

test("upgrade: allowedHosts recusa Host desconhecido e mantém localhost/browser same-origin", async () => {
  const server = await startServer({ allowedHosts: ["ditto.example"] })

  const loopback = await openSocket(wsUrl(server), { headers: { origin: `http://127.0.0.1:${server.port}` } })
  await closeSocket(loopback)

  const publicHost = await openSocket(wsUrl(server), { headers: { host: "ditto.example", origin: "https://ditto.example" } })
  await closeSocket(publicHost)

  assert.equal(await expectRefusal(wsUrl(server), { headers: { host: "evil.example", origin: "https://evil.example" } }), 403)
})

// --- P0-3 + P0-10: fallback SPA, sourcemaps e headers ---------------------------------

test("HTTP: headers de segurança em HTML/JSON e SPA fallback só para rota sem extensão", async () => {
  const server = await startServer()

  const room = await httpGet(`${baseUrl(server)}/room`)
  assert.equal(room.status, 200)
  assert.match(room.headers.get("content-type") ?? "", /text\/html/)
  assert.match(room.body, /abuse-client/)
  assert.equal(room.headers.get("x-frame-options"), "DENY")
  assert.equal(room.headers.get("referrer-policy"), "no-referrer")
  assert.equal(room.headers.get("x-content-type-options"), "nosniff")
  assert.match(room.headers.get("permissions-policy") ?? "", /camera=\(self\)/)
  assert.match(room.headers.get("permissions-policy") ?? "", /microphone=\(self\)/)
  assert.match(room.headers.get("permissions-policy") ?? "", /display-capture=\(self\)/)
  const csp = room.headers.get("content-security-policy") ?? ""
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(csp.includes(directive), `CSP sem "${directive}": ${csp}`)
  }

  const config = await httpGet(`${baseUrl(server)}/client-config.json`)
  assert.equal(config.status, 200)
  assert.match(config.headers.get("content-type") ?? "", /application\/json/)
  assert.equal(config.headers.get("x-frame-options"), "DENY")
  assert.match(config.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/)

  const join = await fetch(`${baseUrl(server)}/join`, { redirect: "manual" })
  assert.equal(join.status, 302)
  assert.equal(join.headers.get("x-frame-options"), "DENY")

  const missingAsset = await httpGet(`${baseUrl(server)}/assets/nope.js`)
  assert.equal(missingAsset.status, 404)
  assert.doesNotMatch(missingAsset.body, /abuse-client/)
  assert.equal(missingAsset.headers.get("x-frame-options"), "DENY")

  // The file exists on disk but sourcemaps are never served.
  assert.equal((await httpGet(`${baseUrl(server)}/app.js.map`)).status, 404)

  const spaRoute = await httpGet(`${baseUrl(server)}/rota/que-nao-existe`)
  assert.equal(spaRoute.status, 200)
  assert.match(spaRoute.body, /abuse-client/)
})

// --- P0-1: join timeout, caps e orçamento por conexão ---------------------------------

test("conexão que não faz join é fechada com 1008; quem faz join continua aberto", async () => {
  const server = await startServer({ joinTimeoutMs: 150 })
  const idle = await openSocket(wsUrl(server))
  assert.equal(await nextClose(idle), 1008)

  const joined = await openSocket(wsUrl(server))
  joined.send(joinMessage())
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(joined.readyState, WebSocket.OPEN)
  await closeSocket(joined)
})

test("tetos de conexão: global 503 e por IP 429 (X-Forwarded-For só com trustProxy)", async () => {
  const global = await startServer({ maxConnections: 2, joinTimeoutMs: 5000 })
  const first = await openSocket(wsUrl(global))
  const second = await openSocket(wsUrl(global))
  assert.equal(await expectRefusal(wsUrl(global)), 503)
  await closeSocket(first)
  await closeSocket(second)

  const perIp = await startServer({ maxConnectionsPerIp: 1, joinTimeoutMs: 5000 })
  const only = await openSocket(wsUrl(perIp))
  assert.equal(await expectRefusal(wsUrl(perIp)), 429)
  await closeSocket(only)

  const proxy = await startServer({ maxConnectionsPerIp: 1, trustProxy: true, joinTimeoutMs: 5000 })
  // The proxy appends the real IP at the end; a spoofed first entry must not create a new bucket.
  const ipA = await openSocket(wsUrl(proxy), { headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.1" } })
  const ipB = await openSocket(wsUrl(proxy), { headers: { "x-forwarded-for": "198.51.100.8, 203.0.113.2" } })
  assert.equal(await expectRefusal(wsUrl(proxy), { headers: { "x-forwarded-for": "198.51.100.7, 203.0.113.1" } }), 429)
  await closeSocket(ipA)
  await closeSocket(ipB)
})

test("HTTP: allowlist de Host recusa DNS rebinding (healthz isento)", async () => {
  const server = await startServer({ allowedHosts: ["ditto.example"] })
  assert.equal((await fetch(`${baseUrl(server)}/healthz`)).status, 200)

  const evilLanding = await new Promise<number>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: server.port, path: "/room", headers: { host: "evil.example" } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      .on("error", reject)
  })
  assert.equal(evilLanding, 421)

  const allowedHost = await new Promise<number>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: server.port, path: "/room", headers: { host: "ditto.example" } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      .on("error", reject)
  })
  assert.equal(allowedHost, 200)
})

test("CLIENT_DIR sem index.html falha no boot (não sobe 'saudável' com app 404)", async () => {
  const emptyDir = await tmpDir()
  await assert.rejects(
    () => startRoomServer({ port: 0, clientDir: emptyDir, tls: null }),
    /CLIENT_DIR inválido/,
  )
})

test("orçamento pré-JSON.parse: flood de frames e de bytes fecha com 1008", async () => {
  const frames = await startServer({ maxFramesPerSecond: 4, maxBytesPerSecond: 1024 * 1024 })
  const flood = await openSocket(wsUrl(frames))
  flood.send(joinMessage())
  for (let index = 0; index < 12; index += 1) flood.send("lixo")
  assert.equal(await nextClose(flood), 1008)

  const bytes = await startServer({ maxFramesPerSecond: 1000, maxBytesPerSecond: 256 })
  const big = await openSocket(wsUrl(bytes))
  big.send(joinMessage())
  big.send("x".repeat(512))
  assert.equal(await nextClose(big), 1008)
})

// --- P0-11: ICE_SERVERS e credencial TURN efêmera -------------------------------------

test("parseIceServers: JSON/CSV válidos, [] desliga e inválido cai no STUN padrão com erro", () => {
  assert.deepEqual(parseIceServers(undefined), DEFAULT_ICE_SERVERS)
  assert.deepEqual(parseIceServers("   "), DEFAULT_ICE_SERVERS)
  assert.deepEqual(parseIceServers("[]"), [])

  const json = '[{"urls":"turn:turn.example:3478","username":"u","credential":"p"},{"urls":["stun:a:3478","stuns:b:5349"]}]'
  assert.deepEqual(parseIceServers(json), [
    { urls: "turn:turn.example:3478", username: "u", credential: "p" },
    { urls: ["stun:a:3478", "stuns:b:5349"] },
  ])
  assert.deepEqual(parseIceServers("stun:a:3478, stun:b:3478"), [{ urls: "stun:a:3478" }, { urls: "stun:b:3478" }])

  for (const invalid of ['[{"urls":123}]', '[{"urls":"http://x"}]', '[{"urls":[]}]', '{"urls":"stun:x"}', "{nao-json"]) {
    const logs: string[] = []
    assert.deepEqual(parseIceServers(invalid, (message) => logs.push(message)), DEFAULT_ICE_SERVERS, invalid)
    assert.ok(logs.length > 0, `sem erro explícito para ${invalid}`)
  }
})

test("client-config.json: TURN efêmero (HMAC-SHA1, rotação, TTL) com TURN_SECRET", async () => {
  const nowSeconds = (): number => Math.floor(Date.now() / 1000)
  const expectedCredential = (username: string): string => createHmac("sha1", "s3cret").update(username).digest("base64")
  const iceServers: IceServerConfig[] = [
    { urls: "stun:stun.example.org:3478" },
    { urls: "turn:turn.example.com:3478", username: "static-user", credential: "static-pass" },
  ]
  const fetchServers = async (server: RoomServer) =>
    (JSON.parse((await httpGet(`${baseUrl(server)}/client-config.json`)).body) as { iceServers: IceServerConfig[] }).iceServers
  const turnOf = (servers: IceServerConfig[]): IceServerConfig => {
    const turn = servers.find((server) => String(server.urls).includes("turn:"))
    assert.ok(turn)
    return turn
  }

  const server = await startServer({ iceServers, turnSecret: "s3cret", turnTtlSeconds: 120 })
  const first = await fetchServers(server)
  const firstTurn = turnOf(first)
  assert.match(firstTurn.username ?? "", /^\d+:[0-9a-f-]{36}$/)
  assert.equal(firstTurn.credential, expectedCredential(firstTurn.username ?? ""))
  const expiry = Number(firstTurn.username?.split(":")[0])
  assert.ok(expiry >= nowSeconds() + 115 && expiry <= nowSeconds() + 125, `expiry fora do TTL: ${expiry}`)
  assert.equal(first.find((entry) => String(entry.urls).includes("stun:"))?.username, undefined)

  const secondTurn = turnOf(await fetchServers(server))
  assert.notEqual(secondTurn.username, firstTurn.username)
  assert.equal(secondTurn.credential, expectedCredential(secondTurn.username ?? ""))

  const defaultsTtl = await startServer({ iceServers, turnSecret: "s3cret" })
  const defaultExpiry = Number(turnOf(await fetchServers(defaultsTtl)).username?.split(":")[0])
  assert.ok(defaultExpiry >= nowSeconds() + 3590 && defaultExpiry <= nowSeconds() + 3610, `TTL padrão: ${defaultExpiry}`)

  const staticOnly = await startServer({ iceServers })
  assert.deepEqual(await fetchServers(staticOnly), iceServers)
})
