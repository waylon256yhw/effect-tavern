// src/lint.ts: one bad card per rule, and the four template cards with every warning they carry listed.
import assert from "node:assert/strict"
import type { Card } from "../src/card.ts"
import { lint } from "../src/lint.ts"
import { loadCard } from "./cards/index.ts"

const base: Card = {
  id: "t",
  frame: [],
  fiction: [],
  greetings: [{ text: "开场。" }],
  rules: { fields: [], actions: [] },
  lore: [],
  guard: [],
}
const of = (card: Card) => lint(card).map((d) => `${d.level} ${d.rule} ${d.path}`)
const said = (card: Card, rule: string) =>
  lint(card)
    .filter((d) => d.rule === rule)
    .map((d) => `${d.level} ${d.path}: ${d.message}`)
const bond = { path: "bond", type: "int", min: 0, max: 20, initial: 0 } as const
const readout = {
  id: "warmth",
  text: "态度",
  options: [{ id: "warm", text: "暖", do: [{ path: "bond", add: 4 }] }],
}

// orphan-event: a window on an event nothing emits is an error; an emitted event nothing reads is a warn. `{path}`
// interpolation names a family of events.
assert.deepEqual(
  of({
    ...base,
    rules: {
      fields: [bond],
      actions: [
        { id: "talk", text: "说话", do: [{ event: "talked" }] },
        { id: "gift", text: "送礼", do: [{ event: "gift:{bond}" }] },
      ],
    },
    lore: [
      {
        id: "x",
        layers: ["甲。", "乙。"],
        unlock: { all: [] },
        offer: { any: [{ event: "fought" }, { event: "gift:3" }] },
      },
    ],
  }).filter((d) => d.includes("orphan-event")),
  ["error orphan-event lore.x.offer", "warn orphan-event rules.actions.talk.do[0]"],
)

// dead-field: nothing writes it in play; a hidden field nothing reads.
assert.deepEqual(
  said(
    {
      ...base,
      rules: {
        fields: [bond, { path: "end", type: "boolean", initial: false, hidden: true }],
        actions: [],
        readouts: [readout],
      },
    },
    "dead-field",
  ),
  [
    "warn rules.fields.end: no action or readout writes end: it never moves in play",
    "warn rules.fields.end: end is hidden and nothing reads it (no when, unlock, offer or heading)",
  ],
)

// prose-cannot-move: written by actions only while the card has readouts. No readouts at all = mechanical by choice.
const gold = { path: "gold", type: "int", min: 0, initial: 0 } as const
const pay = { id: "pay", text: "付钱", do: [{ path: "gold", add: 3 }] }
assert.deepEqual(
  said({ ...base, rules: { fields: [bond, gold], actions: [pay], readouts: [readout] } }, "prose-cannot-move"),
  ["warn rules.fields.gold: gold: written by actions only; the prose cannot move it."],
)
assert.deepEqual(said({ ...base, rules: { fields: [gold], actions: [pay] } }, "prose-cannot-move"), [])

// band-gap: variants on one field cover 0..20 edge to edge, or the lint names the hole / the overlap.
const banded = (...whens: Card["fiction"][number]["when"][]): Card => ({
  ...base,
  fiction: whens.map((when, i) => ({ id: `b${i}`, text: "带。", when })),
  rules: { fields: [bond], actions: [], readouts: [readout] },
})
assert.deepEqual(
  said(banded({ path: "bond", op: "lt", value: 8 }, { path: "bond", op: "gte", value: 8 }), "band-gap"),
  [],
)
assert.deepEqual(
  said(banded({ path: "bond", op: "lt", value: 8 }, { path: "bond", op: "gt", value: 12 }), "band-gap"),
  ["warn rules.fields.bond: no fiction variant on bond holds at 8..12 (variants: b0, b1)"],
)
assert.deepEqual(
  said(
    banded({ path: "bond", op: "lte", value: 8 }, { path: "bond", op: "gte", value: 8 }, { path: "bond", is: 20 }),
    "band-gap",
  ),
  [
    "warn rules.fields.bond: fiction variants b0, b1 all hold at 8",
    "warn rules.fields.bond: fiction variants b1, b2 all hold at 20",
  ],
)
assert.deepEqual(said(banded({ path: "bond", op: "lt", value: 8 }), "band-gap"), []) // one variant is an addition, not bands

