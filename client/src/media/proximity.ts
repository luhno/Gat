import { PROXIMITY_ENTER_TILES, PROXIMITY_EXIT_TILES, TILE_SIZE } from "@shared/constants"
import type { Vec2 } from "@shared/types"

/** Player positions are world pixels; proximity is judged in tiles. */
export const tileDistance = (a: Vec2, b: Vec2, tileSize: number = TILE_SIZE): number =>
  Math.hypot(a.x - b.x, a.y - b.y) / tileSize

/**
 * Hysteresis: an idle peer connects inside the enter radius, a connected peer
 * stays until the (larger) exit radius, and between the two the previous state
 * wins — that is what stops peers flapping while someone walks the boundary.
 */
export const nextConnected = (connected: boolean, distanceTiles: number): boolean =>
  connected ? distanceTiles < PROXIMITY_EXIT_TILES : distanceTiles <= PROXIMITY_ENTER_TILES

/** The lower id opens the media session, so exactly one side sends the first offer. */
export const isInitiator = (selfId: string, peerId: string): boolean => selfId < peerId

/** The higher id is the polite peer: it yields (rolls back) when both sides offer at once. */
export const isPolite = (selfId: string, peerId: string): boolean => selfId > peerId
