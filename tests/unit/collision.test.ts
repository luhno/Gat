import assert from "node:assert/strict"
import { test } from "node:test"

import { isBlocked, PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH, resolveMovement, tileCenter } from "../../src/shared/collision"
import type { OfficeMap } from "../../src/shared/types"

// 10x10 test room: wall border + one solid desk block at tiles (4,4)-(5,5).
const map: OfficeMap = (() => {
  const width = 10
  const height = 10
  const walls = new Array<number>(width * height).fill(0)
  for (let x = 0; x < width; x++) {
    walls[x] = 1
    walls[(height - 1) * width + x] = 1
  }
  for (let y = 0; y < height; y++) {
    walls[y * width] = 1
    walls[y * width + width - 1] = 1
  }
  return {
    name: "test",
    width,
    height,
    tileSize: 32,
    floors: new Array(width * height).fill(0),
    walls,
    objects: [{ id: "desk", kind: "desk", x: 4, y: 4, w: 2, h: 2, solid: true }],
    zones: [],
    spawn: { x: 2, y: 2 },
  }
})()

test("tileCenter returns the middle of a tile", () => {
  assert.deepEqual(tileCenter(map, 0, 0), { x: 16, y: 16 })
  assert.deepEqual(tileCenter(map, 3, 5), { x: 112, y: 176 })
})

test("open floor is walkable, walls and solid objects are not", () => {
  assert.equal(isBlocked(map, 2 * 32 + 16, 2 * 32 + 16), false)
  assert.equal(isBlocked(map, 16, 16), true) // border wall
  assert.equal(isBlocked(map, 4 * 32 + 16, 4 * 32 + 16), true) // desk
  assert.equal(isBlocked(map, -100, 100), true) // outside the map
})

test("resolveMovement slides along a wall instead of sticking", () => {
  const start = { x: 2 * 32 + 16, y: 2 * 32 + 16 }
  // Move diagonally up-left into the corner: both axes blocked, player stays put.
  const intoCorner = resolveMovement(map, start, { x: start.x - 50, y: start.y - 50 })
  assert.ok(intoCorner.x >= PLAYER_HALF_WIDTH)
  assert.ok(intoCorner.y >= PLAYER_HALF_HEIGHT)

  // Move right along the top wall while pushing up: x advances, y clamps.
  const slide = resolveMovement(map, start, { x: start.x + 60, y: start.y - 100 })
  assert.ok(slide.x > start.x, "x should advance")
  assert.equal(slide.y, start.y, "blocked axis keeps the previous value")
})

test("resolveMovement never leaves the map bounds", () => {
  const result = resolveMovement(map, { x: 16, y: 16 }, { x: 10000, y: -10000 })
  assert.ok(result.x <= map.width * map.tileSize - PLAYER_HALF_WIDTH)
  assert.ok(result.y >= PLAYER_HALF_HEIGHT)
})
