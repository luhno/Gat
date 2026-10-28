// Soundboard: a small local library of MP3 clips (≤10 s after trim, 20 effects) that plays locally
// and is broadcast to nearby peers through the room WebSocket (bytes are relayed, never stored).
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
  emoji: string
  /** Per-effect volume multiplier (0..1), like Discord's "Volume do som". */
  gain: number
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
  return effects
    .map((effect) => ({ ...effect, emoji: effect.emoji ?? "", gain: typeof effect.gain === "number" ? effect.gain : 1 }))
    .sort((a, b) => a.createdAt - b.createdAt)
}

export const saveEffect = async (effect: SoundboardEffect): Promise<void> => {
  await withStore("readwrite", (store) => store.put(effect))
}

export const deleteEffect = async (id: string): Promise<void> => {
  await withStore("readwrite", (store) => store.delete(id))
}

// ---------- panel volume (each person controls their own output) ----------

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

/** Decode an uploaded file for the trim dialog; null when the browser cannot decode it. */
export const decodeAudio = async (blob: Blob): Promise<AudioBuffer | null> => {
  try {
    const context = await ensureAudio()
    return await context.decodeAudioData(await blob.arrayBuffer())
  } catch {
    return null
  }
}

const playBuffer = async (buffer: AudioBuffer, name: string, remote: boolean, gain = 1): Promise<void> => {
  const context = await ensureAudio()
  const source = context.createBufferSource()
  source.buffer = buffer
  const perSoundGain = context.createGain()
  perSoundGain.gain.value = Math.max(0, Math.min(1, gain))
  source.connect(perSoundGain)
  if (outputGain) perSoundGain.connect(outputGain)
  source.start()
  document.body.dataset.soundboardLast = name
  document.body.dataset.soundboardRemote = remote ? "1" : ""
}

/** Preview a slice of the decoded buffer in the trim dialog. Returns a stop function. */
export const previewSlice = async (buffer: AudioBuffer, startSec: number, endSec: number): Promise<() => void> => {
  const context = await ensureAudio()
  const source = context.createBufferSource()
  source.buffer = buffer
  const gain = context.createGain()
  source.connect(gain)
  if (outputGain) gain.connect(outputGain)
  source.start(0, Math.max(0, startSec), Math.max(0.05, endSec - startSec))
  return () => {
    try {
      source.stop()
    } catch {
      // Already finished.
    }
  }
}

/** Encode an AudioBuffer to a 16-bit PCM WAV blob (trimmed clips are stored as WAV). */
export const encodeWav = (buffer: AudioBuffer): Blob => {
  const channels = buffer.numberOfChannels
  const frameCount = buffer.length
  const bytesPerSample = 2
  const dataSize = frameCount * channels * bytesPerSample
  const output = new ArrayBuffer(44 + dataSize)
  const view = new DataView(output)
  const writeString = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeString(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true)
  view.setUint16(32, channels * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, dataSize, true)
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel))
  let offset = 44
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel]![frame]!))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += bytesPerSample
    }
  }
  return new Blob([output], { type: "audio/wav" })
}

/**
 * Render [startSec, endSec) to a small WAV blob: downmixed to mono and capped at 24 kHz so a 10 s
 * clip stays well under the relay chunk budget (the original MP3 limit is 512 KB, but PCM is bigger).
 */
export const trimBuffer = async (buffer: AudioBuffer, startSec: number, endSec: number): Promise<Blob> => {
  const duration = Math.max(0.05, Math.min(endSec, buffer.duration) - Math.max(0, startSec))
  const sampleRate = Math.min(24_000, buffer.sampleRate)
  const frameCount = Math.max(1, Math.floor(duration * sampleRate))
  const offline = new OfflineAudioContext(1, frameCount, sampleRate)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start(0, Math.max(0, startSec), duration)
  return encodeWav(await offline.startRendering())
}

// ---------- broadcast ----------

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
      connection.sendSoundboard({
        t: "soundboard",
        clip,
        name,
        total,
        index,
        gain: effect.gain,
        data: toBase64(chunk),
      })
    }
  } catch {
    // The clip already played locally; broadcasting is best effort.
  }
}

/** Play a clip locally (respecting its own volume) and relay it to nearby peers. */
export const playEffect = async (effect: SoundboardEffect): Promise<boolean> => {
  const buffer = await decodeAudio(effect.blob)
  if (!buffer) return false
  await playBuffer(buffer, effect.name, false, effect.gain)
  void broadcastEffect(effect)
  return true
}

// ---------- receive clips from nearby peers ----------

interface Assembly {
  name: string
  from: string
  total: number
  gain: number
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
    const buffer = await decodeAudio(new Blob([bytes], { type: "audio/mpeg" }))
    if (buffer && isNear(assembly.from)) await playBuffer(buffer, assembly.name, true, assembly.gain)
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
      gain: typeof message.gain === "number" ? message.gain : 1,
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

// ---------- upload checks (duration is handled by the trim dialog) ----------

export type SoundboardFileCheck = { ok: true } | { ok: false; error: string }

export const validateSoundboardFile = (file: File, existing: number): SoundboardFileCheck => {
  if (!/\.mp3$/i.test(file.name) && file.type !== "audio/mpeg") return { ok: false, error: "Escolha um arquivo .mp3." }
  if (file.size > MAX_SOUNDBOARD_FILE_BYTES) return { ok: false, error: "O arquivo passa de 512 KB. Use um trecho menor." }
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." }
  if (existing >= MAX_SOUNDBOARD_EFFECTS) return { ok: false, error: "O painel já tem 20 efeitos. Remova um para adicionar outro." }
  return { ok: true }
}

export const MAX_EFFECT_DURATION_MS = MAX_SOUNDBOARD_MS
