import assert from "node:assert/strict"
import { X509Certificate } from "node:crypto"
import { promises as fs } from "node:fs"
import type { IncomingHttpHeaders } from "node:http"
import https from "node:https"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { WebSocket } from "ws"

import { PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH, clampToMap, findSpawn, isBlocked, resolveMovement, tileCenter } from "../../src/server/collision"
import { createRoom } from "../../src/server/room"
import { startRoomServer, type RoomServer } from "../../src/server/server"
import { getOrCreateTlsMaterial } from "../../src/server/tls"
import {
  createRateLimiter,
  sanitizeMediaPatch,
  sanitizeProfile,
  sanitizeProfilePatch,
  validateChat,
  validateMove,
  validatePing,
  validateSignal,
} from "../../src/server/validation"
import {
  CHAT_RATE_MAX,
  CHAT_RATE_WINDOW_MS,
  MAX_CHAT_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MOVE_RATE_MAX,
  MOVE_RATE_WINDOW_MS,
  WS_PATH,
} from "../../src/shared/constants"
import { DEFAULT_MAP } from "../../src/shared/defaultMap"
import { PROTOCOL_VERSION } from "../../src/shared/protocol"
import type { ClientMessage, ServerMessage } from "../../src/shared/protocol"
import type { OfficeMap, PlayerProfile } from "../../src/shared/types"

const PROFILE: PlayerProfile = {
  name: "Ana",
  shirtColor: "#e4572e",
  skinTone: "#f2c9a0",
  hairStyle: 0,
  status: "available",
}

const testMap = (): OfficeMap => {
  const width = 6
  const height = 6
  const walls = new Array<number>(width * height).fill(0)
  for (let x = 0; x < width; x++) {
    walls[x] = 1
    walls[(height - 1) * width + x] = 1
  }
  for (let y = 0; y < height; y++) {
    walls[y * width] = 1
    walls[y * width + width - 1] = 1
  }
  return {
    name: "test-map",
    width,
    height,
    tileSize: 32,
    floors: new Array<number>(width * height).fill(0),
    walls,
    objects: [
      { id: "desk", kind: "desk", x: 2, y: 2, w: 1, h: 1, solid: true },
      { id: "rug", kind: "rug", x: 1, y: 3, w: 2, h: 1, solid: false },
    ],
    zones: [],
    spawn: { x: 1, y: 1 },
  }
}

// --- process-wide cleanup so `node --test` always exits -------------------------------

const tmpDirs: string[] = []
const openServers: RoomServer[] = []
const openSockets: WebSocket[] = []

after(async () => {
  for (const ws of openSockets) ws.terminate()
  for (const server of openServers) await server.close().catch(() => undefined)
  for (const dir of tmpDirs) await fs.rm(dir, { recursive: true, force: true })
})

const tmpDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gather-offline-test-"))
  tmpDirs.push(dir)
  return dir
}

let storagePromise: Promise<string> | undefined
const sharedStorage = (): Promise<string> => (storagePromise ??= tmpDir())
const loadTls = async () => getOrCreateTlsMaterial(["localhost"], await sharedStorage())

const startServer = async (): Promise<RoomServer> => {
  const clientDir = path.join(await sharedStorage(), "client")
  await fs.mkdir(clientDir, { recursive: true })
  await fs.writeFile(path.join(clientDir, "index.html"), "<!doctype html><html><body>fake-client</body></html>")
  await fs.writeFile(path.join(clientDir, "app.js"), "globalThis.__fake = true")
  const server = await startRoomServer({ port: 0, clientDir, tls: await loadTls(), roomName: "Sala de teste" })
  openServers.push(server)
  return server
}

const httpsRequest = (url: string): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> =>
  new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: false, agent: false }, (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }))
      })
      .on("error", reject)
  })

const openSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false })
    openSockets.push(ws)
    ws.on("error", () => undefined)
    ws.once("open", () => resolve(ws))
    ws.once("error", reject)
  })

