// A decision model is a second kind of model, beside the language models of providers.ts: it takes one text and typed
// questions (yes/no, pick one, rate on a rubric) and answers with probabilities, generating no text. It has its own
// connection because it is its own service: a relay or gateway that serves chat rarely serves decisions, a decision
// model has nothing a language model is configured with (hat, effort, output cap, context, capabilities), and it must
// never appear where a stage's model is picked. One per install, optional; the key is a vault secret like a provider's.
// No ai-sdk here: the client imports these types (decide.ts is the call).
import { Schema } from "effect"

/** Who serves it: each driver is one API shape, with the address and model a blank config falls back to, and the path
 *  its SDK appends to the address. */
export const DRIVERS = {
  google: {
    name: "Google Gemini Decisions",
    url: "https://generativelanguage.googleapis.com/v1beta",
    path: "/decisions",
    model: "gemini-decision-1",
  },
  openai: { name: "OpenAI Decisions", url: "https://api.openai.com/v1", path: "/decisions", model: "gpt-6-luna" },
  typesafe: { name: "TypeSafe Jev", url: "https://api.typesafe.ai/v1", path: "/systemone", model: "jev-latest" },
} as const
export type Driver = keyof typeof DRIVERS

export const DecisionConfig = Schema.Struct({
  enabled: Schema.Boolean,
  driver: Schema.Literals(["google", "openai", "typesafe"]),
  model: Schema.String,
  url: Schema.optionalKey(Schema.String), // the API base the driver appends its path to; unset = the driver's own
  secret: Schema.optionalKey(Schema.String), // a secret id; none = no key
  proxy: Schema.optionalKey(Schema.Union([Schema.String, Schema.Literal(false)])), // Connection.proxy's three states
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
export type DecisionConfig = typeof DecisionConfig.Type

/** The address a config's requests go to: what the settings page shows and a probe that never reached a fetch reports. */
export const decisionUrl = (c: Pick<DecisionConfig, "driver" | "url">): string =>
  `${(c.url?.trim() || DRIVERS[c.driver].url).replace(/\/+$/, "")}${DRIVERS[c.driver].path}`
