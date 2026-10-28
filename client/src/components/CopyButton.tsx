import { useEffect, useRef, useState } from "react"

import { IconCopy } from "./icons"

/** Copy-to-clipboard button with a short "Copiado!" confirmation (works offline, no deps). */
export function CopyButton({
  text,
  label,
  className = "btn btn-ghost btn-sm",
}: {
  text: string
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = async (): Promise<void> => {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      const area = document.createElement("textarea")
      area.value = text
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      try {
        ok = document.execCommand("copy")
      } catch {
        ok = false
      }
      area.remove()
    }
    if (!ok) return
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void copy()}
      aria-label={copied ? "Endereço copiado" : label}
      title={label}
    >
      <IconCopy />
      <span>{copied ? "Copiado!" : "Copiar"}</span>
    </button>
  )
}
