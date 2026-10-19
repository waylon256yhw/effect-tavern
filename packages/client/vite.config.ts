import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

// `vp dev` here, `node src/main.ts` in packages/server: the page talks to the session through `/api`.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: "http://localhost:7777", rewrite: (p) => p.replace(/^\/api/, "") } } },
})
