import solid from "@solidjs/vite-plugin"
import Icons from "unplugin-icons/vite"
import { defineConfig } from "vite-plus"

// `vp dev` here, `node src/main.ts` in packages/server: the page talks to the session through `/api`.
// Icons: Iconify's `ph` set (Phosphor), each `~icons/ph/<name>` compiled into a Solid component.
export default defineConfig({
  plugins: [solid(), Icons({ compiler: "solid", scale: 1 })],
  server: { proxy: { "/api": { target: "http://localhost:7777", rewrite: (p) => p.replace(/^\/api/, "") } } },
})
