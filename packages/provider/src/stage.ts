// Native tool messages, bounded by one execution attempt. Tools operate on caller-owned staging;
// completion validates that staging, but never commits it. Persistence belongs to the runtime.
import { generateText, type FlexibleSchema, type ToolSet } from "ai"
import { Effect, Schema } from "effect"
import { settings, standard, usage, wire, type CallOptions, type Message, type Model, type Usage } from "./call.ts"

export interface StageBudget {
  maxSteps: number
  /** Per model request, including the final request. */
  maxOutputTokens?: number
  /** Cumulative output across this attempt. Each request is capped by the remaining allowance. */
  maxTotalOutputTokens?: number
  /** Whole attempt, including tool execution. */
  timeoutMs?: number
}
export type ToolResult<T = unknown> = { ok: true; value: T } | { ok: false; code: string; message: string }
export interface ToolContext {
  toolCallId: string
  signal: AbortSignal
}
export interface StageTool {
  description: string
  inputSchema: FlexibleSchema<unknown>
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>
}
/** Retain typed inputs at declaration sites; the heterogeneous registry stays private to the runner. */
export const stageTool = <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
  schema: S,
  description: string,
  execute: (input: S["Type"], context: ToolContext) => Promise<ToolResult>,
): StageTool => ({
  description,
  inputSchema: standard(schema),
  execute: (input, context) => execute(input as S["Type"], context), // SDK has decoded input through inputSchema
})

export interface ToolTrace {
  toolCallId: string
  name: string
  input: unknown
  result: ToolResult
  replayed: boolean
  ms: number
}
export interface StageStep {
  index: number
  messages: readonly Message[]
  response?: readonly Message[]
  finishReason?: string
  usage?: Usage
  calls: ToolTrace[]
  ms?: number
}
export type StageTrace = readonly StageStep[]
export type StageEvent =
  | { kind: "request"; step: number; messages: readonly Message[] }
  | { kind: "response"; step: number; messages: readonly Message[]; usage: Usage; finishReason: string }
  | { kind: "tool"; step: number; call: ToolTrace }
  | { kind: "end"; status: "completed" | "budget_exhausted" | "failed" | "cancelled"; usage: Usage }
export type StageOutcome = {
  trace: StageTrace
  usage: Usage
} & (
  | { status: "completed"; value: unknown }
  | { status: "budget_exhausted"; reason: "steps" | "output_tokens" | "timeout" }
)
export class StageError extends Error {
  constructor(
    message: string,
    readonly trace: StageTrace,
    readonly usage: Usage,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = "StageError"
  }
}
export interface StageOptions {
  tools: Readonly<Record<string, StageTool>>
  /** Text completion is suitable for read-only lookup. A named completion tool must validate
   *  the whole transaction, including unresolved domain errors, and return its final value. */
  completion: { tool: string } | { text: true }
  budget: StageBudget
  call?: CallOptions
  /** Incremental trace remains observable even when the Effect is interrupted. Must not throw. */
  onEvent?: (event: StageEvent) => void
}
const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const error = (code: string, message: string): ToolResult => ({ ok: false, code, message })
// Canonical keys make retries insensitive to JSON object member order.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  )
const copy = <T>(value: T): T => structuredClone(value)

/** One SDK generation per iteration, with native assistant/tool response messages preserved intact.
 *  Deliberately execute outside SDK execute callbacks: fatal failures must abort, recoverable failures
 *  must return tool results, and a completion tool must be last before it can validate staging.
 *  Tools must honor signal and only mutate attempt-local staging. A new run gets a fresh result cache. */
