// 代称 (docs/packs-brief.md §八): the pure functions, the value's lock, the merge order, every expansion point on a session
// over a scripted model (a player row's entry with an unfilled hole skipped, its neighbour sent), the card's own open
// hole locking the turn (#170), the refusals, history untouched, and the holes a client is told of. The two lint rules
// are in test/lint.ts, the wire in server test/serve.ts.
import { fake, type Message } from "@effect-tavern/provider"
import { Effect, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { decodeCard, type Card } from "../src/card.ts"
import { decodeLayer, decodeLocal, resolve, type Layer, type Rows } from "../src/layer.ts"
import { expand, holes, Names } from "../src/names.ts"
import { makeSession, type Event } from "../src/session.ts"
import { chat, loadCard, plain } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

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
  assert.throws(() => decodeLocal({ id: "local", name: "L", card: "c", names: { char: bad } }))
  assert.throws(() => decodeLayer({ id: "p", name: "P", names: { char: bad } }))
  assert.throws(() => decodeCard({ ...chat, names: { char: bad } }))
}

const persona = { name: "阿青", text: "P {{user}}" }

// ───────── A session: every point, a player row's unfilled neighbour skipped ─────────
const card: Card = {
  ...chat,
  names: { char: "依瑞丝" },
  greetings: [{ text: "G {{char}}" }],
  frame: [{ id: "style", text: "FRAME {{char}}" }],
  fiction: [{ id: "a", text: "FICTION {{char}}" }],
  lore: [
    {
      id: "li",
      layers: ["LORE {{char}}.", "DEEP {{char}}."],
      sections: [{ id: "s", text: "SECTION {{char}}." }],
      unlock: [{ all: [] }, { all: [] }],
      offer: { any: [] },
    },
    { id: "held", layers: ["HELD {{given}}."], unlock: { all: [] }, offer: { any: [] } },
  ],
  products: [
    { role: "theater" as const, id: "kept", text: "ASK {{char}}", shape: { kind: "text" } },
    { role: "theater" as const, id: "blk", text: "BLOCK {{char}}", shape: { kind: "text" }, stage: "narrate" },
  ],
}
const pack: Layer = {
  id: "pk",
  name: "PK",
  names: { place: "贝克兰德" },
  entries: [
    { id: "x", text: "ENTRY {{place}}." },
    { id: "y", text: "ENTRY-NO {{missing}}." },
  ],
  fragments: [{ id: "setting", text: "PACK {{place}}" }],
  products: [
    { id: "town", text: "TOWN {{place}}", on: true },
    { id: "gone", text: "TOWN-NO {{missing}}", on: true },
  ],
}
const local = { id: "local", name: "local", card: card.id, mounts: ["pk"] }
const player: Rows = {
  harness: {
    id: "harness",
    name: "harness",
    fragments: [
      { id: "t", text: "TAIL {{char}}", at: "tail" },
      { id: "u", text: "TAIL-NO {{missing}}", at: "tail" },
    ],
  },
  packs: [pack],
  local: { ...local, names: { given: "玩家给的" } },
  persona,
}
let rows = player
const picks: string[][] = []
const canned = {
  notes: "N",
  kept: "K",
  options: ["A", "B", "C", "D"],
  people: [],
  scene: { place: "P", present: [] },
}
const prose = { text: "said {{char}}" }
const scripted = fake((o) => {
  const doc = readStage(o)
  if (doc.phase === "lookup") {
    const refs = o.prompt.some((m) => m.role === "tool") ? [] : (picks.shift() ?? [])
    return refs.length
      ? {
          text: "",
          toolCalls: [
            { name: "read_context", input: { refs: refs.map((id) => `${id.includes("/") ? "pack" : "card"}:${id}`) } },
          ],
        }
      : { text: "Done" }
  }
  if (doc.phase === "narrate") return prose
  return defaultAnswer(doc, canned)
})
const session = () =>
  makeSession({
    card,
    rows: () => rows,
    model: () => ({ ...scripted, hat: "h" }),
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

picks.push(["li", "li#s", "pk/x"])
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
  "SECTION 依瑞丝.", // a section, expanded like a layer
  "ENTRY 贝克兰德.", // a pack's entry
  "blk: BLOCK 依瑞丝", // a narrate block's ask
  "town: TOWN 贝克兰德",
  "G 依瑞丝", // the stored opening, as history
])
  assert.ok(has(narrate, s), s)
