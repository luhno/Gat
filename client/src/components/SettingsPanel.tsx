import { useEffect, useState } from "react"

import { APP_VERSION, MAX_NAME_LENGTH } from "@shared/constants"
import type { PlayerProfile, UserStatus } from "@shared/types"

import { persistProfile } from "../desktop"
import type { MediaApi } from "../media/useMedia"
import { connection } from "../net/connection"
import { getState } from "../state/store"
import { IconClose } from "./icons"
import { Notice } from "./Notice"
import { STATUSES, STATUS_LABELS } from "./palette"

const deviceOptions = (devices: MediaDeviceInfo[], fallback: string): { id: string; label: string }[] =>
  devices.map((device, index) => ({ id: device.deviceId, label: device.label || `${fallback} ${index + 1}` }))

export function SettingsPanel({
  media,
  profile,
  onClose,
}: {
  media: MediaApi
  profile: PlayerProfile
  onClose: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [status, setStatus] = useState<UserStatus>(profile.status)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(profile.name)
    setStatus(profile.status)
  }, [profile.name, profile.status])

  const save = async (): Promise<void> => {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
    if (!trimmed) return
    connection.updateProfile({ name: trimmed, status })
    await persistProfile({ ...getState().profile, name: trimmed, status })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <aside className="panel settings-panel" data-testid="settings-panel" aria-label="Configurações">
      <header className="panel-head">
        <h2>Configurações</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar configurações">
          <IconClose />
        </button>
      </header>

      <section className="settings-section" aria-labelledby="settings-profile-title">
        <h3 id="settings-profile-title">Seu perfil</h3>
        <label className="field">
          <span>Nome</span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            aria-label="Seu nome"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as UserStatus)} aria-label="Seu status">
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-actions">
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!name.trim()}>
            Salvar perfil
          </button>
          {saved ? (
            <span className="settings-saved" role="status">
              Salvo!
            </span>
          ) : null}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-camera-title">
        <h3 id="settings-camera-title">Sua câmera</h3>
        <div className="settings-camera">
          {media.videoEnabled && media.localStream ? (
            <video
              className="settings-camera-video"
              data-testid="settings-camera-preview"
              ref={(element) => {
                if (element && element.srcObject !== media.localStream) element.srcObject = media.localStream
              }}
              autoPlay
              muted
              playsInline
            />
          ) : (
            <p className="settings-hint">Câmera desligada. Use o botão de câmera na barra inferior para ligar.</p>
          )}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-devices-title">
        <h3 id="settings-devices-title">Dispositivos</h3>
        <label className="field">
          <span>Microfone</span>
          <select
            value={media.selected.audioInputId ?? ""}
            onChange={(event) => void media.selectAudioInput(event.target.value).catch(() => undefined)}
            aria-label="Microfone"
          >
            <option value="">Padrão do sistema</option>
            {deviceOptions(media.devices.audioInputs, "Microfone").map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Câmera</span>
          <select
            value={media.selected.videoInputId ?? ""}
            onChange={(event) => void media.selectVideoInput(event.target.value).catch(() => undefined)}
            aria-label="Câmera"
          >
            <option value="">Padrão do sistema</option>
            {deviceOptions(media.devices.videoInputs, "Câmera").map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Saída de áudio</span>
          <select
            value={media.selected.audioOutputId ?? ""}
            onChange={(event) => void media.selectAudioOutput(event.target.value).catch(() => undefined)}
            aria-label="Saída de áudio"
          >
            <option value="">Padrão do sistema</option>
            {deviceOptions(media.devices.audioOutputs, "Saída").map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        {media.mediaError ? <Notice kind="error">{media.mediaError}</Notice> : null}
      </section>

      <section className="settings-section" aria-labelledby="settings-connection-title">
        <h3 id="settings-connection-title">Conexão</h3>
        {media.connectionStats ? (
          <dl className="settings-stats" data-testid="settings-connection">
            <div>
              <dt>Pares de mídia</dt>
              <dd>{media.connectionStats.peers}</dd>
            </div>
            <div>
              <dt>Rota</dt>
              <dd>
                {media.connectionStats.direct
                  ? media.connectionStats.candidateType === "host"
                    ? "Direta (rede local)"
                    : "Direta (NAT)"
                  : media.connectionStats.candidateType === "relay"
                    ? "Relay (TURN)"
                    : "Coletando…"}
              </dd>
            </div>
            <div>
              <dt>Latência</dt>
              <dd>{media.connectionStats.rttMs !== null ? `${media.connectionStats.rttMs} ms` : "—"}</dd>
            </div>
            <div>
              <dt>Jitter</dt>
              <dd>{media.connectionStats.jitterMs !== null ? `${media.connectionStats.jitterMs} ms` : "—"}</dd>
            </div>
            <div>
              <dt>Pacotes perdidos</dt>
              <dd>{media.connectionStats.packetsLost !== null ? media.connectionStats.packetsLost : "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="settings-hint">Sem mídia conectada agora. Aproxime-se de alguém para abrir uma conexão.</p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="settings-about-title">
        <h3 id="settings-about-title">Sobre</h3>
        <p className="settings-about">
          DittoApp {APP_VERSION} — sala na rede local ou na web, sem telemetria.
        </p>
      </section>
    </aside>
  )
}
