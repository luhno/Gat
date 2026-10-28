import { useEffect, useRef, useState } from "react"

import { MAX_SOUNDBOARD_EFFECTS, MAX_SOUNDBOARD_MS } from "@shared/constants"

import { IconClose } from "../components/icons"
import { Notice } from "../components/Notice"
import {
  deleteEffect,
  getSoundboardVolume,
  listEffects,
  playEffect,
  saveEffect,
  setSoundboardVolume,
  validateSoundboardFile,
  type SoundboardEffect,
} from "./soundboard"

const formatDuration = (durationMs: number): string => `${(durationMs / 1000).toFixed(1).replace(".", ",")} s`

/** Soundboard panel: up to 20 MP3 clips (≤10 s), one click to play, volume for the whole panel. */
export function SoundboardPanel({ onClose }: { onClose: () => void }) {
  const [effects, setEffects] = useState<SoundboardEffect[]>([])
  const [volume, setVolume] = useState(() => getSoundboardVolume())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const refresh = async (): Promise<void> => {
    const next = await listEffects()
    setEffects(next)
    document.body.dataset.soundboardCount = String(next.length)
  }

  useEffect(() => {
    void refresh().catch(() => setError("Não foi possível carregar os efeitos salvos."))
  }, [])

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      let current = effects.length
      let firstError: string | null = null
      for (const file of Array.from(files)) {
        const result = await validateSoundboardFile(file, current)
        if (!result.ok) {
          firstError ??= `${file.name}: ${result.error}`
          continue
        }
        await saveEffect(result.effect)
        current += 1
      }
      if (firstError) setError(firstError)
      await refresh()
    } catch {
      setError("Não foi possível salvar o som neste navegador.")
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
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
          disabled={busy || effects.length >= MAX_SOUNDBOARD_EFFECTS}
        >
          {busy ? "Adicionando…" : "Adicionar som"}
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
          onChange={(event) => {
            const next = setSoundboardVolume(Number(event.target.value))
            setVolume(next)
          }}
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
              <span className="soundboard-name">{effect.name}</span>
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
        MP3 de até 10 segundos, até {MAX_SOUNDBOARD_EFFECTS} efeitos. O som toca para você e para quem estiver perto na
        sala.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        multiple
        hidden
        data-testid="soundboard-upload"
        onChange={(event) => void addFiles(event.target.files)}
      />
    </aside>
  )
}

export { MAX_SOUNDBOARD_MS }
