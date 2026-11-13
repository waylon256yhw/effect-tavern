// The player layer through its interface (docs/packs-brief.md §九, §十): `resolve(card, {})` byte for byte what the code sent
// before layer.ts existed, the author order, yield and the switches' takeover, the persona last, the locks landing in
// `dropped` with the session still opening, the entries' prefix, the holes' four treatments, `on` and `from`, the overlay
// storing only its difference. Then a session over a scripted model: what a row does to the documents, per request. The
// migration of the old player row is the server's test/data.ts, the routes its test/serve.ts.
import { fake, type Message } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import type { Card } from "../src/card.ts"
import { prose as proseOf } from "../src/journal.ts"
import {
  decodeLayer,
  decodeLocal,
  empty,
  harness,
  overlaid,
  overlayOf,
  resolve,
  shown,
  type Layer,
  type Local,
  type Rows,
} from "../src/layer.ts"
import { kindOf } from "../src/product.ts"
import { cardView, makeSession, type Event } from "../src/session.ts"
import { cardNames, chat, loadCard } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

const collect = (s: Stream.Stream<Event, unknown>) =>
  Effect.runPromise(Stream.runCollect(s)).then((c) => [...c] as Event[])
const nodeOf = (es: readonly Event[]) => es.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
const row = (id: string, r: Partial<Layer> = {}): Layer => ({ id, name: id, ...r })
function here(r: Partial<Local> = {}): Local {
  return { id: "local", name: "local", card: chat.id, ...r }
}

// ───────── resolve(card, {}): the request bytes of the code before layer.ts ─────────
// test/fixtures/requests.json was captured from that code (the commit before this module, player `{global: [], forCard:
// {}}`), over the template cards: one greeting, one act, one demand; `wuxia+` adds a director, the note channel and a
// lexicon, so direct and polish go out too. An edit of a template card moves its bytes: `CAPTURE=1 bun test/layer.ts`
// rewrites the turns' half of the file, and the diff is the review.
{
  const file = new URL("fixtures/requests.json", import.meta.url)
  const fixture = JSON.parse(readFileSync(file, "utf8"))
  const canned = { notes: "N", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }
  const model = fake((o) => {
    const d = readStage(o)
    if (d.phase === "narrate") return { text: "不是这样而是那样。".repeat(30) }
    return defaultAnswer(d, canned)
  })
  const variant = async (name: string): Promise<Card> => {
    if (name !== "wuxia+") return loadCard(name)
    const c = await loadCard("wuxia")
    return { ...c, director: true, input: "note", lexicon: [{ pattern: "不是*而是", hint: "八股" }] }
  }
  for (const name of [...cardNames, "wuxia+"]) {
    const card = await variant(name)
    const S = makeSession({ card, rows: () => ({}), model: () => model })
    const root = S.greet(card.greetings[0]!).node!
    const es = await collect(S.act(root.id, { text: "我看了看四周。⦅小心⦆" }))
    const dem = await collect(S.demand(nodeOf(es).id, "inner"))
    const calls = [...es, ...dem].flatMap((e) => (e.kind === "call" ? [{ phase: e.phase, msgs: e.msgs }] : []))
    if (process.env["CAPTURE"]) fixture[name] = calls
    assert.equal(JSON.stringify(calls), JSON.stringify(fixture[name]), name)
  }
  if (process.env["CAPTURE"]) writeFileSync(file, `${JSON.stringify(fixture, null, 1)}\n`)
  if (process.env["CAPTURE"]) {
    const act = harness("act")
    fixture.harness.asks = act.asks!.filter((a) => !a.id.startsWith("switch."))
    fixture.harness.act = act.products
    fixture.harness.note = harness("note").products
    writeFileSync(file, `${JSON.stringify(fixture, null, 1)}\n`)
  }
  // All default asks remain covered by the fixture.
  const h = fixture.harness
  const act = harness("act")
  const sentences = Object.entries(h.sentences as Record<string, Record<string, string>>).flatMap(([k, vs]) =>
    Object.entries(vs).map(([v, text]) => ({ id: `switch.${k}.${v}`, text })),
  )
  assert.deepEqual(
    act.asks,
    [...h.asks, ...sentences].map((a: { id: string; text: string }) => ({ id: a.id, text: a.text })),
  )
  assert.deepEqual([act.products, harness("note").products], [h.act, h.note])
  assert.deepEqual([act.snippets, act.format], [h.snippets, h.format])
  // nothing to draw on an empty layer
  const R = resolve(chat, {})
  assert.deepEqual([R.dropped, R.holes, R.names], [[], [], {}])
  assert.deepEqual([R.switches.value, R.switches.taken], [{}, { pov: null, verbosity: null }])
}

