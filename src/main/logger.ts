// Minimal local-only logging. No telemetry, no network: everything goes to
// userData/logs inside the app's own data directory.

import fs from "node:fs"
import path from "node:path"

let logsDir = ""

export function initLogging(dir: string): void {
  logsDir = dir
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // Logging must never be the reason the app fails to start.
  }
}

export function logsDirectory(): string {
  return logsDir
}

/** stdout + userData/logs/main.log, so headless smoke tests can read either. */
export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  append("main.log", line)
}

/** Each blocked external request, one line: proof that the app never went online. */
export function offlineGuardLog(url: string): void {
  append("offline-guard.log", `${new Date().toISOString()} ${url}`)
}

function append(file: string, line: string): void {
  if (!logsDir) return
  try {
    fs.appendFileSync(path.join(logsDir, file), `${line}\n`)
  } catch {
    // Ignore: logging is best-effort.
  }
}
