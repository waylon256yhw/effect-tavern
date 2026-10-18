// The three calls the harness makes, as Effects. Interrupting the fiber aborts the HTTP request.
// Structured stages: `object`. Narrate: `text` (one shot) or `stream`. Nothing here loops or picks tools.
import {
  generateObject,
  generateText,
  streamText,
  type LanguageModel,
  type AssistantModelMessage,
  type LanguageModelUsage,
  type ModelMessage,
  type TextStreamPart,
} from "ai"
import { Effect, Queue, Schema, Stream } from "effect"
import type { Format } from "./url.ts"

export type Message = ModelMessage
export type Part = TextStreamPart<{}>

export type Effort = "off" | "low" | "medium" | "high" | "max"
export interface CallOptions {
  /** Stage name; goes out as the schema name on `object` and is what a fake or a trace sees. */
  name?: string
  maxOutputTokens?: number
  temperature?: number
  effort?: Effort
  /** Merged under the model's own provider key; use for anything the connection config does not name. */
  providerOptions?: Record<string, Record<string, unknown>>
}

/** Cache breakpoint. The harness marks the last head message and the last folded-prefix message; other formats ignore it. */
export const breakpoint = <M extends Message>(m: M): M => ({
  ...m,
  providerOptions: { ...m.providerOptions, anthropic: { cacheControl: { type: "ephemeral" } } },
})

// Deckled's reasoning-effort table, cut to three formats. `off` is only sent where the format has an off value.
const GEMINI_BUDGET: Record<Effort, number> = { off: 0, low: 2048, medium: 8192, high: 24576, max: 32768 }
export const effortOptions = (format: Format, effort: Effort): Record<string, Record<string, unknown>> => {
  switch (format) {
    case "anthropic":
      return {
        anthropic:
          effort === "off"
            ? { thinking: { type: "disabled" } }
            : { thinking: { type: "adaptive", display: "summarized" }, effort: effort === "max" ? "max" : effort },
      }
    case "gemini":
      return {
        google: { thinkingConfig: { thinkingBudget: GEMINI_BUDGET[effort], includeThoughts: effort !== "off" } },
      }
    case "openai-compatible":
      return effort === "off" ? {} : { compat: { reasoningEffort: effort } }
  }
}

/** Effect Schema as an ai-sdk schema: Standard Schema for validation plus Standard JSON Schema for the wire. */
export const standard = <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(s: S) => {
  const v = Schema.toStandardSchemaV1(s)
  const j = Schema.toStandardJSONSchemaV1(s)
  return { "~standard": { ...v["~standard"], jsonSchema: j["~standard"].jsonSchema } }
}

/** Wire placement. Anthropic takes a mid-conversation system message only directly after a user message (verified live:
 *  400 otherwise). The harness's views put directives after the player's line, but a past turn that had no player line
 *  (an aside-only turn that delivered lore) leaves its system lines after an assistant message; those go out under the
 *  one role the wire still allows there, content unchanged. Leading system messages (the head) are untouched. */
const wire = (format: Format, messages: readonly Message[]): Message[] =>
  format === "anthropic"
    ? messages.map((m, i) =>
        m.role === "system" && messages[i - 1]?.role === "assistant" ? ({ ...m, role: "user" } as Message) : m,
      )
    : [...messages]

const settings = (format: Format, o: CallOptions) => ({
  allowSystemInMessages: true, // the head and mid-history lore are system messages in the message list; ai 7 refuses them by default
  maxOutputTokens: o.maxOutputTokens,
  temperature: o.temperature,
  providerOptions: { ...(o.effort && effortOptions(format, o.effort)), ...o.providerOptions } as never,
})

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}
const usage = (u: LanguageModelUsage): Usage => ({
  input: u.inputTokens ?? 0,
  output: u.outputTokens ?? 0,
  cacheRead: u.inputTokenDetails.cacheReadTokens ?? 0,
  cacheWrite: u.inputTokenDetails.cacheWriteTokens ?? 0,
})

export class ModelError extends Schema.TaggedError<ModelError>()("ModelError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}
// tryPromise wraps the rejection in an UnknownError; the ai-sdk error underneath carries the provider's message.
const fail = (wrapped: unknown) => {
  const cause = wrapped instanceof Error && wrapped.cause instanceof Error ? wrapped.cause : wrapped
  return new ModelError({ message: cause instanceof Error ? cause.message : String(cause), cause })
}

export interface Model {
  format: Format
  model: LanguageModel
}

export const object = <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
  m: Model,
  schema: S,
  messages: readonly Message[],
  o: CallOptions = {},
) =>
  Effect.tryPromise((abortSignal) =>
    generateObject({
      model: m.model,
      schema: standard(schema),
      schemaName: o.name,
      messages: wire(m.format, messages),
      abortSignal,
      ...settings(m.format, o),
    }),
  ).pipe(
    Effect.mapError(fail),
    Effect.map((r) => ({ value: r.object as S["Type"], usage: usage(r.usage), finishReason: r.finishReason })),
  )

export const text = (m: Model, messages: readonly Message[], o: CallOptions = {}) =>
  Effect.tryPromise((abortSignal) =>
    generateText({ model: m.model, messages: wire(m.format, messages), abortSignal, ...settings(m.format, o) }),
  ).pipe(
    Effect.mapError(fail),
    Effect.map((r) => ({
      text: r.text,
      reasoning: r.reasoningText,
      /** The reply as parts the provider will take back: text, and reasoning with its signature in providerOptions. */
      parts: replyParts(r.response.messages.find((m) => m.role === "assistant")),
      usage: usage(r.usage),
      finishReason: r.finishReason,
    })),
  )

export type ReplyPart = Extract<
  Exclude<AssistantModelMessage["content"], string>[number],
  { type: "text" | "reasoning" }
>
const replyParts = (m: AssistantModelMessage | undefined): ReplyPart[] =>
  m === undefined
    ? []
    : typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : m.content.filter((p): p is ReplyPart => p.type === "text" || p.type === "reasoning")

/** Parts as ai-sdk emits them; the finish part carries usage. Interrupting the stream aborts the request.
 *  Cancelling ai-sdk's iterator early leaves a promise rejecting with `undefined` (ai 7.0.62, verified live), which
 *  would crash the process. So the iterator is never cancelled: interruption aborts the signal and the drain runs on
 *  to the `abort` part ai-sdk then emits, which is dropped. */
export const stream = (m: Model, messages: readonly Message[], o: CallOptions = {}): Stream.Stream<Part, ModelError> =>
  Stream.callback<Part, ModelError>((queue) =>
    Effect.gen(function* () {
      const ac = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => ac.abort()))
      const r = streamText({
        model: m.model,
        messages: wire(m.format, messages),
        abortSignal: ac.signal,
        ...settings(m.format, o),
      })
      void (async () => {
        try {
          for await (const p of r.fullStream as AsyncIterable<Part>) {
            if (p.type === "error") return void (await Effect.runPromise(Queue.fail(queue, fail(p.error))))
            if (p.type !== "abort") await Effect.runPromise(Queue.offer(queue, p))
          }
          await Effect.runPromise(Queue.end(queue))
        } catch (e) {
          await Effect.runPromise(Queue.fail(queue, fail(e)))
        }
      })()
    }),
  )
