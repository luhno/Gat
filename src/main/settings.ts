// Persisted desktop settings (userData/settings.json). The renderer can only
// influence these through setSettings, so everything is validated here.

import fs from "node:fs"
import path from "node:path"

import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "@shared/bridge"
import { MAX_NAME_LENGTH, MAX_PROFILE_COLOR_LENGTH } from "@shared/constants"
import type { HairStyle, UserStatus } from "@shared/types"

import { log } from "./logger"

const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/
const STATUSES: UserStatus[] = ["available", "busy", "focus"]
const MAX_ADDRESS_LENGTH = 512
const MAX_DEVICE_ID_LENGTH = 256

export class SettingsStore {
  private value: DesktopSettings
  private readonly file: string

  constructor(file: string) {
    this.file = file
    this.value = sanitize(readJson(file))
  }

  get(): DesktopSettings {
    return { ...this.value }
  }

  set(patch: Partial<DesktopSettings>): DesktopSettings {
    this.value = sanitize({ ...this.value, ...patch })
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, `${JSON.stringify(this.value, null, 2)}\n`)
    } catch (error) {
      log(`[settings] não foi possível gravar ${this.file}: ${String(error)}`)
    }
    return this.get()
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown
  } catch {
    return null
  }
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
}

function text(raw: unknown, fallback: string, maxLength: number): string {
  return typeof raw === "string" ? raw.slice(0, maxLength) : fallback
}

function color(raw: unknown, fallback: string): string {
  return typeof raw === "string" && COLOR_PATTERN.test(raw) ? raw.slice(0, MAX_PROFILE_COLOR_LENGTH) : fallback
}

function nullableText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function sanitize(raw: unknown): DesktopSettings {
  const input = asRecord(raw)
  const fallback = DEFAULT_DESKTOP_SETTINGS
  const hairStyle = input.defaultHairStyle
  const status = input.defaultStatus
  return {
    defaultName: text(input.defaultName, fallback.defaultName, MAX_NAME_LENGTH),
    defaultShirtColor: color(input.defaultShirtColor, fallback.defaultShirtColor),
    defaultSkinTone: color(input.defaultSkinTone, fallback.defaultSkinTone),
    defaultHairStyle: (hairStyle === 0 || hairStyle === 1 || hairStyle === 2 || hairStyle === 3
      ? hairStyle
      : fallback.defaultHairStyle) as HairStyle,
    defaultStatus: STATUSES.includes(status as UserStatus) ? (status as UserStatus) : fallback.defaultStatus,
    lastJoinedAddress: nullableText(input.lastJoinedAddress, MAX_ADDRESS_LENGTH),
    audioInputId: nullableText(input.audioInputId, MAX_DEVICE_ID_LENGTH),
    videoInputId: nullableText(input.videoInputId, MAX_DEVICE_ID_LENGTH),
    audioOutputId: nullableText(input.audioOutputId, MAX_DEVICE_ID_LENGTH),
  }
}