const nextMessage = (ws: WebSocket, timeoutMs = 5000): Promise<ServerMessage> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("timeout esperando mensagem do servidor"))
    }, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      ws.off("message", onMessage)
    }
    const onMessage = (raw: WebSocket.RawData): void => {
      cleanup()
      try {
        resolve(JSON.parse(String(raw)) as ServerMessage)
      } catch (error) {
        reject(error)
      }
    }
    ws.on("message", onMessage)
  })

const nextClose = (ws: WebSocket): Promise<number> => new Promise((resolve) => ws.once("close", (code: number) => resolve(code)))

const expectType = <T extends ServerMessage["t"]>(message: ServerMessage, type: T): Extract<ServerMessage, { t: T }> => {
  assert.equal(message.t, type)
  return message as Extract<ServerMessage, { t: T }>
}

const closeSocket = (ws: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    ws.once("close", () => resolve())
    ws.close()
  })

const wsUrl = (server: RoomServer, pathname = WS_PATH): string => `wss://127.0.0.1:${server.port}${pathname}`
const joinMessage = (profile: unknown = PROFILE, protocol: unknown = PROTOCOL_VERSION): string =>
  JSON.stringify({ t: "join", protocol, profile })
const asClient = (value: unknown): ClientMessage => value as ClientMessage

// --- pure validation ------------------------------------------------------------------

test("sanitizeProfile: perfil válido é normalizado, inválido é rejeitado", () => {
  assert.deepEqual(sanitizeProfile({ ...PROFILE, name: "  Ana  " }), PROFILE)
  assert.deepEqual(sanitizeProfile({ ...PROFILE, shirtColor: "#AABBCC" }), { ...PROFILE, shirtColor: "#AABBCC" })

  for (const invalid of [
    null,
    42,
    [],
    {},
    { ...PROFILE, name: "" },
    { ...PROFILE, name: "x".repeat(MAX_NAME_LENGTH + 1) },
    { ...PROFILE, name: "Ana\u0000" },
    { ...PROFILE, name: 7 },
    { ...PROFILE, shirtColor: "red" },
    { ...PROFILE, shirtColor: "#12345" },
    { ...PROFILE, skinTone: "#xyzxyz" },
    { ...PROFILE, hairStyle: 4 },
    { ...PROFILE, hairStyle: 1.5 },
    { ...PROFILE, status: "online" },
  ]) {
    assert.equal(sanitizeProfile(invalid), null)
  }
})

test("sanitizeProfilePatch e sanitizeMediaPatch descartam só os campos inválidos", () => {
  assert.deepEqual(sanitizeProfilePatch({ name: "Bia", shirtColor: "nope", hairStyle: 2, status: "busy" }), {
    name: "Bia",
    hairStyle: 2,
    status: "busy",
  })
  assert.equal(sanitizeProfilePatch({ name: "", hairStyle: 9 }), null)
  assert.equal(sanitizeProfilePatch(null), null)
  assert.deepEqual(sanitizeMediaPatch({ audioEnabled: true, videoEnabled: "yes", screenSharing: false }), {
    audioEnabled: true,
    screenSharing: false,
  })
  assert.equal(sanitizeMediaPatch({ audioEnabled: 1 }), null)
})

test("validateMove rejeita não-finitos, direção e moving inválidos", () => {
  assert.deepEqual(validateMove({ x: 10, y: 20, dir: "up", moving: true }), { x: 10, y: 20, dir: "up", moving: true })
  for (const invalid of [
    null,
    {},
    { x: Number.NaN, y: 20, dir: "up", moving: true },
    { x: 10, y: Number.POSITIVE_INFINITY, dir: "up", moving: true },
    { x: "10", y: 20, dir: "up", moving: true },
    { x: 10, y: 20, dir: "sideways", moving: true },
    { x: 10, y: 20, dir: "up", moving: 1 },
  ]) {
    assert.equal(validateMove(invalid), null)
  }
})

test("validateChat: trim, controle removido e limite de tamanho", () => {
  assert.equal(validateChat("  olá\r\nLAN  "), "oláLAN")
  assert.equal(validateChat("x".repeat(MAX_CHAT_LENGTH)), "x".repeat(MAX_CHAT_LENGTH))
  assert.equal(validateChat("x".repeat(MAX_CHAT_LENGTH + 1)), null)
  assert.equal(validateChat("   "), null)
  assert.equal(validateChat(42), null)
  assert.equal(validateChat("\u0000\u0001"), null)
})

