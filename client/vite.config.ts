import path from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "../src/shared"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "../dist/client"),
    emptyOutDir: true,
    // Produção não pode publicar sourcemaps: o servidor serve dist/client direto, então um
    // `.map` ficaria acessível. Debug pode optar por SOURCEMAP=true.
    sourcemap: process.env.SOURCEMAP === "true",
  },
})
