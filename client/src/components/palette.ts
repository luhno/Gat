import type { HairStyle, UserStatus } from "@shared/types"

/** Profile choices offered on the home screen and in the settings panel. */

export const SHIRT_COLORS = [
  "#e4572e",
  "#f2b134",
  "#4ade80",
  "#22d3ee",
  "#3b82f6",
  "#a78bfa",
  "#f472b6",
  "#f87171",
]

export const SKIN_TONES = ["#f2c9a0", "#e0ac7e", "#b9805a", "#8d5a3b"]

export const HAIR_STYLES: HairStyle[] = [0, 1, 2, 3]

export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  0: "Curto",
  1: "Longo",
  2: "Coque",
  3: "Cacheado",
}

export const STATUSES: UserStatus[] = ["available", "busy", "focus"]

export const STATUS_LABELS: Record<UserStatus, string> = {
  available: "Disponível",
  busy: "Ocupado",
  focus: "Em foco",
}

export const STATUS_COLORS: Record<UserStatus, string> = {
  available: "#4ade80",
  busy: "#f87171",
  focus: "#c084fc",
}