// ───────── The author order: the later wins by id, for every kind ─────────
const card: Card = {
  ...chat,
  frame: [{ id: "style", text: "CARD" }],
  fiction: [],
  names: { user: "C", a: "C", b: "C", c: "C", d: "C" },
  asks: [{ id: "lookup", text: "ASK-CARD" }],
  lexicon: [{ pattern: "p", hint: "CARD" }],
}
const packA = row("A", {
  fragments: [
    { id: "style", text: "A" },
    { id: "voice", text: "VOICE-A" },
  ],
  asks: [{ id: "lookup", text: "ASK-A" }],
  names: { b: "A", c: "A", d: "A" },
  snippets: [{ name: "q", text: "A" }],
  format: [{ label: "k", text: "A" }],
  lexicon: [{ pattern: "p", hint: "A" }],
})
const packB = row("B", {
  fragments: [{ id: "style", text: "B" }],
  asks: [{ id: "lookup", text: "ASK-B" }],
  names: { c: "B", d: "B" },
  snippets: [{ name: "q", text: "B" }],
  format: [{ label: "k", text: "B" }],
})
const overlay = row("harness", {
  fragments: [
    { id: "style", text: "OVER" },
    { id: "own", text: "OWN" },
  ],
  asks: [{ id: "lookup", text: "ASK-OVER" }],
  names: { a: "OVER", b: "OVER", c: "OVER", d: "OVER", e: "OVER" },
  snippets: [
    { name: "q", text: "OVER" },
    { name: "only", text: "ONLY" },
  ],
  format: [{ label: "k", text: "OVER" }],
  lexicon: [{ pattern: "p", hint: "OVER" }],
})
const packs = [packB, packA]
{
  const texts = (r: Rows) => resolve(card, r).frame.map((f) => [f.id, f.text, f.from])
  // the card's alone
  assert.deepEqual(texts({}), [["style", "CARD", "card"]])
  // the overlay under the card, its fragment yielding by default; a pack not mounted is not there
  assert.deepEqual(texts({ harness: overlay, packs }), [
    ["own", "OWN", "harness"],
    ["style", "CARD", "card"],
  ])
  // packs in mount order, whatever the library's order; a missing id skipped, a repeated one once
  const mounted = { harness: overlay, packs, local: here({ mounts: ["A", "gone", "B", "A"] }) }
  assert.deepEqual(texts(mounted), [
    ["own", "OWN", "harness"],
    ["style", "B", "B"],
    ["voice", "VOICE-A", "A"],
  ])
  assert.deepEqual(
    texts({ harness: overlay, packs, local: here({ mounts: ["B", "A"] }) }).find((f) => f[0] === "style"),
    ["style", "A", "A"],
  )
  // local over all of them
  const top = { harness: overlay, packs, local: here({ mounts: ["A", "B"], fragments: [{ id: "style", text: "L" }] }) }
  assert.deepEqual(
    texts(top).find((f) => f[0] === "style"),
    ["style", "L", "local"],
  )

  // the other kinds the same
  const R = resolve(card, {
    ...mounted,
    local: here({
      mounts: ["A", "B"],
      names: { d: "L" },
      snippets: [{ name: "q", text: "L" }],
      format: [{ label: "k", text: "L" }],
    }),
  })
  assert.deepEqual(R.names, { user: "C", a: "C", b: "A", c: "B", d: "L", e: "OVER" }) // the overlay under the card
  assert.deepEqual([R.asks["lookup"]!.text, R.asks["lookup"]!.from], ["ASK-B", "B"])
  assert.equal(R.asks["polish"]!.from, "harness")
  // a menu by name: the highest rank's copy, the highest first, the harness's last
  assert.deepEqual(
    R.snippets.slice(0, 2).map((s) => [s.name, s.text, s.from]),
    [
      ["q", "L", "local"],
      ["only", "ONLY", "harness"],
    ],
  )
  assert.equal(R.snippets.at(-1)!.from, "harness")
  assert.deepEqual(
    R.format.slice(0, 1).map((f) => [f.text, f.from]),
    [["L", "local"]],
  )
  // a lexicon entry has no id: every rank's stands, the highest first, so the polish hints read in that order
  assert.deepEqual(
    R.lexicon.map((e) => e.hint),
    ["A", "CARD", "OVER"],
  )
  // the note channel takes the channel switch and the thought mark out of the menu, a row's as well
  const note = resolve(
    { ...card, input: "note" },
    {
      harness: row("harness", {
        snippets: [
          { name: "t", text: "⦅" },
          { name: "n", text: "N" },
        ],
      }),
    },
  ).snippets.map((s) => s.name)
  assert.ok(note.includes("n") && !note.includes("t") && !note.includes("心声") && !note.includes("场外"))

  // one document zone order: the player's slots in first-written order, then what is left of the card's
  const both = resolve(
    {
      ...card,
      frame: [
        { id: "style", text: "CARD" },
        { id: "x", text: "X" },
      ],
    },
    { harness: row("harness", { fragments: [{ id: "style", text: "B", mode: "both" }] }) },
  )
  assert.deepEqual(
    both.frame.map((f) => f.text),
    ["B", "CARD", "X"],
  )
  // at: tail goes to the tail; a text-less slot stands and says nothing
  const tailed = resolve(chat, {
    harness: row("harness", {
      fragments: [{ id: "t", text: "T", at: "tail" }, { id: "s" }],
    }),
  })
  assert.deepEqual([tailed.tail.map((f) => f.text), tailed.frame.some((f) => f.id === "s")], [["T"], true])
  // a tail fragment is not a slot: named like the card's head slot it neither yields to it nor knocks it out
  const slotted = { ...chat, frame: [...chat.frame, { id: "pov", text: "CARD-POV" }] }
  const named = resolve(slotted, {
    harness: row("harness", { fragments: [{ id: "pov", text: "TAIL-POV", at: "tail" }] }),
    local: here({ fragments: [{ id: "pov", text: "LOCAL-TAIL", at: "tail", mode: "override" }] }),
  })
  assert.deepEqual(
    [named.tail.map((f) => [f.text, f.from]), named.frame.find((f) => f.id === "pov")?.text],
    [[["LOCAL-TAIL", "local"]], "CARD-POV"],
  )
  // nor does a tail directive hold the slot: with the card's pov gone the head slot is free
  const onlyTail = resolve(chat, { harness: row("harness", { fragments: [{ id: "pov", text: "T", at: "tail" }] }) })
  assert.deepEqual([onlyTail.switches.taken.pov, onlyTail.frame.some((f) => f.id === "pov")], [null, false])
  // a card's slot with no text is left for the player: nobody holds it until a switch compiles there, and `taken` says so
  assert.equal(resolve({ ...chat, frame: [...chat.frame, { id: "pov" }] }, {}).switches.taken.pov, null)
  const emptySlot = resolve(
    { ...chat, frame: [...chat.frame, { id: "pov" }] },
    { local: here({ switches: { pov: "third" } }) },
  )
  assert.deepEqual(
    [emptySlot.switches.taken.pov, emptySlot.frame.filter((f) => f.id === "pov").map((f) => f.compiled)],
    ["local", [true]],
  )
}