test("validateSignal: só offer/answer/ice bem formados passam", () => {
  assert.deepEqual(validateSignal({ to: "peer-1", data: { kind: "offer", sdp: "v=0" } }), {
    to: "peer-1",
    data: { kind: "offer", sdp: "v=0" },
  })
  assert.deepEqual(validateSignal({ to: "peer-1", data: { kind: "ice", candidate: null } }), {
    to: "peer-1",
    data: { kind: "ice", candidate: null },
  })
  assert.deepEqual(
    validateSignal({
      to: "peer-1",
      data: { kind: "ice", candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } },
    }),
    { to: "peer-1", data: { kind: "ice", candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } } },
  )
  for (const invalid of [
    null,
    {},
    { to: "", data: { kind: "offer", sdp: "v=0" } },
    { to: "peer-1", data: { kind: "ping", sdp: "v=0" } },
    { to: "peer-1", data: { kind: "offer", sdp: 7 } },
    { to: "peer-1", data: { kind: "offer", sdp: "" } },
    { to: "peer-1", data: { kind: "answer", sdp: "x".repeat(20_000) } },
    { to: "peer-1", data: { kind: "ice", candidate: { candidate: "c", sdpMid: 1, sdpMLineIndex: 0 } } },
    { to: "peer-1", data: { kind: "ice", candidate: { candidate: "c", sdpMid: "0", sdpMLineIndex: -1 } } },
  ]) {
    assert.equal(validateSignal(invalid), null)
  }
  assert.equal(validatePing(123), 123)
  assert.equal(validatePing(Number.NaN), null)
  assert.equal(validatePing("123"), null)
})

test("createRateLimiter: janela deslizante por tempo injetado", () => {
  let current = 0
  const limiter = createRateLimiter(3, 1000, () => current)
  assert.equal(limiter.take(), true)
  assert.equal(limiter.take(), true)
  assert.equal(limiter.take(), true)
  assert.equal(limiter.take(), false)
  current = 999
  assert.equal(limiter.take(), false)
  current = 1000
  assert.equal(limiter.take(), true)
})

// --- collision (shared pixel math, re-exported by src/server/collision) ---------------

test("colisão: caixa 20x14 bloqueia paredes/objetos e desliza por eixo", () => {
  const map = testMap()
  assert.deepEqual(tileCenter(map, 1, 1), { x: 48, y: 48 })
  assert.equal(PLAYER_HALF_WIDTH, 10)
  assert.equal(PLAYER_HALF_HEIGHT, 7)

  assert.equal(isBlocked(map, 48, 48), false)
  assert.equal(isBlocked(map, tileCenter(map, 2, 2).x, tileCenter(map, 2, 2).y), true, "desk solid")
  assert.equal(isBlocked(map, 16, 16), true, "wall tile")
  assert.equal(isBlocked(map, tileCenter(map, 1, 3).x, tileCenter(map, 1, 3).y), false, "rug is not solid")
  assert.deepEqual(clampToMap(map, -500, -500), { x: 10, y: 7 })

  // Open floor: the target is accepted (staying on the free row above the desk).
  assert.deepEqual(resolveMovement(map, { x: 48, y: 48 }, { x: 60, y: 52 }), { x: 60, y: 52 })
  // Desk blocks the X axis; Y is free, so the move slides down.
  const slid = resolveMovement(map, { x: 48, y: 80 }, { x: 80, y: 144 })
  assert.deepEqual(slid, { x: 48, y: 144 })
  // From there the X axis is free.
  assert.deepEqual(resolveMovement(map, slid, { x: 80, y: 144 }), { x: 80, y: 144 })
  // Clamped target would sit on the border wall: both axes stay put.
  assert.deepEqual(resolveMovement(map, { x: 48, y: 48 }, { x: -1000, y: 48 }), { x: 48, y: 48 })
})

