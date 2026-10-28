// Soundboard: a small local library of MP3 clips (≤10 s, 20 effects) that plays locally and is
// broadcast to nearby peers through the room WebSocket (bytes are relayed, never stored).
import {
  MAX_SOUNDBOARD_CHUNKS,
  MAX_SOUNDBOARD_EFFECTS,
  MAX_SOUNDBOARD_FILE_BYTES,
  MAX_SOUNDBOARD_MS,
  PROXIMITY_EXIT_TILES,
  SOUNDBOARD_CHUNK_BYTES,
} from "@shared/constants"

import { tileDistance } from "../media/proximity"
import { connection } from "../net/connection"
import { getState } from "../state/store"

export interface SoundboardEffect {
  id: string
  name: string
  blob: Blob
  durationMs: number
  createdAt: number
}

const DB_NAME = "dittoapp-soundboard"
const STORE = "effects"
const VOLUME_KEY = "dittoapp.soundboard.volume"

// ---------- storage (IndexedDB) ----------

let dbPromise: Promise<IDBDatabase> | null = null

const openDb = (): Promise<IDBDatabase> => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const listEffects = async (): Promise<SoundboardEffect[]> => {
  const effects = await withStore<SoundboardEffect[]>("readonly", (store) => store.getAll())
  return effects.sort((a, b) => a.createdAt - b.createdAt)
}

export const saveEffect = async (effect: SoundboardEffect): Promise<void> => {
  await withStore("readwrite", (store) => store.put(effect))
}

export const deleteEffect = async (id: string): Promise<void> => {
  await withStore("readwrite", (store) => store.delete(id))
}

// ---------- volume (each person controls their own soundboard output) ----------

export const getSoundboardVolume = (): number => {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY))
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value
  } catch {
    // Storage disabled: default volume.
  }
  return 80
}

let outputGain: GainNode | null = null

export const setSoundboardVolume = (value: number): number => {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  try {
    localStorage.setItem(VOLUME_KEY, String(clamped))
  } catch {
    // Best effort.
  }
  if (outputGain) outputGain.gain.value = clamped / 100
  return clamped
}

// ---------- audio engine ----------

let audioContext: AudioContext | null = null

const ensureAudio = async (): Promise<AudioContext> => {
  if (!audioContext) {
    audioContext = new AudioContext()
    outputGain = audioContext.createGain()
    outputGain.gain.value = getSoundboardVolume() / 100
    outputGain.connect(audioContext.destination)
  }
  if (audioContext.state === "suspended") await audioContext.resume()
  return audioContext
}

const decodeBlob = async (blob: Blob): Promise<AudioBuffer | null> => {
  try {
    const context = await ensureAudio()
    return await context.decodeAudioData(await blob.arrayBuffer())
  } catch {
    return null
  }
}

