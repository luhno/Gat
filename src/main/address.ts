// Validation for "join a LAN room" addresses. Pure module: no Electron import,
// so it can be unit-tested without booting the shell.
import { PRIVATE_HOST_PATTERN } from "@shared/constants"

export function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOST_PATTERN.test(hostname.toLowerCase())
}

export interface ParsedJoinAddress {
  /** Normalized host base: https://<host>:<port>/ */
  url: string
  /** First page a joining window must load: <base>?autojoin=1 */
  page: string
}

export function normalizeJoinAddress(raw: string): ParsedJoinAddress | { error: string } {
  const value = raw.trim()
  if (!value) return { error: "Informe o endereço do host (ex.: 192.168.0.10:8787)." }
  if (value.length > 512) return { error: "Endereço muito longo." }

  let parsed: URL
  if (value.includes("://")) {
    try {
      parsed = new URL(value)
    } catch {
      return { error: "Endereço inválido." }
    }
    if (parsed.protocol !== "https:") return { error: "Use um endereço https:// para entrar na sala." }
    if (parsed.username || parsed.password) return { error: "Endereço inválido." }
  } else {
    const match = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(value)
    if (!match) return { error: "Use host:porta (ex.: 192.168.0.10:8787)." }
    try {
      parsed = new URL(`https://${match[1]}:${match[2]}`)
    } catch {
      return { error: "Porta inválida." }
    }
  }

  const port = parsed.port ? Number(parsed.port) : 443
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Porta inválida." }
  const hostname = parsed.hostname.toLowerCase()
  if (!isPrivateHostname(hostname)) return { error: "Só é permitido entrar em hosts loopback ou da LAN." }

  const url = `https://${hostname}:${port}/`
  return { url, page: `${url}?autojoin=1` }
}
