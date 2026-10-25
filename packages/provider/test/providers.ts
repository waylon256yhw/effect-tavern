// A provider's model flattens into a Connection: the model's format over the provider's, that format's endpoint (exact
// prefix kept, a bare origin left to the format's default path), the secret as the credential; what is missing or off
// fails naming the provider. The hint never shows a short key.
import assert from "node:assert/strict"
import { connection, hint, type Provider, type Secret } from "../src/providers.ts"

const key: Secret = { id: "s", name: "K", type: "auth_token", value: "tok-0123456789abcdef" }
const p: Provider = {
  id: "relay",
  name: "Relay",
  enabled: true,
  defaultFormat: "anthropic",
  endpoints: {
    anthropic: { url: "https://relay.example" },
    "openai-compatible": { url: "https://relay.example/openai", exactPrefix: true },
  },
  secret: "s",
  cacheTtl: "1h",
  proxy: false,
  models: [],
}
const base = connection(p, { id: "claude", hat: "h" }, key)
assert.deepEqual(base, {
  id: "relay/claude",
  format: "anthropic",
  endpoint: { url: "https://relay.example", resolution: "format-default" },
  credential: { type: "auth_token", token: key.value },
  model: "claude",
  cacheTtl: "1h",
  proxy: false,
  hat: "h",
})
const over = connection(p, { id: "gpt", format: "openai-compatible", capabilities: { prefill: false } }, key)
assert.deepEqual(
  [over.format, over.endpoint, over.capabilities],
  ["openai-compatible", { url: "https://relay.example/openai", resolution: "exact-prefix" }, { prefill: false }],
)
// exactPrefix off is "infer", never "format-default": a URL with a path is taken as its prefix, not refused
const pathed = { ...p, endpoints: { anthropic: { url: "https://relay.example/claude/" } } }
assert.deepEqual(connection(pathed, { id: "c" }, key).endpoint, {
  url: "https://relay.example/claude",
  resolution: "exact-prefix",
})
assert.throws(() => connection({ ...p, enabled: false }, { id: "x" }, key), /provider "Relay": disabled/)
assert.throws(() => connection(p, { id: "x", format: "gemini" }, key), /provider "Relay": no gemini endpoint/)
assert.throws(() => connection(p, { id: "x" }, undefined), /provider "Relay": no key/)
assert.throws(
  () => connection({ ...p, endpoints: { anthropic: { url: "ftp://x" } } }, { id: "x" }, key),
  /provider "Relay": .*http/,
)
assert.equal(hint("sk-ant-api03-abcdefgh3210"), "sk-ant****3210")
assert.equal(hint("short-key"), "****")
console.log("providers ok")
