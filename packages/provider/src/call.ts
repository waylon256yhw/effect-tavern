// The three calls the harness makes, as Effects. Interrupting the fiber aborts the HTTP request.
// Structured stages: `object`. Narrate: `text` (one shot) or `stream`. Nothing here loops or picks tools.
import {
  Output,
  generateText,
  streamText,
  type LanguageModel,
  type AssistantModelMessage,
  type FinishReason,
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
  /** Sampling temperature; sent to openai-compatible and gemini only (Claude has no sampling parameters). */
  temperature?: number
  effort?: Effort
  /** Merged under the model's own provider key; use for anything the connection config does not name. */
  providerOptions?: Record<string, Record<string, unknown>>
}

/** Cache breakpoint on a message. Anthropic needs explicit markers (at most four, each caching the prefix up to it,
 *  nothing below the model's minimum prefix); OpenAI and Gemini cache prefixes on their own and ignore it. The TTL is the
 *  connection's call: 5m for traffic under five minutes apart, 1h (twice the write price) for a human who replies
 *  within the hour; 1h markers must precede 5m ones in the request. */
export type CacheTtl = "5m" | "1h"
export const breakpoint = <M extends Message>(m: M, ttl?: CacheTtl): M => ({
  ...m,
  providerOptions: {
    ...m.providerOptions,
    anthropic: { cacheControl: { type: "ephemeral", ...(ttl === "1h" ? { ttl } : {}) } },
  },
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
 *  (an note-only turn that delivered lore) leaves its system lines after an assistant message; those go out under the
 *  one role the wire still allows there, content unchanged. Leading system messages (the head) are untouched.
 *  Gemini takes system messages only as the leading run (they become systemInstruction; @ai-sdk/google throws on any
 *  later one), so there every system message after the first non-system one goes out as user, content unchanged. */
export const wire = (format: Format, messages: readonly Message[], prefill?: boolean): Message[] => {
  // the one prefill rule: the request does not end in an assistant message (an assistant inside, a hat's, is fine)
  if (prefill === false && messages.at(-1)?.role === "assistant")
    throw new Error(
      "request ends in an assistant message, and this connection does not take a prefill (capabilities.prefill is false): end the hat's tail in a user or system message",
    )
  const head = messages.findIndex((m) => m.role !== "system")
  return messages.map((m, i) =>
    m.role === "system" &&
    (format === "anthropic" ? messages[i - 1]?.role === "assistant" : format === "gemini" && head >= 0 && i > head)
      ? ({ ...m, role: "user" } as Message)
      : m,
  )
}

const settings = (format: Format, o: CallOptions) => ({
  allowSystemInMessages: true, // the head and mid-history lore are system messages in the message list; ai 7 refuses them by default
  maxOutputTokens: o.maxOutputTokens,
  // Claude has no sampling knobs any more: current models ignore temperature (ai-sdk warns and drops it) and the
  // 2026-10-21 API version rejects it outright; the other two formats still take it.
  temperature: format === "anthropic" ? undefined : o.temperature,
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
  /** The connection's `capabilities.prefill`; false rejects a request ending in an assistant message at the wire. */
  prefill?: boolean
}

export const object = <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
  m: Model,
  schema: S,
  messages: readonly Message[],
  o: CallOptions = {},
) =>
  Effect.tryPromise((abortSignal) =>
    generateText({
      model: m.model,
      output: Output.object({ schema: standard(schema), name: o.name }),
      messages: wire(m.format, messages, m.prefill),
      abortSignal,
      ...settings(m.format, o),
    }),
  ).pipe(
    Effect.mapError(fail),
    Effect.map((r) => ({ value: r.output as S["Type"], usage: usage(r.usage), finishReason: r.finishReason })),
  )

export const text = (m: Model, messages: readonly Message[], o: CallOptions = {}) =>
  Effect.tryPromise((abortSignal) =>
    generateText({
      model: m.model,
      messages: wire(m.format, messages, m.prefill),
      abortSignal,
      ...settings(m.format, o),
    }),
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

export interface Reply {
  text: string
  parts: ReplyPart[]
  usage: Usage
  finishReason: FinishReason
}
/** One streaming request with two faces: `parts` as ai-sdk emits them (the finish part carries usage), and `reply`,
 *  what `text` would have returned, resolved once `parts` is drained. Interrupting `parts` aborts the request.
 *  Cancelling ai-sdk's iterator early leaves a promise rejecting with `undefined` (ai 7.0.62, verified live), which
 *  would crash the process. So the iterator is never cancelled: interruption aborts the signal and the drain runs on
 *  to the `abort` part ai-sdk then emits, which is dropped. */
export const streamed = (m: Model, messages: readonly Message[], o: CallOptions = {}) =>
  Effect.try({ try: () => wire(m.format, messages, m.prefill), catch: fail }).pipe(
    Effect.map((wired) => {
      const ac = new AbortController()
      const r = streamText({
        model: m.model,
        messages: wired,
        abortSignal: ac.signal,
        ...settings(m.format, o),
      })
      const parts = Stream.callback<Part, ModelError>((queue) =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Effect.sync(() => ac.abort()))
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
      const reply: Effect.Effect<Reply, ModelError> = Effect.tryPromise(async (): Promise<Reply> => ({
        text: await r.text,
        parts: replyParts((await r.responseMessages).find((m) => m.role === "assistant") as AssistantModelMessage),
        usage: usage(await r.usage),
        finishReason: await r.finishReason,
      })).pipe(Effect.mapError(fail))
      return { parts, reply }
    }),
  )
export const stream = (m: Model, messages: readonly Message[], o: CallOptions = {}): Stream.Stream<Part, ModelError> =>
  Stream.unwrap(Effect.map(streamed(m, messages, o), (s) => s.parts))
