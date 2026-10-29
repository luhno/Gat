import { useEffect, useRef, useState } from "react"

interface ShareButtonProps {
  url: string
  title: string
  text?: string
  label?: string
  className?: string
}

/**
 * Native share sheet when the browser supports it (mobile), copy-to-clipboard fallback
 * (desktop/Electron). Both paths are offline and dependency-free.
 */
export function ShareButton({ url, title, text, label = "Compartilhar link da sala", className = "btn btn-ghost btn-sm" }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function"

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const onShare = async (): Promise<void> => {
    if (canShare) {
      try {
        await navigator.share({ title, text: text ?? title, url })
        return
      } catch (error) {
        // The user dismissed the sheet: leave the UI alone.
        if ((error as DOMException)?.name === "AbortError") return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void onShare()}
      aria-label={copied ? "Link copiado" : label}
      title={label}
      data-testid="share-room"
    >
      <span>{copied ? "Link copiado!" : canShare ? "Compartilhar" : "Copiar link"}</span>
    </button>
  )
}
