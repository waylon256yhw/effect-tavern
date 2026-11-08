// Real SDK adapters against aimock's native HTTP protocols. This verifies serialized schemas,
// ordered calls/results and repair, not whether a commercial endpoint accepts a particular model.
import assert from "node:assert/strict"
import { LLMock } from "@copilotkit/aimock"
import { Effect, Schema } from "effect"
import { bind, type Trace } from "../src/connection.ts"
import { runStageTools, stageTool } from "../src/stage.ts"
import type { Format } from "../src/url.ts"

const mock = new LLMock({ port: 0 })
await mock.start()
try {
  for (const format of ["anthropic", "gemini", "openai-compatible"] as Format[]) {
    mock.reset()
    // aimock 1.46 defaults Gemini tool replies to FUNCTION_CALL; the SDK expects native STOP.
    // Override the fixture, not production finish-reason handling.
    const traces: Trace[] = []
    const bodies: Record<string, any>[] = []
    mock.on(
      { hasToolResult: false },
      {
        ...(format === "gemini" ? { finishReason: "stop" } : {}),
        toolCalls: [{ id: "read1", name: "read", arguments: { key: "missing" } }],
      },
    )
    mock.on(
      { toolResultContains: "not_found" },
      {
        ...(format === "gemini" ? { finishReason: "stop" } : {}),
        toolCalls: [
          { id: "read2", name: "read", arguments: { key: "entry", detail: "full" } },
          { id: "finish1", name: "finish", arguments: { summary: "found" } },
        ],
      },
    )
    const model = bind(
      {
        id: "test",
        format,
        endpoint: { url: mock.url, resolution: "format-default" },
        credential: { type: "api_key", key: "test-key" },
        model: format === "anthropic" ? "claude-haiku-5-5" : format === "gemini" ? "gemini-2.5-flash" : "gpt-5",
      },
      {
        onTrace: (t) => traces.push(t),
        traceBody: true,
        fetch: (url, init) => {
          assert.equal(typeof init?.body, "string")
          bodies.push(JSON.parse(init!.body as string))
          return fetch(url, init)
        },
      },
    )
    const reads: string[] = []
    const out = await Effect.runPromise(
      runStageTools(
        model,
        [
          { role: "system", content: "Use read, then finish. Tools return structured errors for invalid keys." },
          { role: "user", content: "Find entry." },
        ],
        {
          tools: {
            read: stageTool(
              Schema.Struct({ key: Schema.String, detail: Schema.optionalKey(Schema.Literals(["full", "brief"])) }),
              "Read an entry",
              async ({ key }) => {
                reads.push(key)
                return key === "entry"
                  ? { ok: true, value: { text: "frozen evidence" } }
                  : { ok: false, code: "not_found", message: "Use entry" }
              },
            ),
            finish: stageTool(Schema.Struct({ summary: Schema.String }), "Complete", async ({ summary }) => ({
              ok: true,
              value: summary,
            })),
          },
          completion: { tool: "finish" },
          budget: { maxSteps: 3, maxOutputTokens: 256 },
          call: { effort: "off" },
        },
      ),
    )
    assert.equal(out.status, "completed", format)
    if (out.status === "completed") assert.equal(out.value, "found")
    assert.deepEqual(reads, ["missing", "entry"])
    assert.equal(traces.length, 2)
    assert.ok(traces.every((t) => t.status === 200))
    assert.equal(out.trace[0]!.calls[0]!.result.ok, false)
    assert.deepEqual(
      out.trace[1]!.calls.map((c) => c.name),
      ["read", "finish"],
    )
    const [first, second] = bodies
    if (format === "anthropic") {
      assert.deepEqual(first!.tools[0].input_schema.required, ["key"])
      assert.equal(first!.tools[0].input_schema.properties.detail.type, "string")
      assert.ok(second!.messages.some((m: any) => m.content?.some?.((p: any) => p.type === "tool_use")))
      const result = second!.messages.flatMap((m: any) => m.content).find((p: any) => p.type === "tool_result")
      assert.equal(result.is_error, true)
      assert.equal(result.tool_use_id, "read1")
      assert.match(JSON.stringify(result.content), /not_found/)
    } else if (format === "gemini") {
      const defs = first!.tools.flatMap((t: any) => t.functionDeclarations ?? [])
      assert.deepEqual(defs[0].parametersJsonSchema.required, ["key"])
      const parts = second!.contents.flatMap((m: any) => m.parts)
      assert.ok(parts.some((p: any) => p.functionCall?.name === "read"))
      const result = parts.find((p: any) => p.functionResponse)
      assert.equal(result.functionResponse.name, "read")
      assert.match(JSON.stringify(result.functionResponse.response), /not_found/)
    } else {
      assert.deepEqual(first!.tools[0].function.parameters.required, ["key"])
      assert.ok(second!.messages.some((m: any) => m.role === "assistant" && m.tool_calls?.length))
      const result = second!.messages.find((m: any) => m.role === "tool")
      assert.equal(result.tool_call_id, "read1")
      assert.match(result.content, /not_found/)
    }
  }
} finally {
  await mock.stop()
}
console.log("stage wire ok (anthropic, gemini, openai-compatible)")
