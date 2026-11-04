// Writing packs (docs/packs-brief.md), the five seams: the frame, the lookup index, replay after a pack is gone, the
// lexicon, the product toggles, the quick inputs. A session over a scripted model; what the wire does with a pack is
// the server's test/serve.ts and test/library.ts.
import { fake, type Message } from "@effect-tavern/provider"
import { Effect, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { frame, mounted, Pack, type Player } from "../src/fragment.ts"
import { cardView, makeSession, snippets, type Event } from "../src/session.ts"
import { chat, plain } from "./cards/index.ts"
import { defaultAnswer, readStage } from "./script.ts"

const decodePack = Schema.decodeUnknownSync(Pack)

// ───────── The frame: global → packs in mount order → per-card → the card's ─────────
{
  const card = { id: "c", frame: [{ id: "style", text: "CARD" }] }
  const a: Pack = {
    id: "a",
    name: "A",
    fragments: [
      { id: "style", text: "PACK-A" },
      { id: "voice", text: "VOICE-A" },
    ],
  }
  const b: Pack = { id: "b", name: "B", fragments: [{ id: "style", text: "PACK-B" }] }
  const global: Player = { global: [{ id: "style", text: "GLOBAL" }], forCard: {} }
  const texts = (p: Player, ...packs: Pack[]) => frame(p, card, packs).map((f) => f.text)
  // over global, the later pack over the earlier; a pack's mode defaults like per-card (override), so the card's goes
  assert.deepEqual(texts(global, a), ["PACK-A", "VOICE-A"])
  assert.deepEqual(texts(global, a, b), ["PACK-B", "VOICE-A"])
  // the player's defaults.forCard is the pack's default too: on yield, the card's slot stands
  assert.deepEqual(texts({ ...global, defaults: { forCard: "yield" } }, a), ["VOICE-A", "CARD"])
  // per-card still has the last word on the slot
  assert.deepEqual(texts({ ...global, forCard: { c: [{ id: "style", text: "MINE" }] } }, a), ["MINE", "VOICE-A"])
  // an item switched off is not there: the global slot under it and the card's stand
  const off: Pack = { id: "o", name: "O", fragments: [{ id: "style", text: "OFF", enabled: false }] }
  assert.deepEqual(texts(global, off), ["CARD"])
  assert.deepEqual(texts({ global: [], forCard: {} }, off), ["CARD"])
  // a pack has no role and no Cond: both are gone at the boundary
  const decoded = decodePack({
    id: "d",
    name: "D",
    fragments: [{ id: "x", text: "T", role: "user", when: { all: [] } }],
  })
  assert.deepEqual(decoded.fragments, [{ id: "x", text: "T" }])
  // mount order, an id the library lacks skipped
  assert.deepEqual(
    mounted({ ...global, packs: { c: ["b", "gone", "a", "b"] } }, "c", [a, b]).map((p) => p.id),
    ["b", "a"],
  )
}

// ───────── A session on the scripted model ─────────
const on = (...ids: string[]): Player => ({ ...plain, packs: { [chat.id]: ids } })
const canned = { notes: "N1", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }
const picks: string[][] = [] // the lookup's next answers
const prose = { text: "hello world" }
const model = () =>
  fake((o) => {
    const doc = readStage(o)
    if (doc.phase === "lookup") return { text: JSON.stringify({ read: picks.shift() ?? [] }) }
    return doc.phase === "narrate" ? prose : defaultAnswer(doc, canned)
  })
const collect = (s: Stream.Stream<Event, unknown>) =>
  Effect.runPromise(Stream.runCollect(s)).then((c) => [...c] as Event[])
const nodeOf = (es: readonly Event[]) => es.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
const asked = (es: readonly Event[], phase: string) =>
  es.flatMap((e) => (e.kind === "call" && e.phase === phase ? [e.msgs] : [])).at(-1)
const texts = (msgs: readonly Message[] | undefined) =>
  (msgs ?? []).map((m) =>
    typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join(""),
  )

const packA: Pack = {
  id: "packA",
  name: "A",
  entries: [{ id: "x", text: "The first sentence. The rest of it." }],
  fragments: [
    { id: "style", text: "PACK-STYLE" },
    { id: "taste", text: "PACK-TAIL", at: "tail" },
  ],
}
const packB: Pack = { id: "packB", name: "B", entries: [{ id: "y", text: "Unmounted." }] }
const lore = [
  {
    id: "own",
    layers: ["The card's own."],
    unlock: { all: [] },
    offer: { any: [] },
  },
]
const card = { ...chat, lore }

// ───────── The lookup index, and replay once the pack is gone ─────────
{
  const library: Pack[] = [packA, packB]
  const S = makeSession({
    card,
    player: on("packA"),
    model,
    packs: () => library,
    policy: { budget: 0, keep: 1, block: 1 }, // the fold reads what was delivered: costIn, the summary
  })
  picks.push(["packA/x"])
  const first = await collect(S.act(null, { text: "one" }))
  const n1 = nodeOf(first)
  const lookup = texts(asked(first, "lookup")).join("\n")
  assert.ok(lookup.includes("packA/x=The first sentence."), lookup) // prefixed, the hook is the first sentence
  assert.ok(lookup.includes("own=The card's own."), lookup) // the card's own beside it
  assert.ok(!lookup.includes("packB"), lookup) // not mounted, not readable
  assert.ok(!lookup.includes("The rest of it"), lookup)
  assert.deepEqual(n1.delivered, [{ id: "packA/x", layer: 1, text: "The first sentence. The rest of it." }])
  assert.deepEqual(
    n1.readable.map((e) => e.id),
    ["own"], // told: no longer readable; the card's entry still is
  )
  // the frame: the pack's slot in the head, its tail fragment last in narrate alone
  const narrate = texts(asked(first, "narrate"))
  assert.ok(narrate.includes("PACK-STYLE"))
  assert.equal(narrate.at(-1), "PACK-TAIL")
  assert.ok(!texts(asked(first, "record")).includes("PACK-TAIL"))

  // A later turn: the entry goes back to the narrator while the pack is mounted.
  const second = await collect(S.act(n1.id, { text: "two" }))
  const n2 = nodeOf(second)
  assert.ok(texts(asked(second, "narrate")).includes("The first sentence. The rest of it."))

  // Unmounted: nothing throws, the old node's delivery reads "", the frame and the index drop it, and no empty message
  // reaches the provider, from the transcript or from a reword reusing the read.
  S.setPlayer(on())
  assert.deepEqual(S.node(n1.id).delivered, [{ id: "packA/x", layer: 1, text: "" }])
  assert.deepEqual(
    S.snapshot().nodes.map((n) => n.id),
    [n1.id, n2.id],
  )
  const third = await collect(S.act(n2.id, { text: "three" }))
  const narrated = texts(asked(third, "narrate"))
  assert.ok(!narrated.some((t) => t === ""))
  assert.ok(!narrated.includes("PACK-STYLE"))
  const sib = await collect(S.reword(n1.id))
  assert.ok(!texts(asked(sib, "narrate")).some((t) => t === ""))

  // Deleted from the library while still mounted: the id is skipped, the same.
  S.setPlayer(on("packA"))
  library.length = 0
  assert.deepEqual(S.node(n1.id).delivered, [{ id: "packA/x", layer: 1, text: "" }])
  assert.equal(S.snapshot().head, nodeOf(sib).id)
}

// ───────── Lexicon: the player's, the packs', the card's; a hit is a polish call ─────────
{
  prose.text = "hello world ".repeat(20) // over the polish floor
  const slop: Pack = { id: "slop", name: "S", lexicon: [{ pattern: "hello", hint: "PACK-HINT" }] }
  const hit = (p: Player) =>
    makeSession({
      card: { ...chat, lexicon: [{ pattern: "hello", hint: "CARD-HINT" }] },
      player: p,
      model,
      packs: () => [slop],
    })
  const es = await collect(
    hit({ ...on("slop"), writing: { lexicon: [{ pattern: "hello", hint: "MINE-HINT" }] } }).act(null, { text: "x" }),
  )
  const polish = texts(asked(es, "polish")).join("\n")
  assert.ok(/MINE-HINT; PACK-HINT; CARD-HINT/.test(polish), polish)
  const unmounted = await collect(
    makeSession({ card: chat, player: plain, model, packs: () => [slop] }).act(null, { text: "x" }),
  )
  assert.equal(asked(unmounted, "polish"), undefined)
}

// ───────── Products: the player's toggle over the packs', and a pack edit in force from the next request ─────────
{
  const asks = (es: readonly Event[], id: string) =>
    texts(asked(es, "record")).some((t) => new RegExp(`^${id}: `, "m").test(t))
  const library: Pack[] = [{ id: "quiet", name: "Q", products: { options: false } }]
  const bare = (...ids: string[]): Player => ({ global: [], forCard: {}, packs: { [chat.id]: ids } }) // no toggle of its own
  const S = makeSession({ card: chat, player: bare("quiet"), model, packs: () => library })
  assert.equal(asks(await collect(S.act(null, { text: "a" })), "options"), false)
  library[0] = { id: "quiet", name: "Q", products: { options: true } } // no setPlayer: the row is read per request
  assert.equal(asks(await collect(S.act(null, { text: "b" })), "options"), true)
  library[0] = { id: "quiet", name: "Q", products: { options: false } }
  S.setPlayer({ ...bare("quiet"), products: { options: true } })
  assert.equal(asks(await collect(S.act(null, { text: "c" })), "options"), true) // the player wins
  // of two packs, the later one wins
  library.push({ id: "loud", name: "L", products: { options: true } })
  S.setPlayer(bare("quiet", "loud"))
  assert.equal(asks(await collect(S.act(null, { text: "d" })), "options"), true)
}

// ───────── Quick inputs: the player's, the packs', the defaults, through the same note-channel filter ─────────
{
  const mine = { name: "mine", text: "M" }
  const a = { name: "a", text: "A" }
  const thought = { name: "thought", text: "⦅", after: "⦆" }
  const pack: Pack = { id: "p", name: "P", snippets: [a, thought] }
  const player = { ...plain, snippets: [mine] }
  assert.deepEqual(cardView(chat, player, [pack]).snippets, [mine, a, thought, ...snippets])
  const note = cardView({ ...chat, input: "note" }, player, [pack]).snippets
  assert.ok(note.includes(a) && !note.includes(thought))
  const S = makeSession({ card: chat, player: { ...player, packs: { [chat.id]: ["p"] } }, model, packs: () => [pack] })
  assert.deepEqual(S.snippets.slice(0, 3), [mine, a, thought])
}

console.log("packs ok")
