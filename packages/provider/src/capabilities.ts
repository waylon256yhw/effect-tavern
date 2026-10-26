// What an endpoint can do, per format, and a connection's effective set (its overrides over the format's defaults).
// Pure data, no ai-sdk: the client imports this module (the model settings show the defaults), so it must stay free of
// anything that would pull a provider SDK into the bundle. connection.ts re-exports it.
import type { Format } from "./url.ts"

export interface Capabilities {
  /** Accepts a trailing assistant message and continues it (truncation recovery). */
  prefill: boolean
  /** `schema`: native JSON-schema output. `tool`: a forced tool. `json`: json_object only, schema goes in the prompt. */
  structured: "schema" | "tool" | "json"
  /** Past turns' reasoning parts are sent back. */
  reasoningBack: boolean
}

// Anthropic: every current Claude (Haiku 5.5 included) answers 400 "does not support assistant message prefill";
// verified live 2026-10-17. Truncation recovery by prefix is off for this format unless the user flips it for an old model.
// Anthropic binds a thinking block to the exact content before it ("Invalid signature … bound to a different
// conversation", verified live): a re-rendered history (ours) can never replay it. Off unless the prefix is frozen.
export const DEFAULTS: Record<Format, Capabilities> = {
  anthropic: { prefill: false, structured: "schema", reasoningBack: false },
  "openai-compatible": { prefill: true, structured: "schema", reasoningBack: true },
  gemini: { prefill: true, structured: "schema", reasoningBack: true },
}

/** A connection's capabilities: its overrides over its format's defaults. Takes only the two fields it reads, so this
 *  module needs nothing from connection.ts. */
export const capabilities = (c: { format: Format; capabilities?: Partial<Capabilities> }): Capabilities => ({
  ...DEFAULTS[c.format],
  ...c.capabilities,
})
