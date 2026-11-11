// src/request.ts through its interface: the whole document each stage reads, asserted the way a person reads a preset,
// top to bottom. One frame, one set of facts; the inputs vary, and the seven stages differ only in what the module lets
// each one see.
import { wire } from "@effect-tavern/provider/src/call.ts"
import type { FakeCall, Message } from "@effect-tavern/provider"
import assert from "node:assert/strict"
import type { Hat, Msg } from "../src/fragment.ts"
import { request, type Ask, type Common } from "../src/request.ts"
import { readStage } from "../support/script.ts"

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
const role = "Off-stage pass; never reply in character."
// what a stage other than narrate reads of the frame: who and where, no line on how to write (layer.ts `worldOf`)
const world = frame.slice(0, 2)
const worldBlock = `<world>\n${world.map((f) => f.text).join("\n\n")}\n</world>`
const offHead = [role, worldBlock]
const c = (input: Common["input"]): Common => ({ frame, world, role, input, thought })

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
  lookup: { stage: "lookup", ledger: [], question: "Which entries?", context: ["Resident: Li's friend."] },
  decide: {
    stage: "decide",
    ledger: [{ role: "system", text: "Ledger:\nhello → -" }],
    question: "Which action?",
    state: '{"hp":40}',
    menu: ["strike: attack B", "talk: talk"],
    soFar: [],
  },
  direct: { stage: "direct", question: "Brief?", ledger: [], rules: ["B does not die"], open, events: ["strike:hit"] },
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
  check: { stage: "check", question: "Check draft.", rules: ["B does not die"], open, must: ["li"], prose: "PROSE#2" },
  polish: {
    stage: "polish",
    question: "Rewrite each target.",
    hints: ["hit-1: stock image"],
    prose: 'A. <target id="hit-1" hits="指节发白">指节发白。</target>B.',
  },
  record: {
    stage: "record",
    tools: "Use the native tools.",
    known: "Known: N1",
    current: "Current: scene=place: P",
    asks: ["notes: Notes are the record", "options: Four things"],
    readout: "Answer from what settled.",
    questions: ["warmth: how A treated the player [cold: cold | flat: indifferent]"],
    prose: "PROSE#2",
  },
}
const stages = Object.keys(asks) as Ask["stage"][]
const all = (input: Common["input"]) =>
  Object.fromEntries(stages.map((s) => [s, request(c(input), asks[s])])) as Record<Ask["stage"], Message[]>

// Chip-only requests retain a user boundary after the history and at the end of structured stages.
for (const stage of ["lookup", "decide", "direct"] as const) {
  const ms = request(c({ text: "", invoke: ["p/manual"] }), asks[stage])
  assert.ok(ms.slice(0, -1).every((m) => m.role === "system"))
  assert.equal(ms.at(-1)!.role, "user")
  assert.ok(text(ms.at(-1)!).trim())
  for (const format of ["anthropic", "gemini"] as const)
    assert.ok(wire(format, ms, false).some((m) => m.role === "user"))
}
// No remaining entry body, directives or products after an unmount: history must not become a prefill.
const bare = request(c({ text: "", invoke: ["p/manual"] }), {
  stage: "narrate",
  fiction,
  history,
  summarized: false,
  told: [],
  outcome: [],
  must: [],
  may: [],
})
assert.deepEqual(
  bare.slice(-2).map((m) => m.role),
  ["assistant", "user"],
)
assert.ok(text(bare.at(-1)!).trim())
for (const format of ["anthropic", "gemini"] as const) assert.doesNotThrow(() => wire(format, bare, false))

