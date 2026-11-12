// A decision model from its own config, on the wire and through `decide`: each driver's request goes to its own
// address with the vault key, a yes/no question rides as Google's `noul` with its two descriptions, the
// answers come back typed by question, and a safety block is told from any other failure by its code.
import assert from "node:assert/strict"
import { Effect } from "effect"
import type { ModelError } from "../src/call.ts"
import { blocked, compileDecision, decide, fakeDecision, probeDecision } from "../src/decide.ts"
import { DRIVERS, decisionUrl, type DecisionConfig, type Driver } from "../src/decision.ts"
import type { Secret } from "../src/providers.ts"

const key: Secret = { id: "s", name: "K", type: "api_key", value: "key-0123456789abcdef" }
const config = (driver: Driver, more: Partial<DecisionConfig> = {}): DecisionConfig => ({
  enabled: true,
  driver,
  model: DRIVERS[driver].model,
  ...more,
})
const questions = {
  broke: {
    type: "boolean",
    instructions: "Does the draft speak for the player?",
    criteria: { true: "It writes the player's words.", false: "Only the world acts." },
  },
  next: { type: "choice", instructions: "Which action?", criteria: { attack: "strikes", end: "nothing more" } },
} as const

interface Sent {
  url: string
  headers: Headers
  body: { model?: string; questions?: Record<string, { type: string; criteria?: Record<string, string> }> }
}
/** A model whose one fetch is recorded and answered with `res`. */
const wired = (c: DecisionConfig, res: () => Response) => {
  const sent: Sent[] = []
  const model = compileDecision(c, key, {
    fetch: async (input, init) => {
      sent.push({
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        headers: new Headers(init?.headers),
        body: JSON.parse(init?.body as string) as Sent["body"],
      })
      return res()
    },
  })
  return { model, sent }
}
const failure = (e: Effect.Effect<unknown, ModelError>) => Effect.runPromise(Effect.flip(e))

// google: the default address, the key header, noul with its descriptions, typed answers, input-only usage
const g = wired(config("google"), () =>
  Response.json({
    answers: {
      broke: { type: "noul", noul: 0.94, confidence: 0.94 },
      next: { type: "choice", choice: "end", probabilities: { attack: 0.2, end: 0.8 }, confidence: 0.8 },
    },
    usage: { total_input_tokens: 42, total_output_tokens: 0, total_tokens: 42 },
  }),
)
const r = await Effect.runPromise(decide(g.model, "林默接过怀表。", questions))
assert.equal(g.sent[0]?.url, decisionUrl(config("google")))
assert.equal(g.sent[0]?.url, "https://generativelanguage.googleapis.com/v1beta/decisions")
assert.equal(g.sent[0]?.headers.get("x-goog-api-key"), key.value)
assert.equal(g.sent[0]?.body.model, "gemini-decision-1")
assert.equal(g.sent[0]?.body.questions?.["broke"]?.type, "noul")
assert.equal(g.sent[0]?.body.questions?.["broke"]?.criteria?.["true_description"], "It writes the player's words.")
assert.equal(r.answers.broke.probability, 0.94)
assert.equal(r.answers.next.choice, "end")
assert.equal(r.answers.next.probabilities?.end, 0.8)
assert.deepEqual(r.usage, { input: 42, output: 0, cacheRead: 0, cacheWrite: 0 })

// a block: HTTP 400 with a string code the SDK's parser does not read; `blocked` finds it in the body
const safety = wired(config("google"), () =>
  Response.json({ error: { code: "safety", message: "Request blocked due to safety violations." } }, { status: 400 }),
)
assert.equal(blocked(await failure(decide(safety.model, "…", questions))), "safety")
const quota = wired(config("google"), () =>
  Response.json({ error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } }, { status: 400 }),
)
const refused = await failure(probeDecision(quota.model))
assert.equal(blocked(refused), undefined)
assert.match(refused.message, /API key not valid/)

// the other drivers and a custom address: where the request goes, with the key as a bearer
for (const [c, url] of [
  [config("openai"), "https://api.openai.com/v1/decisions"],
  [config("typesafe"), "https://api.typesafe.ai/v1/systemone"],
  [config("google", { url: "https://relay.example/v1beta/" }), "https://relay.example/v1beta/decisions"],
] as const) {
  const w = wired(c, () => Response.json({ error: { message: "no" } }, { status: 400 }))
  await failure(probeDecision(w.model))
  assert.equal(w.sent[0]?.url, url)
  assert.equal(decisionUrl(c), url)
  if (c.driver !== "google") assert.equal(w.sent[0]?.headers.get("authorization"), `Bearer ${key.value}`)
}

assert.throws(() => compileDecision(config("google"), undefined), /no key/)
assert.throws(() => compileDecision(config("google", { model: " " }), key), /no model/)

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