// ───────── Yield: a lower rank has filled the slot, it does not stand ─────────
{
  const f = (id: string, text: string, mode?: "yield" | "override") => ({ id, text, ...(mode && { mode }) })
  const of = (r: Rows) => resolve(card, r).frame.map((x) => x.text)
  assert.deepEqual(of({ harness: row("harness", { fragments: [f("style", "Y", "yield")] }) }), ["CARD"]) // to the card
  assert.deepEqual(of({ harness: row("harness", { fragments: [f("v", "Y", "yield")] }) }), ["Y", "CARD"]) // nothing under it
  // the overlay against the card: no mode yields, `override` beats the card's slot
  assert.deepEqual(of({ harness: row("harness", { fragments: [f("style", "O")] }) }), ["CARD"])
  assert.deepEqual(of({ harness: row("harness", { fragments: [f("style", "O", "override")] }) }), ["O"])
  // a pack and the local row over an overriding overlay, by id
  assert.deepEqual(
    of({
      harness: row("harness", { fragments: [f("style", "O", "override")] }),
      packs: [row("p", { fragments: [f("style", "P")] })],
      local: here({ mounts: ["p"] }),
    }),
    ["P"],
  )
  assert.deepEqual(
    of({
      harness: row("harness", { fragments: [f("v", "BASE")] }),
      local: here({ fragments: [f("v", "L", "yield")] }),
    }),
    ["BASE", "CARD"], // to the overlay, whose slot the card left empty
  )
  assert.deepEqual(
    of({
      harness: row("harness", { fragments: [f("style", "Y", "yield")] }),
      local: here({ fragments: [f("style", "L")] }),
    }),
    ["L"], // a yield that did not stand does not stop the rank above it
  )
  // an item switched off is not there: it blanks neither the slot under it nor the card's
  const off = { id: "style", text: "OFF", enabled: false }
  assert.deepEqual(of({ harness: row("harness", { fragments: [off] }) }), ["CARD"])
  assert.deepEqual(
    of({
      harness: row("harness", { fragments: [f("v", "BASE")] }),
      local: here({ fragments: [{ ...f("v", "x"), enabled: false }] }),
    }),
    ["BASE", "CARD"],
  )
}

// ───────── The switches: compiled, yielding; merged by key down the ranks; `taken` ─────────
{
  const say = harness("act").asks!
  const line = (id: string) => say.find((a) => a.id === id)!.text
  const sw = { pov: "second", echo: false, agency: "strict", verbosity: "concise" } as const
  const R = resolve(chat, { harness: row("harness", { switches: sw, fragments: [{ id: "language", text: "L" }] }) })
  // pov, echo and agency are one slot, verbosity its own, before the row's own fragments
  assert.deepEqual(
    R.frame.slice(0, 3).map((f) => [f.id, f.compiled, f.from]),
    [
      ["pov", true, "harness"],
      ["verbosity", true, "harness"],
      ["language", undefined, "harness"],
    ],
  )
  assert.equal(R.frame[0]!.text, line("switch.pov.second") + line("switch.echo.false") + line("switch.agency.strict"))
  assert.deepEqual(R.switches.taken, { pov: "harness", verbosity: "harness" })
  assert.deepEqual(R.switches.value, sw)
  assert.equal(R.switches.sentences["switch.pov.none"], line("switch.pov.none"))
  // no player in the fiction: echo and agency drop with it
  assert.equal(
    resolve(chat, { harness: row("harness", { switches: { pov: "none", echo: true, agency: "free" } }) }).frame[0]!
      .text,
    line("switch.pov.none"),
  )
  // a later row's switch wins key by key: one slot compiled from the merge, the later row's name on it
  const merged = resolve(chat, {
    harness: row("harness", { switches: { pov: "second", agency: "strict" } }),
    local: here({ switches: { pov: "third" } }),
  })
  assert.equal(merged.frame[0]!.text, line("switch.pov.third") + line("switch.agency.strict"))
  assert.deepEqual([merged.frame[0]!.from, merged.switches.value.agency], ["local", "strict"])
  // a card that writes the slot takes the group: the compiled one yields, the taker named and not compiled
  const carded = resolve(
    { ...chat, frame: [{ id: "pov", text: "全知" }] },
    { harness: row("harness", { switches: sw }) },
  )
  assert.deepEqual(
    carded.frame.map((f) => [f.id, f.text === "全知"]),
    [
      ["verbosity", false],
      ["pov", true],
    ],
  )
  assert.equal(carded.switches.taken.pov, "card")
  // free text takes the group, at its own row or below; a switch above it yields; the same row's yielding text still stands
  const free = (r: Rows) => {
    const x = resolve(chat, r)
    const pov = x.frame.find((f) => f.id === "pov")!
    return [pov.text, pov.compiled, x.switches.taken.pov]
  }
  const text = { id: "pov", text: "FREE" }
  assert.deepEqual(free({ harness: row("harness", { switches: sw, fragments: [text] }) }), [
    "FREE",
    undefined,
    "harness",
  ])
  assert.deepEqual(free({ harness: row("harness", { switches: sw, fragments: [{ ...text, mode: "yield" }] }) }), [
    "FREE",
    undefined,
    "harness",
  ])
  assert.deepEqual(free({ harness: row("harness", { fragments: [text] }), local: here({ switches: sw }) }), [
    "FREE",
    undefined,
    "harness",
  ])
  // a yielding text above a compiled slot: the lower rank filled it
  assert.equal(
    free({ harness: row("harness", { switches: sw }), local: here({ fragments: [{ ...text, mode: "yield" }] }) })[1],
    true,
  )
  // an overlay's sentence is what compiles; a hole it cannot fill falls back to the code's
  const edit = (t: string) => row("harness", { asks: [{ id: "switch.pov.second", text: t }] })
  const on = { switches: { pov: "second" } } as const
  const edited = resolve(chat, { harness: { ...edit("MINE"), ...on } })
  assert.deepEqual(
    [edited.frame[0]!.text, edited.switches.sentences["switch.pov.second"], edited.asks["switch.pov.second"]!.from],
    ["MINE", "MINE", "harness"],
  )
  assert.equal(resolve(chat, { harness: { ...edit("{{x}}"), ...on } }).frame[0]!.text, line("switch.pov.second"))
  // the overlay's own switches are the lowest rank's: under a pack key by key, yielding to the card like any
  const low = row("harness", { switches: { pov: "second", verbosity: "concise" } })
  const lowest = resolve(chat, {
    harness: low,
    packs: [row("p", { switches: { pov: "third" } })],
    local: here({ mounts: ["p"] }),
  })
  assert.equal(lowest.frame.find((f) => f.id === "pov")!.text, line("switch.pov.third"))
  assert.deepEqual(lowest.switches.taken, { pov: "p", verbosity: "harness" })
}

