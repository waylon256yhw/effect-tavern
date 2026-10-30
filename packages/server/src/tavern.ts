// A tavern from an open library store, a card and a model: the library over them, seeded on a first run when given a
// key, greeted when asked, behind the HTTP handler. The environment is the caller's: dev.ts reads it (CARD, DATA,
// MODEL, HAT, GREETING, the local key) and opens the store; a test passes `open(":memory:")`.
import type { Data } from "./data.ts"
import { library } from "./library.ts"
import { handle } from "./serve.ts"

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
  greeting,
  inspect = false,
  ...o
}: Parameters<typeof library>[0] & {
  /** Seed an empty install with this key (`seed`). */
  seed?: { key: string }
  /** An empty story opens on this greeting of the card (a root); none = the player picks one on the card page. */
  greeting?: number
  /** Keep the request messages on `call` events (serve.ts `handle`). */
  inspect?: boolean
}) => {
  if (seeded) seed(o.data, seeded.key)
  const lib = library(o)
  if (greeting !== undefined && lib.session().log.nodes.size === 0) {
    const g = o.card.greetings[greeting]
    if (g) lib.session().greet(g)
  }
  return { data: o.data, lib, handler: handle(lib, { inspect }) }
}
