// A stage's model, bound once: a provider's model through `connection`, then `bind`. The capabilities (format default
// under the entry's overrides) give prefill and reasoningBack; effort and maxOutputTokens come from the model entry,
// ttl and hat from the connection; what nobody set is absent, not undefined.
import assert from "node:assert/strict"
import { bind } from "../src/connection.ts"
import { connection, type Provider, type Secret } from "../src/providers.ts"

const key: Secret = { id: "s", name: "K", type: "api_key", value: "sk-0123456789abcdef" }
const p: Provider = {
  id: "relay",
  name: "Relay",
  enabled: true,
  defaultFormat: "anthropic",
  endpoints: { anthropic: { url: "https://relay.example" }, gemini: { url: "https://relay.example" } },
  secret: "s",
  cacheTtl: "1h",
  models: [],
}
const fields = ({ model, ...rest }: ReturnType<typeof bind>) => (assert.ok(model), rest)

// every knob set: the entry's over the format's defaults (anthropic: no prefill, no reasoning back)
const full = bind(
  connection(
    p,
    { id: "claude", hat: "h", effort: "high", maxOutputTokens: 2048, capabilities: { prefill: true } },
    key,
  ),
)
assert.deepEqual(fields(full), {
  format: "anthropic",
  prefill: true,
  reasoningBack: false,
  effort: "high",
  maxOutputTokens: 2048,
  ttl: "1h",
  hat: "h",
})

// nothing set: the format's defaults, and no key for what is absent
const { cacheTtl: _, ...bare } = p
const plain = fields(bind(connection(bare, { id: "g", format: "gemini" }, key)))
assert.deepEqual(plain, { format: "gemini", prefill: true, reasoningBack: true })
assert.ok(!("effort" in plain) && !("ttl" in plain) && !("hat" in plain) && !("maxOutputTokens" in plain))

// the connection carries the entry's settings, so a caller can override one before binding (dev.ts, test/live.ts)
assert.equal(bind({ ...connection(p, { id: "c", effort: "high" }, key), effort: "low" }).effort, "low")
console.log("bind ok")