// ───────── The persona: its text the end of the local row, its name the last word on `user` ─────────
{
  const persona = { name: "阿青", text: "P {{user}}" }
  const R = resolve(
    { ...card, frame: [{ id: "persona", text: "CARD-P" }] },
    {
      persona,
      local: here({
        fragments: [
          { id: "persona", text: "MINE" },
          { id: "z", text: "Z" },
        ],
        names: { user: "ME" },
      }),
    },
  )
  assert.deepEqual(
    R.frame.map((f) => [f.id, f.text, f.from]),
    [
      ["persona", "P 阿青", "local"],
      ["z", "Z", "local"],
    ],
  )
  assert.equal(R.names.user, "阿青")
  // no local row is no obstacle
  assert.equal(resolve(chat, { persona }).frame[0]!.text, "P 阿青")
  // the lock holds on it too: `user` stays what it was, in the ledger
  const bad = resolve(chat, { persona: { name: "两\n行", text: "T" } })
  assert.equal(bad.names.user, undefined)
  assert.deepEqual(bad.dropped, [{ from: "local", kind: "name", id: "user", why: "a name is one line with no {{" }])
}

// ───────── The locks: at the boundary, and again in resolve; `dropped`, never a throw ─────────
{
  // when and role: gone from every stored row, the overlay's too, at decode and over a row that skipped it
  const f = { id: "x", text: "T", role: "user", when: { all: [] } }
  assert.deepEqual(decodeLayer({ id: "d", name: "D", fragments: [f] }).fragments, [{ id: "x", text: "T" }])
  assert.deepEqual(decodeLocal({ id: "l", name: "L", card: "c", fragments: [f] }).fragments, [{ id: "x", text: "T" }])
  const direct = resolve(chat, { harness: row("harness", { fragments: [f as never] }) }).frame[0]!
  assert.deepEqual([direct.when, direct.role], [undefined, undefined])
  // names at the boundary, and in resolve
  for (const bad of ["两\n行", "两\r行", "含 {{x}} 洞", "{{"])
    assert.throws(() => decodeLayer({ id: "d", name: "D", names: { k: bad } }))
  const named = resolve(chat, { harness: row("harness", { names: { k: "两\n行", ok: "好" } }) })
  assert.deepEqual(named.names, { ok: "好" })
  assert.deepEqual(
    named.dropped.map((d) => [d.from, d.kind, d.id]),
    [["harness", "name", "k"]],
  )

  // A product patch by rank: label, text and on, on ANY existing id; its shape, stage, fold and feed stay.
  const P = (r: Rows, id: string) => resolve(chat, r).products.find((p) => p.id === id)
  for (const id of ["notes", "options", "inner"]) {
    const was = P({}, id)!
    const got = P(
      {
        harness: row("harness", {
          products: [
            {
              role: "world" as const,
              id,
              label: "X",
              text: "NEW",
              on: true,
              shape: { kind: "table", columns: [] },
              stage: "record",
              fold: "latest",
              feed: false,
            } as never,
          ],
        }),
      },
      id,
    )!
    assert.deepEqual(
      [got.label, got.text, got.on, got.from, got.shape, got.stage, got.fold, got.feed],
      ["X", "NEW", true, "harness", was.shape, was.stage, was.fold, was.feed],
    )
  }
  // no text keeps the question and its author; the later rank's `on` and `trigger` win over the pack's
  const onOff = resolve(chat, {
    harness: row("harness", { products: [{ id: "inner", on: false, trigger: "demand" }] }),
    packs: [row("p", { products: [{ id: "inner", on: true, trigger: "turn", label: "P" }] })],
    local: here({ mounts: ["p"], products: [{ id: "inner", on: false }] }),
  }).products.find((p) => p.id === "inner")!
  assert.deepEqual(
    [onOff.on, onOff.trigger, onOff.label, onOff.from, onOff.text],
    [false, "turn", "P", "harness", P({}, "inner")!.text],
  )
  // so a card's product toggled on the local row is still the card's, and `shown` still strips its text
  const cardsOwn = {
    ...chat,
    products: [{ role: "world" as const, id: "scene", text: "CARD-Q", shape: { kind: "text" as const } }],
  }
  const toggledCard = shown(
    resolve(cardsOwn, { local: here({ products: [{ id: "scene", on: false }] }) }),
  ).products.find((p) => p.id === "scene")!
  assert.deepEqual([toggledCard.from, toggledCard.on, "text" in toggledCard], ["card", false, false])
  // a card's whole patch: a table's shape stays under a pack's text
  const people = {
    role: "world" as const,
    id: "people",
    text: "Who.",
    shape: { kind: "table" as const, columns: [{ key: "name", type: "text" as const }] },
    feed: true,
    when: { path: "n", op: "gt" as const, value: 0 },
  }
  const tabled = { ...chat, products: [people] }
  const onTable = resolve(tabled, {
    packs: [row("p", { products: [{ id: "people", text: "MINE" }] })],
    local: here({ mounts: ["p"] }),
  }).products.at(-1)!
  assert.deepEqual(
    [onTable.text, onTable.shape, onTable.fold, onTable.when, onTable.from],
    ["MINE", people.shape, undefined, people.when, "p"],
  )
  // the overlay's patch on the card's id stays a patch under the card: its toggle and label stand where the card is
  // silent, the card's text, shape and stage stand over it (it never compiles to a narrate text)
  const under = resolve(tabled, {
    harness: row("harness", { products: [{ id: "people", label: "L", text: "OVER", on: false }] }),
  }).products.at(-1)!
  assert.deepEqual(
    [under.label, under.on, under.text, under.shape, under.stage, under.from],
    ["L", false, "Who.", people.shape, undefined, "card"],
  )
  // an entry id holding `/` would alias another row's entry: dropped, the sibling indexed
  const slashed = resolve(chat, {
    harness: row("harness", {
      entries: [
        { id: "a/b", text: "X" },
        { id: "c", text: "Y" },
      ],
    }),
  })
  assert.deepEqual(
    [slashed.entries.map((e) => e.id), slashed.dropped],
    [["harness/c"], [{ from: "harness", kind: "entry", id: "a/b", why: "an entry id has no /" }]],
  )
  // A new id: narrate, text, on by default, nothing else. Without text it is dropped, into the ledger.
  const town = P(
    { local: here({ products: [{ id: "town", label: "T", text: "gossip", when: { all: [] } } as never] }) },
    "town",
  )!
  assert.deepEqual(town, {
    role: "theater" as const,
    id: "town",
    label: "T",
    text: "gossip",
    shape: { kind: "text" },
    stage: "narrate",
    on: true,
    from: "local",
  })
  assert.equal(kindOf(town), "theater")
  const blank = resolve(chat, {
    packs: [row("p", { products: [{ id: "x", label: "X", on: true }] })],
    local: here({ mounts: ["p"] }),
  })
  assert.equal(
    blank.products.some((p) => p.id === "x"),
    false,
  )
  assert.deepEqual(blank.dropped, [{ from: "p", kind: "product", id: "x", why: "a new product needs text" }])
  // a toggle on an id this card does not declare says nothing about this card: ignored, no warning, at any rank
  const toggled = resolve(
    { ...chat, products: [] },
    {
      harness: row("harness", { products: [{ id: "people", on: false }] }),
      packs: [row("p", { products: [{ id: "people", on: false }] })],
      local: here({ mounts: ["p"], products: [{ id: "people", on: true }] }),
    },
  )
  assert.deepEqual([toggled.dropped, toggled.products.some((p) => p.id === "people")], [[], false])
  // an earlier row's new id is there for a later row to patch
  assert.equal(
    P(
      {
        harness: row("harness", { products: [{ id: "t", text: "a" }] }),
        local: here({ products: [{ id: "t", on: false }] }),
      },
      "t",
    )!.on,
    false,
  )

  // the card's own shape error still throws; an overlay's goes in the ledger, since it would kill every card
  assert.throws(() => resolve({ ...chat, products: [{ id: "ghost" }] }, {}), /needs text and shape/)
  assert.throws(
    () =>
      resolve(
        {
          ...chat,
          products: [{ role: "theater" as const, id: "n", text: "t", shape: { kind: "list" }, stage: "narrate" }],
        },
        {},
      ),
    /a narrate product is text/,
  )
  const badOverlay = resolve(chat, { harness: row("harness", { products: [{ id: "ghost", label: "G" }] }) })
  assert.equal(
    badOverlay.products.some((p) => p.id === "ghost"),
    false,
  )
  assert.deepEqual(badOverlay.dropped, [
    { from: "harness", kind: "product", id: "ghost", why: "a new product needs text" },
  ])
  // an overlay's new id is a 小剧场 like a pack's, whatever else it wrote; a later row patches it
  const whole = {
    role: "world" as const,
    id: "w",
    text: "W",
    shape: { kind: "list" as const },
    stage: "record" as const,
    feed: true,
  }
  assert.deepEqual(P({ harness: row("harness", { products: [whole] }) }, "w"), {
    role: "theater" as const,
    id: "w",
    text: "W",
    shape: { kind: "text" },
    stage: "narrate",
    on: true,
    from: "harness",
  })
  assert.equal(
    P(
      {
        harness: row("harness", { products: [whole] }),
        packs: [row("p", { products: [{ id: "w", text: "P" }] })],
        local: here({ mounts: ["p"] }),
      },
      "w",
    )!.text,
    "P",
  )
  // an overlay's patch never moves a default's shape, stage, fold or feed
  const notes = P({}, "notes")!
  const patched = P(
    { harness: row("harness", { products: [{ id: "notes", shape: { kind: "list" }, fold: "latest", feed: false }] }) },
    "notes",
  )!
  assert.deepEqual([patched.shape, patched.fold, patched.feed], [notes.shape, notes.fold, notes.feed])

  // An ask `product.<id>` is a text patch at its row's rank, not a separate chain.
  const asked = (r: Rows, c: Card = chat) => resolve(c, r).products.find((p) => p.id === "notes")!
  const cardAsks = { ...chat, asks: [{ id: "product.notes", text: "CARD" }] }
  assert.deepEqual([asked({}, cardAsks).text, asked({}, cardAsks).from], ["CARD", "card"])
  const overAsks = row("harness", { asks: [{ id: "product.notes", text: "BASE" }] })
  assert.equal(asked({ harness: overAsks }).text, "BASE")
  assert.equal(asked({ harness: overAsks }, cardAsks).text, "CARD") // the overlay under the card's
  // the overlay's ask at its rank, under the card's product text; a pack's and the local row's over it
  const cardText = { ...chat, products: [{ id: "notes", text: "CARD-TEXT" }] }
  const ask = (text: string) => [{ id: "product.notes", text }]
  assert.equal(asked({ harness: overAsks }, cardText).text, "CARD-TEXT")
  assert.equal(
    asked({ packs: [row("p", { asks: ask("PACK") })], local: here({ mounts: ["p"] }) }, cardText).text,
    "PACK",
  )
  assert.equal(asked({ local: here({ asks: ask("LOCAL") }) }, cardText).text, "LOCAL")
  assert.equal(resolve(chat, { harness: overAsks }).asks["product.notes"], undefined)
  // the same row: its ask over its patch
  assert.equal(
    asked({ harness: row("harness", { products: [{ id: "notes", text: "P" }], asks: overAsks.asks! }) }).text,
    "BASE",
  )
  // on a product this card does not have, nothing
  assert.deepEqual(
    resolve(chat, { harness: row("harness", { asks: [{ id: "product.people", text: "x" }] }) }).dropped,
    [],
  )
}

