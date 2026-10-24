// src/request.ts through its interface: the whole document each stage reads, asserted the way a person reads a preset,
// top to bottom. One frame, one set of facts; the inputs vary, and the six stages differ only in what the module lets
// each one see.
import type { Message } from "@effect-tavern/provider"
import assert from "node:assert/strict"
import type { Msg } from "../src/fragment.ts"
import { request, type Ask, type Common } from "../src/request.ts"

const frame: Msg[] = [
  { role: "system", text: "Write in Chinese." },
  { role: "system", text: "你是新来到小镇的牧师。" },
  { role: "system", text: "用第二人称写玩家。" },
]
const fiction: Msg[] = [{ role: "system", text: "A: swordsman" }]
const reply: Msg = {
  role: "assistant",
  text: "PROSE#1",
  parts: [
    { type: "reasoning", text: "R" },
    { type: "text", text: "PROSE#1" },
  ],
}
const history: Msg[] = [{ role: "user", text: "hello" }, reply]
const open = [
  { id: "li", text: "B is Li." },
  { id: "echo", text: "E2, with a comma" },
]
const thought = "Text between ⦅ and ⦆ is a thought."
const c = (input: Common["input"]): Common => ({ frame, input, thought })

const text = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")
const roles = (ms: Message[]) => ms.map((m) => m.role).join(" ")
const doc = (ms: Message[]) => ms.map(text).join("\n")
const marks = (ms: Message[]) =>
  ms
    .map((m, i) =>
      (m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl !== undefined ? i : -1,
    )
    .filter((i) => i >= 0)

const asks: Record<Ask["stage"], Ask> = {
  lookup: { stage: "lookup", index: ["li", "people@3#0=Li"] },
  decide: {
    stage: "decide",
    ledger: [{ role: "system", text: "Ledger:\nhello → -" }],
    question: "Which action?",
    state: '{"hp":40}',
    menu: ["strike: attack B", "talk: talk"],
    soFar: [],
  },
  direct: { stage: "direct", ledger: [], rules: ["B does not die"], open, events: ["strike:hit"] },
  narrate: {
    stage: "narrate",
    fiction,
    history,
    summarized: false,
    told: ["Li: A's lost friend."],
    outcome: ["strike:hit"],
    current: "Current: scene=place: P",
    must: [open[0]!],
    may: [open[1]!],
    tone: "quiet",
    correction: "Previous draft broke: rule",
  },
  check: { stage: "check", rules: ["B does not die"], open, must: ["li"], prose: "PROSE#2" },
  record: {
    stage: "record",
    known: "Known: N1",
    current: "Current: scene=place: P",
    asks: ["notes: Notes are the record", "options: Four things"],
    questions: ["warmth: how A treated the player [cold: cold | flat: indifferent]"],
    prose: "PROSE#2",
  },
}
const stages = Object.keys(asks) as Ask["stage"][]
const all = (input: Common["input"]) =>
  Object.fromEntries(stages.map((s) => [s, request(c(input), asks[s])])) as Record<Ask["stage"], Message[]>

// ───────── The frame leads every stage; the fiction and the transcript reach only the narrator ─────────
const line = all({ text: "我拔剑。", note: "虚晃一招" })
for (const s of stages)
  assert.deepEqual(
    line[s].slice(0, 3).map(text),
    frame.map((f) => f.text),
    s,
  )
for (const s of stages) {
  assert.equal(/A: swordsman/.test(doc(line[s])), s === "narrate", s)
  assert.equal(/PROSE#1/.test(doc(line[s])), s === "narrate", s)
}

// ───────── Two skeletons ─────────
// The narrator continues a conversation: head, the transcript ending in the last reply, the player's line as the user
// message, then this turn's directives as system lines in a fixed order, the correction last.
assert.equal(
  roles(line.narrate),
  "system system system system user assistant user " + Array(8).fill("system").join(" "),
)
assert.deepEqual(line.narrate.slice(6).map(text), [
  "我拔剑。",
  "Li: A's lost friend.",
  "Outcome: strike:hit",
  "Current: scene=place: P",
  "MUST reveal: B is Li.",
  "MAY reveal: E2, with a comma",
  "Tone: quiet",
  "Player note: 虚晃一招",
  "Previous draft broke: rule",
])
// The structured stages judge one user message under system lines only.
for (const s of stages.filter((s) => s !== "narrate")) {
  const ms = line[s]
  assert.ok(ms.slice(0, -1).every((m) => m.role === "system") && ms.at(-1)!.role === "user", s)
}
assert.deepEqual(line.lookup.slice(3).map(text), ["Index: li, people@3#0=Li", "我拔剑。"])
assert.deepEqual(line.decide.slice(3).map(text), [
  "Ledger:\nhello → -",
  'Which action?\nState: {"hp":40}\nActions: strike: attack B | talk: talk\nSo far: -',
  "我拔剑。",
])
assert.deepEqual(line.direct.slice(3).map(text), [
  "Rule: B does not die",
  "Open: li=B is Li. | echo=E2, with a comma\nEvents: strike:hit",
  "Player note: 虚晃一招",
  "我拔剑。",
])
// check reads the open entries' text, not their ids alone, and the prose is the user message
assert.deepEqual(line.check.slice(3).map(text), [
  "Rule: B does not die",
  "Open: li=B is Li. | echo=E2, with a comma\nMust: li",
  "PROSE#2",
])
// record: facts and questions above, the scene as one user message with the player's line marked as theirs
assert.deepEqual(line.record.slice(3).map(text), [
  "Known: N1\nCurrent: scene=place: P\nnotes: Notes are the record\noptions: Four things",
  "Questions: warmth: how A treated the player [cold: cold | flat: indifferent]",
  "Player's line: 我拔剑。\n\nPROSE#2",
])

// ───────── The input as one unit, with an audience per stage ─────────
// A note beside a line reaches the director and the narrator only (README: note feeds narrator and director).
for (const s of stages) assert.equal(/Player note:/.test(doc(line[s])), s === "direct" || s === "narrate", s)
// A note alone is the user message itself wherever the line is read; record sees the prose alone, no label, no blank.
const note = all({ text: "", note: "继续。" })
for (const s of ["lookup", "decide", "direct"] as const) assert.equal(text(note[s].at(-1)!), "继续。", s)
assert.equal(text(note.narrate[6]!), "继续。")
assert.ok(!/Player note:/.test(doc(note.narrate)))
assert.equal(text(note.record.at(-1)!), "PROSE#2")
// A thought in the line: every stage that reads the line hears what it is; check reads the prose and does not.
const th = all({ text: "⦅wait⦆" })
for (const s of stages) assert.equal(doc(th[s]).includes(thought), s !== "check", s)
for (const s of stages) assert.ok(!doc(line[s]).includes(thought), s) // and none without one
// A record question without readouts has no Questions line; a narrate with nothing to say has no tail.
assert.equal(request(c({ text: "x" }), { ...asks.record, questions: undefined, current: undefined } as Ask).length, 5)
assert.equal(
  roles(
    request(c({ text: "x" }), {
      stage: "narrate",
      fiction,
      history: [],
      summarized: false,
      told: [],
      outcome: [],
      must: [],
      may: [],
    }),
  ),
  "system system system system user",
)

// ───────── Breakpoints and the wire ─────────
// Structured: the frame's last message. Narrate: the head's last (frame + fiction), the summary, the last history message.
for (const s of stages.filter((s) => s !== "narrate")) assert.deepEqual(marks(line[s]), [2], s)
assert.deepEqual(marks(line.narrate), [3, 5])
const summarized = request(c({ text: "x" }), {
  ...asks.narrate,
  history: [{ role: "system", text: "Summary: N1" }, ...history],
  summarized: true,
} as Ask)
assert.deepEqual(marks(summarized), [3, 4, 6])
assert.equal(text(summarized[4]!), "Summary: N1")
// The connection's TTL rides on the head's breakpoint only; past parts go back only when the connection takes them.
const wired = request(c({ text: "x" }), asks.narrate, { ttl: "1h", reasoningBack: true })
const cc = (m: Message) => (m.providerOptions!.anthropic as { cacheControl: { ttl?: string } }).cacheControl
assert.deepEqual([cc(wired[3]!).ttl, cc(wired[5]!).ttl], ["1h", undefined])
assert.deepEqual(wired[5]!.content, reply.parts)
assert.equal(line.narrate[5]!.content, "PROSE#1")

console.log("request ok")
