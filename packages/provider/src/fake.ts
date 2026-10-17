// A scripted model for self-checks: the same `Model` the harness calls, answered by a function of the request.
// Lives here so the runtime's checks need no ai-sdk import of their own.
import { MockLanguageModelV4 } from "ai/test"
import type { Model } from "./call.ts"

export type FakeCall = Parameters<MockLanguageModelV4["doGenerate"]>[0]
export type FakeMessage = FakeCall["prompt"][number]

export const fakeText = (m: FakeMessage): string =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")

/** `reply` sees the provider-side request: `prompt` (messages), `responseFormat.name` (the `name` passed to `object`). */
export const fake = (reply: (o: FakeCall) => { text: string; cut?: boolean }): Model => ({
  format: "openai-compatible",
  model: new MockLanguageModelV4({
    doGenerate: async (o) => {
      const r = reply(o)
      return {
        content: [{ type: "text", text: r.text }],
        finishReason: { unified: r.cut ? "length" : "stop", raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }
    },
  }),
})
