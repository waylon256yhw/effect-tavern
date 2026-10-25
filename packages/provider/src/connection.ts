// A connection is one immutable record: wire format, endpoint prefix, credential, model, and what the endpoint can do.
// `compile` turns it into an ai-sdk model; nothing else in the harness knows which factory is behind it.
// Three formats only (docs/provider-reading.md §6). Unset config fields are never sent.
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { plan, type Endpoint, type Format } from "./url.ts"

export type { Endpoint, Format } from "./url.ts"

/** Anthropic takes an API key (`x-api-key`) or an OAuth-style token (`Authorization: Bearer`); the others take either as bearer/key. */
export type Credential = { type: "api_key"; key: string } | { type: "auth_token"; token: string }

export interface Capabilities {
  /** Accepts a trailing assistant message and continues it (truncation recovery). */
  prefill: boolean
  /** `schema`: native JSON-schema output. `tool`: a forced tool. `json`: json_object only, schema goes in the prompt. */
  structured: "schema" | "tool" | "json"
  /** Past turns' reasoning parts are sent back. */
  reasoningBack: boolean
}

export interface Trace {
  url: string
  method: string
  status: number
  ms: number
  body?: string
}

export interface Connection {
  id: string
  format: Format
  endpoint: Endpoint
  credential: Credential
  model: string
  capabilities?: Partial<Capabilities>
  /** Lifetime of the head's cache entry: 1h when a person is on the other end (replies 5–60 minutes apart), else 5m. */
  cacheTtl?: "5m" | "1h"
  headers?: Record<string, string>
  /** Forward proxy, the three states of Bun's fetch `proxy` option, which carries it: unset reads the environment
   *  (https_proxy), `false` forces a direct connection, a URL routes this connection through it. Node's fetch ignores
   *  the option and reads the environment only with NODE_USE_ENV_PROXY=1; the runtime is Bun. */
  proxy?: string | false
  /** The hat this connection wears (a library id, `/hats`): what its model needs around the harness's document to
   *  answer in continuation mode. Resolved per request by the library, like the player's persona. */
  hat?: string
}

// Anthropic: every current Claude (Haiku 5.5 included) answers 400 "does not support assistant message prefill";
// verified live 2026-10-17. Truncation recovery by prefix is off for this format unless the user flips it for an old model.
// Anthropic binds a thinking block to the exact content before it ("Invalid signature … bound to a different
// conversation", verified live): a re-rendered history (ours) can never replay it. Off unless the prefix is frozen.
const DEFAULTS: Record<Format, Capabilities> = {
  anthropic: { prefill: false, structured: "schema", reasoningBack: false },
  "openai-compatible": { prefill: true, structured: "schema", reasoningBack: true },
  gemini: { prefill: true, structured: "schema", reasoningBack: true },
}
export const capabilities = (c: Connection): Capabilities => ({ ...DEFAULTS[c.format], ...c.capabilities })

const secret = (c: Credential) => (c.type === "api_key" ? c.key : c.token)
// ai-sdk factories refuse an empty key even when the real credential rides in a header. Never sent as a real key.
const PLACEHOLDER = "managed-auth"

/** The header each format's factory puts the credential in. `listModels` uses the same table so the two cannot drift. */
export const authHeaders = (c: Connection): Record<string, string> => {
  const bearer = { authorization: `Bearer ${secret(c.credential)}` }
  switch (c.format) {
    case "anthropic":
      return {
        "anthropic-version": "2023-06-01",
        ...(c.credential.type === "api_key" ? { "x-api-key": c.credential.key } : bearer),
      }
    case "gemini":
      return c.credential.type === "api_key" ? { "x-goog-api-key": c.credential.key } : bearer
    case "openai-compatible":
      return bearer
  }
}

type Fetch = typeof globalThis.fetch

/** The fetch this connection sends through: the runtime's, with `proxy` set on each request when the connection names
 *  one (`proxy` is not in the DOM RequestInit type, hence the cast). */
const fetchFor = (c: Connection): Fetch =>
  c.proxy === undefined
    ? globalThis.fetch
    : (input, init) => globalThis.fetch(input, { ...init, proxy: c.proxy } as RequestInit)

/** Wraps fetch so the inspector can see what was actually sent: URL, status, latency, optionally the converted body. */
const traced =
  (onTrace: (t: Trace) => void, withBody: boolean, inner: Fetch): Fetch =>
  async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const body = withBody && typeof init?.body === "string" ? init.body : undefined
    const t0 = performance.now()
    const res = await inner(input, init)
    onTrace({
      url,
      method: init?.method ?? "GET",
      status: res.status,
      ms: Math.round(performance.now() - t0),
      ...(body !== undefined && { body }),
    })
    return res
  }

export interface CompileOptions {
  onTrace?: (t: Trace) => void
  traceBody?: boolean
  fetch?: Fetch
}

export const compile = (c: Connection, o: CompileOptions = {}): LanguageModel => {
  const { base } = plan(c.format, c.endpoint, c.model)
  const inner = o.fetch ?? fetchFor(c)
  const fetch = o.onTrace ? traced(o.onTrace, o.traceBody ?? false, inner) : inner
  const common = { baseURL: base, headers: c.headers, fetch }
  const cred = c.credential
  switch (c.format) {
    case "anthropic":
      return createAnthropic({
        ...common,
        ...(cred.type === "api_key" ? { apiKey: cred.key } : { authToken: cred.token }),
      })(c.model)
    case "openai-compatible":
      return createOpenAICompatible({
        ...common,
        name: "compat", // providerOptions for this model live under the key "compat"
        apiKey: secret(cred),
        supportsStructuredOutputs: capabilities(c).structured === "schema",
        includeUsage: true,
      })(c.model)
    case "gemini":
      return createGoogleGenerativeAI({
        ...common,
        ...(cred.type === "api_key"
          ? { apiKey: cred.key }
          : { apiKey: PLACEHOLDER, headers: { ...c.headers, ...authHeaders(c) } }),
      })(c.model)
  }
}

/** GET {base}/models with the format's auth. Model ids only; a 404 means the endpoint does not list, not that it is down.
 *  `onTrace` sees the one fetch, as on `compile`. */
export const listModels = async (c: Connection, o: CompileOptions = {}): Promise<string[]> => {
  const inner = o.fetch ?? fetchFor(c)
  const fetch = o.onTrace ? traced(o.onTrace, false, inner) : inner
  const res = await fetch(plan(c.format, c.endpoint).models, { headers: { ...c.headers, ...authHeaders(c) } })
  if (!res.ok) throw new Error(`model listing failed: HTTP ${res.status}`)
  const body = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> }
  const ids = body.data?.map((m) => m.id) ?? body.models?.map((m) => m.name?.replace(/^models\//, "")) ?? []
  return ids.filter((id): id is string => typeof id === "string" && id !== "")
}
