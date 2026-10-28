import { useEffect, useRef, useState } from "react"

import { MAX_SOUNDBOARD_EFFECTS, MAX_SOUNDBOARD_MS } from "@shared/constants"

import { IconClose } from "../components/icons"
import { Notice } from "../components/Notice"
import {
  decodeAudio,
  deleteEffect,
  getSoundboardVolume,
  listEffects,
  playEffect,
  previewSlice,
  saveEffect,
  setSoundboardVolume,
  trimBuffer,
  validateSoundboardFile,
  type SoundboardEffect,
} from "./soundboard"

const formatSeconds = (value: number): string => `${value.toFixed(2).replace(".", ",")} s`
const formatDuration = (durationMs: number): string => `${(durationMs / 1000).toFixed(1).replace(".", ",")} s`

interface PendingUpload {
  file: File
  buffer: AudioBuffer
  durationSec: number
}

/** Draw the decoded waveform and the current trim selection. */
function Waveform({ buffer, start, end }: { buffer: AudioBuffer; start: number; end: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return
    const width = canvas.width
    const height = canvas.height
    const data = buffer.getChannelData(0)
    const buckets = 240
    const step = Math.max(1, Math.floor(data.length / buckets))
    context.clearRect(0, 0, width, height)

    // Bars
    context.fillStyle = "#4b5563"
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      let peak = 0
      const from = bucket * step
      for (let index = from; index < Math.min(from + step, data.length); index += 1) {
        peak = Math.max(peak, Math.abs(data[index] ?? 0))
      }
      const barHeight = Math.max(1, peak * (height - 8))
      const x = (bucket / buckets) * width
      const barWidth = Math.max(1, width / buckets - 1)
      context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight)
    }

    // Selection overlay + handles
    const toX = (seconds: number): number => (Math.min(1, Math.max(0, seconds / buffer.duration)) || 0) * width
    const startX = toX(start)
    const endX = toX(end)
    context.fillStyle = "rgba(139, 92, 246, 0.28)"
    context.fillRect(startX, 0, Math.max(1, endX - startX), height)
    context.fillStyle = "#c4b5fd"
    for (const x of [startX, endX]) {
      context.fillRect(Math.min(width - 2, Math.max(0, x - 1)), 0, 2, height)
    }
  }, [buffer, start, end])

  return <canvas ref={canvasRef} className="soundboard-waveform" width={520} height={84} aria-hidden="true" />
}

