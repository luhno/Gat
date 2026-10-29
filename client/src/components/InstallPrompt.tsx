import { useEffect, useState } from "react"

/** Minimal shape of Chrome's install event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

const isElectron = typeof window !== "undefined" && "gather" in window

/**
 * "Instalar app" button. Hidden unless the browser offers installation (beforeinstallprompt),
 * which never happens in the Electron shell — the desktop app is already installed.
 */
export function InstallPrompt({ className = "btn btn-primary" }: { className?: string }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isElectron) return
    const onPrompt = (event: Event): void => {
      event.preventDefault()
      setPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = (): void => setPrompt(null)
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  if (!prompt) return null
  return (
    <button
      type="button"
      className={className}
      data-testid="install-prompt"
      onClick={() => {
        void prompt.prompt()
        setPrompt(null)
      }}
    >
      <span>Instalar app</span>
    </button>
  )
}
