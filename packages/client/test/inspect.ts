import { nativeTrace } from "../src/inspect.ts"
// The pipeline projection: only the calls that ran, the second-draft loop and a stop read off the order, the drafts
// folded into trays, a request split into regions at its cache breakpoints, one turn's totals.
import assert from "node:assert/strict"
import {
  cached,
  count,
  defaultView,
  digest,
  firstSentence,
  groups,
  isTray,
  ordinals,
  pieces,
  precheck,
  regions,
  rowHits,
  rows,
  settledAt,
  stepOps,
  totals,
  type Call,
  type Facts,
} from "../src/inspect.ts"

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
// a narrate after record is a demanded block (a narrate-stage product), not a second draft: no tray, and the stop
// stays on the prose's narrate
const demanded = rows([call("narrate"), call("check"), call("record"), call("narrate")], { end: "stopped" })
assert.deepEqual(shape(demanded), [
  ["narrate", "stopped"],
  ["check", "ok"],
  ["record", "ok"],
  ["narrate", "ok"],
])
assert.equal(settledAt(demanded), 2)
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

// search: literal, case-insensitive
assert.equal(count("axb", "a.b"), 0)
// a row's hits: its request and its prose answer (an object answer is not searched); none for an empty query
const [hit] = rows([{ ...call("narrate"), msgs: [usr("a.b"), sys("A.B")], out: "and a.b" }], { end: "end" })
assert.equal(rowHits(hit!, "a.b"), 3)
assert.equal(rowHits(hit!, ""), 0)
assert.equal(rowHits(rows([call("record")], { end: "end" })[0]!, "a.b"), 0)
// the opened row lands on the request when the query hits there, else on the result (the prose's marks)
assert.equal(defaultView(hit!, "a.b"), "prompt")
assert.equal(defaultView(hit!, "and"), "result")
assert.equal(defaultView(hit!, ""), "result")

assert.deepEqual(totals([call("narrate", 5), call("record", 2)]), {
  calls: 2,
  input: 200,
  output: 20,
  cacheRead: 100,
  cacheWrite: 0,
  ms: 7,
})

const tool = {
  toolCallId: "t1",
  name: "read_context",
  input: { resourceId: "pack:p/guide" },
  result: { ok: false, code: "stale", message: "refresh" },
  replayed: false,
  ms: 1,
}
const cancelled = nativeTrace({
  status: "cancelled",
  budget: { maxSteps: 3 },
  events: [
    { kind: "request", step: 0, messages: [] },
    { kind: "tool", step: 0, call: tool },
  ],
})!
assert.equal(cancelled.status, "cancelled")
assert.equal(cancelled.steps[0]!.calls[0]!.toolCallId, "t1")
assert.equal(cancelled.budget!.maxSteps, 3)
assert.equal(nativeTrace("text"), undefined)
assert.deepEqual(nativeTrace({ status: "completed", trace: [] })!.steps, [])

// ───────── heads ─────────
const facts: Facts = {
  beats: [{ next: "talk" }, { next: "steal", chance: 0.65 }],
  checks: [{ action: "steal", chance: 0.65, roll: 0.32, hit: true }],
  must: ["a", "b"],
  label: (id) => ({ mood: "心情" })[id] ?? id,
}
const row = (c: Partial<Call>, end: "end" | "stopped" = "end") =>
  rows([{ ...call(c.phase ?? "narrate"), ...c }], { end })[0]!