const playBuffer = async (buffer: AudioBuffer, name: string, remote: boolean): Promise<boolean> => {
  const context = await ensureAudio()
  const source = context.createBufferSource()
  source.buffer = buffer
  if (outputGain) source.connect(outputGain)
  source.start()
  document.body.dataset.soundboardLast = name
  document.body.dataset.soundboardRemote = remote ? "1" : ""
  return true
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const broadcastEffect = async (effect: SoundboardEffect): Promise<void> => {
  if (getState().connection !== "connected") return
  try {
    const bytes = new Uint8Array(await effect.blob.arrayBuffer())
    const total = Math.ceil(bytes.length / SOUNDBOARD_CHUNK_BYTES)
    if (total < 1 || total > MAX_SOUNDBOARD_CHUNKS) return
    const clip = crypto.randomUUID()
    const name = effect.name.slice(0, 32)
    for (let index = 0; index < total; index += 1) {
      const chunk = bytes.subarray(index * SOUNDBOARD_CHUNK_BYTES, (index + 1) * SOUNDBOARD_CHUNK_BYTES)
      connection.sendSoundboard({ t: "soundboard", clip, name, total, index, data: toBase64(chunk) })
    }
  } catch {
    // The clip already played locally; broadcasting is best effort.
  }
}

/** Play a clip locally and relay it to nearby peers in the same room. */
export const playEffect = async (effect: SoundboardEffect): Promise<boolean> => {
  const buffer = await decodeBlob(effect.blob)
  if (!buffer) return false
  await playBuffer(buffer, effect.name, false)
  void broadcastEffect(effect)
  return true
}

// ---------- receive clips from nearby peers ----------

interface Assembly {
  name: string
  from: string
  total: number
  chunks: (string | undefined)[]
  received: number
  timer: number
}

const ASSEMBLY_TIMEOUT_MS = 5_000
const assemblies = new Map<string, Assembly>()

const isNear = (from: string): boolean => {
  const state = getState()
  const self = state.selfId ? state.players[state.selfId] : null
  const sender = state.players[from]
  if (!self || !sender || !state.map) return false
  return tileDistance(self, sender, state.map.tileSize) <= PROXIMITY_EXIT_TILES
}

const finishAssembly = async (assembly: Assembly): Promise<void> => {
  try {
    const chunks = assembly.chunks.map((chunk) => fromBase64(chunk ?? ""))
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    const buffer = await decodeBlob(new Blob([bytes], { type: "audio/mpeg" }))
    if (buffer && isNear(assembly.from)) await playBuffer(buffer, assembly.name, true)
  } catch {
    // Malformed clip: ignore, the next one can still play.
  }
}

const handleRelayedChunk: Parameters<typeof connection.onSoundboard>[0] = (message) => {
  let assembly = assemblies.get(message.clip)
  if (!assembly) {
    assembly = {
      name: message.name,
      from: message.from,
      total: message.total,
      chunks: new Array<string | undefined>(message.total),
      received: 0,
      timer: window.setTimeout(() => assemblies.delete(message.clip), ASSEMBLY_TIMEOUT_MS),
    }
    assemblies.set(message.clip, assembly)
  }
  if (assembly.total !== message.total || message.index >= assembly.total) return
  if (assembly.chunks[message.index] !== undefined) return
  assembly.chunks[message.index] = message.data
  assembly.received += 1
  if (assembly.received === assembly.total) {
    window.clearTimeout(assembly.timer)
    assemblies.delete(message.clip)
    void finishAssembly(assembly)
  }
}

let receiverInitialized = false

/** Register once from the office screen so clips play even with the panel closed. */
export const initSoundboardReceiver = (): void => {
  if (receiverInitialized) return
  receiverInitialized = true
  connection.onSoundboard(handleRelayedChunk)
}

// ---------- upload validation ----------

const readAudioDurationMs = (file: Blob): Promise<number> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    let settled = false
    const finish = (value: number): void => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(value)
    }
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) finish(audio.duration * 1000)
    }
    audio.onerror = () => finish(Number.POSITIVE_INFINITY)
    audio.src = url
    window.setTimeout(() => finish(Number.POSITIVE_INFINITY), 5_000)
  })

export type SoundboardUploadResult =
  | { ok: true; effect: SoundboardEffect }
  | { ok: false; error: string }

export const validateSoundboardFile = async (file: File, existing: number): Promise<SoundboardUploadResult> => {
  if (!/\.mp3$/i.test(file.name) && file.type !== "audio/mpeg") return { ok: false, error: "Escolha um arquivo .mp3." }
  if (file.size > MAX_SOUNDBOARD_FILE_BYTES) return { ok: false, error: "O arquivo passa de 512 KB. Use um trecho menor." }
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." }
  if (existing >= MAX_SOUNDBOARD_EFFECTS) return { ok: false, error: "O painel já tem 20 efeitos. Remova um para adicionar outro." }
  const durationMs = await readAudioDurationMs(file)
  if (!Number.isFinite(durationMs) || durationMs <= 0) return { ok: false, error: "Não foi possível ler este áudio." }
  if (durationMs > MAX_SOUNDBOARD_MS + 50) return { ok: false, error: "O som deve ter até 10 segundos." }
  const name = file.name.replace(/\.mp3$/i, "").trim().slice(0, 32) || "Som"
  return {
    ok: true,
    effect: { id: crypto.randomUUID(), name, blob: file, durationMs: Math.round(durationMs), createdAt: Date.now() },
  }
}