// ───────── The frame leads narrate; stage.role + <world> lead every off-stage pass (#167) ─────────
const line = all({ text: "我拔剑。", note: "虚晃一招" })
// narrate reads the whole frame; every other stage opens with stage.role + <world> (never a naked "你是……" command and
// never a line on how to write), while fiction and transcript reach narrate alone.
assert.deepEqual(
  line.narrate.slice(0, frame.length).map(text),
  frame.map((f) => f.text),
)
for (const s of stages.filter((s) => s !== "narrate")) {
  assert.deepEqual(line[s].slice(0, offHead.length).map(text), offHead, s)
  assert.ok(!doc(line[s]).includes("用第二人称写玩家"), s)
}
assert.ok(!doc(line.narrate).includes(role) && !doc(line.narrate).includes("<world>"))
for (const s of stages) {
  assert.equal(/A: swordsman/.test(doc(line[s])), s === "narrate", s)
  assert.equal(/PROSE#1/.test(doc(line[s])), s === "narrate", s)
}
// Empty world (banxing, yandao): stage.role alone carries the head breakpoint; no empty <world> wrapper is emitted.
for (const s of stages.filter((s) => s !== "narrate")) {
  const emptyWorld = request({ ...c({ text: "x" }), world: [] }, asks[s])
  assert.equal(text(emptyWorld[0]!), role, s)
  assert.ok(!doc(emptyWorld).includes("<world>"), s)
  assert.deepEqual(marks(emptyWorld), [0], s)
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
// Off-stage passes judge one user message under system lines only: tagged material first, task instruction at the very end.
for (const s of stages.filter((s) => s !== "narrate")) {
  const ms = line[s]
  assert.ok(ms.slice(0, -1).every((m) => m.role === "system") && ms.at(-1)!.role === "user", s)
}
assert.deepEqual(line.lookup.slice(offHead.length).map(text), [
  "Resident: Li's friend.",
  "Player note: 虚晃一招",
  "<input>\n我拔剑。\n</input>\n\nWhich entries?",
])
assert.deepEqual(line.decide.slice(offHead.length).map(text), [
  "Ledger:\nhello → -",
  'State: {"hp":40}\nActions: strike: attack B | talk: talk\nSo far: -',
  "<input>\n我拔剑。\n</input>\n\nWhich action?",
])
assert.deepEqual(line.direct.slice(offHead.length).map(text), [
  "Rule: B does not die",
  "Open: li=B is Li. | echo=E2, with a comma\nEvents: strike:hit",
  "Player note: 虚晃一招",
  "<input>\n我拔剑。\n</input>\n\nBrief?",
])
// check reads the open entries' text above, then <draft> + check instruction in the user message
assert.deepEqual(line.check.slice(offHead.length).map(text), [
  "Rule: B does not die",
  "Open: li=B is Li. | echo=E2, with a comma\nMust: li",
  "<draft>\nPROSE#2\n</draft>\n\nCheck draft.",
])
// a guard-only turn (nothing open): the rules alone above <draft>, no empty Open / Must labels
assert.deepEqual(
  request(c({ text: "我拔剑。" }), { ...(asks.check as Extract<Ask, { stage: "check" }>), open: [], must: [] })
    .slice(offHead.length)
    .map(text),
  ["Rule: B does not die", "<draft>\nPROSE#2\n</draft>\n\nCheck draft."],
)
// polish: per-target hints above (omitted when empty), marked <draft> + rewrite instruction as the user message
assert.deepEqual(line.polish.slice(offHead.length).map(text), [
  "hit-1: stock image",
  '<draft>\nA. <target id="hit-1" hits="指节发白">指节发白。</target>B.\n</draft>\n\nRewrite each target.',
])
assert.deepEqual(
  request(c({ text: "x" }), { ...(asks.polish as Extract<Ask, { stage: "polish" }>), hints: [] })
    .slice(offHead.length)
    .map(text),
  ['<draft>\nA. <target id="hit-1" hits="指节发白">指节发白。</target>B.\n</draft>\n\nRewrite each target.'],
)
// record: Known/Current above, <scene> followed by product asks, tools instruction, and readout Questions at the tail
assert.deepEqual(line.record.slice(offHead.length).map(text), [
  "Known: N1\nCurrent: scene=place: P",
  "<scene>\nPlayer's line: 我拔剑。\n\nPROSE#2\n</scene>\n\nnotes: Notes are the record\noptions: Four things\nUse the native tools.\n\nAnswer from what settled.\nQuestions: warmth: how A treated the player [cold: cold | flat: indifferent]",
])

// ───────── The input as one unit, with an audience per stage ─────────
// A note beside a line reaches lookup, the director and the narrator only (README: note feeds narrator and director).
for (const s of stages)
  assert.equal(/Player note:/.test(doc(line[s])), s === "lookup" || s === "direct" || s === "narrate", s)
// A note alone becomes <input>'s body wherever the line is read; record's <scene> holds the prose alone, no label, no blank.
const note = all({ text: "", note: "继续。" })
for (const s of ["lookup", "decide", "direct"] as const)
  assert.match(text(note[s].at(-1)!), /^<input>\n继续。\n<\/input>\n\n/, s)
assert.equal(text(note.narrate[6]!), "继续。")
assert.ok(!/Player note:/.test(doc(note.narrate)))
assert.match(text(note.record.at(-1)!), /^<scene>\nPROSE#2\n<\/scene>\n\n/)
// A thought in the line: every stage that reads the line hears what it is; check and polish read <draft> and do not.
const th = all({ text: "⦅wait⦆" })
for (const s of stages) assert.equal(doc(th[s]).includes(thought), s !== "check" && s !== "polish", s)
for (const s of stages) assert.ok(!doc(line[s]).includes(thought), s) // and none without one
// A record question without readouts has no Questions line; a narrate with nothing to say has no tail.
const quietRecord = request(c({ text: "x" }), { ...asks.record, questions: undefined, current: undefined } as Ask)
assert.equal(quietRecord.length, offHead.length + 2)
assert.ok(!doc(quietRecord).includes("Questions:"))
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
// Structured: the off-stage head's last message. Narrate: the head's last (frame + fiction), the summary, the last history message.
for (const s of stages.filter((s) => s !== "narrate")) assert.deepEqual(marks(line[s]), [offHead.length - 1], s)
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

// ───────── The connection's hat and the player's tail ─────────
const drawn = { text: "我拔剑。", note: "虚晃一招" }
// No hat, an empty one, no tail: today's document byte for byte (narrate's prefix cache untouched).
for (const s of stages)
  assert.deepEqual(
    request({ ...c(drawn), tail: [] }, asks[s], { hat: { id: "bare", name: "bare" }, ttl: "1h" }),
    request(c(drawn), asks[s], { ttl: "1h" }),
    s,
  )
const hat: Hat = {
  id: "h",
  name: "continuation",
  narrate: {
    head: [
      { role: "user", text: "HS-U" },
      { role: "system", text: "HAT-SYS" },
      { role: "assistant", text: "HS-A" },
    ],
    tail: [
      { role: "assistant", text: "TAIL-A" },
      { role: "user", text: "TAIL-U" },
    ],
  },
  review: { head: [{ role: "system", text: "REVIEW" }] },
}
const worn = (s: Ask["stage"]) =>
  request({ ...c(drawn), tail: [{ role: "system", text: "PLAYER-TAIL" }] }, asks[s], { hat })
// narrate: frame, fiction, the hat's system, its handshake, history, the line, directives, the player's tail, the hat's tail
const n = worn("narrate")
assert.deepEqual(n.map(text), [
  ...frame.map((f) => f.text),
  "A: swordsman",
  "HAT-SYS",
  "HS-U",
  "HS-A",
  "hello",
  "PROSE#1",
  ...line.narrate.slice(6).map(text),
  "PLAYER-TAIL",
  "TAIL-A",
  "TAIL-U",
])
assert.deepEqual(marks(n), [6, 8]) // the head's breakpoint on the last head message: the handshake is in the prefix
// check, polish, record wear review.head after <world>, the breakpoint on it, nothing of narrate's hat
for (const s of ["check", "polish", "record"] as const) {
  assert.equal(text(worn(s)[offHead.length]!), "REVIEW", s)
  assert.deepEqual(marks(worn(s)), [offHead.length], s)
}
for (const s of stages) assert.equal(/HAT-SYS|HS-|TAIL-/.test(doc(worn(s))), s === "narrate", s)
// lookup, decide, direct wear nothing, and no stage but narrate reads a tail fragment
for (const s of ["lookup", "decide", "direct"] as const) assert.deepEqual(worn(s), line[s], s)
for (const s of ["check", "polish", "record"] as const) assert.ok(!doc(worn(s)).includes("PLAYER-TAIL"), s)
// a hat's empty message (a row left blank in the settings editor) never reaches the document, in any slot or stage
const blank = { role: "system", text: "  " } as const
const padded: Hat = {
  ...hat,
  narrate: {
    head: [blank, ...hat.narrate!.head!, blank],
    tail: [{ ...blank, role: "assistant" }, ...hat.narrate!.tail!],
  },
  review: { head: [blank, ...hat.review!.head!] },
}
for (const s of stages)
  assert.deepEqual(
    request({ ...c(drawn), tail: [{ role: "system", text: "PLAYER-TAIL" }] }, asks[s], { hat: padded }),
    worn(s),
    s,
  )

// ───────── The scripted narrator reads what this module writes ─────────
// support/script.ts parses the data lines back for every scripted model; a change to a line above fails here first.
const read = (s: Ask["stage"], ms: Message[] = line[s]) =>
  readStage({ prompt: ms, responseFormat: s === "narrate" ? undefined : { type: "json", name: s } } as FakeCall)
assert.equal(read("narrate").phase, "narrate")
assert.equal(read("record").phase, "record")
assert.equal(read("lookup").phase, "lookup")
for (const s of ["lookup", "decide", "direct"] as const) assert.equal(read(s).subject, "我拔剑。", s)
assert.equal(read("check").subject, "PROSE#2")
assert.equal(read("record").subject, "Player's line: 我拔剑。\n\nPROSE#2")
assert.deepEqual(read("decide").soFar, [])
assert.deepEqual(
  read("decide", request(c({ text: "x" }), { ...asks.decide, soFar: ["strike:hit", "strike:miss"] } as Ask)).soFar,
  ["strike:hit", "strike:miss"],
)
for (const s of ["direct", "check"] as const) {
  assert.deepEqual(read(s).open, ["li", "echo"], s)
  assert.deepEqual(read(s).rules, ["B does not die"], s)
}
assert.deepEqual(read("record").known, ["N1"])
assert.deepEqual(read("record").asked, ["notes", "options"])
assert.deepEqual(read("record").questions, [{ id: "warmth", options: ["cold", "flat"] }])
assert.deepEqual(read("polish").targets, [["hit-1", "指节发白。"]])

console.log("request ok")
