// Tests for src/fragment.ts `head` (+ history over Turn[]), over the frame layer.ts resolves: §8's `assemble` re-done over layers + Turn[] + stage.
// Head = player layer → card frame → fiction (the card's character, cast or world); audience per stage comes from the layer, not from a per-fragment field.
// Dropped from Fragment: keys, trigger, depth, scan, before/after anchors, order. Kept: when, enabled/options.
import assert from "node:assert/strict"
import { decodeFragments as frags, head, type Fragment, type Msg } from "../src/fragment.ts"
import { ledger, narratorHistory } from "../src/history.ts"
import type { Turn } from "../src/journal.ts"
import { resolve, type Rows } from "../src/layer.ts"
import { chat } from "./cards/index.ts"

interface Card {
  id: string
  frame: readonly Fragment[]
  character: readonly Fragment[]
}
type Stage = "direct" | "narrate"
type T = Turn<never>
const turn = (text: string, prose: string, notes: string[]): T => ({
  changes: [],
  settlementStatus: "committed",
  settlementVersion: 0,
  id: 0,
  parent: null,
  input: { text },
  read: [],
  beats: [],
  answers: {},
  end: "end",
  brief: { must: [], may: [] },
  reply: [{ type: "text", text: prose }],
  fired: [],
  violated: [],
  products: { notes },
})

const assemble = (
  rows: Rows,
  card: Card,
  path: readonly T[],
  stage: Stage,
  input: string,
  { state = {} as Record<string, unknown>, options = {} as Record<string, boolean> } = {},
): Msg[] => {
  const R = resolve({ ...chat, id: card.id, frame: card.frame, fiction: [] }, rows)
  const layers = stage === "narrate" ? [...R.frame, ...card.character] : R.frame // audience = layer
  const history = stage === "narrate" ? narratorHistory(path, () => "") : ledger(path, () => [])
  return [...head(layers, { state, options }), ...history, { role: "user", text: input }]
}

// ───────── Checks ─────────
// the overlay's fragments yield to the card's slot; the local row's override it, per slot. `when` is the card's alone (the
// lock strips it from a player's row), so the state-dependent fragment below is the card's.
const overlay = (mode?: "override") => ({
  id: "harness",
  name: "harness",
  fragments: frags([
    { id: "language", text: "Write in Chinese." },
    { id: "length", text: "Two paragraphs.", ...(mode && { mode }) },
    { id: "persona", text: "Player: a quiet traveller." },
  ]),
})
const local = {
  id: "local",
  name: "local",
  card: "wuxia",
  fragments: frags([
    { id: "length", text: "Long, four paragraphs." }, // default: override
    { id: "persona", text: "Player: a sword student." },
    { id: "tone", text: "Warm underneath.", mode: "both" }, // coexists with the card's tone
    { id: "setting", text: "Any era is fine.", mode: "yield" }, // the card's setting wins
  ]),
}
const player: Rows = { harness: overlay(), local }
const card: Card = {
  id: "wuxia",
  frame: frags([
    { id: "setting", text: "Late Ming, no firearms." },
    { id: "length", text: "One paragraph." },
    { id: "tone", text: "Terse." },
    { id: "cot", text: "Think before you write." },
    { id: "mood", text: "Keep it gentle today.", when: { path: "player.tired", is: true } },
  ]),
  character: frags([
    { id: "a", text: "A: wandering swordsman." },
    { id: "a-trust", text: "A trusts the player.", when: { path: "a.trust", op: "gte", value: 50 } },
  ]),
}
const other: Card = { id: "other", frame: frags([{ id: "setting", text: "Space station." }]), character: [] }
const path: T[] = [turn("hello", "PROSE#0", ["NOTE#0"])]
const texts = (m: Msg[]) => m.map((x) => x.text)
const s0 = { player: { tired: false }, a: { trust: 10 } }

// Three relations, chosen per slot by the player: override (length), both (tone), yield (setting); untouched slots fill.
// A slot takes its place where it first stands: the overlay's yielding "length" never stood, so the local one comes later.
let v = assemble(player, card, path, "narrate", "go", { state: s0 })
assert.deepEqual(texts(v).slice(0, 8), [
  "Write in Chinese.",
  "Player: a sword student.",
  "Long, four paragraphs.",
  "Warm underneath.", // player zone
  "Late Ming, no firearms.",
  "Terse.",
  "Think before you write.", // card frame; "One paragraph." overridden, setting kept
  "A: wandering swordsman.",
])
for (const gone of ["One paragraph.", "Two paragraphs.", "Any era is fine."]) assert.ok(!texts(v).includes(gone))
// No local row: the overlay's yielding slot fills only where the card left it empty.
v = assemble({ harness: overlay() }, other, [], "narrate", "go", { state: s0 })
assert.deepEqual(texts(v), [
  "Write in Chinese.",
  "Two paragraphs.",
  "Player: a quiet traveller.",
  "Space station.",
  "go",
])
// An overlay's fragment that says override: the card's "One paragraph." loses to "Two paragraphs."
v = assemble({ harness: overlay("override") }, card, [], "narrate", "go", { state: s0 })
assert.ok(texts(v).includes("Two paragraphs.") && !texts(v).includes("One paragraph."))

// Audience by layer: the director sees player + frame, never the character; its history has no prose.
v = assemble(player, card, path, "direct", "go", { state: s0 })
assert.ok(!texts(v).some((t) => /A:|PROSE#/.test(t)) && texts(v).includes("Late Ming, no firearms."))
assert.ok(texts(v).some((t) => t.startsWith("Ledger:") && t.includes("NOTE#0")))
v = assemble(player, card, path, "narrate", "go", { state: s0 })
assert.ok(texts(v).includes("PROSE#0"))

// Order is the document's: a `when` fragment appears where the author put it, not moved to the end for the cache.
const a = assemble(player, card, path, "narrate", "go", { state: s0 })
const b = assemble(player, card, path, "narrate", "go", { state: { player: { tired: true }, a: { trust: 80 } } })
assert.ok(!texts(a).includes("Keep it gentle today.") && !texts(a).includes("A trusts the player."))
assert.deepEqual(texts(b).slice(4, 8), [
  "Late Ming, no firearms.",
  "Terse.",
  "Think before you write.",
  "Keep it gentle today.", // the card's `when` fragment, in its own place in the card zone
])
assert.deepEqual(texts(b).slice(-5, -2), ["A: wandering swordsman.", "A trusts the player.", "hello"]) // character zone, then history
assert.equal(b.length, a.length + 2)

// Options: a disabled fragment vanishes; an empty-text fragment is a slot and emits nothing.
assert.ok(
  !texts(assemble(player, card, [], "narrate", "go", { state: s0, options: { cot: false } })).includes(
    "Think before you write.",
  ),
)
assert.ok(
  !texts(assemble(player, { ...card, frame: frags([{ id: "x" }]) }, [], "narrate", "go", { state: s0 })).includes(
    undefined as never,
  ),
)

console.log(texts(b).join("\n"))
console.log("ok")
