// Synthesized UI sounds (no assets, no dependencies) + audio/motion preferences.
// All sounds are generated with Web Audio and never play before a user gesture.
const SOUND_KEY = "dittoapp.sound.enabled"
const VOLUME_KEY = "dittoapp.sound.volume"
const MOTION_KEY = "dittoapp.reduceMotion"

export type UiSound =
  | "join"
  | "leave"
  | "chatSent"
  | "chatReceived"
  | "micOn"
  | "micOff"
  | "camera"
  | "screenStart"
  | "screenStop"
  | "error"
  | "toggle"

export type MotionPreference = "auto" | "on" | "off"

let soundEnabled = true
let soundVolume = 60
let motionPreference: MotionPreference = "auto"
let audioContext: AudioContext | null = null
let masterGain: GainNode | null = null

const clampVolume = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

const applyToDocument = (): void => {
  try {
    document.body.dataset.uiSoundEnabled = soundEnabled ? "1" : "0"
    document.body.dataset.uiSoundVolume = String(soundVolume)
    document.body.dataset.reduceMotionPreference = motionPreference
    if (motionPreference === "auto") delete document.documentElement.dataset.reduceMotion
    else document.documentElement.dataset.reduceMotion = motionPreference
  } catch {
    // Document not ready (SSR/tests): preferences still apply in memory.
  }
}

export const getSoundEnabled = (): boolean => soundEnabled
export const getSoundVolume = (): number => soundVolume
export const getMotionPreference = (): MotionPreference => motionPreference

export const isReducedMotion = (): boolean => {
  if (motionPreference === "on") return true
  if (motionPreference === "off") return false
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

export const setSoundEnabled = (enabled: boolean): void => {
  soundEnabled = enabled
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "1" : "0")
  } catch {
    // Storage disabled.
  }
  if (masterGain) masterGain.gain.value = enabled ? (soundVolume / 100) * 0.5 : 0
  applyToDocument()
}

export const setSoundVolume = (value: number): void => {
  soundVolume = clampVolume(value)
  try {
    localStorage.setItem(VOLUME_KEY, String(soundVolume))
  } catch {
    // Storage disabled.
  }
  if (masterGain && soundEnabled) masterGain.gain.value = (soundVolume / 100) * 0.5
  applyToDocument()
}

export const setMotionPreference = (preference: MotionPreference): void => {
  motionPreference = preference
  try {
    localStorage.setItem(MOTION_KEY, preference)
  } catch {
    // Storage disabled.
  }
  applyToDocument()
}

const loadPreferences = (): void => {
  try {
    soundEnabled = localStorage.getItem(SOUND_KEY) !== "0"
    const storedVolume = Number(localStorage.getItem(VOLUME_KEY))
    if (Number.isFinite(storedVolume) && storedVolume >= 0 && storedVolume <= 100) soundVolume = storedVolume
    const storedMotion = localStorage.getItem(MOTION_KEY)
    if (storedMotion === "auto" || storedMotion === "on" || storedMotion === "off") motionPreference = storedMotion
  } catch {
    // Defaults.
  }
}

const ensureContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null
  try {
    if (!audioContext) {
      audioContext = new AudioContext()
      masterGain = audioContext.createGain()
      masterGain.gain.value = soundEnabled ? (soundVolume / 100) * 0.5 : 0
      masterGain.connect(audioContext.destination)
    }
    if (audioContext.state === "suspended") void audioContext.resume()
    return audioContext
  } catch {
    return null
  }
}

// One short enveloped oscillator note.
const tone = (
  context: AudioContext,
  options: { from: number; to?: number; duration: number; type?: OscillatorType; peak?: number; delay?: number },
): void => {
  const start = context.currentTime + (options.delay ?? 0)
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = options.type ?? "triangle"
  oscillator.frequency.setValueAtTime(options.from, start)
  if (options.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), start + options.duration)
  const peak = options.peak ?? 0.2
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration)
  oscillator.connect(gain)
  if (masterGain) gain.connect(masterGain)
  oscillator.start(start)
  oscillator.stop(start + options.duration + 0.03)
}

const noise = (context: AudioContext, duration: number, peak = 0.12, delay = 0): void => {
  const frames = Math.max(1, Math.floor(context.sampleRate * duration))
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < frames; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / frames)
  const source = context.createBufferSource()
  const gain = context.createGain()
  const start = context.currentTime + delay
  source.buffer = buffer
  gain.gain.setValueAtTime(peak, start)
  source.connect(gain)
  if (masterGain) gain.connect(masterGain)
  source.start(start)
}

/** Play one UI sound. No-op when disabled (the user's preference wins). */
export const playUiSound = (sound: UiSound): void => {
  if (!soundEnabled) return
  const context = ensureContext()
  if (!context) return
  try {
    switch (sound) {
      case "join":
        tone(context, { from: 523, to: 659, duration: 0.11, peak: 0.16 })
        tone(context, { from: 659, to: 784, duration: 0.1, peak: 0.14, delay: 0.09 })
        break
      case "leave":
        tone(context, { from: 659, to: 523, duration: 0.11, peak: 0.13 })
        tone(context, { from: 523, to: 392, duration: 0.12, peak: 0.11, delay: 0.09 })
        break
      case "chatSent":
        tone(context, { from: 880, to: 1046, duration: 0.07, peak: 0.1 })
        break
      case "chatReceived":
        tone(context, { from: 880, to: 660, duration: 0.09, peak: 0.12 })
        break
      case "micOn":
        tone(context, { from: 560, to: 760, duration: 0.08, peak: 0.12 })
        break
      case "micOff":
        tone(context, { from: 760, to: 520, duration: 0.09, peak: 0.12 })
        break
      case "camera":
        noise(context, 0.05, 0.08)
        tone(context, { from: 1200, duration: 0.03, peak: 0.06, type: "square" })
        break
      case "screenStart":
        tone(context, { from: 330, to: 660, duration: 0.16, peak: 0.12 })
        break
      case "screenStop":
        tone(context, { from: 660, to: 330, duration: 0.16, peak: 0.11 })
        break
      case "error":
        tone(context, { from: 240, to: 180, duration: 0.18, peak: 0.14, type: "sawtooth" })
        break
      case "toggle":
        tone(context, { from: 1000, duration: 0.025, peak: 0.05 })
        break
    }
    document.body.dataset.uiSoundLast = sound
  } catch {
    // Sound is cosmetic; never break an action because of it.
  }
}

let initialized = false

/** Load preferences, reflect them in the DOM and unlock audio on the first user gesture. */
export const initUiSound = (): void => {
  if (initialized) return
  initialized = true
  loadPreferences()
  applyToDocument()
  const unlock = (): void => {
    ensureContext()
    window.removeEventListener("pointerdown", unlock)
    window.removeEventListener("keydown", unlock)
  }
  window.addEventListener("pointerdown", unlock, { once: true })
  window.addEventListener("keydown", unlock, { once: true })
}