// unreachable-layer: an unlock outside the bounds; layers past every unlock behind an offer that never holds.
// `{ any: [] }` as layer 1's unlock is the card saying "not in play" and is left alone.
const lored = (lore: Card["lore"]): Card => ({
  ...base,
  rules: { fields: [bond], actions: [], readouts: [readout] },
  lore,
})
assert.deepEqual(
  said(
    lored([
      {
        id: "a",
        layers: ["一。", "二。"],
        unlock: [{ all: [] }, { path: "bond", op: "gt", value: 20 }],
        offer: { not: { all: [] } },
      },
      {
        id: "b",
        layers: ["一。", "二。"],
        unlock: { all: [] },
        offer: {
          all: [
            { path: "bond", op: "lt", value: 3 },
            { path: "bond", op: "gt", value: 5 },
          ],
        },
      },
      { id: "c", layers: ["一。", "二。"], unlock: { all: [] }, offer: { path: "lore.c.since", op: "gte", value: 3 } },
      { id: "d", layers: ["一。"], unlock: { any: [] }, offer: { all: [] } },
    ]),
    "unreachable-layer",
  ),
  [
    "warn lore.a.unlock[1]: no state within the fields' bounds satisfies layer 2's unlock together with the layers before it",
    "warn lore.a.layers[1]: layers 2..2 lie past every reachable unlock and the offer never holds",
    "warn lore.b.layers[1]: layers 2..2 lie past every reachable unlock and the offer never holds",
  ],
)

// hook-length: the first sentence of layers[0], as the index will cut it.
assert.deepEqual(
  said(
    lored([{ id: "h", layers: [`${"长".repeat(41)}。后面不算。`], unlock: { all: [] }, offer: { all: [] } }]),
    "hook-length",
  ),
  [`warn lore.h.layers[0]: the hook is 42 characters (ceiling 40): 「${"长".repeat(41)}。」`],
)

// field-in-prose: a field next to a number or a comparison, in any text the narrator reads. Dialogue is skipped.
assert.deepEqual(
  of({
    ...lored([{ id: "l", layers: ["当bond大于8时，他会说实话。"], unlock: { all: [] }, offer: { all: [] } }]),
    fiction: [{ id: "f", text: "bond达到12以后她不再试探。" }],
    greetings: [{ text: "她说：「bond 3 了。」" }],
  }),
  ["error field-in-prose fiction.f.text", "error field-in-prose lore.l.layers[0]"],
)

// inline-product: an output format asked in the text.
assert.deepEqual(of({ ...base, frame: [{ id: "style", text: "每次回复末尾附上状态栏，并给出三个选项。" }] }), [
  "error inline-product frame.style.text",
])
assert.match(lint({ ...base, frame: [{ id: "style", text: "在回复的末尾列出选项。" }] })[0]!.hint!, /product/)

// The template cards: no errors, and exactly these warnings (a new one fails here until it is meant).
const templates: Record<string, string[]> = {
  wuxia: [
    "warn orphan-event rules.actions.strike.miss[1]", // the miss reaches the narrator as a ledger line; nothing opens on it
    "warn prose-cannot-move rules.fields.foe", // the duel is mechanical
    "warn prose-cannot-move rules.fields.hp",
  ],
  banxing: [],
  ri: [
    "warn orphan-event rules.readouts.confession.options.accepted.do[1]", // the confession's outcome is a ledger line
    "warn orphan-event rules.readouts.confession.options.refused.do[1]",
  ],
  yandao: ["warn dead-field rules.fields.起点"], // set once by the second greeting, read by a fiction variant
}
for (const [name, want] of Object.entries(templates)) assert.deepEqual(of(await loadCard(name)), want, name)
console.log("ok")
