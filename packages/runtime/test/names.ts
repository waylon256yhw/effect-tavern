// 代称 (docs/packs-brief.md §八): the pure functions, the value's lock, the merge order, every expansion point on a session
// over a scripted model (an entry with an unfilled hole skipped, its neighbour sent), the refusals, history untouched,
// and what `cardView` tells a client. The two lint rules are in test/lint.ts, the wire in server test/serve.ts.
import { fake, type Message } from "@effect-tavern/provider"
import { Effect, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { decodeCard, type Card } from "../src/card.ts"
import { decodePlayer, Pack, type Player } from "../src/fragment.ts"
import { expand, holes, Names } from "../src/names.ts"
import { cardView, makeSession, type Event } from "../src/session.ts"
import { chat, plain } from "./cards/index.ts"
import { defaultAnswer, readStage } from "./script.ts"

// ───────── The pure functions ─────────
assert.equal(expand("{{char}} 与 {{ user }}，{{char}}", { char: "依瑞丝", user: "阿青" }), "依瑞丝 与 阿青，依瑞丝")
assert.equal(expand("{{char}} {{x}}", { char: "依瑞丝" }), undefined) // one hole without a value: the whole text stays home
assert.equal(expand("no holes", {}), "no holes")
assert.equal(expand("{{constructor}}", {}), undefined) // own keys only
assert.equal(expand("{{a}}", { a: "$& {{b}}", b: "x" }), "$& {{b}}") // one pass, a value is taken literally
assert.deepEqual(holes("{{b}} {{a}} {{ b }} {{setvar::x::1}} {{1x}}"), ["b", "a"])

// ───────── The value's lock, at every layer's boundary ─────────
const names = Schema.decodeUnknownSync(Names)
assert.deepEqual(names({ char: "依瑞丝" }), { char: "依瑞丝" })
for (const bad of ["两\n行", "两\r行", "含 {{x}} 洞", "{{"]) {
  assert.throws(() => names({ char: bad }))
  assert.throws(() => decodePlayer({ global: [], forCard: {}, names: { c: { char: bad } } }))
  assert.throws(() => Schema.decodeUnknownSync(Pack)({ id: "p", name: "P", names: { char: bad } }))
  assert.throws(() => decodeCard({ ...chat, names: { char: bad } }))
}

// ───────── The merge: the harness's user < card < packs in mount order < player < persona's name ─────────
const persona = { name: "阿青", text: "P {{user}}" }
{
  const card: Card = { ...chat, names: { user: "C", char: "C", a: "C", b: "C", c: "C" } }
  const packs: Pack[] = [
    { id: "p", name: "P", names: { a: "P", b: "P", c: "P" } },
    { id: "q", name: "Q", names: { b: "Q", c: "Q" } },
  ]
  const player: Player = { global: [], forCard: {}, names: { [chat.id]: { c: "ME", user: "ME" }, other: { c: "NO" } } }
  assert.equal(cardView(chat, { global: [], forCard: {} }).names.user, "玩家")
  assert.deepEqual(cardView(card, player, packs).names, { user: "ME", char: "C", a: "P", b: "Q", c: "ME" })
  assert.equal(cardView(card, player, packs, persona).names.user, "阿青")
}

// ───────── A session: every point, the unfilled neighbour skipped ─────────
const card: Card = {
  ...chat,
  names: { char: "依瑞丝" },
  greetings: [{ text: "G {{char}}" }],
  frame: [
    { id: "style", text: "FRAME {{char}}" },
    { id: "voice", text: "FRAME-NO {{missing}}" },
  ],
  fiction: [
    { id: "a", text: "FICTION {{char}}" },
    { id: "b", text: "FICTION-NO {{missing}}" },
  ],
  lore: [
    {
      id: "li",
      layers: ["LORE {{char}}.", "DEEP {{char}}."],
      unlock: [{ all: [] }, { all: [] }],
      offer: { any: [] },
    },
    { id: "un", layers: ["UNFILLED {{missing}}."], unlock: { all: [] }, offer: { any: [] } },
    { id: "late", layers: ["LATE.", "LATE-NO {{missing}}."], unlock: { all: [] }, offer: { any: [] } }, // any layer
    { id: "held", layers: ["HELD {{given}}."], unlock: { all: [] }, offer: { any: [] } },
  ],
  products: [
    { id: "kept", text: "ASK {{char}}", shape: { kind: "text" } },
    { id: "skipped", text: "ASK-NO {{missing}}", shape: { kind: "text" } },
    { id: "blk", text: "BLOCK {{char}}", shape: { kind: "text" }, stage: "narrate" },
    { id: "blkno", text: "BLOCK-NO {{missing}}", shape: { kind: "text" }, stage: "narrate" },
  ],
}
const pack: Pack = {
  id: "pk",
  name: "PK",
  names: { place: "贝克兰德" },
  entries: [
    { id: "x", text: "ENTRY {{place}}." },
    { id: "y", text: "ENTRY-NO {{missing}}." },
  ],
  fragments: [{ id: "setting", text: "PACK {{place}}" }],
  theaters: [
    { id: "town", text: "TOWN {{place}}", on: true },
    { id: "gone", text: "TOWN-NO {{missing}}", on: true },
  ],
}
const player: Player = {
  global: [
    { id: "t", text: "TAIL {{char}}", at: "tail" },
    { id: "u", text: "TAIL-NO {{missing}}", at: "tail" },
  ],
  forCard: {},
  packs: { [card.id]: ["pk"] },
  names: { [card.id]: { given: "玩家给的" } },
}
const picks: string[][] = []
const prose = { text: "said {{char}}" }
const scripted = fake((o) => {
  const doc = readStage(o)
  if (doc.phase === "lookup") return { text: JSON.stringify({ read: picks.shift() ?? [] }) }
  if (doc.phase === "narrate") return prose
  const canned = {
    notes: "N",
    kept: "K",
    options: ["A", "B", "C", "D"],
    people: [],
    scene: { place: "P", present: [] },
  }
  return defaultAnswer(doc, canned)
})
const session = () =>
  makeSession({
    card,
    player,
    model: () => ({ ...scripted, hat: "h" }),
    packs: () => [pack],
    persona: () => persona,
    hat: (id) => ({
      id,
      name: id,
      narrate: {
        head: [
          { role: "system", text: "HAT {{char}}" },
          { role: "system", text: "HAT-NO {{missing}}" },
        ],
        tail: [{ role: "system", text: "HATTAIL {{char}}" }],
      },
      review: { head: [{ role: "system", text: "REVIEW {{char}}" }] },
    }),
  })
const collect = (s: Stream.Stream<Event, unknown>) =>
  Effect.runPromise(Stream.runCollect(s)).then((c) => [...c] as Event[])
const texts = (msgs: readonly Message[] | undefined) =>
  (msgs ?? []).map((m) =>
    typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join(""),
  )
const doc = (es: readonly Event[], phase: string) =>
  texts(es.flatMap((e) => (e.kind === "call" && e.phase === phase ? [e.msgs] : [])).at(-1))
const nodeOf = (es: readonly Event[]) => es.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!

const S = session()
// the opening is stored expanded; an unfilled one is refused, by name, and leaves no node
const root = S.greet(card.greetings[0]!).node!
assert.deepEqual(root.turn.reply, [{ type: "text", text: "G 依瑞丝" }])
assert.throws(() => S.greet({ text: "G {{missing}} {{other}}" }), /\{\{missing\}\}, \{\{other\}\}/)
assert.equal(S.log.nodes.size, 1)

picks.push(["li", "pk/x"])
const first = await collect(S.act(root.id, { text: "{{char}} typed" }))
const narrate = doc(first, "narrate")
const has = (d: readonly string[], s: string) => d.some((m) => m.includes(s))
for (const s of [
  "FRAME 依瑞丝",
  "FICTION 依瑞丝",
  "PACK 贝克兰德",
  "P 阿青", // the persona slot, its name in `user`
  "TAIL 依瑞丝",
  "HAT 依瑞丝",
  "HATTAIL 依瑞丝",
  "LORE 依瑞丝.", // layer text, told
  "DEEP 依瑞丝.",
  "ENTRY 贝克兰德.", // a pack's entry
  "blk: BLOCK 依瑞丝", // a narrate block's ask
  "town: TOWN 贝克兰德",
  "G 依瑞丝", // the stored opening, as history
])
  assert.ok(has(narrate, s), s)
// the unfilled ones are gone, none of them dragging its neighbour or leaving a dangling instruction
assert.ok(!narrate.some((m) => /-NO|\{\{missing/.test(m)))
assert.ok(has(narrate, "{{char}} typed")) // the player's line goes as typed

// the index: hooks expanded; an entry unfilled in any layer is not in it, whichever layer
const index = doc(first, "lookup").find((m) => m.includes("Index: "))!
assert.ok(index.includes("li=LORE 依瑞丝."))
assert.ok(index.includes("pk/x=ENTRY 贝克兰德."))
assert.ok(index.includes("held=HELD 玩家给的."))
for (const id of ["un=", "late=", "pk/y="]) assert.ok(!index.includes(id), id)

// the record asks: expanded, the unfilled one not asked and not on the node; review wears its hat expanded
const record = doc(first, "record")
assert.ok(has(record, "kept: ASK 依瑞丝"))
assert.ok(has(record, "REVIEW 依瑞丝"))
assert.ok(!has(record, "skipped:"))
const n1 = nodeOf(first)
assert.equal(n1.turn.products.kept, "K")
assert.equal("skipped" in n1.turn.products, false)
assert.equal(n1.turn.input.text, "{{char}} typed")
assert.deepEqual(
  n1.delivered.map((d) => d.text),
  ["LORE 依瑞丝.", "DEEP 依瑞丝.", "ENTRY 贝克兰德."],
)

// History: the literal holes in a past line and a past reply go back as they are
picks.push(["held"])
const second = await collect(S.act(n1.id, { text: "again" }))
const history = doc(second, "narrate")
assert.ok(has(history, "{{char}} typed"))
assert.ok(has(history, "said {{char}}"))
assert.ok(has(history, "HELD 玩家给的."))
const n2 = nodeOf(second)

// A demand: refused by name when the question has a hole unfilled; asked expanded otherwise
assert.throws(() => S.demand(n2.id, "skipped"), /skipped: unfilled \{\{missing\}\}/)
assert.throws(() => S.demand(n2.id, "gone"), /gone: unfilled \{\{missing\}\}/)
prose.text = "DEMANDED"
const asked = await collect(S.demand(n2.id, "blk"))
assert.ok(has(doc(asked, "narrate"), "blk: BLOCK 依瑞丝"))
assert.equal(nodeOf(asked).turn.products.blk, "DEMANDED")
prose.text = "said {{char}}"

// Replay: the name that filled a told entry taken away, the old node reads "" (§二) and nothing throws; the transcript
// and the next index go on without it.
S.setPlayer({ ...player, names: {} })
assert.deepEqual(
  S.node(n2.id).delivered.map((d) => d.text),
  [""],
)
assert.ok(S.snapshot().nodes.length >= 3)
const third = await collect(S.act(n2.id, { text: "on" }))
assert.ok(!has(doc(third, "narrate"), "HELD"))

// A Cond reading the counters of an entry that left the index still has an answer.
{
  const counted: Card = {
    ...chat,
    lore: [
      { id: "un", layers: ["U {{missing}}."], unlock: { all: [] }, offer: { any: [] } },
      {
        id: "w",
        layers: ["W.", "WINDOW."],
        unlock: { all: [] },
        offer: { path: "lore.un.shown", op: "lte", value: 0 },
      },
    ],
  }
  const C = makeSession({ card: counted, player: plain, model: () => scripted })
  picks.push(["w"])
  const es = await collect(C.act(null, { text: "hi" }))
  assert.ok(has(doc(es, "narrate"), "WINDOW."))
}

// ───────── What a client reads: names and the holes nothing fills, derived from the text ─────────
{
  const view = (c: Card, p: Player, packs: Pack[] = [], who?: typeof persona) => cardView(c, p, packs, who)
  const bare: Player = { global: [], forCard: {} }
  const shelf: Card = {
    ...chat,
    frame: [
      { id: "style", text: "{{a}} {{user}}" },
      { id: "voice", text: "{{off}}", enabled: false }, // never goes out
    ],
    fiction: [{ id: "f", text: "{{b}}" }],
    greetings: [{ text: "{{c}}" }],
    lore: [{ id: "l", layers: ["{{d}}", "{{e}}"], unlock: { all: [] }, offer: { any: [] } }],
    products: [{ id: "q", text: "{{f}}", shape: { kind: "text" }, on: false }], // off is still demandable
  }
  const kit: Pack = {
    id: "k",
    name: "K",
    fragments: [{ id: "setting", text: "{{g}}" }],
    entries: [{ id: "x", text: "{{h}}" }],
    theaters: [{ id: "t", text: "{{i}}" }],
    snippets: [{ name: "s", text: "{{j}}", after: "{{k}}" }],
    names: { h: "H" },
  }
  // in order of appearance, `user` filled, the disabled fragment and the pack's own name out
  assert.deepEqual(view(shelf, bare, [kit]).holes, ["g", "a", "b", "c", "d", "e", "f", "i", "j", "k"])
  // a player's name fills it; a slot the player's fragment overrides does not go out, so its hole is not one
  const mine: Player = {
    global: [],
    forCard: { [shelf.id]: [{ id: "style", text: "plain" }] },
    names: { [shelf.id]: { b: "B" } },
  }
  assert.deepEqual(view(shelf, mine).holes, ["c", "d", "e", "f"])
  // the persona's own text is scanned; its name fills `user`
  assert.deepEqual(
    view({ ...chat, frame: [], fiction: [], products: [] }, bare, [], { name: "N", text: "{{z}} {{user}}" }).holes,
    ["z"],
  )
}

console.log("ok")
