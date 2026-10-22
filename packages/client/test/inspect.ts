// The trace projection: calls laid on the six stages with the skeleton filled in, the second-draft loop and a stop
// read off the order, a request split into regions at its cache breakpoints, totals summed over every node.
import assert from "node:assert/strict"
import { regions, rows, totals, type Call } from "../src/inspect.ts"

const usage = { input: 100, output: 10, cacheRead: 50, cacheWrite: 0 }
const call = (phase: Call["phase"], ms = 1): Call => ({ kind: "call", phase, msgs: [], out: {}, usage, ms })
const shape = (rs: ReturnType<typeof rows>) =>
  rs.map((r) => [r.phase, r.status, r.draft].filter((x) => x !== undefined))

// a chat card's turn: narrate and record only; the four other stages are dashed in pipeline order
assert.deepEqual(shape(rows([call("narrate"), call("record")], { end: "end" })), [
  ["lookup", "skipped"],
  ["decide", "skipped"],
  ["direct", "skipped"],
  ["narrate", "ok"],
  ["check", "skipped"],
  ["record", "ok"],
])
// the correction rewrite: check fails into a second narrate, both drafts numbered
assert.deepEqual(
  shape(
    rows(
      [
        call("lookup"),
        call("decide"),
        call("direct"),
        call("narrate"),
        call("check"),
        call("narrate"),
        call("check"),
        call("record"),
      ],
      { end: "end" },
    ),
  ),
  [
    ["lookup", "ok"],
    ["decide", "ok"],
    ["direct", "ok"],
    ["narrate", "ok", 1],
    ["check", "failed", 1],
    ["narrate", "ok", 2],
    ["check", "ok", 2],
    ["record", "ok"],
  ],
)
// a stop mid-prose: the narrate is where the player halted, check never ran, record did
assert.deepEqual(shape(rows([call("lookup"), call("narrate"), call("record")], { end: "stopped" })), [
  ["lookup", "ok"],
  ["decide", "skipped"],
  ["direct", "skipped"],
  ["narrate", "stopped"],
  ["check", "skipped"],
  ["record", "ok"],
])

const bp = { anthropic: { cacheControl: { type: "ephemeral" } } }
const sys = (content: string, mark = false) =>
  ({ role: "system", content, ...(mark && { providerOptions: bp }) }) as Call["msgs"][number]
const usr = (content: string) => ({ role: "user", content }) as Call["msgs"][number]
// a narrate request: head to its breakpoint, the fold, history to its breakpoint, the input and its directives
assert.deepEqual(
  regions([
    sys("frame"),
    sys("fiction", true),
    sys("summary", true),
    usr("t1"),
    sys("l", true),
    usr("go"),
    sys("Tone: x"),
  ]).map((r) => [r.name, r.msgs.length, r.chars]),
  [
    ["Head", 2, 12],
    ["Summary", 1, 7],
    ["History", 2, 3],
    ["Input", 2, 9],
  ],
)
// a decide request: head, then the ledger and the input unmarked
assert.deepEqual(
  regions([sys("frame", true), usr("go")]).map((r) => r.name),
  ["Head", "Input"],
)
// check and record: no breakpoints, all input
assert.deepEqual(
  regions([sys("Rule: x"), usr("prose")]).map((r) => r.name),
  ["Input"],
)
// parts content counts its text
assert.equal(
  regions([{ role: "assistant", content: [{ type: "text", text: "abc" }] } as Call["msgs"][number]])[0]!.chars,
  3,
)

assert.deepEqual(totals([[call("narrate", 5), call("record", 2)], [call("narrate", 3)]]), {
  requests: 3,
  input: 300,
  output: 30,
  cacheRead: 150,
  cacheWrite: 0,
  ms: 10,
})
console.log("ok")