// the ordinal only when a stage ran twice; the pre-check counts apart from the LLM check
assert.deepEqual(
  ordinals(
    rows([call("lookup"), call("narrate"), { ...call("check"), via: "decision" }, call("check"), call("narrate")], {
      end: "end",
    }),
  ),
  [undefined, 1, undefined, undefined, 2],
)
assert.equal(cached([call("narrate")]), true)
assert.equal(cached([{ ...call("narrate"), usage: { ...usage, cacheRead: 0 } }]), false)
// the first sentence: cut at the first stop (its closing quote kept) or newline, no character cap
assert.equal(firstSentence("  他说：“走吧。”她没动。"), "他说：“走吧。”")
assert.equal(firstSentence("Go! Now."), "Go!")
assert.equal(firstSentence("一行没有句号\n第二行"), "一行没有句号")
assert.equal(firstSentence("x".repeat(300)), "x".repeat(300))
// decide: the judged beat's action, toned by the roll, the roll / chance in grey; an unjudged beat its action alone
assert.deepEqual(digest(row({ phase: "decide" }), 1, facts), {
  pills: [{ text: "steal", tone: "ok" }],
  note: "0.32 / 65%",
})
assert.deepEqual(digest(row({ phase: "decide" }), 0, facts), { pills: [{ text: "talk" }] })
// direct: must, then may lighter; nothing when the brief is empty
assert.deepEqual(digest(row({ phase: "direct", out: { must: ["a"], may: ["c"], tone: "x" } }), 0, facts).pills, [
  { text: "a" },
  { text: "c", tone: "soft" },
])
assert.deepEqual(digest(row({ phase: "direct", out: {} }), 0, facts).pills, [])
// narrate: the first sentence; a stopped prose one amber pill
assert.deepEqual(digest(row({ phase: "narrate", out: "门开了。风进来。" }, "stopped"), 0, facts), {
  pills: [{ word: "stopped", tone: "warn" }],
  line: "门开了。",
})
assert.deepEqual(pieces("门开了。\n风进来。\n<<aside>> inner\n他想。"), [
  { text: "门开了。\n风进来。" },
  { id: "inner", text: "他想。" },
])
assert.equal(digest(row({ phase: "narrate", out: "<<aside>> inner\n他想。走。" }), 0, facts).line, "他想。")
// check: nothing on pass, red pills for the missed must and broken rules
assert.deepEqual(digest(row({ phase: "check", out: { fired: ["a", "b"], violated: [] } }), 0, facts).pills, [])
assert.deepEqual(digest(row({ phase: "check", out: { fired: ["a"], violated: ["no magic"] } }), 0, facts).pills, [
  { text: "b", tone: "bad" },
  { text: "no magic", tone: "bad" },
])
// the pre-check: its pill, and the hand-over only on escalate
const pre = (out: unknown) => digest(row({ phase: "check", via: "decision", out }), 0, facts).pills
assert.deepEqual(pre({ p: { rules: {}, open: {} }, verdict: "pass" }), [{ word: "precheck" }])
assert.deepEqual(pre({ verdict: "escalate", error: "blocked:x" }), [
  { word: "precheck", tone: "bad", hint: "blocked:x" },
  { word: "escalate" },
])
assert.deepEqual(precheck({ p: { rules: { "no magic": 0.1 }, open: { a: null } }, verdict: "escalate" }), {
  lines: [
    { label: "no magic", p: 0.1 },
    { label: "a", p: null },
  ],
  escalate: true,
})
// polish: the sentences that came back changed
const polished = row({
  phase: "polish",
  msgs: [usr('<target id="hit-1">甲。</target><target id="hit-2">乙。</target>')],
  out: { "hit-1": "甲！", "hit-2": "乙。" },
})
assert.deepEqual(digest(polished, 0, facts).pills, [{ word: "sentences", n: 1 }])
// the tool stages: lookup's titles read, record's products written by their shown names, an abnormal status first
const step = (calls: unknown[], i = 0) => ({ index: i, messages: [], calls, ms: 900 })
const searched = {
  toolCallId: "s",
  name: "search_context",
  input: { query: "竹林 剑", scope: "all" },
  result: { ok: true, value: [{}, {}] },
  replayed: false,
  ms: 0,
}
const read = {
  toolCallId: "r",
  name: "read_context",
  input: { refs: ["x", "y"] },
  result: {
    ok: true,
    value: [
      { resourceId: "x", title: "竹林" },
      { resourceId: "y", resident: true },
    ],
  },
  replayed: false,
  ms: 1,
}
const lookup = row({
  phase: "lookup",
  out: { status: "completed", value: "", trace: [step([searched]), step([read], 1)] },
})
assert.deepEqual(digest(lookup, 0, facts).pills, [{ text: "竹林" }])
assert.deepEqual(stepOps(step([searched, read]) as never, facts.label), [
  { kind: "search", query: "竹林 剑", n: 2 },
  { kind: "read", titles: ["竹林"] },
])
const record = row({
  phase: "record",
  out: {
    status: "completed",
    value: {
      changes: [{ kind: "patch_record", product: "mood", patch: {}, prev: {} }],
      products: { notes: "x", empty: "" },
      answers: {},
    },
    trace: [],
  },
})
assert.deepEqual(digest(record, 0, facts).pills, [{ text: "心情" }, { text: "notes" }])
const ops = [
  { ...searched, name: "patch_mood", toolCallId: "p", result: { ok: true, value: { changed: true } } },
  { ...searched, name: "finish_record", toolCallId: "f", result: { ok: true, value: {} } },
  { ...searched, name: "insert_npc", toolCallId: "i", result: { ok: false, code: "invalid_change", message: "" } },
]
assert.deepEqual(stepOps(step(ops) as never, facts.label), [
  { kind: "op", verb: "patch", target: "心情" },
  { kind: "op", verb: "insert", target: "npc", error: "invalid_change" },
])
assert.deepEqual(digest(row({ phase: "lookup", out: { status: "budget_exhausted", trace: [] } }), 0, facts).pills, [
  { word: "exhausted", tone: "warn" },
])
console.log("ok")
