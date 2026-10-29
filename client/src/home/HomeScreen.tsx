import { useEffect, useRef, useState, type FormEvent } from "react"

import { MAX_NAME_LENGTH, PRIVATE_HOST_PATTERN } from "@shared/constants"
import type { PlayerProfile, UserStatus } from "@shared/types"

import { CopyButton } from "../components/CopyButton"
import { ShareButton } from "../components/ShareButton"
import { Notice } from "../components/Notice"
import { HAIR_STYLES, HAIR_STYLE_LABELS, SHIRT_COLORS, SKIN_TONES, STATUSES, STATUS_COLORS, STATUS_LABELS } from "../components/palette"
import { desktop as desktopBridge, hasDesktopBridge, joinLanRoom, persistProfile } from "../desktop"
import { connection } from "../net/connection"
import { actions, useStore } from "../state/store"
import { AvatarPreview } from "./AvatarPreview"

interface ParsedAddress {
  address?: string
  error?: string
}

/** Validate a LAN host address before handing it to the desktop bridge. */
export const parseLanAddress = (raw: string): ParsedAddress => {
  const trimmed = raw.trim()
  if (!trimmed) return { error: "Digite o endereço do host (ex.: 192.168.0.10:8787)." }
  if (trimmed.length > 120) return { error: "Endereço muito longo." }
  let url: URL
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
  } catch {
    return { error: "Endereço inválido. Use host:porta, por exemplo 192.168.0.10:8787." }
  }
  if (url.protocol !== "https:") return { error: "O app serve a sala em HTTPS. Use https:// no endereço." }
  if (!PRIVATE_HOST_PATTERN.test(url.hostname)) {
    return { error: "Só endereços da rede local: 192.168.x.x, 10.x.x.x, 172.16–31.x.x ou localhost." }
  }
  if (!url.port) return { error: "Inclua a porta da sala, por exemplo 192.168.0.10:8787." }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Porta inválida." }
  return { address: `${url.hostname}:${port}` }
}

