// Shared standalone environment for the HTTP host and in-process CLI. No developer credentials.
import { fake } from "@effect-tavern/provider"
import { cardNames, loadCard, plain, readCard } from "@effect-tavern/runtime/support/cards.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { open } from "./data.ts"
import { shelf, tavern } from "./tavern.ts"

export const openHost = async (fakeModel = process.env["MODEL"] === "fake") => {
  const at = process.env["CARDS"]
  const files = at
    ? readdirSync(at)
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => readCard(join(at, f)))
    : await Promise.all(cardNames.map(loadCard))
  const dir = process.env["DATA"] ?? join(process.cwd(), ".tavern")
  mkdirSync(dir, { recursive: true })
  const data = open(join(dir, "tavern.db"))
  const model = fakeModel ? fake((call) => defaultAnswer(readStage(call), { notes: "", options: [] })) : undefined
  return tavern({
    data,
    cards: shelf(files),
    overlay: plain.harness,
    ...(model && { model: () => model, pinned: true }),
  })
}
