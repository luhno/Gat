import { useEffect, useState } from "react"

// Touch UI is a behavior change (joystick drives movement), not just a layout breakpoint, so it
// is decided in JS. Capability checks only — no user-agent sniffing.
const TOUCH_QUERY = "(pointer: coarse) and (max-width: 1024px)"
const NARROW_QUERY = "(max-width: 1024px)"

const isTouchDevice = (): boolean => {
  if (typeof window === "undefined") return false
  if (!window.matchMedia(NARROW_QUERY).matches) return false
  // Chromium mobile emulation and some tablets report a fine pointer with touch points.
  return window.matchMedia(TOUCH_QUERY).matches || navigator.maxTouchPoints > 0
}

export const useIsTouch = (): boolean => {
  const [touch, setTouch] = useState(isTouchDevice)

  useEffect(() => {
    const queries = [window.matchMedia(TOUCH_QUERY), window.matchMedia(NARROW_QUERY)]
    const update = (): void => setTouch(isTouchDevice())
    for (const query of queries) query.addEventListener("change", update)
    return () => {
      for (const query of queries) query.removeEventListener("change", update)
    }
  }, [])

  return touch
}

/**
 * Mobile browsers resize the visual viewport (address bar, on-screen keyboard) without resizing
 * the layout viewport, so a plain `height: 100%` leaves the canvas and the chat input misplaced.
 * Publishes the real height as `--app-height`; the ResizeObserver in OfficeCanvas then re-fits.
 */
export const useDynamicViewportHeight = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) return
    const viewport = window.visualViewport
    const apply = (): void => {
      const height = viewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`)
    }
    apply()
    viewport?.addEventListener("resize", apply)
    viewport?.addEventListener("scroll", apply)
    window.addEventListener("resize", apply)
    window.addEventListener("orientationchange", apply)
    return () => {
      viewport?.removeEventListener("resize", apply)
      viewport?.removeEventListener("scroll", apply)
      window.removeEventListener("resize", apply)
      window.removeEventListener("orientationchange", apply)
      document.documentElement.style.removeProperty("--app-height")
    }
  }, [enabled])
}
