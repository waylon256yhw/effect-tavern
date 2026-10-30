// The pipeline projection: only the calls that ran, the second-draft loop and a stop read off the order, the drafts
// folded into trays, a request split into regions at its cache breakpoints, one turn's totals.
import assert from "node:assert/strict"
import { count, defaultTab, groups, isTray, regionHits, regions, rows, totals, type Call } from "../src/inspect.ts"

const usage = { input: 100, output: 10, cacheRead: 50, cacheWrite: 0 }
const call = (phase: Call["phase"], ms = 1): Call => ({ kind: "call", phase, msgs: [], out: {}, usage, ms })
const shape = (rs: ReturnType<typeof rows>) =>
  rs.map((r) => [r.phase, r.status, r.draft].filter((x) => x !== undefined))

// a chat card's turn: narrate and record only, two rows; the other stages are not drawn
const chat = [call("narrate"), call("record")]
assert.deepEqual(shape(rows(chat, { end: "end" })), [
  ["narrate", "ok"],
  ["record", "ok"],
])
// the correction rewrite: check fails into a second narrate, both drafts numbered, each draft one tray
const rewrite = rows(
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
)
assert.deepEqual(shape(rewrite), [
  ["lookup", "ok"],
  ["decide", "ok"],
  ["direct", "ok"],
  ["narrate", "ok", 1],
  ["check", "failed", 1],
  ["narrate", "ok", 2],
  ["check", "ok", 2],
  ["record", "ok"],
])
assert.deepEqual(
  groups(rewrite).map((g) => (isTray(g) ? [g.draft, g.rows.map((r) => r.phase), g.failed] : g.phase)),
  ["lookup", "decide", "direct", [1, ["narrate", "check"], true], [2, ["narrate", "check"], false], "record"],
)
// a stop mid-prose: the narrate is where the player halted, check never ran, record did; one draft, no tray
const stopped = rows([call("lookup"), call("narrate"), call("record")], { end: "stopped" })
assert.deepEqual(shape(stopped), [
  ["lookup", "ok"],
  ["narrate", "stopped"],
  ["record", "ok"],
])
assert.ok(groups(stopped).every((g) => !isTray(g)))

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
  ]).map((r) => [r.name, r.msgs.length, r.chars, r.breakpoint]),
  [
    ["Head", 2, 12, true],
    ["Summary", 1, 7, true],
    ["History", 2, 3, true],
    ["Input", 2, 9, false],
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

// search: hits per region (literal, case-insensitive), the well opens on the first region with hits
const searched = regions([sys("Frame a.b", true), usr("t1"), sys("l", true), usr("A.B go a.b")])
assert.deepEqual(regionHits(searched, "a.b"), [1, 0, 2])
assert.deepEqual(regionHits(searched, ""), [0, 0, 0])
assert.equal(count("axb", "a.b"), 0)
assert.equal(defaultTab([0, 3, 1], "q"), 1)
assert.equal(defaultTab([0, 0, 0], "q"), 2) // only the answer hits: the last region
assert.equal(defaultTab([0, 3, 1], ""), 2) // no query: the last region
assert.equal(defaultTab([], ""), 0)

assert.deepEqual(totals([call("narrate", 5), call("record", 2)]), {
  calls: 2,
  input: 200,
  output: 20,
  cacheRead: 100,
  cacheWrite: 0,
  ms: 7,
})
console.log("ok")
