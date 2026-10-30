// The pure half of the providers cluster: the model list against the listing (the format rule), one entry's format
// and capabilities, the request drawer's round trip, the routing pairs.
import assert from "node:assert/strict"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import {
  applied,
  capOf,
  correctedModels,
  formatOf,
  pairKey,
  pairOf,
  requestOf,
  staleModels,
  stalePair,
  without,
  withModels,
  withoutModels,
} from "../src/connections.ts"

const p: Provider = {
  id: "p",
  name: "Proxy",
  enabled: true,
  defaultFormat: "openai-compatible",
  endpoints: { "openai-compatible": { url: "https://x/v1" } },
  models: [{ id: "a" }, { id: "c", format: "gemini" }, { id: "d" }],
}
// The listing: a on another endpoint (stale: no format of its own), c too (the player's format stays), d on the
// default, b new on another endpoint, e new on the default
const remote = [
  { id: "a", format: "anthropic" as const },
  { id: "b", format: "anthropic" as const },
  { id: "c", format: "anthropic" as const },
  { id: "d" },
  { id: "e" },
]
assert.deepEqual(staleModels(p, remote), [{ id: "a", format: "anthropic" }])
assert.deepEqual(staleModels(p, []), [])
assert.deepEqual(correctedModels(p, remote).models, [
  { id: "a", format: "anthropic" },
  { id: "c", format: "gemini" },
  { id: "d" },
])
assert.deepEqual(withModels(p, remote).models, [
  { id: "a", format: "anthropic" },
  { id: "c", format: "gemini" },
  { id: "d" },
  { id: "b", format: "anthropic" },
  { id: "e" },
])
assert.deepEqual(withModels(p, [{ id: "a" }]).models, p.models) // already there, nothing to correct
assert.deepEqual(withoutModels(p, ["a", "d", "zz"]).models, [{ id: "c", format: "gemini" }])
assert.equal(withModels(p, remote).name, "Proxy") // the rest of the provider stays

// One entry: its format over the provider's, a capability's override over its format's default, one key set or removed
assert.equal(formatOf(p, { id: "a" }), "openai-compatible")
assert.equal(formatOf(p, { id: "a", format: "anthropic" }), "anthropic")
assert.equal(capOf(p, { id: "a" }, "prefill"), true)
assert.equal(capOf(p, { id: "a", format: "anthropic" }, "prefill"), false)
assert.equal(capOf(p, { id: "a", format: "anthropic", capabilities: { prefill: true } }, "prefill"), true)
assert.deepEqual(without({ id: "a", hat: "h" }, "hat", undefined), { id: "a" })
assert.deepEqual(without({ id: "a" }, "effort", "high"), { id: "a", effort: "high" })

// The request round trip: a bare provider reads as the defaults and goes back unchanged
const bare = requestOf(p)
assert.deepEqual(bare, {
  defaultFormat: "openai-compatible",
  endpoints: {
    "openai-compatible": { url: "https://x/v1", exactPrefix: false },
    anthropic: { url: "", exactPrefix: false },
    gemini: { url: "", exactPrefix: false },
  },
  ttl: "5m",
  proxy: "env",
  proxyUrl: "",
  headers: [],
})
assert.deepEqual(applied(p, bare), p)
// every field set and read back
const full: Provider = {
  ...p,
  endpoints: { anthropic: { url: "https://a", exactPrefix: true } },
  cacheTtl: "1h",
  proxy: "http://proxy:8080",
  headers: { "x-a": "1" },
}
assert.deepEqual(requestOf(full), {
  ...bare,
  endpoints: {
    "openai-compatible": { url: "", exactPrefix: false },
    anthropic: { url: "https://a", exactPrefix: true },
    gemini: { url: "", exactPrefix: false },
  },
  ttl: "1h",
  proxy: "custom",
  proxyUrl: "http://proxy:8080",
  headers: [["x-a", "1"]],
})
assert.deepEqual(applied(p, requestOf(full)), full)
assert.equal(requestOf({ ...p, proxy: false }).proxy, "direct")
// back: URLs trimmed, empty ones dropped, exactPrefix only when on; 5m and the env proxy left out; direct is false; a
// custom proxy trimmed, an empty one is the env one; headers with a blank name dropped, names trimmed, values kept
const back = applied(full, {
  defaultFormat: "anthropic",
  endpoints: {
    "openai-compatible": { url: "  ", exactPrefix: true },
    anthropic: { url: " https://a/ ", exactPrefix: false },
    gemini: { url: "https://g", exactPrefix: true },
  },
  ttl: "5m",
  proxy: "custom",
  proxyUrl: "  ",
  headers: [
    [" x-b ", " v "],
    ["  ", "dropped"],
  ],
})
assert.deepEqual(back, {
  ...p,
  defaultFormat: "anthropic",
  endpoints: { anthropic: { url: "https://a/" }, gemini: { url: "https://g", exactPrefix: true } },
  headers: { "x-b": " v " },
})
assert.equal(applied(full, { ...requestOf(full), proxy: "direct" }).proxy, false)
assert.equal(applied(full, { ...requestOf(full), proxy: "env" }).proxy, undefined)
assert.equal(applied(full, { ...requestOf(full), proxyUrl: " http://q " }).proxy, "http://q")
assert.equal("headers" in applied(full, { ...requestOf(full), headers: [] }), false)
assert.equal("cacheTtl" in applied(full, { ...requestOf(full), ttl: "5m" }), false)

// Routing pairs: one menu value and back; why a pair is not on offer
const pair = { provider: "p", model: "a" }
assert.equal(pairOf(pairKey(pair)).model, "a")
assert.deepEqual(pairOf(pairKey({ provider: "x y", model: "m:1/2" })), { provider: "x y", model: "m:1/2" })
assert.equal(stalePair([p], undefined), undefined)
assert.equal(stalePair([p], pair), undefined) // live
assert.deepEqual(stalePair([{ ...p, enabled: false }], pair), { reason: "disabled", name: "Proxy", model: "a" })
assert.deepEqual(stalePair([p], { provider: "p", model: "zz" }), { reason: "removed", name: "Proxy", model: "zz" })
assert.deepEqual(stalePair([], pair), { reason: "removed", name: "p", model: "a" }) // provider gone: its id
assert.deepEqual(stalePair([{ ...p, enabled: false }], { provider: "p", model: "zz" }), {
  reason: "removed",
  name: "Proxy",
  model: "zz",
}) // gone wins over off
console.log("connections ok")
