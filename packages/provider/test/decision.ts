// A decision model from a gemini connection, on the wire and through `decide`: the request goes to `{base}/decisions`
// with the connection's key, a boolean question rides as Google's `noul`, and the answers come back typed by question.
// Any other format has no decision endpoint and fails at compile, naming the connection.
import assert from "node:assert/strict"
import { Effect } from "effect"
import { compileDecision } from "../src/connection.ts"
import { decide, fakeDecision } from "../src/decision.ts"
import { connection, type Provider, type Secret } from "../src/providers.ts"

const key: Secret = { id: "s", name: "K", type: "api_key", value: "goog-0123456789abcdef" }
const p: Provider = {
  id: "g",
  name: "Google",
  enabled: true,
  defaultFormat: "gemini",
  endpoints: {
    gemini: { url: "https://generativelanguage.googleapis.com" },
    anthropic: { url: "https://relay.example" },
  },
  secret: "s",
  models: [],
}
const questions = {
  broke: { type: "boolean", instructions: "Does the draft speak for the player?" },
  next: { type: "choice", instructions: "Which action?", criteria: { attack: "strikes", end: "nothing more" } },
} as const

let sent = {
  url: "",
  headers: new Headers(),
  body: {} as { model?: string; questions?: Record<string, { type: string }> },
}
const model = compileDecision(connection(p, { id: "gemini-decision-1" }, key), {
  fetch: async (input, init) => {
    sent = {
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      headers: new Headers(init?.headers),
      body: JSON.parse(init?.body as string) as typeof sent.body,
    }
    return Response.json({
      answers: {
        broke: { type: "noul", noul: 0.94, confidence: 0.94 },
        next: { type: "choice", choice: "end", probabilities: { attack: 0.2, end: 0.8 }, confidence: 0.8 },
      },
      usage: { total_input_tokens: 42, total_output_tokens: 0, total_tokens: 42 },
    })
  },
})
const r = await Effect.runPromise(decide(model, "林默接过怀表。", questions))
assert.equal(sent.url, "https://generativelanguage.googleapis.com/v1beta/decisions")
assert.equal(sent.headers.get("x-goog-api-key"), key.value)
assert.equal(sent.body.model, "gemini-decision-1")
assert.equal(sent.body.questions?.broke?.type, "noul")
assert.equal(r.answers.broke.probability, 0.94)
assert.equal(r.answers.next.choice, "end")
assert.equal(r.answers.next.probabilities?.end, 0.8)
assert.deepEqual(r.usage, { input: 42, output: 0, cacheRead: 0, cacheWrite: 0 })

assert.throws(
  () => compileDecision(connection(p, { id: "claude", format: "anthropic" }, key)),
  /needs a gemini endpoint/,
)

// the fake answers from the request, with no distribution: what an adapter over a language model returns
const f = await Effect.runPromise(
  decide(
    fakeDecision((call) => ({
      broke: { type: "boolean", probability: JSON.stringify(call.state).includes("怀表") ? 0.9 : 0.1 },
      next: { type: "choice", choice: "attack" },
    })),
    "怀表",
    questions,
  ),
)
assert.equal(f.answers.broke.probability, 0.9)
assert.equal(f.answers.next.probabilities, undefined)
console.log("decision ok")
