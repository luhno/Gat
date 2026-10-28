// Command-line flags for the offline shell. The e2e harness drives these.
import { DEFAULT_PORT } from "@shared/constants"

export interface CliOptions {
  port: number
  join: string | null
  multiInstance: boolean
  fakeMedia: boolean
  offlineGuardStrict: boolean
}

function value(argv: string[], name: string): string | null {
  const prefix = `--${name}=`
  const match = argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : null
}

export function parseCli(argv: string[]): CliOptions {
  const rawPort = value(argv, "port")
  const parsedPort = rawPort === null ? Number.NaN : Number.parseInt(rawPort, 10)
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT
  const join = value(argv, "join")?.trim() || null
  return {
    port,
    join,
    multiInstance: argv.includes("--multi-instance") || process.env.GATHER_OFFLINE_MULTI_INSTANCE === "1",
    fakeMedia: argv.includes("--fake-media"),
    offlineGuardStrict: argv.includes("--offline-guard-strict"),
  }
}
