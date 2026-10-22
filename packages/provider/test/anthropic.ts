// Live check against the real Anthropic API: the things no mock can verify (cache tiers, prefill, signed reasoning).
// Key: ANTHROPIC_API_KEY, else the "api_key" profile pointed at api.anthropic.com in ~/.deckled. Skips without one.
// Proxy: https_proxy, passed as the connection's explicit `proxy`, so the per-request path is what runs, not Bun's env fallback.
// Runs on Haiku with tiny outputs; well under a cent per pass.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Effect, Schema, Stream } from "effect"
import { breakpoint, object, stream, text, type Message, type Model } from "../src/call.ts"
import { capabilities, compile, listModels, type Connection, type Trace } from "../src/connection.ts"

const deckledKey = (): string | undefined => {
  try {
    const dir = join(homedir(), ".deckled")
    const profiles = JSON.parse(readFileSync(join(dir, "providers.json"), "utf8")) as Record<
      string,
      { format?: string; endpoint?: { url?: string } }
    >
    const creds = JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8")) as Record<
      string,
      { type?: string; key?: string }
    >
    const id = Object.keys(profiles).find(
      (k) =>
        profiles[k]?.format === "anthropic-messages" &&
        profiles[k]?.endpoint?.url?.startsWith("https://api.anthropic.com") &&
        creds[k]?.type === "api_key",
    )
    return id ? creds[id]?.key : undefined
  } catch {
    return undefined
  }
}
const key = process.env["ANTHROPIC_API_KEY"] ?? deckledKey()
if (!key) {
  console.log("anthropic skipped (no key)")
  process.exit(0)
}

const conn: Connection = {
  id: "anthropic-live",
  format: "anthropic",
  endpoint: { url: "https://api.anthropic.com", resolution: "format-default" },
  credential: { type: "api_key", key },
  model: "claude-haiku-5-5",
  // Explicit per-connection proxy, read from the shell only here. Without it Node sends direct and Anthropic answers 403.
  proxy: process.env["https_proxy"] ?? process.env["HTTPS_PROXY"],
}
const traces: Trace[] = []
const m: Model = { format: "anthropic", model: compile(conn, { onTrace: (t) => traces.push(t), traceBody: true }) }
const body = (t: Trace) => JSON.parse(t.body!) as any
const user = (t: string): Message => ({ role: "user", content: t })

const program = Effect.gen(function* () {
  // 1. model listing goes through the format's auth headers, not the SDK
  const models = yield* Effect.promise(() => listModels(conn))
  assert.ok(models.includes(conn.model), `listed: ${models.join(",")}`)
  assert.deepEqual(capabilities(conn), { prefill: false, structured: "schema", reasoningBack: false })

  // 2. structured stage: a forced shape, decoded through Effect Schema
  const Decide = Schema.Struct({ next: Schema.Literals(["strike", "end"]), p: Schema.Number })
  const d = yield* object(m, Decide, [user("Pick next=strike with p=0.5. Only the object.")], {
    effort: "off",
    maxOutputTokens: 200,
  })
  assert.equal(d.value.next, "strike")
  assert.equal(typeof d.value.p, "number")
  assert.ok(d.usage.output > 0)

  // 3. prefill: the capability default says no, and the API agrees (400). This is the fact README §4 left unverified.
  const pre = yield* text(m, [user("Finish this sentence."), { role: "assistant", content: "The quick brown fox" }], {
    effort: "off",
    maxOutputTokens: 30,
  }).pipe(Effect.flip)
  assert.match(pre.message, /prefill/)
  assert.equal(body(traces.at(-1)!).messages.at(-1).role, "assistant") // the request did carry the prefix

  // 4. cache: a breakpoint on the head; first call writes, identical second call reads
  const nonce = `Session ${Date.now()}.`
  const filler = Array.from({ length: 400 }, (_, i) => `Rule ${i + 1}: item ${i + 1} stays in order.`).join(" ")
  const head = breakpoint({ role: "system", content: `${nonce} Follow these rules. ${filler}` } as Message)
  const once = () => text(m, [head, user("Reply with the word ok.")], { effort: "off", maxOutputTokens: 5 })
  const a = yield* once()
  const b = yield* once()
  assert.deepEqual(body(traces.at(-1)!).system.at(-1).cache_control, { type: "ephemeral" })
  assert.ok(a.usage.cacheWrite > 0, `first: ${JSON.stringify(a.usage)}`)
  assert.ok(b.usage.cacheRead > 0, `second: ${JSON.stringify(b.usage)}`)

  // 5. reasoning round trip: turn 1 thinks, turn 2 sends the signed thinking back and is accepted
  const q1 = user("Is 1234567 prime? Think it through, then answer yes or no.")
  const r1 = yield* text(m, [q1], { effort: "low", maxOutputTokens: 2000 })
  assert.ok(
    r1.parts.some((p) => p.type === "reasoning"),
    `turn 1 parts: ${r1.parts.map((p) => p.type).join(",")}`,
  )
  const r2 = yield* text(m, [q1, { role: "assistant", content: r1.parts }, user("And 1234569? Think it through.")], {
    effort: "low",
    maxOutputTokens: 2000,
  })
  assert.equal(traces.at(-1)!.status, 200)
  const replayed = body(traces.at(-1)!).messages[1].content.find(
    (c: any) => c.type === "thinking" || c.type === "redacted_thinking",
  )
  assert.ok(replayed, "turn 2 request carries the thinking block")
  assert.ok(r2.text.length > 0)

  // 6. stream: deltas arrive, the finish part carries usage, interruption aborts
  const arr = yield* stream(m, [user("Count from one to five in words.")], { effort: "off", maxOutputTokens: 40 }).pipe(
    Stream.runCollect,
  )
  assert.ok(arr.filter((p) => p.type === "text-delta").length > 1)
  const fin = arr.find((p) => p.type === "finish")
  assert.ok(fin && fin.type === "finish" && (fin.totalUsage.outputTokens ?? 0) > 0)
  const cut = yield* stream(m, [user("Write three paragraphs about rivers.")], {
    effort: "off",
    maxOutputTokens: 400,
  }).pipe(Stream.take(2), Stream.runCollect)
  assert.equal(cut.length, 2)

  console.log(`anthropic ok (${traces.length} requests, all ${[...new Set(traces.map((t) => t.status))].join("/")})`)
})

await Effect.runPromise(program.pipe(Effect.scoped))
