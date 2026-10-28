import { DEFAULT_DESKTOP_SETTINGS, type DesktopBridge, type DesktopSettings, type JoinResult } from "@shared/bridge"
import { MAX_NAME_LENGTH } from "@shared/constants"
import type { HairStyle, PlayerProfile, UserStatus } from "@shared/types"

import { HAIR_STYLES, SHIRT_COLORS, SKIN_TONES, STATUSES } from "./components/palette"
import { actions, getState } from "./state/store"

/** The preload bridge. Undefined when a LAN guest opens the office URL in a plain browser. */
export const desktop: DesktopBridge | null = typeof window !== "undefined" ? (window.gather ?? null) : null

export const hasDesktopBridge = desktop !== null

/**
 * Web sessions have no desktop settings file; the profile is kept in localStorage so a
 * visitor keeps their name/avatar across reloads and tabs.
 */
const PROFILE_STORAGE_KEY = "dittoapp.profile.v1"

const storedProfile = (): PlayerProfile | null => {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<Record<keyof PlayerProfile, unknown>>
    if (typeof value.name !== "string" || !value.name.trim()) return null
    return {
      name: value.name.trim().slice(0, MAX_NAME_LENGTH),
      shirtColor:
        typeof value.shirtColor === "string" && SHIRT_COLORS.includes(value.shirtColor)
          ? value.shirtColor
          : DEFAULT_DESKTOP_SETTINGS.defaultShirtColor,
      skinTone:
        typeof value.skinTone === "string" && SKIN_TONES.includes(value.skinTone)
          ? value.skinTone
          : DEFAULT_DESKTOP_SETTINGS.defaultSkinTone,
      hairStyle: HAIR_STYLES.includes(value.hairStyle as HairStyle)
        ? (value.hairStyle as HairStyle)
        : DEFAULT_DESKTOP_SETTINGS.defaultHairStyle,
      status: STATUSES.includes(value.status as UserStatus) ? (value.status as UserStatus) : DEFAULT_DESKTOP_SETTINGS.defaultStatus,
    }
  } catch {
    return null
  }
}

/** Load desktop-only state (app mode + persisted settings) and apply defaults to the profile. */
export async function bootstrapDesktop(): Promise<void> {
  if (!desktop) {
    const profile = storedProfile()
    if (profile) actions.setProfile(profile)
    return
  }
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

/** Persist the profile fields that should prefill the next session (desktop settings or localStorage). */
export async function persistProfile(profile: PlayerProfile): Promise<void> {
  if (!profile.name) return
  if (!desktop) {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
    } catch {
      // Private mode / storage disabled: the profile simply does not survive a reload.
    }
    return
  }
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
