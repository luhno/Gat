import type { ReactNode } from "react"

import { IconClose } from "./icons"

/** Inline banner used for connection/media errors and warnings. */
export function Notice({
  kind = "info",
  children,
  onClose,
}: {
  kind?: "info" | "error"
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="notice-text">{children}</span>
      {onClose ? (
        <button type="button" className="notice-close" onClick={onClose} aria-label="Fechar aviso">
          <IconClose />
        </button>
      ) : null}
    </div>
  )
}
