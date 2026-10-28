// Bundles the standalone web server (src/online/main.ts) into dist/online/server.cjs.
// Self-contained: ws is bundled, so the runtime image needs no node_modules.
import { build } from "esbuild"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

await build({
  entryPoints: { server: path.join(rootDir, "src/online/main.ts") },
  outdir: path.join(rootDir, "dist/online"),
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  external: ["bufferutil", "utf-8-validate"],
  tsconfig: path.join(rootDir, "tsconfig.json"),
  logLevel: "info",
})
