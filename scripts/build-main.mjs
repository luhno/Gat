import { build } from "esbuild"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Bundle main + preload into self-contained CJS files so the packaged app has no
// runtime node_modules (ws/selfsigned are bundled; electron is provided by the runtime).
await build({
  entryPoints: {
    main: path.join(rootDir, "src/main/main.ts"),
    preload: path.join(rootDir, "src/preload/preload.ts"),
  },
  outdir: path.join(rootDir, "dist/main"),
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  // ws optional native speedups are not needed; electron is injected by the runtime.
  external: ["electron", "bufferutil", "utf-8-validate"],
  tsconfig: path.join(rootDir, "tsconfig.json"),
  logLevel: "info",
})
