export const APP_VERSION = "1.0.0"
export const APP_DISPLAY_NAME = "DittoApp"
export const PROTOCOL_VERSION = 1

export const TILE_SIZE = 32
export const MAX_NAME_LENGTH = 32
export const MAX_CHAT_LENGTH = 500
export const MAX_PLAYERS = 6
export const MAX_MESSAGE_BYTES = 16 * 1024
export const MAX_PROFILE_COLOR_LENGTH = 9

export const WS_PATH = "/ws"
export const DEFAULT_PORT = 8787
export const PORT_ATTEMPTS = 5

export const MOVE_SEND_INTERVAL_MS = 60
export const PING_INTERVAL_MS = 5000
export const CHAT_HISTORY_LIMIT = 200

/** Peers start a media session inside this distance (tiles) and drop it outside the exit radius. */
export const PROXIMITY_ENTER_TILES = 4.5
export const PROXIMITY_EXIT_TILES = 5.5

/** Chat/rate limits enforced by the LAN server. */
export const CHAT_RATE_WINDOW_MS = 5000
export const CHAT_RATE_MAX = 8
export const MOVE_RATE_WINDOW_MS = 1000
export const MOVE_RATE_MAX = 40

export const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})|10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})|192\.168\.(\d{1,3})\.(\d{1,3})|172\.(1[6-9]|2\d|3[01])\.(\d{1,3})\.(\d{1,3}))$/
