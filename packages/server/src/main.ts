// `PORT=7777 CARD=wuxia MODEL=fake node src/main.ts`: the developer's session (dev.ts) on its own port, for a client
// that is not `vp dev` (which mounts the same handler at /api itself).
import { createServer } from "node:http"
import { handler } from "./dev.ts"

const port = Number(process.env["PORT"] ?? 7777)
createServer(handler).listen(port, () => console.log(`http://localhost:${port}`))