// ───────── Entries: prefixed by their row; one layer ─────────
{
  const R = resolve(chat, {
    harness: row("harness", { entries: [{ id: "x", text: "OVER." }] }),
    packs: [row("p", { entries: [{ id: "x", text: "P." }] }), row("q", { entries: [{ id: "x", text: "Q." }] })],
    local: here({ mounts: ["p"], entries: [{ id: "x", text: "L." }] }),
  })
  assert.deepEqual(
    R.entries.map((e) => [e.id, e.text, e.from]),
    [
      ["harness/x", "OVER.", "harness"],
      ["p/x", "P.", "p"],
      ["local/x", "L.", "local"],
    ],
  )
}

// ───────── The holes, four ways ─────────
{
  const rows: Rows = {
    harness: row("harness", {
      names: { place: "贝克兰德" },
      fragments: [
        { id: "good", text: "F {{place}}" },
        { id: "bad", text: "F-NO {{missing}}" },
        { id: "tg", text: "T {{place}}", at: "tail" },
        { id: "tb", text: "T-NO {{missing}}", at: "tail" },
      ],
      entries: [
        { id: "good", text: "E {{place}}." },
        { id: "bad", text: "E-NO {{missing}}." },
      ],
      snippets: [
        { name: "good", text: "S {{place}}", after: "{{place}}" },
        { name: "bad", text: "S-NO {{missing}}" },
        { name: "badafter", text: "S", after: "{{after}}" },
      ],
      products: [
        { id: "good", text: "Q {{place}}" },
        { id: "bad", text: "Q-NO {{missing}}" },
      ],
      asks: [{ id: "lookup", text: "ASK-NO {{ask}}" }],
    }),
  }
  const R = resolve({ ...chat, frame: [], lore: [] }, rows)
  // a fragment, an entry, a quick input: filled, or not there
  assert.deepEqual(
    R.frame.map((f) => f.text),
    ["F 贝克兰德"],
  )
  assert.deepEqual(
    R.tail.map((f) => f.text),
    ["T 贝克兰德"],
  )
  assert.deepEqual(
    R.entries.map((e) => e.text),
    ["E 贝克兰德."],
  )
  assert.deepEqual(
    R.snippets.filter((s) => /good|bad/.test(s.name)).map((s) => [s.name, s.text, s.after]),
    [["good", "S 贝克兰德", "贝克兰德"]],
  )
  // a product: filled, or marked and keeping its raw text so a refusal can name the hole
  const by = (id: string) => R.products.find((p) => p.id === id)!
  assert.deepEqual([by("good").text, by("good").unasked], ["Q 贝克兰德", undefined])
  assert.deepEqual([by("bad").text, by("bad").unasked], ["Q-NO {{missing}}", true])
  // an ask: down the chain, the code's own at the bottom
  assert.deepEqual([R.asks["lookup"]!.from, /Find only the context/.test(R.asks["lookup"]!.text)], ["harness", true])
  // `holes`: what nothing fills, in order of appearance, the same list whether or not the entry was dropped
  assert.deepEqual(R.holes, ["missing", "ask", "after"])
}