// the unfilled ones are gone, none of them dragging its neighbour or leaving a dangling instruction
assert.ok(!narrate.some((m) => /-NO|\{\{missing/.test(m)))
assert.ok(has(narrate, "{{char}} typed")) // the player's line goes as typed

// Lookup no longer enumerates the catalog (including unavailable/unexpanded entries).
assert.ok(!doc(first, "lookup").some((m) => m.includes("Index:")))

// the record asks: expanded; the pack's unfilled theater not asked and not on the node; review wears its hat expanded
const record = doc(first, "record")
assert.ok(has(record, "kept: ASK 依瑞丝"))
assert.ok(has(record, "REVIEW 依瑞丝"))
const n1 = nodeOf(first)
assert.equal(n1.turn.products.kept, "K")
assert.equal("gone" in n1.turn.products, false)
assert.equal(n1.turn.input.text, "{{char}} typed")
assert.deepEqual(
  n1.delivered.map((d) => d.text),
  ["LORE 依瑞丝.\n\nDEEP 依瑞丝.", "SECTION 依瑞丝.", "ENTRY 贝克兰德."],
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
assert.throws(() => S.demand(n2.id, "gone"), /gone: unfilled \{\{missing\}\}/)
prose.text = "DEMANDED"
const asked = await collect(S.demand(n2.id, "blk"))
assert.ok(has(doc(asked, "narrate"), "blk: BLOCK 依瑞丝"))
assert.equal(nodeOf(asked).turn.products.blk, "DEMANDED")
prose.text = "said {{char}}"

// Replay: the name that filled a told entry taken away, the old node reads "" (§二) and nothing throws; the card's
// own text now has an open hole, so the next turn is refused, naming it, and runs again once the name is back.
rows = { ...player, local }
assert.deepEqual(
  S.node(n2.id).delivered.map((d) => d.text),
  ["HELD 玩家给的."],
)
assert.ok(S.snapshot().nodes.length >= 3)
await assert.rejects(collect(S.act(n2.id, { text: "on" })), /^Error: card: unfilled \{\{given\}\}$/)
rows = player
const third = await collect(S.act(n2.id, { text: "on" }))
assert.ok(has(doc(third, "narrate"), "HELD 玩家给的."))

// ───────── The card's own open hole: no turn runs, anywhere a turn starts (#170) ─────────
{
  const at = (c: Partial<Card>, r: Rows = plain) =>
    makeSession({ card: { ...chat, greetings: [{ text: "G" }], ...c }, rows: () => r, model: () => scripted })
  const refused = /card: unfilled \{\{missing\}\}/
  for (const c of [
    { frame: [{ id: "style", text: "F {{missing}}" }] },
    { fiction: [{ id: "f", text: "F {{missing}}" }] },
    { lore: [{ id: "l", layers: ["L.", "L2 {{missing}}."] }] },
    { lore: [{ id: "l", layers: ["L."], sections: [{ id: "s", text: "S {{missing}}." }] }] }, // a section counts too
    { guard: ["RULE {{missing}}"] },
    {
      rules: { ...chat.rules, readouts: [{ id: "r", text: "R", options: [{ id: "a", text: "{{missing}}", do: [] }] }] },
    },
    { products: [{ role: "theater" as const, id: "q", text: "Q {{missing}}", shape: { kind: "text" as const } }] },
    { passages: [{ when: { all: [] }, text: "P {{missing}}" }] },
  ] as Partial<Card>[]) {
    const C = at(c)
    assert.throws(() => C.greet(C.greetings[0]!), refused, JSON.stringify(c))
    await assert.rejects(collect(C.act(null, { text: "hi" })), refused, JSON.stringify(c))
    assert.equal(C.log.nodes.size, 0)
  }
  // a disabled fragment is not in force; a player's slot text over the card's leaves the card's out of the count
  const off = at({ frame: [{ id: "style", text: "F {{missing}}", enabled: false }] })
  assert.ok(off.greet(off.greetings[0]!).node)
  const over = at(
    { frame: [{ id: "style", text: "F {{missing}}" }] },
    {
      ...plain,
      local: { id: "local", name: "local", card: chat.id, fragments: [{ id: "style", text: "MINE" }] },
    },
  )
  assert.ok(over.greet(over.greetings[0]!).node)

  // `{{user}}` has no fallback: no persona, no name, the opening is refused and every list names it
  const hello = { greetings: [{ text: "早安，{{user}}" }] }
  const bare = at(hello)
  assert.deepEqual([bare.layer.cardHoles, bare.layer.holes, bare.layer.names.user], [["user"], ["user"], undefined])
  assert.throws(() => bare.begin({}), /^Error: card: unfilled \{\{user\}\}$/)
  // a persona, or a local name, fills it
  const worn = at(hello, { ...plain, persona: { name: "林默", text: "P" } })
  assert.deepEqual(worn.greet(worn.greetings[0]!).node!.turn.reply, [{ type: "text", text: "早安，林默" }])
  const local = at(hello, { ...plain, local: { id: "local", name: "local", card: chat.id, names: { user: "阿青" } } })
  assert.deepEqual(local.greet(local.greetings[0]!).node!.turn.reply, [{ type: "text", text: "早安，阿青" }])
  // an old saved opening's plain text is still the player's to fix before naming anyone (an edit of an opening runs nothing)
  rows = { ...plain, local: { id: "local", name: "local", card: chat.id, names: { user: "玩家" } } }
  const fix = makeSession({ card: { ...chat, ...hello }, rows: () => rows, model: () => scripted })
  const saved = fix.greet(fix.greetings[0]!).node!
  rows = plain
  assert.deepEqual(fix.layer.cardHoles, ["user"])
  const fixed = await collect(fix.edit(saved.id, { text: "早安" }))
  assert.deepEqual(nodeOf(fixed).turn.reply, [{ type: "text", text: "早安" }])
  // and anything that runs a model on it is refused
  await assert.rejects(collect(fix.act(saved.id, { text: "hi" })), /card: unfilled \{\{user\}\}/)

  // an ensemble card with no names under a global theater holding `{{char}}`: the theater stays out, the turn runs
  const yandao = await loadCard("yandao")
  const Y = makeSession({
    card: yandao,
    rows: () => ({
      ...plain,
      harness: { ...plain.harness!, products: [{ id: "aside", text: "{{char}} 的旁白", on: true }] },
    }),
    model: () => scripted,
  })
  assert.deepEqual([Y.layer.cardHoles, Y.layer.holes], [[], ["char"]])
  const ran = await collect(Y.begin({ note: "开始" }))
  assert.ok(nodeOf(ran))
}

// Guard lines, per line: expanded for check and its enum; none, no check at all.
{
  const violating = fake((o) => {
    const d = readStage(o)
    if (d.phase === "check") return { text: JSON.stringify({ violated: d.rules.slice(0, 1) }) }
    return d.phase === "narrate" ? prose : defaultAnswer(d, canned)
  })
  const guarded: Card = { ...card, lore: [], guard: ["RULE {{char}}"] }
  const G = makeSession({ card: guarded, rows: () => plain, model: () => violating })
  const es = await collect(G.act(null, { text: "hi" }))
  assert.ok(has(doc(es, "check"), "Rule: RULE 依瑞丝"))
  assert.deepEqual(nodeOf(es).turn.violated, ["RULE 依瑞丝"])
  const none = makeSession({
    card: { ...guarded, guard: [] },
    rows: () => plain,
    model: () => violating,
  })
  assert.equal(doc(await collect(none.act(null, { text: "hi" })), "check").length, 0)
}

// Readouts: the question and its options expanded.
{
  const opt = (text: string) => [{ id: "a", text, do: [] }]
  const R = makeSession({
    card: {
      ...chat,
      names: { char: "依瑞丝" },
      rules: { ...chat.rules, readouts: [{ id: "r", text: "READ {{char}}", options: opt("OPT {{char}}") }] },
    },
    rows: () => plain,
    model: () => scripted,
  })
  const es = await collect(R.act(null, { text: "hi" }))
  assert.ok(has(doc(es, "record"), "r: READ 依瑞丝 [a: OPT 依瑞丝]"))
  assert.deepEqual(nodeOf(es).turn.answers, { r: "a" })
}

// Asks: a question cannot be skipped, so the chain yields, player → card → the harness's own.
{
  const lore = [{ id: "l", layers: ["L."], unlock: { all: [] }, offer: { any: [] } }]
  const lookup = async (cardAsks: Card["asks"], names?: Names) => {
    const A = makeSession({
      card: { ...chat, lore, ...(cardAsks && { asks: cardAsks }) },
      rows: () => ({
        ...plain,
        local: {
          id: "local",
          name: "local",
          card: chat.id,
          asks: [{ id: "lookup", text: "PLAYER {{char}}" }],
          ...(names && { names }),
        },
      }),
      model: () => scripted,
    })
    return doc(await collect(A.act(null, { text: "hi" })), "lookup").join("\n")
  }
  const cardAsk = [{ id: "lookup", text: "CARD ASK" }]
  assert.ok((await lookup(cardAsk)).includes("CARD ASK"))
  const harness = await lookup(undefined)
  assert.ok(harness.includes("Find only the context") && !harness.includes("PLAYER"))
  assert.ok((await lookup(cardAsk, { char: "依瑞丝" })).includes("PLAYER 依瑞丝"))
}

// ───────── What a client reads: the holes nothing fills, derived from the text ─────────
{
  const view = (c: Card, r: Rows = {}) => resolve(c, r).holes
  const shelf: Card = {
    ...chat,
    frame: [
      { id: "style", text: "{{a}} {{user}}" },
      { id: "voice", text: "{{off}}", enabled: false }, // never goes out
    ],
    fiction: [{ id: "f", text: "{{b}}" }],
    greetings: [{ text: "{{c}}" }],
    lore: [{ id: "l", layers: ["{{d}}", "{{e}}"], unlock: { all: [] }, offer: { any: [] } }],
    products: [{ role: "theater" as const, id: "q", text: "{{f}}", shape: { kind: "text" }, on: false }], // off is still demandable
  }
  const kit: Layer = {
    id: "k",
    name: "K",
    fragments: [{ id: "setting", text: "{{g}}" }],
    entries: [{ id: "x", text: "{{h}}" }],
    products: [{ id: "t", text: "{{i}}" }],
    snippets: [{ name: "s", text: "{{j}}", after: "{{k}}" }],
    names: { h: "H" },
  }
  const on = { id: "local", name: "local", card: chat.id }
  // in order of appearance, `user` a hole like any other, the disabled fragment and the pack's own name out
  const mounted = { packs: [kit], local: { ...on, mounts: ["k"] } }
  assert.deepEqual(view(shelf, mounted), ["g", "a", "user", "b", "c", "d", "e", "f", "i", "j", "k"])
  // the ones that lock the turn: the card's own text in force (an off product is not run, only demanded)
  assert.deepEqual(resolve(shelf, mounted).cardHoles, ["a", "user", "b", "c", "d", "e"])
  // a player's name fills it; a slot the player's fragment overrides does not go out, so its hole is not one
  const mine = { ...on, fragments: [{ id: "style", text: "plain" }], names: { b: "B" } }
  assert.deepEqual(view(shelf, { local: mine }), ["c", "d", "e", "f"])
  // guard lines, readouts and the asks; a card's ask under a player's that expands never goes out, under one that does not it may
  const worded = (text: string) =>
    view(
      {
        ...chat,
        guard: ["{{m}}"],
        rules: { ...chat.rules, readouts: [{ id: "r", text: "{{n}}", options: [{ id: "a", text: "{{o}}", do: [] }] }] },
        asks: [{ id: "lookup", text: "{{q}}" }],
      },
      { local: { ...on, asks: [{ id: "lookup", text }] } },
    )
  assert.deepEqual(worded("{{p}}"), ["m", "n", "o", "p", "q"])
  assert.deepEqual(worded("plain"), ["m", "n", "o"])
  // the persona's own text is scanned; its name fills `user`
  assert.deepEqual(
    view({ ...chat, frame: [], fiction: [], products: [] }, { persona: { name: "N", text: "{{z}} {{user}}" } }),
    ["z"],
  )
}

console.log("ok")
