// Tests for src/fragment.ts (+ history over Turn[]): §8's `assemble` re-done over layers + Turn[] + stage.
// Head = player layer → card frame → fiction (the card's character, cast or world); audience per stage comes from the layer, not from a per-fragment field.
// Dropped from Fragment: keys, trigger, depth, scan, before/after anchors, order. Kept: when, enabled/options.
import assert from "node:assert/strict"
import {
  decodeFragments as frags,
  frame,
  head,
  writing,
  type Fragment,
  type Msg,
  type Player,
  type Writing,
} from "../src/fragment.ts"
import { ledger, narratorHistory } from "../src/history.ts"
import type { Turn } from "../src/journal.ts"

interface Card {
  id: string
  frame: readonly Fragment[]
  character: readonly Fragment[]
}
type Stage = "direct" | "narrate"
type T = Turn<never>
const turn = (text: string, prose: string, notes: string[]): T => ({
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
  player: Player,
  card: Card,
  path: readonly T[],
  stage: Stage,
  input: string,
  { state = {} as Record<string, unknown>, options = {} as Record<string, boolean> } = {},
): Msg[] => {
  const layers = stage === "narrate" ? [...frame(player, card), ...card.character] : frame(player, card) // audience = layer
  const history = stage === "narrate" ? narratorHistory(path, () => "") : ledger(path, () => [])
  return [...head(layers, { state, options }), ...history, { role: "user", text: input }]
}

// ───────── Checks ─────────
const player: Player = {
  global: frags([
    { id: "language", text: "Write in Chinese." },
    { id: "length", text: "Two paragraphs." },
    { id: "persona", text: "Player: a quiet traveller." },
    { id: "mood", text: "Keep it gentle today.", when: { path: "player.tired", is: true } },
  ]),
  forCard: {
    wuxia: frags([
      { id: "length", text: "Long, four paragraphs." }, // default for per-card: override
      { id: "persona", text: "Player: a sword student." },
      { id: "tone", text: "Warm underneath.", mode: "both" }, // coexists with the card's tone
      { id: "setting", text: "Any era is fine.", mode: "yield" }, // the card's setting wins
    ]),
  },
}
const card: Card = {
  id: "wuxia",
  frame: frags([
    { id: "setting", text: "Late Ming, no firearms." },
    { id: "length", text: "One paragraph." },
    { id: "tone", text: "Terse." },
    { id: "cot", text: "Think before you write." },
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
let v = assemble(player, card, path, "narrate", "go", { state: s0 })
assert.deepEqual(texts(v).slice(0, 8), [
  "Write in Chinese.",
  "Long, four paragraphs.",
  "Player: a sword student.",
  "Warm underneath.", // player zone
  "Late Ming, no firearms.",
  "Terse.",
  "Think before you write.", // card frame; "One paragraph." overridden, setting kept
  "A: wandering swordsman.",
])
for (const gone of ["One paragraph.", "Two paragraphs.", "Any era is fine."]) assert.ok(!texts(v).includes(gone))
// No per-card settings: global entries yield by default, so they fill only the slots the card left empty.
v = assemble(player, other, [], "narrate", "go", { state: s0 })
assert.deepEqual(texts(v), [
  "Write in Chinese.",
  "Two paragraphs.",
  "Player: a quiet traveller.",
  "Space station.",
  "go",
])
// The player flips the default: global overrides everywhere, so the card's "One paragraph." loses to "Two paragraphs."
v = assemble({ ...player, forCard: {}, defaults: { global: "override" } }, card, [], "narrate", "go", { state: s0 })
assert.ok(texts(v).includes("Two paragraphs.") && !texts(v).includes("One paragraph."))
// Default is a setting, not a rule: per-card entries can be made to yield wholesale.
v = assemble({ ...player, defaults: { forCard: "yield" } }, card, [], "narrate", "go", { state: s0 })
assert.ok(texts(v).includes("One paragraph.") && !texts(v).includes("Long, four paragraphs."))

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
assert.deepEqual(texts(b).slice(0, 5), [
  "Write in Chinese.",
  "Long, four paragraphs.",
  "Player: a sword student.",
  "Keep it gentle today.", // global `when` fragment, in its own place in the player zone
  "Warm underneath.",
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

// Writing switches: pov, echo and agency compile into one `pov` slot (so a card that fills `pov` itself, 盐道, takes the
// whole group), verbosity into its own; a global free-text fragment on the same slot wins; "none" drops echo and agency.
const w: Writing = { pov: "second", echo: false, agency: "strict", verbosity: "concise" }
assert.deepEqual(
  writing(w).map((f) => f.id),
  ["pov", "verbosity"],
)
assert.ok(
  /「你」/.test(writing(w)[0]!.text!) && /不要转述/.test(writing(w)[0]!.text!) && /只承接/.test(writing(w)[0]!.text!),
)
assert.deepEqual(
  writing({ pov: "none", echo: true, agency: "free" }).map((f) => f.text!.includes("转述")),
  [false],
)
assert.deepEqual(writing({}), [])
const switched: Player = { writing: w, global: frags([{ id: "language", text: "Write in Chinese." }]), forCard: {} }
v = assemble(switched, other, [], "narrate", "go", { state: s0 })
assert.deepEqual(texts(v).slice(0, 2), [writing(w)[0]!.text!, writing(w)[1]!.text!]) // compiled slots lead the player zone
const povCard: Card = { ...other, frame: frags([{ id: "pov", text: "全知第三人称。" }]) }
v = assemble(switched, povCard, [], "narrate", "go", { state: s0 })
assert.ok(texts(v).includes("全知第三人称。") && !texts(v).some((t) => /只承接/.test(t))) // the card's pov takes echo and agency with it
v = assemble({ ...switched, global: frags([{ id: "pov", text: "My own pov." }]) }, other, [], "narrate", "go", {
  state: s0,
})
assert.ok(texts(v).includes("My own pov.") && !texts(v).some((t) => /「你」/.test(t))) // free text on the slot wins

console.log(texts(b).join("\n"))
console.log("ok")
