import assert from "node:assert/strict"
import { test } from "node:test"

import { PROXIMITY_ENTER_TILES, PROXIMITY_EXIT_TILES, TILE_SIZE } from "@shared/constants"

import { isInitiator, isPolite, nextConnected, tileDistance } from "../../client/src/media/proximity"

test("tileDistance converts world pixels to tiles", () => {
  // 3-4-5 triangle in pixels is a 5-tile distance on a 32px map.
  assert.equal(tileDistance({ x: 0, y: 0 }, { x: TILE_SIZE * 3, y: TILE_SIZE * 4 }), 5)
  assert.equal(tileDistance({ x: 0, y: 0 }, { x: 0, y: 0 }), 0)
  assert.equal(tileDistance({ x: 100, y: 100 }, { x: 100 + TILE_SIZE / 2, y: 100 }, 32), 0.5)
  // A larger tile size means the same pixels are fewer tiles.
  assert.equal(tileDistance({ x: 0, y: 0 }, { x: 64, y: 0 }, 64), 1)
})

test("hysteresis enters at 4.5 tiles and only exits at 5.5 tiles", () => {
  assert.equal(PROXIMITY_ENTER_TILES, 4.5)
  assert.equal(PROXIMITY_EXIT_TILES, 5.5)

  let connected = false
  connected = nextConnected(connected, 5.0)
  assert.equal(connected, false, "inside the dead band but never connected: stays disconnected")
  connected = nextConnected(connected, 4.5)
  assert.equal(connected, true, "at the enter radius: connects")
  connected = nextConnected(connected, 5.4)
  assert.equal(connected, true, "inside the dead band while connected: stays connected")
  connected = nextConnected(connected, 5.5)
  assert.equal(connected, false, "at the exit radius: disconnects")
  connected = nextConnected(connected, 5.0)
  assert.equal(connected, false, "inside the dead band while disconnected: stays disconnected")
  connected = nextConnected(connected, 4.4)
  assert.equal(connected, true, "back inside the enter radius: reconnects")
})

test("walking through the radius flips the connection exactly twice", () => {
  // Walking away and back: no flapping around the boundary.
  const path = [6, 5.6, 5.2, 4.8, 4.6, 4.5, 4, 4.4, 4.6, 5.0, 5.4, 5.49, 5.5, 5.8]
  let connected = false
  const transitions: boolean[] = []
  for (const distance of path) {
    const next = nextConnected(connected, distance)
    if (next !== connected) transitions.push(next)
    connected = next
  }
  assert.deepEqual(transitions, [true, false])
})

test("the lower id initiates and the higher id is polite", () => {
  assert.equal(isInitiator("a", "b"), true)
  assert.equal(isInitiator("b", "a"), false)
  assert.equal(isPolite("b", "a"), true)
  assert.equal(isPolite("a", "b"), false)

  // Exactly one side initiates each pair, and it is never the polite one.
  for (const [selfId, peerId] of [
    ["a", "b"],
    ["b", "a"],
    ["3f2a", "3f2b"],
    ["9", "10"],
  ] as const) {
    assert.notEqual(isInitiator(selfId, peerId), isInitiator(peerId, selfId))
    assert.notEqual(isInitiator(selfId, peerId), isPolite(selfId, peerId))
  }
})
