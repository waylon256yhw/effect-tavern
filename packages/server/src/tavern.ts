// A tavern from an open library store, the cards and a model: the library over them, seeded on a first run when given a
// key, behind the HTTP handler. No card is bound: a story names its own (library.ts). The environment is the caller's:
// dev.ts reads it (CARDS, DATA, MODEL, HAT, the local key), loads the card files and opens the store; a test passes
// `open(":memory:")` and a shelf of its own.
import { decodeCard, type Card } from "@effect-tavern/runtime/src/card.ts"
import type { Data } from "./data.ts"
import { library, type Cards } from "./library.ts"
import { handle } from "./serve.ts"

/** The cards an install knows: `files` (a directory of YAML, dev.ts) first, then the library's `card` table; the first
 *  id wins. A table card is decoded when a story of it opens. */
export const shelf = (files: readonly Card[], data: Data): Cards => ({
  list: () =>
    [...files, ...data.cards.list()]
      .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i)
      .map((c) => ({ id: c.id, title: c.title ?? c.id })),
  get: (id) => {
    const file = files.find((c) => c.id === id)
    if (file) return file
    const json = data.cards.get(id)
    if (json === undefined) throw new Error(`no card ${id}`)
    return decodeCard({ ...(json as object), id })
  },
})

/** First run on a developer machine: the key becomes the vault's one secret and the library's one provider, its
 *  Haiku the default, so the settings page opens on what the dev loop already ran on. Only on an empty install: once
 *  a provider or a secret exists, the player's tables are left alone. */
export const seed = (data: Data, key: string) => {
  if (data.providers.list().length || data.secrets.list().length) return
  data.secrets.put({ id: "anthropic", name: "Anthropic", type: "api_key", value: key })
  data.providers.put({
    id: "anthropic",
    name: "Anthropic",
    enabled: true,
    defaultFormat: "anthropic",
    endpoints: { anthropic: { url: "https://api.anthropic.com" } },
    secret: "anthropic",
    models: [
      { id: "claude-haiku-5-5", effort: "low" },
      { id: "claude-sonnet-5-5", effort: "low" },
    ],
  })
  data.routing.write({ default: { provider: "anthropic", model: "claude-haiku-5-5" } })
}

export const tavern = ({
  seed: seeded,
  inspect = false,
  ...o
}: Parameters<typeof library>[0] & {
  /** Seed an empty install with this key (`seed`). */
  seed?: { key: string }
  /** Keep the request messages on `call` events (serve.ts `handle`). */
  inspect?: boolean
}) => {
  if (seeded) seed(o.data, seeded.key)
  const lib = library(o)
  return { data: o.data, lib, handler: handle(lib, { inspect }) }
}