export function HomeScreen() {
  const { profile, settings, desktop, connection: connectionStatus, error } = useStore()
  const [joinAddress, setJoinAddress] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [joining, setJoining] = useState(false)
  const nameRef = useRef<HTMLInputElement | null>(null)

  const isGuest = desktop?.mode === "guest"
  const connecting = busy || connectionStatus === "connecting" || connectionStatus === "reconnecting"

  useEffect(() => {
    if (settings.lastJoinedAddress) setJoinAddress((current) => current || settings.lastJoinedAddress || "")
  }, [settings.lastJoinedAddress])

  const updateProfile = (patch: Partial<PlayerProfile>): void => actions.setProfile(patch)

  const openOffice = async (): Promise<void> => {
    const name = profile.name.trim()
    if (!name) {
      setFormError("Escolha um nome para abrir o escritório.")
      nameRef.current?.focus()
      return
    }
    const next: PlayerProfile = { ...profile, name }
    setBusy(true)
    setFormError(null)
    actions.setError(null)
    actions.setProfile({ name })
    try {
      await persistProfile(next).catch(() => undefined)
      await connection.connect(next)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Não foi possível abrir o escritório.")
    } finally {
      setBusy(false)
    }
  }

  const submitJoin = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!hasDesktopBridge) {
      setJoinError("Entrar em uma sala da LAN só funciona no app desktop.")
      return
    }
    const name = profile.name.trim()
    if (!name) {
      setJoinError("Escolha um nome antes de entrar na sala.")
      nameRef.current?.focus()
      return
    }
    const parsed = parseLanAddress(joinAddress)
    if (!parsed.address) {
      setJoinError(parsed.error ?? "Endereço inválido.")
      return
    }
    setJoining(true)
    setJoinError(null)
    try {
      // The host page loads from the bridge settings: persist before navigating away.
      actions.setProfile({ name })
      await persistProfile({ ...profile, name }).catch(() => undefined)
      const result = await joinLanRoom(parsed.address)
      if (!result.ok) setJoinError(result.error ?? "Não foi possível entrar na sala. Confira o endereço e a rede.")
    } catch (cause) {
      setJoinError(cause instanceof Error ? cause.message : "Não foi possível entrar na sala.")
    } finally {
      setJoining(false)
    }
  }

  const leaveGuestRoom = (): void => {
    if (desktopBridge) void desktopBridge.leaveRoom()
  }

  const look = {
    shirtColor: profile.shirtColor,
    skinTone: profile.skinTone,
    hairStyle: profile.hairStyle,
    status: profile.status,
  }

  // Web (no desktop bridge): single shared room, no LAN tools.
  const web = !hasDesktopBridge
  const shareUrl = `${window.location.origin}/join`

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-brand">
          <span className="home-logo" aria-hidden="true">
            D
          </span>
          <div>
            <h1>DittoApp</h1>
            <p>{web ? "Entre pelo link e pronto — sem instalação, sem conta." : "Seu escritório na rede local — sem internet, sem conta."}</p>
          </div>
        </div>
      </header>

      <main className="home-main">
        <section className="home-card" aria-labelledby="home-profile-title">
          <h2 id="home-profile-title">Seu perfil</h2>

          <label className="field">
            <span>Nome</span>
            <input
              ref={nameRef}
              data-testid="home-name"
              value={profile.name}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Como quer ser chamado?"
              autoComplete="off"
              onChange={(event) => updateProfile({ name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void openOffice()
                }
              }}
              aria-label="Seu nome"
            />
          </label>

          <fieldset className="option-group">
            <legend>Cor da camiseta</legend>
            <div className="swatches">
              {SHIRT_COLORS.map((color, index) => (
                <label
                  key={color}
                  className={profile.shirtColor === color ? "swatch is-active" : "swatch"}
                  style={{ backgroundColor: color }}
                  title={`Camiseta ${index + 1}`}
                >
                  <input
                    type="radio"
                    name="shirt-color"
                    className="sr-only"
                    checked={profile.shirtColor === color}
                    onChange={() => updateProfile({ shirtColor: color })}
                    aria-label={`Camiseta ${index + 1}`}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="option-group">
            <legend>Tom de pele</legend>
            <div className="swatches">
              {SKIN_TONES.map((tone, index) => (
                <label
                  key={tone}
                  className={profile.skinTone === tone ? "swatch is-active" : "swatch"}
                  style={{ backgroundColor: tone }}
                  title={`Tom de pele ${index + 1}`}
                >
                  <input
                    type="radio"
                    name="skin-tone"
                    className="sr-only"
                    checked={profile.skinTone === tone}
                    onChange={() => updateProfile({ skinTone: tone })}
                    aria-label={`Tom de pele ${index + 1}`}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="option-group">
            <legend>Cabelo</legend>
            <div className="chips">
              {HAIR_STYLES.map((style) => (
                <label key={style} className={profile.hairStyle === style ? "chip is-active" : "chip"}>
                  <input
                    type="radio"
                    name="hair-style"
                    className="sr-only"
                    checked={profile.hairStyle === style}
                    onChange={() => updateProfile({ hairStyle: style })}
                  />
                  {HAIR_STYLE_LABELS[style]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="option-group">
            <legend>Status</legend>
            <div className="chips">
              {STATUSES.map((status) => (
                <label key={status} className={profile.status === status ? "chip is-active" : "chip"}>
                  <input
                    type="radio"
                    name="user-status"
                    className="sr-only"
                    checked={profile.status === status}
                    onChange={() => updateProfile({ status })}
                  />
                  <span className="chip-dot" style={{ backgroundColor: STATUS_COLORS[status] }} aria-hidden="true" />
                  {STATUS_LABELS[status]}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="home-card home-preview" aria-labelledby="home-preview-title">
          <h2 id="home-preview-title">Prévia</h2>
          <div className="avatar-stage">
            <AvatarPreview look={look} />
          </div>
          <div className="preview-name">
            <span className="participant-dot" style={{ backgroundColor: STATUS_COLORS[profile.status] }} aria-hidden="true" />
            {profile.name.trim() || "Seu nome"}
            <span className="preview-status">{STATUS_LABELS[profile.status]}</span>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-large"
            data-testid="home-open-office"
            onClick={() => void openOffice()}
            disabled={connecting}
          >
            {connecting ? "Conectando…" : web ? "Entrar na sala" : isGuest ? "Entrar no escritório do host" : "Abrir meu escritório"}
          </button>
          {web ? (
            <p className="home-hint">Sala única: todos que abrirem o link entram aqui.</p>
          ) : (
            <p className="home-hint">Você será o host da sala neste computador.</p>
          )}
        </section>

        {hasDesktopBridge ? (
          <section className="home-card home-room" aria-labelledby="home-room-title">
            <h2 id="home-room-title">Sala na LAN</h2>

            {isGuest ? (
              <div className="guest-banner">
                <Notice kind="info">Você está conectado ao endereço LAN de outro computador.</Notice>
                <button type="button" className="btn btn-ghost btn-sm" onClick={leaveGuestRoom}>
                  Voltar ao meu app
                </button>
              </div>
            ) : null}

            <div className="lan-box" data-testid="home-lan-urls">
              <h3>Endereços deste escritório</h3>
              {desktop?.mode === "host" && desktop.lanUrls.length > 0 ? (
                <>
                  <p className="home-hint">Compartilhe com colegas na mesma rede:</p>
                  <ul className="address-list">
                    {desktop.lanUrls.map((url) => (
                      <li key={url}>
                        <code>{url}</code>
                        <CopyButton text={url} label={`Copiar endereço ${url}`} />
                      </li>
                    ))}
                    <li>
                      <code>{desktop.localUrl}</code>
                      <CopyButton text={desktop.localUrl} label="Copiar endereço local" />
                    </li>
                  </ul>
                </>
              ) : (
                <p className="home-hint">
                  {isGuest
                    ? "Este computador está entrando na sala de outro host."
                    : "Os endereços LAN aparecem aqui quando você abre o escritório pelo app desktop."}
                </p>
              )}
            </div>

            <form className="join-form" onSubmit={(event) => void submitJoin(event)}>
              <h3>Entrar em sala da LAN</h3>
              <label className="field">
                <span>Endereço do host</span>
                <input
                  data-testid="home-join-address"
                  value={joinAddress}
                  placeholder="192.168.0.10:8787"
                  inputMode="url"
                  autoComplete="off"
                  onChange={(event) => setJoinAddress(event.target.value)}
                  aria-label="Endereço da sala na LAN"
                  disabled={!hasDesktopBridge}
                />
              </label>
              <button
                type="submit"
                className="btn btn-secondary"
                data-testid="home-join-button"
                disabled={!hasDesktopBridge || joining || !joinAddress.trim()}
              >
                {joining ? "Entrando…" : "Entrar na sala"}
              </button>
              {!hasDesktopBridge ? <p className="home-hint">Disponível apenas no app desktop.</p> : null}
            </form>

            {joinError ? <Notice kind="error">{joinError}</Notice> : null}
            {formError ? <Notice kind="error">{formError}</Notice> : null}
            {error ? <Notice kind="error">{error}</Notice> : null}
          </section>
        ) : (
          <section className="home-card home-room" aria-labelledby="home-room-title">
            <h2 id="home-room-title">Sala</h2>
            <p className="home-hint">Versão web: todos que abrirem este link entram na mesma sala (até 6 pessoas).</p>
            <div className="lan-box" data-testid="web-room-link">
              <h3>Link de entrada</h3>
              <ul className="address-list">
                <li>
                  <code>{shareUrl}</code>
                  <ShareButton url={shareUrl} title="Entre no meu escritório no DittoApp" />
                </li>
              </ul>
              <p className="home-hint">O app desktop (Electron) continua no repositório para uso offline na LAN.</p>
            </div>
            {formError ? <Notice kind="error">{formError}</Notice> : null}
            {error ? <Notice kind="error">{error}</Notice> : null}
          </section>
        )}
      </main>

      <footer className="home-footer">
        <span>{web ? "Sala privada por link · sem instalação · sem telemetria" : "100% offline · seus dados ficam nesta máquina"}</span>
        <span className="home-footer-hint">Atalhos no escritório: M microfone · V câmera · C chat · P participantes · Esc fecha painéis</span>
      </footer>
    </div>
  )
}