// ───────── The card's own holes (#170): they stay in its text as written; written over, they do not count ─────────
{
  const card: Card = {
    ...chat,
    frame: [
      { id: "setting", text: "S {{place}}" },
      { id: "off", text: "OFF {{offhole}}", enabled: false },
    ],
    greetings: [{ text: "早安，{{user}}" }],
    lore: [
      {
        id: "l",
        layers: ["L."],
        sections: [{ id: "s", text: "SEC {{sec}}" }],
        unlock: { all: [] },
        offer: { any: [] },
      },
    ],
  }
  const R = resolve(card, {})
  // no fallback name: `user` is a hole like any other; a disabled fragment is not in force; a section is scanned
  assert.deepEqual(R.holes, ["place", "user", "sec"])
  assert.equal(R.frame.find((f) => f.id === "setting")!.text, "S {{place}}")
  // a persona, a local name, a player's slot text over the card's: each closes its hole
  const named = resolve(card, {
    local: {
      id: "local",
      name: "local",
      card: card.id,
      names: { sec: "节" },
      fragments: [{ id: "setting", text: "S" }],
    },
    persona: { name: "阿青", text: "P" },
  })
  assert.deepEqual(named.holes, [])
  // a card's product and ask keep their wording with the hole in it; a player row's rewording takes the product over
  const asked: Card = {
    ...chat,
    products: [
      { id: "q", text: "Q {{x}}", shape: { kind: "text" }, role: "theater", stage: "narrate" },
    ] as Card["products"],
    asks: [{ id: "lookup", text: "LOOK {{y}}" }],
  }
  const A = resolve(asked, {})
  const q = A.products.find((p) => p.id === "q")!
  assert.deepEqual([q.text, q.unasked, A.asks["lookup"]!.text], ["Q {{x}}", undefined, "LOOK {{y}}"])
  const reworded = resolve(asked, {
    local: { id: "local", name: "local", card: chat.id, asks: [{ id: "product.q", text: "Q {{z}}" }] },
  })
  assert.deepEqual(reworded.products.find((p) => p.id === "q")!.unasked, true)
  // a nameless card under a global theater holding {{char}}: the theater stays out, the card runs (packs-brief §八)
  const ensemble = resolve(
    { ...chat, frame: [], greetings: [], lore: [] },
    { harness: row("harness", { products: [{ id: "aside", text: "{{char}} 的旁白" }] }) },
  )
  assert.deepEqual(ensemble.holes, ["char"])
  assert.equal(ensemble.products.find((p) => p.id === "aside")!.unasked, true)
}

