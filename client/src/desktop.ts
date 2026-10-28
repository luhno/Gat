import type { DesktopBridge, DesktopSettings, JoinResult } from "@shared/bridge"
import type { PlayerProfile } from "@shared/types"

import { actions, getState } from "./state/store"

/** The preload bridge. Undefined when a LAN guest opens the office URL in a plain browser. */
export const desktop: DesktopBridge | null = typeof window !== "undefined" ? (window.gather ?? null) : null

export const hasDesktopBridge = desktop !== null

/** Load desktop-only state (app mode + persisted settings) and apply defaults to the profile. */
export async function bootstrapDesktop(): Promise<void> {
  if (!desktop) return
  const [info, settings] = await Promise.all([desktop.getConnectionInfo(), desktop.getSettings()])
  actions.setDesktop(info)
  actions.setSettings(settings)
  if (!getState().profile.name && settings.defaultName) {
    actions.setProfile({
      name: settings.defaultName,
      shirtColor: settings.defaultShirtColor,
      skinTone: settings.defaultSkinTone,
      hairStyle: settings.defaultHairStyle,
      status: settings.defaultStatus,
    })
  }
}

/** Persist the profile fields that should prefill the next session. */
export async function persistProfile(profile: PlayerProfile): Promise<void> {
  if (!desktop || !profile.name) return
  const settings: Partial<DesktopSettings> = {
    defaultName: profile.name,
    defaultShirtColor: profile.shirtColor,
    defaultSkinTone: profile.skinTone,
    defaultHairStyle: profile.hairStyle,
    defaultStatus: profile.status,
  }
  const saved = await desktop.setSettings(settings)
  actions.setSettings(saved)
}

export async function persistDeviceSettings(settings: Partial<DesktopSettings>): Promise<void> {
  if (!desktop) return
  actions.setSettings(await desktop.setSettings(settings))
}

export async function joinLanRoom(address: string): Promise<JoinResult> {
  if (!desktop) return { ok: false, error: "Entrar em uma sala da LAN só funciona no app desktop." }
  return desktop.joinLanRoom(address)
}
