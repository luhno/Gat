import { build } from "esbuild"
import { globSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const entries = globSync("tests/unit/*.test.ts", { cwd: rootDir }).map((f) => path.join(rootDir, f))

if (entries.length === 0) {
  console.error("no tests/unit/*.test.ts files found")
  process.exit(1)
}

await build({
  entryPoints: entries,
  outdir: path.join(rootDir, "dist/tests"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  external: ["electron"],
  tsconfig: path.join(rootDir, "tsconfig.json"),
  logLevel: "info",
})
