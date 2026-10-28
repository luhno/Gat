import { useEffect, useRef, useState } from "react"

import { MAX_NAME_LENGTH } from "@shared/constants"

import { Notice } from "./components/Notice"
import { bootstrapDesktop, hasDesktopBridge } from "./desktop"
import { HomeScreen } from "./home/HomeScreen"
import { connection } from "./net/connection"
import { OfficeScreen } from "./office/OfficeScreen"
import { actions, getState, useStore } from "./state/store"

/** Boot: load desktop bridge state, then route between home and the office. */
export function App() {
  const state = useStore()
  const [booted, setBooted] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const autojoinDone = useRef(false)

  useEffect(() => {
    let alive = true
    bootstrapDesktop()
      .catch((cause: unknown) => {
        if (alive) setBootError(cause instanceof Error ? cause.message : "Não foi possível carregar as configurações do app.")
      })
      .finally(() => {
        if (alive) setBooted(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!booted || autojoinDone.current) return
    autojoinDone.current = true
    const params = new URLSearchParams(window.location.search)
    if (params.get("autojoin") !== "1") return
    const profile = { ...getState().profile }
    if (!profile.name.trim()) {
      // Online room links have no desktop profile: accept ?name= or become a unique guest.
      const requested = (params.get("name") ?? "").trim().slice(0, MAX_NAME_LENGTH)
      profile.name = requested || (hasDesktopBridge ? "Convidado" : `Convidado ${Math.floor(1000 + Math.random() * 9000)}`)
    }
    actions.setProfile(profile)
    connection.connect(profile).catch((cause: unknown) => {
      actions.setError(cause instanceof Error ? cause.message : "Não foi possível entrar na sala da LAN.")
    })
  }, [booted])

  if (!booted) {
    return (
      <div className="splash">
        <span className="spinner" aria-hidden="true" />
        <p>Carregando DittoApp…</p>
      </div>
    )
  }

  if (state.selfId && state.map) return <OfficeScreen />

  return (
    <>
      <HomeScreen />
      {bootError ? (
        <div className="boot-error">
          <Notice kind="error" onClose={() => setBootError(null)}>
            {bootError}
          </Notice>
        </div>
      ) : null}
    </>
  )
}
