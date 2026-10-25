import solid from "@solidjs/vite-plugin"
import type { IncomingMessage, ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { FileSystemIconLoader } from "unplugin-icons/loaders"
import Icons from "unplugin-icons/vite"
import { defineConfig, type Plugin, type RunnableDevEnvironment } from "vite-plus"

// `vp dev` is the whole stack: the session (packages/server/src/dev.ts) runs inside this process through Vite's module
// runner, mounted at /api. An edit under runtime or server re-evaluates it on the next request; the journal file keeps
// the story across that. A backend that fails to load answers 500 with the reason instead of hanging the client.
const api = (): Plugin => ({
  name: "tavern-api",
  configureServer(server) {
    const entry = fileURLToPath(new URL("../server/src/dev.ts", import.meta.url))
    server.middlewares.use("/api", async (req, res) => {
      try {
        const { handler } = (await (server.environments["ssr"] as RunnableDevEnvironment).runner.import(entry)) as {
          handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
        }
        await handler(req, res)
      } catch (e) {
        res
          .writeHead(500, { "content-type": "text/plain" })
          .end(e instanceof Error ? (e.stack ?? e.message) : String(e))
      }
    })
  },
})

// Icons: Iconify's `ph` set (Phosphor), each `~icons/ph/<name>` compiled into a Solid component; `~icons/lobe/<slug>`
// is one mono LobeHub brand SVG (MIT, the static-svg package), read from disk per named import (src/family.tsx).
const lobe = FileSystemIconLoader(
  fileURLToPath(new URL("./node_modules/@lobehub/icons-static-svg/icons", import.meta.url)),
)
export default defineConfig({
  plugins: [solid(), Icons({ compiler: "solid", scale: 1, customCollections: { lobe } }), api()],
})
