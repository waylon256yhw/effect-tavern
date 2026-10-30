// A scripted model for self-checks: the same `Model` the session calls, answered by a function of the request.
// Lives here so the runtime's checks need no ai-sdk import of their own.
import { simulateReadableStream } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import type { Model } from "./call.ts"

export type FakeCall = Parameters<MockLanguageModelV4["doGenerate"]>[0]
export type FakeMessage = FakeCall["prompt"][number]

export const fakeText = (m: FakeMessage): string =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}
const finish = (cut: boolean | undefined) => ({ unified: cut ? "length" : "stop", raw: undefined }) as const
/** `reply` sees the provider-side request: `prompt` (messages), `responseFormat.name` (the `name` passed to `object`).
 *  A streamed request gets the same answer in eight-character deltas, `delay` milliseconds apart when set. */
export const fake = (reply: (o: FakeCall) => { text: string; cut?: boolean; delay?: number }): Model => ({
  format: "openai-compatible",
  prefill: false, // as on current Claude; a test that continues a cut prose sets it
  model: new MockLanguageModelV4({
    doGenerate: async (o) => {
      const r = reply(o)
      if (r.delay) await new Promise((f) => setTimeout(f, r.delay)) // a slow answer waits once; the stream waits per chunk
      return { content: [{ type: "text", text: r.text }], finishReason: finish(r.cut), usage, warnings: [] }
    },
    doStream: async (o) => {
      const r = reply(o)
      return {
        stream: simulateReadableStream({
          chunkDelayInMs: r.delay ?? null,
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "0" },
            ...(r.text.match(/[^]{1,8}/g) ?? []).map((delta) => ({ type: "text-delta", id: "0", delta }) as const),
            { type: "text-end", id: "0" },
            { type: "finish", finishReason: finish(r.cut), usage },
          ],
        }),
      }
    },
  }),
})