test("findSpawn usa map.spawn e evita tiles bloqueados/ocupados sem hardcode de dimensões", () => {
  const map = testMap()
  const base = findSpawn(map, [], () => 0)
  assert.deepEqual(base, tileCenter(map, map.spawn.x, map.spawn.y))
  assert.equal(isBlocked(map, base.x, base.y), false)

  const second = findSpawn(map, [base], () => 0)
  assert.equal(isBlocked(map, second.x, second.y), false)
  assert.ok(Math.hypot(second.x - base.x, second.y - base.y) >= map.tileSize * 0.9)

  const defaultSpawn = findSpawn(DEFAULT_MAP, [], () => 0)
  assert.equal(isBlocked(DEFAULT_MAP, defaultSpawn.x, defaultSpawn.y), false)
  assert.equal(defaultSpawn.x, tileCenter(DEFAULT_MAP, DEFAULT_MAP.spawn.x, DEFAULT_MAP.spawn.y).x)
  assert.equal(defaultSpawn.y, tileCenter(DEFAULT_MAP, DEFAULT_MAP.spawn.x, DEFAULT_MAP.spawn.y).y)
})

// --- room (transport-free, fake clients) ----------------------------------------------

interface FakeClient {
  client: { send(message: ServerMessage): void; close(): void }
  messages: ServerMessage[]
  take(): ServerMessage[]
  isClosed(): boolean
}

const fakeClient = (): FakeClient => {
  const messages: ServerMessage[] = []
  let closed = false
  return {
    client: {
      send: (message) => messages.push(message),
      close: () => {
        closed = true
      },
    },
    messages,
    take: () => messages.splice(0, messages.length),
    isClosed: () => closed,
  }
}

const idGenerator = (): (() => string) => {
  let next = 0
  return () => `player-${++next}`
}

const joinFake = (room: ReturnType<typeof createRoom>, fake: FakeClient, profile: unknown = PROFILE): string => {
  const result = room.join(fake.client, { protocol: PROTOCOL_VERSION, profile })
  if (!result.ok) assert.fail(`join deveria funcionar: ${result.code}`)
  return result.id
}

test("room: join manda welcome, playerJoined para os existentes e playerLeft ao sair", () => {
  const room = createRoom({ name: "Sala de teste", now: () => 1000, createId: idGenerator() })
  const a = fakeClient()
  const idA = joinFake(room, a)

  assert.equal(room.size(), 1)
  const welcomeA = expectType(a.messages[0]!, "welcome")
  assert.equal(welcomeA.protocol, PROTOCOL_VERSION)
  assert.equal(welcomeA.you.id, idA)
  assert.equal(welcomeA.you.x, tileCenter(DEFAULT_MAP, DEFAULT_MAP.spawn.x, DEFAULT_MAP.spawn.y).x)
  assert.equal(welcomeA.you.dir, "down")
  assert.equal(welcomeA.players.length, 1)
  assert.equal(welcomeA.room.name, "Sala de teste")
  assert.equal(welcomeA.serverTime, 1000)
  assert.deepEqual(welcomeA.map, DEFAULT_MAP)

  const b = fakeClient()
  const idB = joinFake(room, b, { ...PROFILE, name: "Bia" })
  const welcomeB = expectType(b.messages[0]!, "welcome")
  assert.equal(welcomeB.players.length, 2)
  assert.equal(welcomeB.you.name, "Bia")
  const joinedForA = expectType(a.messages[1]!, "playerJoined")
  assert.equal(joinedForA.player.id, idB)

  a.take()
  room.leave(idB)
  assert.equal(room.size(), 1)
  assert.equal(expectType(a.messages[0]!, "playerLeft").id, idB)
  a.take()
  room.leave("ghost")
  assert.equal(a.messages.length, 0)
})

test("room: rejeita protocolo errado, perfil inválido e sala cheia", () => {
  const room = createRoom({ createId: idGenerator() })
  const a = fakeClient()
  const badProtocol = room.join(a.client, { protocol: PROTOCOL_VERSION + 1, profile: PROFILE })
  assert.equal(badProtocol.ok, false)
  assert.equal(badProtocol.ok ? "" : badProtocol.code, "protocol_mismatch")
  const badProfile = room.join(a.client, { protocol: PROTOCOL_VERSION, profile: { ...PROFILE, name: "" } })
  assert.equal(badProfile.ok, false)
  assert.equal(badProfile.ok ? "" : badProfile.code, "invalid_profile")
  assert.equal(room.size(), 0)

  for (let i = 0; i < MAX_PLAYERS; i++) joinFake(room, fakeClient())
  const extra = room.join(fakeClient().client, { protocol: PROTOCOL_VERSION, profile: PROFILE })
  assert.equal(extra.ok, false)
  assert.equal(extra.ok ? "" : extra.code, "room_full")
})

