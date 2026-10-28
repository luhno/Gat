// Server-side collision helpers. The math itself is shared with the web client
// (src/shared/collision.ts) so both sides resolve walls identically; only the spawn
// placement is server-only.
export {
  PLAYER_HALF_WIDTH,
  PLAYER_HALF_HEIGHT,
  tileCenter,
  clampToMap,
  isBlocked,
  resolveMovement,
} from "../shared/collision"

import { isBlocked, tileCenter } from "../shared/collision"
import type { OfficeMap, Vec2 } from "../shared/types"

/** Free spot on the spawn tile or the closest free ring around it; random among that ring. */
export const findSpawn = (map: OfficeMap, occupied: readonly Vec2[] = [], random: () => number = Math.random): Vec2 => {
  const minDistance = map.tileSize * 0.9
  for (let radius = 0; radius <= 8; radius++) {
    const candidates: Vec2[] = []
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const spot = tileCenter(map, map.spawn.x + dx, map.spawn.y + dy)
        if (isBlocked(map, spot.x, spot.y)) continue
        if (occupied.some((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < minDistance)) continue
        candidates.push(spot)
      }
    }
    if (candidates.length > 0) return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]!
  }
  return tileCenter(map, map.spawn.x, map.spawn.y)
}
