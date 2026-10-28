import type { DesktopBridge } from "@shared/bridge"

declare global {
  interface Window {
    /** Injected by the Electron preload (src/preload/preload.ts). Absent in a plain browser. */
    gather?: DesktopBridge

    /** Read-only state snapshot exposed for the e2e harness (tests/e2e). */
    __gatherTest?: () => unknown
  }
}

export {}