// ───────── The overlay: the row a client edits is the merge, what is stored is the difference ─────────
{
  const h = harness("act")
  // the whole row back, with nothing changed: nothing stored
  const unchanged = overlayOf("act", overlaid("act"))
  assert.ok(empty(unchanged), JSON.stringify(unchanged))
  // one sentence, one product's text: only those, at field level
  const notes = h.products!.find((p) => p.id === "notes")!
  const edited: Layer = {
    ...h,
    asks: h.asks!.map((a) => (a.id === "lookup" ? { ...a, text: "MINE" } : a)),
    products: h.products!.map((p) => (p.id === "notes" ? { ...p, text: "N" } : p)),
    snippets: [...h.snippets!.filter((s) => s.name !== "继续"), { name: "new", text: "x" }],
    fragments: [{ id: "f", text: "F" }],
  }
  const stored = overlayOf("act", edited)
  assert.deepEqual(stored, {
    id: "harness",
    name: h.name,
    asks: [{ id: "lookup", text: "MINE" }],
    products: [{ id: "notes", text: "N" }],
    snippets: [{ name: "new", text: "x" }],
    fragments: [{ id: "f", text: "F" }],
  })
  // the merge shows it, and what was left out is the default again
  const back = overlaid("act", stored)
  assert.equal(back.asks!.find((a) => a.id === "lookup")!.text, "MINE")
  assert.deepEqual(
    back.products!.find((p) => p.id === "notes"),
    { ...notes, text: "N" },
  )
  assert.equal(
    back.snippets!.some((s) => s.name === "继续"),
    true,
  )
  assert.equal(back.asks!.length, h.asks!.length)
  // and resolve reads the stored form the same way
  const R = resolve(chat, { harness: stored })
  assert.deepEqual([R.asks["lookup"]!.text, R.asks["lookup"]!.from], ["MINE", "harness"])
  assert.deepEqual(R.products.find((p) => p.id === "notes")!.from, "harness")
  // the options question stays the card's channel's unless the overlay wrote one
  const optionsOf = (o?: Layer) =>
    resolve({ ...chat, input: "note" }, { harness: o }).products.find((p) => p.id === "options")!.text
  assert.match(optionsOf(stored), /Four directions/)
  assert.equal(optionsOf(row("harness", { products: [{ id: "options", text: "O" }] })), "O")
}

// ───────── `from` and the one redaction ─────────
{
  const c: Card = {
    ...chat,
    frame: [
      { id: "style", text: "SECRET" },
      { id: "t", text: "TAIL-SECRET", at: "tail" },
    ],
    asks: [{ id: "lookup", text: "ASK-SECRET" }],
    products: [{ role: "world" as const, id: "scene", text: "PRODUCT-SECRET", shape: { kind: "text" } }],
    lexicon: [{ pattern: "LEXICON-SHOWN" }], // a ban is a prompt, to a player too: it goes whole
  }
  const R = shown(resolve(c, { harness: row("harness", { fragments: [{ id: "mine", text: "MINE" }] }) }))
  const wire = JSON.stringify(R)
  assert.ok(!/SECRET/.test(wire), wire)
  assert.deepEqual(
    R.frame.map((f) => [f.id, f.from, "text" in f]),
    [
      ["mine", "harness", true],
      ["style", "card", false],
    ],
  )
  assert.equal(R.products.find((p) => p.id === "scene")!.from, "card")
  assert.ok("text" in R.products.find((p) => p.id === "notes")!) // the harness's question is the player's to read
  assert.ok(wire.includes("MINE"))
  assert.deepEqual(R.lexicon, [{ pattern: "LEXICON-SHOWN", from: "card" }])
  // cardView carries it, with the card's own projection beside it
  const v = cardView(c, {})
  assert.deepEqual(Object.keys(v).sort(), ["catalogs", "fiction", "greetings", "layer", "meta", "rules"])
  assert.ok(!/SECRET/.test(JSON.stringify(v)))
}

// ───────── A session: rows read per request ─────────
const canned = { notes: "N1", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }
const picks: string[][] = [] // the lookup's next answers
const prose = { text: "hello world" }
const model = () =>
  fake((o) => {
    const doc = readStage(o)
    if (doc.phase === "lookup") {
      const refs = o.prompt.some((m) => m.role === "tool") ? [] : (picks.shift() ?? [])
      return refs.length
        ? { text: "", toolCalls: [{ name: "read_context", input: { refs: refs.map((r) => `pack:${r}`) } }] }
        : { text: "Done" }
    }
    return doc.phase === "narrate" ? prose : defaultAnswer(doc, canned)
  })
const asked = (es: readonly Event[], phase: string) =>
  es.flatMap((e) => (e.kind === "call" && e.phase === phase ? [e.msgs] : [])).at(-1)
const texts = (msgs: readonly Message[] | undefined) =>
  (msgs ?? []).map((m) =>
    typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join(""),
  )
const mount = (...mounts: string[]) => here({ mounts })

// The lookup index, and replay once the pack is gone.
{
  const packA = row("packA", {
    entries: [{ id: "x", text: "The first sentence. The rest of it." }],
    fragments: [
      { id: "style", text: "PACK-STYLE" },
      { id: "taste", text: "PACK-TAIL", at: "tail" },
    ],
  })
  const packB = row("packB", { entries: [{ id: "y", text: "Unmounted." }] })
  const c = { ...chat, lore: [{ id: "own", layers: ["The card's own."], unlock: { all: [] }, offer: { any: [] } }] }
  const rows: Rows & { packs: Layer[] } = { local: mount("packA"), packs: [packA, packB] }
  const S = makeSession({
    card: c,
    rows: () => rows,
    model,
    policy: { budget: 0, keep: 1, block: 1 }, // the fold reads what was delivered: costIn, the summary
  })
  picks.push(["packA/x"])
  const first = await collect(S.act(null, { text: "one" }))
  const n1 = nodeOf(first)
  const lookup = texts(asked(first, "lookup")).join("\n")
  assert.ok(!lookup.includes("packA/x="), lookup) // prefixed, the hook is the first sentence
  assert.ok(!lookup.includes("own="), lookup)
  assert.ok(!lookup.includes("packB"), lookup) // not mounted, not readable
  assert.ok(!lookup.includes("The rest of it"), lookup)
  assert.equal(n1.delivered[0]!.text, "The first sentence. The rest of it.")
  assert.deepEqual(
    n1.playerCatalog.map((e) => e.resourceId),
    ["pack:packA/x"], // player catalog is independent of model residency
  )
  // the frame: the row's slot in the head, its tail fragment last in narrate alone
  const narrate = texts(asked(first, "narrate"))
  assert.ok(narrate.some((t) => t.includes("PACK-STYLE")))
  assert.equal(narrate.at(-1), "PACK-TAIL")
  assert.ok(!texts(asked(first, "record")).includes("PACK-TAIL"))
  const second = await collect(S.act(n1.id, { text: "two" }))
  const n2 = nodeOf(second)
  assert.ok(texts(asked(second, "narrate")).some((t) => t.includes("The first sentence. The rest of it.")))

  // Unmounted, read on the next request: nothing throws, the old node's delivery reads "", the frame and the index drop
  // it, and no empty message reaches the provider, from the transcript or from a reword reusing the read.
  rows.local = mount()
  assert.deepEqual(S.node(n1.id).delivered, n1.delivered)
  assert.deepEqual(
    S.snapshot().nodes.map((n) => n.id),
    [n1.id, n2.id],
  )
  const third = await collect(S.act(n2.id, { text: "three" }))
  const narrated = texts(asked(third, "narrate"))
  assert.ok(!narrated.some((t) => t === ""))
  assert.ok(!narrated.some((t) => t.includes("PACK-STYLE")))
  const sib = await collect(S.reword(n1.id))
  assert.ok(!texts(asked(sib, "narrate")).some((t) => t === ""))
  assert.ok(texts(asked(sib, "narrate")).some((t) => t.includes("The rest of it.")))

  // Deleted from the library while still mounted: the id is skipped, the same.
  rows.local = mount("packA")
  rows.packs.length = 0
  assert.deepEqual(S.node(n1.id).delivered, n1.delivered)
  assert.equal(S.snapshot().head, nodeOf(sib).id)
}

