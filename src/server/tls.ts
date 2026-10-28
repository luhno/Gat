import { createHash, X509Certificate } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import selfsigned from "selfsigned"

import { PRIVATE_HOST_PATTERN } from "../shared/constants"

export interface TlsMaterial {
  key: string
  cert: string
  fingerprint256: string
}

const CERT_VALIDITY_DAYS = 3650
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
const HOSTNAME = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

/** SHA-256 fingerprint of the DER certificate, colon separated (same form as browsers show). */
export const fingerprint = (certPem: string): string =>
  createHash("sha256").update(new X509Certificate(certPem).raw).digest("hex").toUpperCase().replace(/(..)(?=.)/g, "$1:")

const privateIPv4 = (): string[] => {
  const addresses: string[] = []
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (String(info.family) !== "IPv4" || info.internal) continue
      if (PRIVATE_HOST_PATTERN.test(info.address)) addresses.push(info.address)
    }
  }
  return addresses
}

const isValidIPv4 = (value: string): boolean =>
  IPV4.test(value) && value.split(".").every((octet) => Number(octet) <= 255)

/** SAN names for this host: caller hostnames + loopback + the machine's private IPv4s. */
const sanNames = (hostnames: string[]): string[] => {
  const names = new Set<string>()
  for (const raw of [...hostnames, "localhost", "127.0.0.1", ...privateIPv4()]) {
    const value = raw.trim().toLowerCase()
    if (value.length === 0 || value.length > 253) continue
    if (IPV4.test(value)) {
      if (isValidIPv4(value)) names.add(value)
    } else if (HOSTNAME.test(value)) {
      names.add(value)
    }
  }
  return [...names]
}

const altNames = (names: string[]) =>
  names.map((name) => (IPV4.test(name) ? { type: 7 as const, ip: name } : { type: 2 as const, value: name }))

const certSans = (certPem: string): Set<string> => {
  const names = new Set<string>()
  try {
    const alt = new X509Certificate(certPem).subjectAltName ?? ""
    for (const part of alt.split(",")) {
      const entry = part.trim()
      if (entry.startsWith("DNS:")) names.add(entry.slice(4).toLowerCase())
      else if (entry.startsWith("IP Address:")) names.add(entry.slice(11).toLowerCase())
      else if (entry.startsWith("IP:")) names.add(entry.slice(3).toLowerCase())
    }
  } catch {
    // Unreadable cert: fall through and regenerate.
  }
  return names
}

/**
 * Returns a self-signed key/cert pair valid for `hostnames` plus loopback and this host's private
 * IPv4s, persisted under `<storageDir>/tls/`. Regenerates when the stored cert does not cover the
 * current hostnames (e.g. the LAN IP changed), so the same file is reused across boots otherwise.
 */
export async function getOrCreateTlsMaterial(hostnames: string[], storageDir: string): Promise<TlsMaterial> {
  const names = sanNames(hostnames)
  const dir = path.join(storageDir, "tls")
  const keyPath = path.join(dir, "key.pem")
  const certPath = path.join(dir, "cert.pem")
  try {
    const [key, cert] = await Promise.all([fs.readFile(keyPath, "utf8"), fs.readFile(certPath, "utf8")])
    const covered = certSans(cert)
    if (names.every((name) => covered.has(name))) return { key, cert, fingerprint256: fingerprint(cert) }
  } catch {
    // Missing/corrupt material: regenerate below.
  }

  const pems = await selfsigned.generate([{ name: "commonName", value: names[0] ?? "localhost" }], {
    notAfterDate: new Date(Date.now() + CERT_VALIDITY_DAYS * 24 * 3600 * 1000),
    keySize: 2048,
    algorithm: "sha256",
    extensions: [{ name: "subjectAltName", altNames: altNames(names) }],
  })
  await fs.mkdir(dir, { recursive: true })
  await Promise.all([fs.writeFile(keyPath, pems.private), fs.writeFile(certPath, pems.cert)])
  return { key: pems.private, cert: pems.cert, fingerprint256: fingerprint(pems.cert) }
}
