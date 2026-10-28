// The room server uses a self-signed certificate. Only accept it for loopback
// and private LAN hosts; anything else keeps Chromium's normal verification.

import { session } from "electron"

import { PRIVATE_HOST_PATTERN } from "@shared/constants"

import { log } from "./logger"

export function installCertificateVerifier(): void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (PRIVATE_HOST_PATTERN.test(request.hostname.toLowerCase())) {
      callback(0)
      return
    }
    // -3 = "not handled": fall back to Chromium's default verification.
    callback(-3)
  })
  log("[cert] verificador de certificado instalado (self-signed só em host privado)")
}