test("room: move aceita posição válida, resolve parede, ignora não-finitos e respeita rate limit", () => {
  let clock = 1000
  const room = createRoom({ now: () => clock, createId: idGenerator() })
  const a = fakeClient()
  const b = fakeClient()
  const idA = joinFake(room, a)
  joinFake(room, b)
  const spawn = { x: tileCenter(DEFAULT_MAP, DEFAULT_MAP.spawn.x, DEFAULT_MAP.spawn.y).x, y: tileCenter(DEFAULT_MAP, DEFAULT_MAP.spawn.x, DEFAULT_MAP.spawn.y).y }
  a.take()
  b.take()

  const target = { x: spawn.x + 5, y: spawn.y + 5 }
  room.handle(idA, { t: "move", ...target, dir: "right", moving: true })
  const movedA = expectType(a.messages[0]!, "playerMoved")
  const movedB = expectType(b.messages[0]!, "playerMoved")
  assert.deepEqual({ x: movedA.x, y: movedA.y, dir: movedA.dir, moving: movedA.moving }, { ...target, dir: "right", moving: true })
  assert.equal(movedB.id, idA)

  a.take()
  b.take()
  room.handle(idA, asClient({ t: "move", x: Number.NaN, y: 0, dir: "up", moving: true }))
  room.handle(idA, asClient({ t: "move", x: spawn.x, y: spawn.y, dir: "sideways", moving: true }))
  assert.equal(a.messages.length, 0)

  // Moving into the border wall is resolved back to the current spot (never inside a wall).
  room.handle(idA, { t: "move", x: 0, y: 0, dir: "up", moving: true })
  const wallMoved = expectType(a.messages[0]!, "playerMoved")
  assert.equal(isBlocked(DEFAULT_MAP, wallMoved.x, wallMoved.y), false)
  assert.equal(wallMoved.x, target.x)

  a.take()
  b.take()
  clock += MOVE_RATE_WINDOW_MS
  for (let i = 0; i < MOVE_RATE_MAX + 2; i++) room.handle(idA, { t: "move", x: target.x, y: target.y, dir: "left", moving: false })
  assert.equal(a.messages.filter((message) => message.t === "playerMoved").length, MOVE_RATE_MAX)
})

test("room: chat faz broadcast, respeita rate limit e ignora inválidos", () => {
  let clock = 1000
  const room = createRoom({ now: () => clock, createId: idGenerator() })
  const a = fakeClient()
  const b = fakeClient()
  const idA = joinFake(room, a)
  joinFake(room, b)
  a.take()
  b.take()

  room.handle(idA, { t: "chat", text: "  olá sala  " })
  const chatA = expectType(a.messages[0]!, "chat")
  const chatB = expectType(b.messages[0]!, "chat")
  assert.equal(chatA.message.text, "olá sala")
  assert.equal(chatA.message.from, idA)
  assert.equal(chatA.message.name, PROFILE.name)
  assert.equal(chatA.message.shirtColor, PROFILE.shirtColor)
  assert.equal(chatA.message.at, clock)
  assert.deepEqual(chatB, chatA)

  a.take()
  b.take()
  room.handle(idA, { t: "chat", text: "" })
  room.handle(idA, asClient({ t: "chat", text: "x".repeat(MAX_CHAT_LENGTH + 1) }))
  room.handle(idA, asClient({ t: "chat", text: 42 }))
  assert.equal(a.messages.length, 0)

  clock += CHAT_RATE_WINDOW_MS
  for (let i = 1; i <= CHAT_RATE_MAX; i++) room.handle(idA, { t: "chat", text: `msg ${i}` })
  assert.equal(a.messages.length, CHAT_RATE_MAX)
  a.take()
  room.handle(idA, { t: "chat", text: "excedente" })
  assert.equal(a.messages.length, 0)
})

