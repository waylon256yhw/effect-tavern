// `PORT=7777 CARD=wuxia MODEL=fake bun src/main.ts`: the whole tavern on one port, what a phone runs. The developer's
// session (dev.ts) under /api, and the client build (`vp build` in packages/client) under everything else; `vp dev`
// mounts the same handler at /api itself and serves the client from source.
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { handler } from "./dev.ts"
import { app } from "./serve.ts"

const port = Number(process.env["PORT"] ?? 7777)
// ponytail: the build is read from the checkout; a compiled binary (bun build --compile) would need it embedded
const dist = fileURLToPath(new URL("../../client/dist/", import.meta.url))
createServer(app(handler, dist)).listen(port, () => console.log(`http://localhost:${port}`))
