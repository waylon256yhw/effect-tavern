import assert from "node:assert/strict"
import { MockLanguageModelV4 } from "ai/test"
import { Cause, Effect, Exit, Fiber, Schema } from "effect"
import type { Message, Model } from "../src/call.ts"
import { runStageTools, stageTool, StageError, type StageOptions, type StageEvent } from "../src/stage.ts"

const input: Message[] = [{ role: "user", content: "Do the work." }]
const call = (id: string, name: string, args: unknown = {}) => ({
  type: "tool-call" as const,
  toolCallId: id,
  toolName: name,
  input: JSON.stringify(args),
})
const tokens = {
  inputTokens: { total: 3, noCache: 1, cacheRead: 1, cacheWrite: 1 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
}
type Request = Parameters<MockLanguageModelV4["doGenerate"]>[0]
type Response = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>
const script = (steps: Array<Response["content"] | ((r: Request) => Promise<Response>)>) => {
  let n = 0
  const requests: Request[] = []
  const model: Model = {
    format: "openai-compatible",
    prefill: false,
    model: new MockLanguageModelV4({
      doGenerate: async (r) => {
        requests.push(r)
        const content = steps[n++]
        assert.ok(content, "unexpected extra generation")
        if (typeof content === "function") return content(r)
        return {
          content,
          usage: tokens,
          warnings: [],
          finishReason: {
            unified: content.some((p) => p.type === "tool-call") ? "tool-calls" : "stop",
            raw: undefined,
          },
        }
      },
    }),
  }
  return { model, requests }
}
const empty = Schema.Struct({})
const options = (): StageOptions => ({
  tools: { finish: stageTool(empty, "Finish", async () => ({ ok: true, value: "done" })) },
  completion: { tool: "finish" },
  budget: { maxSteps: 4 },
})
const run = (m: Model, o: StageOptions) => Effect.runPromise(runStageTools(m, input, o))

// Ordered execution, explicit completion in the same step, and immutable results.
{
  const { model, requests } = script([[call("a", "add", { n: 1 }), call("b", "add", { n: 2 }), call("f", "finish")]])
  const order: number[] = []
  const o = options()
  o.tools = {
    add: stageTool(Schema.Struct({ n: Schema.Int }), "Add", async ({ n }) => {
      await new Promise((resolve) => setTimeout(resolve, n === 1 ? 5 : 0))
      order.push(n)
      return { ok: true, value: order }
    }),
    finish: stageTool(empty, "Finish", async () => ({ ok: true, value: [...order] })),
  }
  const out = await run(model, o)
  assert.equal(out.status, "completed")
  if (out.status === "completed") assert.deepEqual(out.value, [1, 2])
  assert.deepEqual(out.trace[0]!.calls[0]!.result, { ok: true, value: [1] })
  assert.equal(requests.length, 1)
  assert.deepEqual(out.usage, { input: 3, output: 2, cacheRead: 1, cacheWrite: 1 })
}
// Duplicate IDs replay only within this attempt. Identical Effect execution starts with a fresh cache.
{
  const { model } = script([
    [call("a", "add")],
    [call("a", "add"), call("f", "finish")],
    [call("a", "add"), call("f", "finish")],
  ])
  let count = 0
  const o = options()
  o.tools = { ...o.tools, add: stageTool(empty, "Add", async () => ({ ok: true, value: ++count })) }
  const effect = runStageTools(model, input, o)
  const first = await Effect.runPromise(effect)
  assert.equal(first.trace[1]!.calls[0]!.replayed, true)
  assert.equal(count, 1)
  await Effect.runPromise(effect)
  assert.equal(count, 2)
}
// Schema and domain errors become native tool results; a failed batch cannot finish early.
{
  const { model, requests } = script([
    [call("bad", "write", { n: "wrong" }), call("f1", "finish")],
    [call("negative", "write", { n: -1 })],
    [call("good", "write", { n: 4 }), call("f2", "finish")],
  ])
  let count = 0
  const o = options()
  o.tools = {
    ...o.tools,
    write: stageTool(Schema.Struct({ n: Schema.Int }), "Write", async ({ n }) => {
      count++
      return n < 0 ? { ok: false, code: "negative", message: "Must be positive" } : { ok: true, value: n }
    }),
  }
  const out = await run(model, o)
  assert.equal(out.status, "completed")
  assert.equal(count, 2) // invalid schema never reached the handler
  assert.equal(out.trace[0]!.calls[1]!.result.ok, false)
  assert.match(JSON.stringify(requests[1]!.prompt), /invalid_tool_call/)
  assert.match(JSON.stringify(requests[2]!.prompt), /negative/)
}
// Completion must be last; wrong ordering never invokes its validator.
{
  let finished = 0
  const { model } = script([[call("f", "finish"), call("a", "read")], [call("f2", "finish")]])
  const o = options()
  o.tools = {
    finish: stageTool(empty, "Finish", async () => ({ ok: true, value: ++finished })),
    read: stageTool(empty, "Read", async () => ({ ok: true, value: "x" })),
  }
  const out = await run(model, o)
  assert.equal(out.status, "completed")
  assert.equal(finished, 1)
}
// Unexpected tool failures abort before subsequent effects and expose the trace.
{
  const { model } = script([[call("boom", "write"), call("f", "finish")]])
  const o = options()
  o.tools = {
    ...o.tools,
    write: stageTool(empty, "Write", async () => {
      throw new Error("storage unavailable")
    }),
  }
  const exit = await Effect.runPromiseExit(runStageTools(model, input, o))
  assert.ok(Exit.isFailure(exit))
  await assert.rejects(run(script([[call("boom", "write")]]).model, o), /storage unavailable/)
}
// A repeated ID with changed arguments is a protocol failure, never a second mutation.
{
  const { model } = script([[call("a", "read", { n: 1 })], [call("a", "read", { n: 2 })]])
  const o = options()
  o.tools = {
    ...o.tools,
    read: stageTool(Schema.Struct({ n: Schema.Int }), "Read", async () => ({ ok: true, value: 0 })),
  }
  await assert.rejects(run(model, o), /reused with different input/)
}
// Natural text completes read-only stages, never an explicit-finish stage.
{
  const { model } = script([[{ type: "text", text: "done" }]])
  assert.equal((await run(model, { ...options(), completion: { text: true } })).status, "completed")
  const unfinished = script([[{ type: "text", text: "done" }]])
  const out = await run(unfinished.model, { ...options(), budget: { maxSteps: 1 } })
  assert.equal(out.status, "budget_exhausted")
}
// Stage cumulative output budget clamps the next request; no hidden model retries.
{
  const { model, requests } = script([[call("a", "read")], [call("b", "read")]])
  const o = options()
  o.tools = { ...o.tools, read: stageTool(empty, "Read", async () => ({ ok: true, value: 0 })) }
  o.budget = { maxSteps: 5, maxOutputTokens: 8, maxTotalOutputTokens: 3 }
  const out = await run(model, o)
  assert.equal(out.status, "budget_exhausted")
  if (out.status === "budget_exhausted") assert.equal(out.reason, "output_tokens")
  assert.deepEqual(
    requests.map((r) => r.maxOutputTokens),
    [3, 1],
  )
}
// Truncated generations never execute even an otherwise parseable mutation.
{
  let executed = false
  const { model } = script([
    async () => ({
      content: [call("a", "write")],
      usage: tokens,
      warnings: [],
      finishReason: { unified: "length", raw: undefined },
    }),
  ])
  const o = options()
  o.tools = {
    ...o.tools,
    write: stageTool(empty, "Write", async () => {
      executed = true
      return { ok: true, value: 0 }
    }),
  }
  assert.equal((await run(model, o)).status, "budget_exhausted")
  assert.equal(executed, false)
}
// Timeout covers model calls and tools, propagates AbortSignal, and never finishes a late attempt.
for (const slowTool of [false, true]) {
  let aborted = false
  const slow = (signal: AbortSignal) =>
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true
          reject(signal.reason)
        },
        { once: true },
      )
    })
  const { model } = script(slowTool ? [[call("s", "slow"), call("f", "finish")]] : [async (r) => slow(r.abortSignal!)])
  const o = options()
  o.budget = { maxSteps: 3, timeoutMs: 25 }
  o.tools = { ...o.tools, slow: stageTool(empty, "Slow", async (_, c) => slow(c.signal)) }
  const out = await run(model, o)
  assert.equal(out.status, "budget_exhausted")
  if (out.status === "budget_exhausted") assert.equal(out.reason, "timeout")
  assert.equal(aborted, true)
}
// Effect interruption remains interruption; it aborts fetch and emits a cancellation trace.
{
  let entered!: () => void
  const ready = new Promise<void>((resolve) => {
    entered = resolve
  })
  const events: StageEvent[] = []
  let aborted = false
  const { model } = script([
    async (r) =>
      new Promise<never>((_, reject) => {
        r.abortSignal!.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(r.abortSignal!.reason)
          },
          { once: true },
        )
        entered()
      }),
  ])
  const fiber = Effect.runFork(runStageTools(model, input, { ...options(), onEvent: (e) => events.push(e) }))
  await ready
  await Effect.runPromise(Fiber.interrupt(fiber))
  const exit = await Effect.runPromise(Fiber.await(fiber))
  assert.ok(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(aborted, true)
  assert.ok(events.some((e) => e.kind === "end" && e.status === "cancelled"))
}
// Configuration errors carry a typed stage error before making a request.
{
  const { model, requests } = script([])
  const exit = await Effect.runPromiseExit(runStageTools(model, input, { ...options(), budget: { maxSteps: 0 } }))
  assert.ok(Exit.isFailure(exit))
  assert.equal(requests.length, 0)
  const err = await Effect.runPromise(
    Effect.flip(runStageTools(model, input, { ...options(), budget: { maxSteps: 0 } })),
  )
  assert.ok(err instanceof StageError)
}
// Unsupported native tooling is rejected locally, without falling back to JSON.
{
  const { model, requests } = script([])
  await assert.rejects(run({ ...model, tools: false }, options()), /does not support native tool calling/)
  assert.equal(requests.length, 0)
}
// Unknown names and malformed arguments return repairable errors without executing handlers.
{
  const { model, requests } = script([
    [call("unknown", "not_declared")],
    [{ ...call("malformed", "finish"), input: "{bad" }],
    [call("correct", "finish")],
  ])
  const out = await run(model, options())
  assert.equal(out.status, "completed")
  assert.match(JSON.stringify(requests[1]!.prompt), /invalid_tool_call/)
  assert.match(JSON.stringify(requests[2]!.prompt), /invalid_tool_call/)
}
// Preserve signed reasoning metadata across tool steps even when historical reasoningBack is disabled.
{
  const { model, requests } = script([
    [
      { type: "reasoning", text: "need evidence", providerMetadata: { anthropic: { signature: "signed" } } },
      call("a", "read"),
    ],
    [call("f", "finish")],
  ])
  const o = options()
  o.tools = { ...o.tools, read: stageTool(empty, "Read", async () => ({ ok: true, value: "evidence" })) }
  await run({ ...model, reasoningBack: false }, o)
  const assistant = requests[1]!.prompt.find((m) => m.role === "assistant")
  assert.ok(assistant && assistant.role === "assistant")
  assert.ok(
    assistant.content.some((p) => p.type === "reasoning" && p.providerOptions?.anthropic?.signature === "signed"),
  )
}
console.log("stage ok")