test("room: profile/media viram playerUpdated para todos, inclusive o autor", () => {
  const room = createRoom({ createId: idGenerator() })
  const a = fakeClient()
  const b = fakeClient()
  const idA = joinFake(room, a)
  joinFake(room, b)
  a.take()
  b.take()

  room.handle(idA, { t: "profile", patch: { name: "Ana Maria", status: "busy", shirtColor: "invalid" } })
  const updatedA = expectType(a.messages[0]!, "playerUpdated")
  const updatedB = expectType(b.messages[0]!, "playerUpdated")
  assert.deepEqual(updatedA, { t: "playerUpdated", id: idA, patch: { name: "Ana Maria", status: "busy" } })
  assert.deepEqual(updatedB, updatedA)

  a.take()
  b.take()
  room.handle(idA, { t: "media", patch: { audioEnabled: true, videoEnabled: false, screenSharing: false } })
  assert.deepEqual(expectType(a.messages[0]!, "playerUpdated").patch, { audioEnabled: true, videoEnabled: false, screenSharing: false })
  assert.deepEqual(expectType(b.messages[0]!, "playerUpdated").patch, { audioEnabled: true, videoEnabled: false, screenSharing: false })

  a.take()
  b.take()
  room.handle(idA, asClient({ t: "profile", patch: { name: "" } }))
  assert.equal(a.messages.length, 0)
  assert.equal(b.messages.length, 0)
})

test("room: signal vai só para o alvo existente; alvo inexistente é ignorado", () => {
  const room = createRoom({ createId: idGenerator() })
  const a = fakeClient()
  const b = fakeClient()
  const idA = joinFake(room, a)
  const idB = joinFake(room, b)
  a.take()
  b.take()

  room.handle(idA, { t: "signal", to: idB, data: { kind: "offer", sdp: "v=0" } })
  assert.equal(a.messages.length, 0)
  assert.deepEqual(expectType(b.messages[0]!, "signal"), { t: "signal", from: idA, data: { kind: "offer", sdp: "v=0" } })

  b.take()
  room.handle(idA, { t: "signal", to: "ghost", data: { kind: "answer", sdp: "v=0" } })
  room.handle(idA, { t: "signal", to: idA, data: { kind: "offer", sdp: "v=0" } })
  room.handle(idA, asClient({ t: "signal", to: idB, data: { kind: "offer", sdp: "" } }))
  assert.equal(b.messages.length, 0)
  assert.equal(a.messages.length, 0)
})

test("room: ping responde pong e join duplicado fecha a conexão", () => {
  const room = createRoom({ now: () => 4242, createId: idGenerator() })
  const a = fakeClient()
  const idA = joinFake(room, a)
  a.take()

  room.handle(idA, { t: "ping", at: 111 })
  assert.deepEqual(expectType(a.messages[0]!, "pong"), { t: "pong", at: 111, serverTime: 4242 })

  a.take()
  room.handle(idA, { t: "join", protocol: PROTOCOL_VERSION, profile: PROFILE })
  assert.equal(expectType(a.messages[0]!, "error").code, "already_joined")
  assert.equal(a.isClosed(), true)
})

// --- TLS ------------------------------------------------------------------------------