/** Soundboard panel: up to 20 clips, one click to play, panel volume, and a trim dialog before saving. */
export function SoundboardPanel({ onClose }: { onClose: () => void }) {
  const [effects, setEffects] = useState<SoundboardEffect[]>([])
  const [volume, setVolume] = useState(() => getSoundboardVolume())
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [name, setName] = useState("")
  const [emoji, setEmoji] = useState("")
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(MAX_SOUNDBOARD_MS / 1000)
  const [soundGain, setSoundGain] = useState(100)
  const [saving, setSaving] = useState(false)
  const [playing, setPlaying] = useState(false)
  const stopPreviewRef = useRef<(() => void) | null>(null)
  const playTimerRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const refresh = async (): Promise<void> => {
    const next = await listEffects()
    setEffects(next)
    document.body.dataset.soundboardCount = String(next.length)
  }

  useEffect(() => {
    void refresh().catch(() => setError("Não foi possível carregar os efeitos salvos."))
    return () => {
      if (playTimerRef.current) window.clearTimeout(playTimerRef.current)
      stopPreviewRef.current?.()
    }
  }, [])

  // ---------- upload / trim dialog ----------

  const openTrimDialog = async (file: File): Promise<void> => {
    setError(null)
    const check = validateSoundboardFile(file, effects.length)
    if (!check.ok) {
      setError(check.error)
      return
    }
    const buffer = await decodeAudio(file)
    if (!buffer) {
      setError("Não foi possível ler este áudio. Use um MP3 válido.")
      return
    }
    const durationSec = buffer.duration
    setName(file.name.replace(/\.mp3$/i, "").trim().slice(0, 32) || "Som")
    setEmoji("")
    setTrimStart(0)
    setTrimEnd(Math.min(durationSec, MAX_SOUNDBOARD_MS / 1000))
    setSoundGain(100)
    setPending({ file, buffer, durationSec })
    if (inputRef.current) inputRef.current.value = ""
  }

  const stopPreview = (): void => {
    stopPreviewRef.current?.()
    stopPreviewRef.current = null
    if (playTimerRef.current) window.clearTimeout(playTimerRef.current)
    playTimerRef.current = null
    setPlaying(false)
  }

  const togglePreview = async (): Promise<void> => {
    if (!pending) return
    if (playing) {
      stopPreview()
      return
    }
    try {
      stopPreviewRef.current = await previewSlice(pending.buffer, trimStart, trimEnd)
      setPlaying(true)
      playTimerRef.current = window.setTimeout(() => stopPreview(), Math.max(120, (trimEnd - trimStart) * 1000))
    } catch {
      setError("Não foi possível tocar a prévia.")
    }
  }

  const setStart = (value: number): void => {
    setTrimStart(Math.min(Math.max(0, value), trimEnd - 0.1))
  }

  const setEnd = (value: number): void => {
    setTrimEnd(Math.max(Math.min(pending?.durationSec ?? 10, value), trimStart + 0.1))
  }

  const selectionSec = Math.max(0, trimEnd - trimStart)
  const overLimit = selectionSec > MAX_SOUNDBOARD_MS / 1000 + 0.001
  const canSend = Boolean(pending) && name.trim().length > 0 && selectionSec >= 0.1 && !overLimit && !saving

  const confirmUpload = async (): Promise<void> => {
    if (!pending || !canSend) return
    setSaving(true)
    setError(null)
    try {
      const fullClip = trimStart <= 0.02 && selectionSec >= pending.durationSec - 0.05
      const blob = fullClip ? pending.file : await trimBuffer(pending.buffer, trimStart, trimEnd)
      const effect: SoundboardEffect = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 32),
        emoji: emoji.trim().slice(0, 8),
        gain: Math.max(0, Math.min(1, soundGain / 100)),
        blob,
        durationMs: Math.round(selectionSec * 1000),
        createdAt: Date.now(),
      }
      await saveEffect(effect)
      await refresh()
      stopPreview()
      setPending(null)
    } catch {
      setError("Não foi possível salvar o som neste navegador.")
    } finally {
      setSaving(false)
    }
  }

  const closeDialog = (): void => {
    stopPreview()
    setPending(null)
  }

  const play = async (effect: SoundboardEffect): Promise<void> => {
    setError(null)
    const ok = await playEffect(effect)
    if (!ok) setError(`Não foi possível tocar “${effect.name}”.`)
  }

  const remove = async (effect: SoundboardEffect): Promise<void> => {
    await deleteEffect(effect.id)
    await refresh()
  }

  return (
    <aside className="panel soundboard-panel" data-testid="soundboard-panel" aria-label="Efeitos sonoros">
      <header className="panel-head">
        <h2>Efeitos sonoros</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar efeitos sonoros">
          <IconClose />
        </button>
      </header>

      <div className="soundboard-toolbar">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="soundboard-add"
          onClick={() => inputRef.current?.click()}
          disabled={effects.length >= MAX_SOUNDBOARD_EFFECTS}
        >
          Adicionar som
        </button>
        <span className="soundboard-count" aria-label={`${effects.length} de ${MAX_SOUNDBOARD_EFFECTS} efeitos`}>
          {effects.length}/{MAX_SOUNDBOARD_EFFECTS}
        </span>
      </div>

      <label className="soundboard-volume">
        <span>Volume do painel</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={volume}
          data-testid="soundboard-volume"
          aria-label="Volume dos efeitos sonoros"
          onChange={(event) => setVolume(setSoundboardVolume(Number(event.target.value)))}
        />
        <output>{volume}%</output>
      </label>

      {error ? (
        <div className="soundboard-notice">
          <Notice kind="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        </div>
      ) : null}

      <div className="soundboard-grid">
        {effects.map((effect, index) => (
          <div className="soundboard-slot" key={effect.id}>
            <button
              type="button"
              className="soundboard-play"
              data-testid={`soundboard-play-${index}`}
              onClick={() => void play(effect)}
              aria-label={`Tocar ${effect.name}`}
              title={`Tocar ${effect.name}`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M7 5.5l7 4.5-7 4.5z" fill="currentColor" />
              </svg>
              <span className="soundboard-name">
                {effect.emoji ? `${effect.emoji} ` : ""}
                {effect.name}
              </span>
              <span className="soundboard-duration">{formatDuration(effect.durationMs)}</span>
            </button>
            <button
              type="button"
              className="soundboard-remove"
              onClick={() => void remove(effect)}
              aria-label={`Remover ${effect.name}`}
              title={`Remover ${effect.name}`}
            >
              <IconClose />
            </button>
          </div>
        ))}
        {Array.from({ length: Math.max(0, MAX_SOUNDBOARD_EFFECTS - effects.length) }).map((_, index) => (
          <div className="soundboard-slot is-empty" key={`empty-${index}`} aria-hidden="true">
            <span>+</span>
          </div>
        ))}
      </div>

      <p className="panel-empty">
        MP3 de até 10 segundos (dá para cortar antes de enviar), até {MAX_SOUNDBOARD_EFFECTS} efeitos. O som toca para
        você e para quem estiver perto na sala.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        multiple
        hidden
        data-testid="soundboard-upload"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void openTrimDialog(file)
        }}
      />

      {pending ? (
        <div className="soundboard-dialog-backdrop" role="presentation">
          <div
            className="soundboard-dialog"
            data-testid="soundboard-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="soundboard-dialog-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                closeDialog()
              }
            }}
          >
            <header className="soundboard-dialog-head">
              <h3 id="soundboard-dialog-title">Enviar um som</h3>
              <button type="button" className="icon-btn" onClick={closeDialog} aria-label="Fechar envio de som">
                <IconClose />
              </button>
            </header>

            <div className="soundboard-dialog-body">
              <div className="soundboard-preview">
                <Waveform buffer={pending.buffer} start={trimStart} end={trimEnd} />
                <div className="soundboard-preview-row">
                  <button type="button" className="btn btn-ghost btn-sm" data-testid="soundboard-preview-play" onClick={() => void togglePreview()}>
                    {playing ? "Parar" : "Prévia"}
                  </button>
                  <span className="soundboard-selection" data-testid="soundboard-duration">
                    {formatSeconds(selectionSec)} de {formatSeconds(pending.durationSec)}
                    {overLimit ? " · máx. 10 s" : ""}
                  </span>
                </div>
              </div>

              <div className="soundboard-file-row">
                <span className="soundboard-file-name" title={pending.file.name}>
                  ↑ {pending.file.name}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()}>
                  Navegar
                </button>
              </div>

              <div className="soundboard-fields">
                <label className="field">
                  <span>Nome do som *</span>
                  <input
                    data-testid="soundboard-name"
                    value={name}
                    maxLength={32}
                    placeholder="Nome do som"
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>Emoji relacionado</span>
                  <input
                    data-testid="soundboard-emoji"
                    value={emoji}
                    maxLength={8}
                    placeholder="Emoji (opcional)"
                    onChange={(event) => setEmoji(event.target.value)}
                  />
                </label>
              </div>

              <div className="soundboard-trim">
                <span className="soundboard-trim-label">
                  Corte do som {overLimit ? <strong>— deixe até 10 s</strong> : null}
                </span>
                <label>
                  <span>Início {formatSeconds(trimStart)}</span>
                  <input
                    type="range"
                    min={0}
                    max={pending.durationSec}
                    step={0.05}
                    value={trimStart}
                    data-testid="soundboard-trim-start"
                    aria-label="Início do trecho"
                    onChange={(event) => setStart(Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Fim {formatSeconds(trimEnd)}</span>
                  <input
                    type="range"
                    min={0}
                    max={pending.durationSec}
                    step={0.05}
                    value={trimEnd}
                    data-testid="soundboard-trim-end"
                    aria-label="Fim do trecho"
                    onChange={(event) => setEnd(Number(event.target.value))}
                  />
                </label>
              </div>

              <label className="soundboard-volume">
                <span>Volume do som</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={soundGain}
                  data-testid="soundboard-gain"
                  aria-label="Volume deste som"
                  onChange={(event) => setSoundGain(Number(event.target.value))}
                />
                <output>{soundGain}%</output>
              </label>
            </div>

            <footer className="soundboard-dialog-actions">
              <button type="button" className="btn btn-secondary" data-testid="soundboard-cancel" onClick={closeDialog}>
                Deixa pra lá
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="soundboard-confirm"
                disabled={!canSend}
                onClick={() => void confirmUpload()}
              >
                {saving ? "Enviando…" : "Enviar"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