// Narration and settlement each resolve their own request configuration; retry can run independently.
{
  let reads = 0
  const S = makeSession({
    card: { ...chat, lore: [{ id: "l", layers: ["L."], unlock: { all: [] }, offer: { any: [] } }] },
    rows: () => (reads++, {}),
    model,
  })
  reads = 0
  const n = nodeOf(await collect(S.act(null, { text: "one" })))
  assert.equal(reads, 2)
  reads = 0
  S.node(n.id)
  S.snapshot()
  assert.equal(reads, 2)
}

// The lexicon: a row's hit is a polish call; `polish: false` from any rank turns the stage off.
{
  prose.text = "hello world ".repeat(20) // over the polish floor
  const slop = row("slop", { lexicon: [{ pattern: "hello", hint: "PACK-HINT" }] })
  const session = (r: Rows) =>
    makeSession({ card: { ...chat, lexicon: [{ pattern: "hello", hint: "CARD-HINT" }] }, rows: () => r, model })
  const es = await collect(
    session({
      packs: [slop],
      local: here({ mounts: ["slop"], lexicon: [{ pattern: "hello", hint: "MINE-HINT" }] }),
    }).act(null, { text: "x" }),
  )
  const polish = texts(asked(es, "polish")).join("\n")
  assert.ok(/MINE-HINT; PACK-HINT; CARD-HINT/.test(polish), polish)
  const off = await collect(
    session({ harness: row("harness", { switches: { polish: false } }) }).act(null, { text: "x" }),
  )
  assert.equal(asked(off, "polish"), undefined)
  const unmounted = await collect(
    makeSession({ card: chat, rows: () => ({ packs: [slop] }), model }).act(null, { text: "x" }),
  )
  assert.equal(asked(unmounted, "polish"), undefined)
}

// A row's product: asked of the narrator, on a node, demandable when off; a lock's refusal leaves the session open.
{
  prose.text = "hello\n<<aside>> town\nGOSSIP"
  const narrateAsks = (es: readonly Event[], line: string) => texts(asked(es, "narrate")).join("\n").includes(line)
  const town = { id: "town", label: "T", text: "The town's gossip." }
  const rows: Rows = { packs: [row("t", { products: [{ ...town, on: true }] })], local: mount("t") }
  const S = makeSession({ card: chat, rows: () => rows, model })
  const es = await collect(S.act(null, { text: "a" }))
  assert.ok(narrateAsks(es, "town: The town's gossip."))
  assert.ok(!texts(asked(es, "record")).join("\n").includes("town: "))
  const n1 = nodeOf(es)
  assert.equal(n1.turn.products.town, "GOSSIP")
  assert.equal(proseOf(n1.turn).trim(), "hello")
  // off, read per request: not asked, still there for a demand
  prose.text = "hello"
  rows.packs = [row("t", { products: [{ ...town, on: false }] })]
  const off = await collect(S.act(n1.id, { text: "b" }))
  assert.ok(!narrateAsks(off, "town: "))
  const n2 = nodeOf(off)
  assert.equal(n2.turn.products.town, undefined)
  const declared = S.layer.products.find((p) => p.id === "town")!
  assert.deepEqual([kindOf(declared), declared.on, declared.text, declared.from], ["theater", false, town.text, "t"])
  prose.text = "DEMANDED"
  assert.equal(nodeOf(await collect(S.demand(n2.id, "town"))).turn.products.town, "DEMANDED")
  // the local row's `on` over the pack's
  prose.text = "hello"
  rows.local = here({ mounts: ["t"], products: [{ id: "town", on: true }] })
  assert.ok(narrateAsks(await collect(S.act(n2.id, { text: "c" })), "town: "))
  // a patch on a record product rewords its question where record asks it
  rows.local = here({ products: [{ id: "notes", text: "MY-NOTES" }] })
  assert.ok(
    texts(asked(await collect(S.act(n2.id, { text: "d" })), "record"))
      .join("\n")
      .includes("notes: MY-NOTES"),
  )

  // a refused row opens: a new id with no text, in the ledger, and the session runs as it would without
  const refused = makeSession({
    card: chat,
    rows: () => ({ harness: row("harness", { products: [{ id: "x", label: "X" }] }) }),
    model,
  })
  assert.deepEqual(
    refused.layer.dropped.map((d) => d.id),
    ["x"],
  )
  assert.equal(
    refused.layer.products.some((p) => p.id === "x"),
    false,
  )
  await collect(refused.act(null, { text: "x" }))
}

console.log("layer ok")
