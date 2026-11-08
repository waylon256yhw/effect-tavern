// Standalone host: explicit DATA/CARDS/MODEL, persisted provider routing, no developer credentials or UI assets.
import { fake } from "@effect-tavern/provider"
import { cardNames, loadCard, readCard } from "@effect-tavern/runtime/support/cards.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { mkdirSync, readdirSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import { open } from "./data.ts"
import { app } from "./serve.ts"
import { shelf, tavern } from "./tavern.ts"

const dir = process.env["DATA"] ?? join(process.cwd(), ".tavern")
mkdirSync(dir, { recursive: true })
const data = open(join(dir, "tavern.db"))
const at = process.env["CARDS"]
const files = at
  ? readdirSync(at)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => readCard(join(at, f)))
  : await Promise.all(cardNames.map(loadCard))
const model = process.env["MODEL"] === "fake" ? fake((call) => defaultAnswer(readStage(call))) : undefined
const { handler } = tavern({ data, cards: shelf(files), ...(model && { model: () => model, pinned: true }) })
const port = Number(process.env["PORT"] ?? 7777)
const host = process.env["HOST"] ?? "127.0.0.1"
const server = createServer(app(handler)).listen(port, host, () => {
  const address = server.address()
  console.error(`http://${host}:${typeof address === "object" && address ? address.port : port}/api`)
})