export const runStageTools = (model: Model, initial: readonly Message[], options: StageOptions) =>
  Effect.tryPromise({
    try: async (interruption): Promise<StageOutcome> => {
      const trace: StageStep[] = []
      const total = zero()
      const ac = new AbortController()
      const timedOut = Symbol("stage timeout")
      const emit = (event: StageEvent) => options.onEvent?.(copy(event))
      let timer: ReturnType<typeof setTimeout> | undefined
      const interrupt = () => ac.abort(interruption.reason)
      interruption.addEventListener("abort", interrupt, { once: true })
      if (interruption.aborted) interrupt()
      let rejectAbort: () => void = () => {}
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(ac.signal.reason)
        ac.signal.addEventListener("abort", rejectAbort, { once: true })
        if (ac.signal.aborted) rejectAbort()
      })
      // Attach immediately: configuration failures can happen before the first race.
      void aborted.catch(() => {})
      const wait = <T>(p: PromiseLike<T>) => Promise.race([p, aborted])
      const exhausted = (reason: "steps" | "output_tokens" | "timeout"): StageOutcome => {
        emit({ kind: "end", status: "budget_exhausted", usage: total })
        return { status: "budget_exhausted", reason, trace, usage: total }
      }
      const completed = (value: unknown): StageOutcome => {
        emit({ kind: "end", status: "completed", usage: total })
        return { status: "completed", value, trace, usage: total }
      }
      try {
        if (model.tools === false) throw new Error("this connection does not support native tool calling")
        const { budget, completion } = options
        for (const [key, value] of Object.entries(budget))
          if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
            throw new Error(`${key} must be a positive safe integer`)
        if (!Number.isSafeInteger(budget.maxSteps) || budget.maxSteps <= 0) throw new Error("maxSteps is required")
        if ("tool" in completion && !Object.hasOwn(options.tools, completion.tool))
          throw new Error(`completion tool ${completion.tool} is not declared`)
        if (budget.timeoutMs !== undefined) timer = setTimeout(() => ac.abort(timedOut), budget.timeoutMs)
        const tools: ToolSet = Object.fromEntries(
          Object.entries(options.tools).map(([name, t]) => [
            name,
            {
              description: t.description,
              inputSchema: t.inputSchema,
            },
          ]),
        )
        const cache = new Map<string, { signature: string; result: ToolResult }>()
        const messages = wire(model.format, initial, model.prefill)
        for (let index = 0; index < budget.maxSteps; index++) {
          ac.signal.throwIfAborted()
          const remaining =
            budget.maxTotalOutputTokens === undefined ? Infinity : budget.maxTotalOutputTokens - total.output
          if (remaining <= 0) return exhausted("output_tokens")
          const limit = Math.min(
            remaining,
            budget.maxOutputTokens ?? options.call?.maxOutputTokens ?? model.maxOutputTokens ?? Infinity,
          )
          const step: StageStep = { index, messages: copy(messages), calls: [] }
          trace.push(step)
          emit({ kind: "request", step: index, messages })
          const started = Date.now()
          const r = await wait(
            generateText({
              model: model.model,
              ...settings(model.format, { effort: model.effort, ...options.call }),
              maxOutputTokens: Number.isFinite(limit) ? limit : undefined,
              maxRetries: 0, // a retry is an explicit new attempt, never hidden from the budget/trace
              messages,
              tools,
              abortSignal: ac.signal,
            }),
          )
          ac.signal.throwIfAborted()
          const used = usage(r.usage)
          for (const k of Object.keys(total) as (keyof Usage)[]) total[k] += used[k]
          step.usage = used
          step.response = copy(r.response.messages)
          step.finishReason = r.finishReason
          step.ms = Date.now() - started
          emit({
            kind: "response",
            step: index,
            messages: r.response.messages,
            usage: used,
            finishReason: r.finishReason,
          })
          // SDK already emits results for invalid calls. Replace those with our single result per call;
          // preserve assistant text/reasoning/signatures and tool-call parts without reconstruction.
          messages.push(...r.response.messages.filter((m) => m.role !== "tool"))
          if (r.finishReason === "length" || total.output > (budget.maxTotalOutputTokens ?? Infinity))
            return exhausted("output_tokens")
          if (r.finishReason !== "stop" && r.finishReason !== "tool-calls")
            throw new Error(`stage generation ended with ${r.finishReason}`)
          if (!r.toolCalls.length) {
            if ("text" in completion) return completed(r.text)
            messages.push({
              role: "user",
              content: `The stage is incomplete. Call ${completion.tool} to finish after validating all required work.`,
            })
            continue
          }
          let failedThisStep = false
          for (const [position, call] of r.toolCalls.entries()) {
            ac.signal.throwIfAborted()
            if (call.providerExecuted)
              throw new Error("provider-executed tools are not supported in a staged transaction")
            const t0 = Date.now()
            const signature = canonical([call.toolName, call.input])
            const previous = cache.get(call.toolCallId)
            const isFinish = "tool" in completion && completion.tool === call.toolName
            let result: ToolResult
            let replayed = false
            if (previous && previous.signature !== signature)
              throw new Error(`toolCallId ${call.toolCallId} was reused with different input`)
            if (isFinish && (position !== r.toolCalls.length - 1 || failedThisStep)) {
              result = error(
                "completion_blocked",
                "Completion must be last, after successful preceding calls. Correct errors and finish with a new toolCallId.",
              )
            } else if (previous) {
              result = copy(previous.result)
              replayed = true
            } else if (call.invalid) {
              result = error("invalid_tool_call", call.error instanceof Error ? call.error.message : String(call.error))
            } else if (!Object.hasOwn(options.tools, call.toolName)) {
              result = error("unknown_tool", `Unknown tool: ${call.toolName}`)
            } else {
              // Unexpected exceptions are fatal; only explicit validation results are recoverable.
              result = await wait(
                options.tools[call.toolName]!.execute(call.input, { toolCallId: call.toolCallId, signal: ac.signal }),
              )
              ac.signal.throwIfAborted()
            }
            // Require JSON data and detach from mutable staging before caching or retaining a trace.
            result = JSON.parse(JSON.stringify(result)) as ToolResult
            if (!result || typeof result.ok !== "boolean") throw new Error("tool returned an invalid result")
            if (!previous) cache.set(call.toolCallId, { signature, result: copy(result) })
            failedThisStep ||= !result.ok
            const callTrace: ToolTrace = {
              toolCallId: call.toolCallId,
              name: call.toolName,
              input: copy(call.input),
              result,
              replayed,
              ms: Date.now() - t0,
            }
            step.calls.push(callTrace)
            emit({ kind: "tool", step: index, call: callTrace })
            messages.push({
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  output: { type: result.ok ? "text" : "error-text", value: JSON.stringify(result) },
                },
              ],
            })
            if (isFinish && result.ok) return completed(result.value)
          }
        }
        return exhausted("steps")
      } catch (cause) {
        if (ac.signal.aborted && ac.signal.reason === timedOut) return exhausted("timeout")
        emit({ kind: "end", status: interruption.aborted ? "cancelled" : "failed", usage: total })
        throw new StageError(cause instanceof Error ? cause.message : String(cause), trace, total, cause)
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        interruption.removeEventListener("abort", interrupt)
        ac.signal.removeEventListener("abort", rejectAbort)
      }
    },
    catch: (cause) => (cause instanceof StageError ? cause : new StageError(String(cause), [], zero(), cause)),
  })
