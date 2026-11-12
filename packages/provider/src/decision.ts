// A decision call: typed questions about one shared text, answered as probabilities, with no text generated
// (ai-sdk `experimental_decide`). A different kind of model from the one a stage calls: no messages, no hat, no
// output. `compileDecision` (connection.ts) makes the model from a gemini connection; this file is the call.
//
// Three question kinds. `boolean` answers P(true); `choice` picks one option id; `score` places the text on an ordered
// rubric. Questions are judged independently of each other. A native decision model returns a distribution for choice
// and score; an adapter over a language model does not, so `probabilities` is optional and a caller checks for it.
// A safety block refuses every question of the request at once: the call fails as a ModelError, never a partial answer.
import { experimental_decide, type Experimental_DecisionModel, type Experimental_DecisionQuestion } from "ai"
import { Experimental_DecisionMockModelV4 } from "ai/test"
import { Effect } from "effect"
import { modelError, type Usage } from "./call.ts"

export type DecisionModel = Experimental_DecisionModel
export type Question = Exclude<Experimental_DecisionQuestion, { type: "box" }>

export const decide = <const Q extends Record<string, Question>>(model: DecisionModel, state: string, questions: Q) =>
  Effect.tryPromise((abortSignal) => experimental_decide({ model, state, questions, abortSignal })).pipe(
    Effect.mapError(modelError),
    Effect.map((r) => ({
      answers: r.answers,
      // input only: a decision generates nothing, and the endpoint has no cache
      usage: { input: r.usage.inputTokens ?? 0, output: 0, cacheRead: 0, cacheWrite: 0 } satisfies Usage,
    })),
  )

type Call = Parameters<Experimental_DecisionMockModelV4["doDecide"]>[0]
type Answers = Awaited<ReturnType<Experimental_DecisionMockModelV4["doDecide"]>>["answers"]
/** A scripted decision model for self-checks, as `fake` is for a stage's model: answers by a function of the request. */
export const fakeDecision = (answer: (call: Call) => Answers): DecisionModel =>
  new Experimental_DecisionMockModelV4({
    supportedQuestionTypes: ["boolean", "choice", "score"],
    doDecide: async (call) => ({ answers: answer(call), warnings: [] }),
  })
