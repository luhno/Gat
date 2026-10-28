import type { MapObject, MapZone, OfficeMap } from "./types"

// Floor plan for the offline office. Plain serializable data: the LAN server sends this
// verbatim in `welcome`, so nothing here may be a function or a class instance.
//
// Layout (44 x 28 tiles, 32 px each = 1408 x 896 world px):
//   reception NW · meeting room N · kitchen NE · corridor · open desks · lounge SW · focus pods E · library SE

const WIDTH = 44
const HEIGHT = 28
const TILE_SIZE = 32

const obj = (
  kind: MapObject["kind"],
  x: number,
  y: number,
  w = 1,
  h = 1,
  solid = true,
  label?: string,
): MapObject => ({
  id: `${kind}-${x}-${y}-${w}x${h}`,
  kind,
  x,
  y,
  w,
  h,
  solid,
  label,
})

const build = (): OfficeMap => {
  const floors = new Array<number>(WIDTH * HEIGHT).fill(0)
  const walls = new Array<number>(WIDTH * HEIGHT).fill(0)
  const at = (x: number, y: number) => y * WIDTH + x

  const wallH = (x0: number, x1: number, y: number, gaps: number[] = []) => {
    for (let x = x0; x <= x1; x++) if (!gaps.includes(x)) walls[at(x, y)] = 1
  }
  const wallV = (y0: number, y1: number, x: number, gaps: number[] = []) => {
    for (let y = y0; y <= y1; y++) if (!gaps.includes(y)) walls[at(x, y)] = 1
  }

  // Outer shell.
  wallH(0, WIDTH - 1, 0)
  wallH(0, WIDTH - 1, HEIGHT - 1)
  wallV(0, HEIGHT - 1, 0)
  wallV(0, HEIGHT - 1, WIDTH - 1)

  // Meeting room: enclosed, double door onto the corridor.
  wallH(14, 26, 1)
  wallV(1, 9, 14)
  wallV(1, 9, 26)
  wallH(15, 25, 9, [19, 20])

  // Kitchen: partition on the west side plus a door onto the corridor.
  wallV(1, 9, 28, [5])
  wallH(29, 42, 9, [35, 36])

  // Focus pods (east): solid block with two interior dividers and doors.
  wallH(29, 42, 10, [35, 36])
  wallV(11, 19, 33, [15])
  wallV(11, 19, 38, [18])
  wallH(29, 42, 20, [35, 36])

  // East wing divider: doors open into desks, pods and library.
  wallV(11, 26, 28, [13, 23])

  // Lounge (south-west): two wide doors onto the open floor.
  wallH(1, 12, 20, [6, 7])
  wallV(20, 26, 13, [23])

  const zone = (name: string, x: number, y: number, w: number, h: number, floor: number): MapZone => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) floors[at(xx, yy)] = floor
    }
    return { id: name.toLowerCase().replace(/\s+/g, "-"), name, x, y, w, h }
  }

  const zones: MapZone[] = [
    zone("Recepção", 1, 1, 12, 8, 1),
    zone("Sala de Reunião", 15, 2, 11, 7, 2),
    zone("Cozinha", 29, 1, 14, 8, 3),
    zone("Corredor", 1, 9, 27, 2, 6),
    zone("Estações de Trabalho", 1, 11, 27, 16, 0),
    zone("Lounge", 1, 20, 12, 7, 4),
    zone("Cápsulas de Foco", 29, 11, 14, 9, 5),
    zone("Biblioteca", 29, 21, 14, 6, 1),
  ]

  const objects: MapObject[] = [
    // ── Reception ────────────────────────────────────────────────────────────
    obj("rug", 3, 2, 6, 5, false),
    obj("desk", 3, 4, 4, 1),
    obj("chair", 5, 5, 1, 1, false),
    obj("chair", 9, 3, 1, 1, false),
    obj("chair", 10, 6, 1, 1, false),
    obj("table", 9, 4, 2, 2),
    obj("bookshelf", 2, 1, 1, 3),
    obj("plant", 11, 1, 1, 1),
    obj("plant", 11, 7, 1, 1),
    obj("lamp", 1, 8, 1, 1, false),
    // ── Meeting room ─────────────────────────────────────────────────────────
    obj("rug", 16, 3, 9, 5, false),
    obj("table", 18, 4, 7, 3),
    obj("chair", 18, 3, 1, 1, false),
    obj("chair", 20, 3, 1, 1, false),
    obj("chair", 22, 3, 1, 1, false),
    obj("chair", 24, 3, 1, 1, false),
    obj("chair", 18, 7, 1, 1, false),
    obj("chair", 20, 7, 1, 1, false),
    obj("chair", 22, 7, 1, 1, false),
    obj("chair", 24, 7, 1, 1, false),
    obj("whiteboard", 16, 2, 4, 1),
    obj("tv", 24, 2, 1, 2),
    obj("plant", 15, 7, 1, 1),
    obj("door", 19, 9, 2, 1, false),
    // ── Kitchen ──────────────────────────────────────────────────────────────
    obj("counter", 30, 1, 8, 1),
    obj("crate", 40, 1, 2, 2),
    obj("table", 32, 4, 6, 2),
    obj("stool", 33, 3, 1, 1, false),
    obj("stool", 35, 3, 1, 1, false),
    obj("stool", 33, 6, 1, 1, false),
    obj("stool", 35, 6, 1, 1, false),
    obj("table", 38, 5, 3, 2),
    obj("chair", 38, 4, 1, 1, false),
    obj("chair", 40, 4, 1, 1, false),
    obj("chair", 38, 7, 1, 1, false),
    obj("chair", 40, 7, 1, 1, false),
    obj("plant", 42, 4, 1, 1),
    obj("door", 35, 9, 2, 1, false),
    obj("door", 28, 5, 1, 1, false),
    // ── Open desks ───────────────────────────────────────────────────────────
    obj("whiteboard", 7, 11, 3, 1),
    obj("desk", 3, 13, 4, 1),
    obj("chair", 4, 14, 1, 1, false),
    obj("chair", 6, 14, 1, 1, false),
    obj("desk", 3, 16, 4, 1),
    obj("chair", 4, 17, 1, 1, false),
    obj("chair", 6, 17, 1, 1, false),
    obj("desk", 10, 13, 4, 1),
    obj("chair", 11, 14, 1, 1, false),
    obj("chair", 13, 14, 1, 1, false),
    obj("desk", 10, 16, 4, 1),
    obj("chair", 11, 17, 1, 1, false),
    obj("chair", 13, 17, 1, 1, false),
    obj("desk", 17, 13, 4, 1),
    obj("chair", 18, 14, 1, 1, false),
    obj("chair", 20, 14, 1, 1, false),
    obj("desk", 17, 16, 4, 1),
    obj("chair", 18, 17, 1, 1, false),
    obj("chair", 20, 17, 1, 1, false),
    obj("desk", 24, 13, 3, 1),
    obj("chair", 24, 14, 1, 1, false),
    obj("chair", 26, 14, 1, 1, false),
    obj("desk", 24, 16, 3, 1),
    obj("chair", 24, 17, 1, 1, false),
    obj("chair", 26, 17, 1, 1, false),
    obj("plant", 1, 12, 1, 1),
    obj("plant", 8, 12, 1, 1),
    obj("plant", 15, 12, 1, 1),
    obj("plant", 22, 12, 1, 1),
    obj("plant", 27, 12, 1, 1),
    obj("plant", 15, 19, 1, 1),
    obj("lamp", 8, 19, 1, 1, false),
    obj("lamp", 26, 11, 1, 1, false),
    // South open area
    obj("rug", 16, 21, 9, 3, false),
    obj("desk", 16, 22, 4, 1),
    obj("chair", 17, 23, 1, 1, false),
    obj("chair", 19, 23, 1, 1, false),
    obj("sofa", 21, 25, 4, 1),
    obj("table", 25, 22, 2, 2),
    obj("plant", 14, 25, 1, 1),
    obj("lamp", 20, 21, 1, 1, false),
    // ── Lounge ───────────────────────────────────────────────────────────────
    obj("rug", 2, 21, 9, 5, false),
    obj("sofa", 3, 21, 4, 1),
    obj("sofa", 3, 25, 4, 1),
    obj("table", 8, 23, 2, 2),
    obj("tv", 1, 23, 1, 1),
    obj("plant", 11, 21, 1, 1),
    obj("plant", 1, 26, 1, 1),
    obj("bookshelf", 11, 24, 1, 3),
    obj("lamp", 7, 21, 1, 1, false),
    // ── Focus pods ───────────────────────────────────────────────────────────
    obj("desk", 30, 12, 2, 1),
    obj("chair", 30, 13, 1, 1, false),
    obj("bookshelf", 29, 17, 1, 2),
    obj("plant", 32, 18, 1, 1),
    obj("desk", 35, 12, 2, 1),
    obj("chair", 35, 13, 1, 1, false),
    obj("whiteboard", 34, 18, 2, 1),
    obj("plant", 34, 19, 1, 1),
    obj("desk", 39, 13, 2, 1),
    obj("chair", 40, 14, 1, 1, false),
    obj("plant", 41, 17, 1, 1),
    obj("lamp", 39, 18, 1, 1, false),
    obj("bookshelf", 42, 18, 1, 2),
    obj("door", 35, 10, 2, 1, false),
    obj("door", 33, 15, 1, 1, false),
    obj("door", 38, 18, 1, 1, false),
    obj("door", 28, 13, 1, 1, false),
    // ── Library ──────────────────────────────────────────────────────────────
    obj("bookshelf", 30, 21, 1, 2),
    obj("bookshelf", 34, 21, 1, 2),
    obj("bookshelf", 40, 21, 1, 2),
    obj("bookshelf", 42, 21, 1, 2),
    obj("rug", 32, 23, 7, 3, false),
    obj("sofa", 33, 25, 4, 1),
    obj("table", 35, 23, 2, 2),
    obj("plant", 29, 25, 1, 1),
    obj("plant", 41, 25, 1, 1),
    obj("lamp", 38, 24, 1, 1, false),
    obj("door", 35, 20, 2, 1, false),
    obj("door", 28, 23, 1, 1, false),
  ]

  return {
    name: "Escritório Offline",
    width: WIDTH,
    height: HEIGHT,
    tileSize: TILE_SIZE,
    floors,
    walls,
    objects,
    zones,
    spawn: { x: 21, y: 11 },
  }
}

export const DEFAULT_MAP: OfficeMap = build()
