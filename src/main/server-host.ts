// The embedded HTTPS+WSS room server. Each app instance serves its own client
// bundle locally; a LAN guest then loads the host URL served by this same code.

import os from "node:os"

import { PRIVATE_HOST_PATTERN } from "@shared/constants"

import { startRoomServer } from "../server/server"
import { getOrCreateTlsMaterial } from "../server/tls"

export interface LocalServer {
  url: string
  port: number
  /** https://<private-ipv4>:<port>/ for every non-loopback private interface. */
  lanUrls: string[]
  close(): Promise<void>
}

export function lanIpv4Addresses(): string[] {
  const addresses = new Set<string>()
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && PRIVATE_HOST_PATTERN.test(entry.address)) {
        addresses.add(entry.address)
      }
    }
  }
  return [...addresses]
}

export async function startLocalServer(options: {
  port: number
  clientDir: string
  storageDir: string
}): Promise<LocalServer> {
  const lanIps = lanIpv4Addresses()
  const tls = await getOrCreateTlsMaterial(["localhost", "127.0.0.1", ...lanIps], options.storageDir)
  const server = await startRoomServer({ port: options.port, clientDir: options.clientDir, tls })
  return {
    url: new URL(server.url).toString(),
    port: server.port,
    lanUrls: lanIps.map((ip) => `https://${ip}:${server.port}/`),
    close: () => server.close(),
  }
}
