// The composition root (src/tavern.ts): a first run's seeding only on an empty install. No card is bound, so nothing is
// greeted on the server (the card page picks the opening).
import { chat, plain as player } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { open } from "../src/data.ts"
import { shelf, tavern } from "../src/tavern.ts"

// empty install: the key is the vault's one secret, its provider has Haiku and Sonnet, Haiku is the default
const empty = open(":memory:")
const fresh = tavern({ data: empty, cards: shelf([chat], empty), player, seed: { key: "sk-ant-api-x" } })
assert.deepEqual(
  fresh.data.secrets.list().map((s) => [s.id, s.type, s.value]),
  [["anthropic", "api_key", "sk-ant-api-x"]],
)
assert.deepEqual(
  fresh.data.providers.list().flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`)),
  ["anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5"],
)
assert.deepEqual(fresh.lib.routing.read(), { default: { provider: "anthropic", model: "claude-haiku-5-5" } })
assert.deepEqual(fresh.lib.stories.list(), []) // and no story made for it

// a provider already there: nothing seeded
const data = open(":memory:")
const own = { id: "mine", name: "Mine", enabled: true, defaultFormat: "anthropic" as const, endpoints: {}, models: [] }
data.providers.put(own)
tavern({ data, cards: shelf([chat], data), player, seed: { key: "sk-ant-api-x" } })
assert.deepEqual([data.providers.list(), data.secrets.list(), data.routing.read()], [[own], [], undefined])

// the environment binds no card: dev.ts reads CARDS (a directory), never CARD
const dev = readFileSync(new URL("../src/dev.ts", import.meta.url), "utf8")
assert.deepEqual([/env\["CARD"\]/.test(dev), /env\["CARDS"\]/.test(dev)], [false, true])
console.log("tavern ok")
