// The decision call (decision.ts is what it is and its config): `compileDecision` turns a config and its key into an
// ai-sdk decision model, `decide` asks it typed questions about one text.
//
// Three question kinds. `boolean` answers P(true); `choice` picks one option id; `score` places the text on an ordered
// rubric. Questions are judged independently of each other. A native decision model returns a distribution for choice
// and score; an adapter over a language model does not, so `probabilities` is optional and a caller checks for it.
// A safety block refuses every question of the request at once: the call fails as a ModelError (`blocked` tells it
// from any other failure), never a partial answer.
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai"
import { experimental_decide, type Experimental_DecisionModel, type Experimental_DecisionQuestion } from "ai"
import { Experimental_DecisionMockModelV4 } from "ai/test"
import { Effect } from "effect"
import { modelError, type ModelError, type Usage } from "./call.ts"
import { fetchFor, traced, type CompileOptions } from "./connection.ts"
import type { DecisionConfig } from "./decision.ts"
import type { Secret } from "./providers.ts"

export type DecisionModel = Experimental_DecisionModel
export type Question = Exclude<Experimental_DecisionQuestion, { type: "box" }>

const FACTORY = { google: createGoogleGenerativeAI, openai: createOpenAI, typesafe: createTypeSafeAi }

/** A config as a model, whether or not it is enabled (the player tests before switching it on). What is missing fails
 *  here; an unset `url` is the driver's own address. `onTrace` sees each fetch, as on `compile`. */
export const compileDecision = (c: DecisionConfig, s: Secret | undefined, o: CompileOptions = {}): DecisionModel => {
  if (!s) throw new Error("decision model: no key")
  if (!c.model.trim()) throw new Error("decision model: no model")
  const inner = o.fetch ?? fetchFor(c)
  const fetch = o.onTrace ? traced(o.onTrace, o.traceBody ?? false, inner) : inner
  return FACTORY[c.driver]({
    apiKey: s.value,
    ...(c.url?.trim() && { baseURL: c.url.trim() }),
    ...(c.headers && { headers: c.headers }),
    // ai-sdk types `fetch` as `typeof fetch`, which under Bun types also requires `preconnect`; the SDK only calls it
    fetch: fetch as typeof globalThis.fetch,
  }).decisionModel(c.model.trim())
}

export const decide = <const Q extends Record<string, Question>>(
  model: DecisionModel,
  state: string,
  questions: Q,
  o: { maxRetries?: number } = {}, // ai-sdk retries a transient failure twice when unset
) =>
  Effect.tryPromise((abortSignal) => experimental_decide({ model, state, questions, abortSignal, ...o })).pipe(
    Effect.mapError(modelError),
    Effect.map((r) => ({
      answers: r.answers,
      // input only: a decision generates nothing, and the endpoint has no cache
      usage: { input: r.usage.inputTokens ?? 0, output: 0, cacheRead: 0, cacheWrite: 0 } satisfies Usage,
    })),
  )

/** The smallest real request: one yes/no question about one word, sent once. What a "test" button sends. */
export const probeDecision = (model: DecisionModel) =>
  decide(
    model,
    "Hello.",
    { greeting: { type: "boolean", instructions: "Is this text a greeting?" } },
    { maxRetries: 0 },
  )

const BLOCKS = ["safety", "prohibited_content", "blocklist", "image_safety", "content_blocked"]
/** Why the service refused to judge this text, when that is what the failure was: its block code, or `refusal` when it
 *  answered with refusals. Google's decisions endpoint answers a block as HTTP 400 `{error: {code: "safety"}}`, which
 *  the SDK's error parser (numeric `code`, a `status`) does not read, so the message is a bare "Bad Request" and the
 *  code is only in the response body down the cause chain. */
export const blocked = (e: ModelError): string | undefined => {
  for (let x: unknown = e.cause, i = 0; x instanceof Error && i < 6; x = x.cause, i++) {
    if (x.name === "AI_DecisionRefusalError") return "refusal"
    const body = (x as { responseBody?: unknown }).responseBody
    if (typeof body !== "string") continue
    try {
      const code = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code
      if (typeof code === "string" && BLOCKS.includes(code)) return code
    } catch {} // not JSON: not a block we can name
  }
  return undefined
}

type Call = Parameters<Experimental_DecisionMockModelV4["doDecide"]>[0]
type Answers = Awaited<ReturnType<Experimental_DecisionMockModelV4["doDecide"]>>["answers"]
/** A scripted decision model for self-checks, as `fake` is for a stage's model: answers by a function of the request. */
export const fakeDecision = (answer: (call: Call) => Answers): DecisionModel =>
  new Experimental_DecisionMockModelV4({
    supportedQuestionTypes: ["boolean", "choice", "score"],
    doDecide: async (call) => ({ answers: answer(call), warnings: [] }),
  })
