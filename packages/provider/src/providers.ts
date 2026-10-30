// The player's model providers, two levels (Cherry Studio's shape, issue #33): a provider is one service with one key
// and an endpoint per format it speaks, and the models picked from it, each with its own overrides. A pick (provider,
// model) flattens into the flat `Connection` this package compiles, so `compile` never learns what a provider is.
// A secret is a key in the library's vault, named, so one key serves several providers; only a hint of it ever leaves
// the server. No ai-sdk here: the client imports these types, and url.ts is all this file runs.
import { Schema } from "effect"
import type { Connection } from "./connection.ts"
import { normalize, type Format } from "./url.ts"

const Format = Schema.Literals(["anthropic", "openai-compatible", "gemini"])
const Endpoint = Schema.Struct({ url: Schema.String, exactPrefix: Schema.optionalKey(Schema.Boolean) })

export const ModelEntry = Schema.Struct({
  id: Schema.String,
  format: Schema.optionalKey(Format), // over the provider's defaultFormat
  hat: Schema.optionalKey(Schema.String), // a library hat id (`/hats`)
  effort: Schema.optionalKey(Schema.Literals(["off", "low", "medium", "high", "max"])),
  maxOutputTokens: Schema.optionalKey(Schema.Number),
  contextTokens: Schema.optionalKey(Schema.Number), // the narrate model's sets the fold budget (runtime history.ts `policyFor`)
  capabilities: Schema.optionalKey(
    Schema.Struct({
      prefill: Schema.optionalKey(Schema.Boolean),
      structured: Schema.optionalKey(Schema.Literals(["schema", "tool", "json"])),
      reasoningBack: Schema.optionalKey(Schema.Boolean),
    }),
  ),
})
export type ModelEntry = typeof ModelEntry.Type

export const Provider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  defaultFormat: Format,
  endpoints: Schema.Struct({
    anthropic: Schema.optionalKey(Endpoint),
    "openai-compatible": Schema.optionalKey(Endpoint),
    gemini: Schema.optionalKey(Endpoint),
  }),
  secret: Schema.optionalKey(Schema.String), // a secret id; none = no key
  cacheTtl: Schema.optionalKey(Schema.Literals(["5m", "1h"])),
  proxy: Schema.optionalKey(Schema.Union([Schema.String, Schema.Literal(false)])), // Connection.proxy's three states
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  models: Schema.Array(ModelEntry),
})
export type Provider = typeof Provider.Type

export const Secret = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Literals(["api_key", "auth_token"]),
  value: Schema.String,
})
export type Secret = typeof Secret.Type
/** The type a key is, read off the key itself when nobody said: an Anthropic OAuth token (`sk-ant-oat…`) rides as a
 *  bearer, everything else is an API key. Not "anything but `sk-ant-` is a bearer": a gateway's `user_…` key is an
 *  API key too. The vault's own setting overrides this. */
export const secretType = (value: string): Secret["type"] => (value.startsWith("sk-ant-oat") ? "auth_token" : "api_key")
/** One probe of a provider (`POST /providers/<id>/test`): the request actually sent, through the connection's proxy, and
 *  how it went. `status` 0 is nothing answered (no route, a closed proxy, a timeout); any other status reached the
 *  address. `ok` is the probe getting what it asked for (a listing parsed, a token back); `error` says what it got
 *  instead, `code` the socket error's code when there was one. `formats` are the protocols the request stands for:
 *  the listing probe sends one request per distinct listing URL, so two endpoints on one address share a probe. */
export interface Probe {
  formats: Format[]
  url: string
  method: string
  status: number
  ms: number
  ok: boolean
  code?: string
  error?: string
}
/** What the wire shows of a secret: never the value. */
export type SecretView = Omit<Secret, "value"> & { hint: string }
/** The first six and last four characters; a key too short to keep most of it hidden shows none. */
export const hint = (value: string): string =>
  value.length >= 16 ? `${value.slice(0, 6)}****${value.slice(-4)}` : "****"
export const secretView = ({ value, ...s }: Secret): SecretView => ({ ...s, hint: hint(value) })

/** One model of one provider as a Connection: the model's format or the provider's default, that format's endpoint,
 *  the key. What is missing fails here, naming the provider; nothing falls back. */
export const connection = (p: Provider, m: ModelEntry, s: Secret | undefined): Connection => {
  const fail = (why: string) => new Error(`provider "${p.name}": ${why}`)
  if (!p.enabled) throw fail("disabled")
  const format = m.format ?? p.defaultFormat
  const ep = p.endpoints[format]
  if (!ep?.url.trim()) throw fail(`no ${format} endpoint`)
  if (!s) throw fail("no key")
  let endpoint
  try {
    endpoint = normalize(format, ep.url, ep.exactPrefix ? "exact-prefix" : "infer")
  } catch (e) {
    throw fail(e instanceof Error ? e.message : String(e))
  }
  return {
    id: `${p.id}/${m.id}`,
    format,
    endpoint,
    credential: s.type === "api_key" ? { type: "api_key", key: s.value } : { type: "auth_token", token: s.value },
    model: m.id,
    ...(m.capabilities && { capabilities: m.capabilities }),
    ...(p.cacheTtl && { cacheTtl: p.cacheTtl }),
    ...(p.headers && { headers: p.headers }),
    ...(p.proxy !== undefined && { proxy: p.proxy }),
    ...(m.hat !== undefined && { hat: m.hat }),
    ...(m.effort !== undefined && { effort: m.effort }),
    ...(m.maxOutputTokens !== undefined && { maxOutputTokens: m.maxOutputTokens }),
  }
}
