import { useEffect, useRef, useState } from "react"

import { CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS, MAX_CHAT_LENGTH } from "@shared/constants"
import type { ChatMessage } from "@shared/types"

import { IconClose, IconSend } from "../components/icons"

const formatTime = (at: number): string =>
  new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

export function ChatPanel({
  messages,
  onSend,
  onClose,
}: {
  messages: ChatMessage[]
  onSend: (text: string) => boolean
  onClose: () => void
}) {
  const [text, setText] = useState("")
  const [rateLimited, setRateLimited] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const sentAtRef = useRef<number[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [messages.length])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const limited = (): boolean => {
    const now = Date.now()
    sentAtRef.current = sentAtRef.current.filter((at) => now - at < CHAT_RATE_WINDOW_MS)
    if (sentAtRef.current.length < CHAT_RATE_MAX) return false
    const wait = CHAT_RATE_WINDOW_MS - (now - sentAtRef.current[0])
    setRateLimited(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setRateLimited(false), Math.max(600, wait))
    return true
  }

  const send = (): void => {
    const value = text.trim()
    if (!value) return
    if (limited()) return
    if (!onSend(value)) return
    sentAtRef.current.push(Date.now())
    setText("")
  }

  return (
    <aside className="panel chat-panel" data-testid="chat-panel" aria-label="Chat da sala">
      <header className="panel-head">
        <h2>Chat</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar chat">
          <IconClose />
        </button>
      </header>
      <div className="chat-messages" ref={scrollerRef} data-testid="chat-messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p className="panel-empty">Nenhuma mensagem ainda. Diga oi para a sala!</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={message.system ? "chat-message is-system" : "chat-message"}>
              {message.system ? (
                <p className="chat-system-text">{message.text}</p>
              ) : (
                <>
                  <div className="chat-meta">
                    <span className="chat-author" style={{ color: message.shirtColor }}>
                      {message.name}
                    </span>
                    <time className="chat-time" dateTime={new Date(message.at).toISOString()}>
                      {formatTime(message.at)}
                    </time>
                  </div>
                  <p className="chat-text">{message.text}</p>
                </>
              )}
            </div>
          ))
        )}
      </div>
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <input
          ref={inputRef}
          className="chat-input"
          data-testid="chat-input"
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Mensagem para a sala…"
          aria-label="Escrever mensagem"
          enterKeyHint="send"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              onClose()
            }
          }}
        />
        <button type="submit" className="btn btn-primary chat-send" data-testid="chat-send" aria-label="Enviar mensagem">
          <IconSend />
          <span>Enviar</span>
        </button>
      </form>
      {rateLimited ? (
        <p className="chat-rate" role="status">
          Muitas mensagens em pouco tempo. Aguarde alguns segundos.
        </p>
      ) : null}
    </aside>
  )
}
