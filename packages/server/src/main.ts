// `PORT=7777 MODEL=fake bun src/main.ts`: the whole tavern on one port, what a phone runs. The developer's
// session (dev.ts) under /api, and the client build (`vp build` in packages/client) under everything else; `vp dev`
// mounts the same handler at /api itself and serves the client from source.
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { handler } from "./dev.ts"
import { app } from "./serve.ts"

const port = Number(process.env["PORT"] ?? 7777)
// `bun run compile` embeds the build in the binary (`--asset ../client/dist`), where it sits at dist/ beside main
const dist = fileURLToPath(
  new URL(import.meta.url.includes("$bunfs") ? "dist/" : "../../client/dist/", import.meta.url),
)
createServer(app(handler, dist)).listen(port, () => console.log(`http://localhost:${port}`))