test("TLS: persiste, reusa quando SAN cobre e regenera quando não cobre", async () => {
  const storage = await tmpDir()
  const first = await getOrCreateTlsMaterial(["localhost"], storage)
  assert.match(first.fingerprint256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
  assert.equal(await fs.readFile(path.join(storage, "tls", "key.pem"), "utf8"), first.key)
  assert.equal(await fs.readFile(path.join(storage, "tls", "cert.pem"), "utf8"), first.cert)

  const sans = new X509Certificate(first.cert).subjectAltName ?? ""
  assert.match(sans, /DNS:localhost/)
  assert.match(sans, /IP Address:127\.0\.0\.1/)

  const reused = await getOrCreateTlsMaterial(["localhost"], storage)
  assert.equal(reused.fingerprint256, first.fingerprint256)

  const regenerated = await getOrCreateTlsMaterial(["Room-Test.local"], storage)
  assert.notEqual(regenerated.fingerprint256, first.fingerprint256)
  assert.match(new X509Certificate(regenerated.cert).subjectAltName ?? "", /DNS:room-test\.local/)

  await fs.writeFile(path.join(storage, "tls", "cert.pem"), "not a certificate")
  const recovered = await getOrCreateTlsMaterial(["localhost"], storage)
  assert.match(recovered.fingerprint256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
})

// --- HTTPS static server --------------------------------------------------------------

test("HTTPS: index, asset, SPA fallback, headers e bloqueio de path traversal", async () => {
  const server = await startServer()

  const index = await httpsRequest(server.url)
  assert.equal(index.status, 200)
  assert.match(index.headers["content-type"] ?? "", /text\/html/)
  assert.equal(index.headers["cache-control"], "no-store")
  assert.equal(index.headers["x-content-type-options"], "nosniff")
  assert.match(index.body, /fake-client/)

  const asset = await httpsRequest(`${server.url}app.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers["content-type"] ?? "", /text\/javascript/)
  assert.match(asset.body, /__fake/)

  const spa = await httpsRequest(`${server.url}rota/que-nao-existe`)
  assert.equal(spa.status, 200)
  assert.match(spa.body, /fake-client/)

  const traversal = await httpsRequest(`${server.url}..%2f..%2fpackage.json`)
  assert.equal(traversal.status, 403)
  assert.doesNotMatch(traversal.body, /gather-offline/)

  const method = await new Promise<number>((resolve, reject) => {
    const req = https.request(`${server.url}`, { method: "POST", rejectUnauthorized: false, agent: false }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on("error", reject)
    req.end("{}")
  })
  assert.equal(method, 405)
})

test("HTTPS: se a porta base estiver ocupada, sobe na seguinte", async () => {
  const blocker = net.createServer()
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject)
    blocker.listen(0, "0.0.0.0", resolve)
  })
  const address = blocker.address()
  const busyPort = typeof address === "object" && address !== null ? address.port : 0
  const clientDir = path.join(await sharedStorage(), "client")
  const server = await startRoomServer({ port: busyPort, clientDir, tls: await loadTls() })
  openServers.push(server)
  try {
    assert.equal(server.port, busyPort + 1)
    assert.equal(server.url, `https://127.0.0.1:${busyPort + 1}/`)
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  }
})

// --- WSS integration ------------------------------------------------------------------

test("WSS: dois clientes fazem join/welcome/move/chat/signal/leave", async () => {
  const server = await startServer()
  const a = await openSocket(wsUrl(server))
  const welcomeAPromise = nextMessage(a)
  a.send(joinMessage())
  const welcomeA = expectType(await welcomeAPromise, "welcome")
  assert.equal(welcomeA.protocol, PROTOCOL_VERSION)
  assert.equal(welcomeA.players.length, 1)
  assert.deepEqual(welcomeA.players[0]!.id, welcomeA.you.id)
  // JSON drops `undefined` keys (label), so compare the meaningful map fields, not the object.
  assert.equal(welcomeA.map.name, DEFAULT_MAP.name)
  assert.equal(welcomeA.map.width, DEFAULT_MAP.width)
  assert.equal(welcomeA.map.height, DEFAULT_MAP.height)
  assert.equal(welcomeA.map.tileSize, DEFAULT_MAP.tileSize)
  assert.deepEqual(welcomeA.map.spawn, DEFAULT_MAP.spawn)
  assert.deepEqual(welcomeA.map.walls, DEFAULT_MAP.walls)
  assert.deepEqual(welcomeA.map.objects, JSON.parse(JSON.stringify(DEFAULT_MAP.objects)))
  assert.equal(welcomeA.room.name, "Sala de teste")

  const b = await openSocket(wsUrl(server))
  const welcomeBPromise = nextMessage(b)
  const joinedAPromise = nextMessage(a)
  b.send(joinMessage({ ...PROFILE, name: "Bia" }))
  const welcomeB = expectType(await welcomeBPromise, "welcome")
  const joinedForA = expectType(await joinedAPromise, "playerJoined")
  assert.equal(joinedForA.player.id, welcomeB.you.id)
  assert.equal(welcomeB.players.length, 2)

  const target = { x: welcomeA.you.x + 5, y: welcomeA.you.y + 5 }
  const movedAPromise = nextMessage(a)
  const movedBPromise = nextMessage(b)
  a.send(JSON.stringify({ t: "move", ...target, dir: "right", moving: true }))
  const movedA = expectType(await movedAPromise, "playerMoved")
  const movedB = expectType(await movedBPromise, "playerMoved")
  assert.deepEqual({ id: movedA.id, x: movedA.x, y: movedA.y, dir: movedA.dir, moving: movedA.moving }, {
    id: welcomeA.you.id,
    ...target,
    dir: "right",
    moving: true,
  })
  assert.equal(movedB.id, welcomeA.you.id)

  const chatAPromise = nextMessage(a)
  const chatBPromise = nextMessage(b)
  a.send(JSON.stringify({ t: "chat", text: "olá LAN" }))
  const chatA = expectType(await chatAPromise, "chat")
  const chatB = expectType(await chatBPromise, "chat")
  assert.equal(chatA.message.text, "olá LAN")
  assert.equal(chatA.message.from, welcomeA.you.id)
  assert.equal(chatA.message.name, PROFILE.name)
  assert.deepEqual(chatB, chatA)

  const signalBPromise = nextMessage(b)
  a.send(JSON.stringify({ t: "signal", to: welcomeB.you.id, data: { kind: "offer", sdp: "v=0" } }))
  const signalB = expectType(await signalBPromise, "signal")
  assert.deepEqual(signalB, { t: "signal", from: welcomeA.you.id, data: { kind: "offer", sdp: "v=0" } })

  const leftAPromise = nextMessage(a)
  const closedB = nextClose(b)
  b.close()
  await closedB
  assert.equal(expectType(await leftAPromise, "playerLeft").id, welcomeB.you.id)

  await closeSocket(a)
})

test("WSS: mensagem antes do join e join inválido fecham a conexão com error", async () => {
  const server = await startServer()

  const early = await openSocket(wsUrl(server))
  const earlyErrorPromise = nextMessage(early)
  const earlyClosePromise = nextClose(early)
  early.send(JSON.stringify({ t: "move", x: 1, y: 1, dir: "up", moving: true }))
  assert.equal(expectType(await earlyErrorPromise, "error").code, "join_required")
  assert.equal(await earlyClosePromise, 1008)

  const invalid = await openSocket(wsUrl(server))
  const invalidErrorPromise = nextMessage(invalid)
  const invalidClosePromise = nextClose(invalid)
  invalid.send(joinMessage({ ...PROFILE, name: "" }))
  assert.equal(expectType(await invalidErrorPromise, "error").code, "invalid_profile")
  assert.equal(await invalidClosePromise, 1008)

  const badProtocol = await openSocket(wsUrl(server))
  const badProtocolErrorPromise = nextMessage(badProtocol)
  badProtocol.send(joinMessage(PROFILE, 999))
  assert.equal(expectType(await badProtocolErrorPromise, "error").code, "protocol_mismatch")
  await nextClose(badProtocol)
})

test("WSS: payload acima de MAX_MESSAGE_BYTES derruba a conexão", async () => {
  const server = await startServer()
  const ws = await openSocket(wsUrl(server))
  const welcomePromise = nextMessage(ws)
  ws.send(joinMessage())
  await welcomePromise

  const closePromise = nextClose(ws)
  ws.send("x".repeat(MAX_MESSAGE_BYTES + 1024))
  assert.equal(await closePromise, 1009)
})

test("WSS: upgrade para caminho diferente de WS_PATH é recusado", async () => {
  const server = await startServer()
  const error = await new Promise<Error>((resolve) => {
    const ws = new WebSocket(wsUrl(server, "/nao-e-ws"), { rejectUnauthorized: false })
    openSockets.push(ws)
    ws.on("error", (cause: Error) => resolve(cause))
  })
  assert.match(error.message, /404/)
})
