// The composition root (src/tavern.ts): a first run's seeding only on an empty install, the greeting root only on an
// empty story.
import { chat, plain as player } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { open } from "../src/data.ts"
import { tavern } from "../src/tavern.ts"

// empty install: the key is the vault's one secret, its provider has Haiku and Sonnet, Haiku is the default
const fresh = tavern({ data: open(":memory:"), card: chat, player, seed: { key: "sk-ant-api-x" } })
assert.deepEqual(
  fresh.data.secrets.list().map((s) => [s.id, s.type, s.value]),
  [["anthropic", "api_key", "sk-ant-api-x"]],
)
assert.deepEqual(
  fresh.data.providers.list().flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`)),
  ["anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5"],
)
assert.deepEqual(fresh.lib.routing.read(), { default: { provider: "anthropic", model: "claude-haiku-5-5" } })

// a provider already there: nothing seeded
const data = open(":memory:")
const own = { id: "mine", name: "Mine", enabled: true, defaultFormat: "anthropic" as const, endpoints: {}, models: [] }
data.providers.put(own)
tavern({ data, card: chat, player, seed: { key: "sk-ant-api-x" } })
assert.deepEqual([data.providers.list(), data.secrets.list(), data.routing.read()], [[own], [], undefined])

// greeting: an empty story gets one root; a story with nodes gets none
const greeted = { ...chat, greetings: [{ text: "G0" }, { text: "G1" }] }
const g = tavern({ data: open(":memory:"), card: greeted, player, greeting: 1 })
assert.equal(g.lib.session().log.nodes.size, 1)
const again = tavern({ data: g.data, card: greeted, player, greeting: 0 }) // the next start, same story
assert.equal(again.lib.session().log.nodes.size, 1)
console.log("tavern ok")
