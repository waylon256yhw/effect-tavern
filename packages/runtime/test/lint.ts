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

// The lore namespace is reserved for derived counters, including paths a card tries to declare below it.
for (const path of ["lore", "lore.li.since", "lore.custom"]) {
  const ds = lint({ ...base, rules: { fields: [{ path, type: "int", initial: 0 }], actions: [] } })
  assert.ok(ds.some((d) => d.rule === "reserved-path" && d.level === "error" && d.path === `rules.fields.${path}`))
}
assert.ok(
  !lint({ ...base, rules: { fields: [{ path: "lorekeeper", type: "int", initial: 0 }], actions: [] } }).some(
    (d) => d.rule === "reserved-path",
  ),
)
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

// An opening switch (`start`, or a greeting's `do`) is written when the story opens; it is dead only if nothing reads it.
const when = { path: "line", is: "b" } as const
const line = { path: "line", type: "enum", options: ["a", "b"], initial: "a" } as const
const opened = (fields: Card["rules"]["fields"], extra: Partial<Card> = {}) =>
  said({ ...base, rules: { fields, actions: [] }, ...extra }, "dead-field")
assert.deepEqual(opened([{ ...line, start: true }], { fiction: [{ id: "f", text: "乙。", when }] }), [])
assert.deepEqual(opened([{ ...line, start: true }]), [
  "warn rules.fields.line: line is an opening switch and nothing reads it (no when, unlock, offer or heading)",
])
assert.deepEqual(
  opened([line], {
    fiction: [{ id: "f", text: "乙。", when }],
    greetings: [{ text: "开场。", do: [{ path: "line", set: "b" }] }],
  }),
  [],
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

// bad-section: `#` is the joint of `card:<entry>#<section>`; ids unique per entry; at most 8. An empty one is empty-text.
{
  const sections = (ids: string[]) => ids.map((id) => ({ id, text: "节。" }))
  const card = lored([
    { id: "x#y", layers: ["一。"], unlock: { all: [] }, offer: { all: [] } },
    { id: "s", layers: ["一。"], sections: sections(["a", "a", "b#c"]), unlock: { all: [] }, offer: { all: [] } },
    { id: "n", layers: ["一。"], sections: sections("abcdefghi".split("")), unlock: { all: [] }, offer: { all: [] } },
    { id: "e", layers: ["一。"], sections: [{ id: "a", text: " " }], unlock: { all: [] }, offer: { all: [] } },
  ])
  assert.deepEqual(said(card, "bad-section"), [
    "error lore.x#y: an entry id holds no #",
    "error lore.s.sections.a: a is declared twice",
    "error lore.s.sections.b#c: a section id holds no #",
    "error lore.n.sections: 9 sections (ceiling 8)",
  ])
  assert.deepEqual(said(card, "empty-text"), ["error lore.e.sections.a: author text is empty"])
}

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

// unknown-path: a Cond, an effect or a roll naming a path no field declares; lore counters of declared entries are fine.
assert.deepEqual(
  of({
    ...lored([
      {
        id: "l",
        layers: ["一。"],
        unlock: { path: "bnod", op: "gte", value: 1 },
        offer: { path: "lore.l.since", op: "gt", value: 2 },
      },
    ]),
    heading: "place",
    fiction: [{ id: "f", text: "带。", when: { path: "lore.x.shown", is: 0 } }],
    rules: {
      fields: [bond],
      actions: [{ id: "a", text: "动", roll: { path: "luck" }, hit: [{ path: "gold", add: 1 }] }],
      readouts: [readout],
    },
  }).filter((d) => d.includes("unknown-path")),
  [
    "error unknown-path fiction.f.when",
    "error unknown-path lore.l.unlock",
    "error unknown-path rules.actions.a.hit[0]",
    "error unknown-path rules.actions.a.roll",
    "error unknown-path heading",
  ],
)

// catalogs: an item's `when` is a Cond like any (unknown-path); a column naming no catalog, and an id declared twice
// (a catalog, or an item in one), are errors.
assert.deepEqual(
  of({
    ...base,
    rules: { fields: [bond], actions: [] },
    catalogs: [
      {
        id: "cg",
        items: [
          { id: "a", when: { path: "bnod", is: 1 } },
          { id: "b", when: { path: "bond", op: "gt", value: 3 } },
          { id: "a" },
        ],
      },
      { id: "cg", items: [] },
    ],
    products: [
      {
        id: "pics",
        role: "chronicle",
        text: "插图",
        shape: {
          kind: "record",
          keys: [
            { key: "here", type: "enum", catalog: "cg" },
            { key: "there", shape: { kind: "table", columns: [{ key: "id", type: "enum", catalog: "gc" }] } },
          ],
        },
      },
    ],
  }).filter((d) => /catalog|unknown-path/.test(d)),
  [
    "error unknown-path catalogs.cg.items.a.when",
    "error unknown-catalog products.pics.id",
    "error duplicate-catalog-item catalogs.cg",
    "error duplicate-catalog-item catalogs.cg.items.a",
  ],
)

// unknown-frame-slot: a frame id outside the slot list is a warn (fiction misfiled); a slot left empty is still a slot.
assert.deepEqual(
  said(
    {
      ...base,
      frame: [
        { id: "persona", text: "你是新来的牧师。" },
        { id: "npc", text: "罗伦斯：六十岁的老牧师。" },
        { id: "voice" },
      ],
    },
    "unknown-frame-slot",
  ),
  [
    "warn frame.npc: npc is not a frame slot (persona, pov, voice, style, setting, language, verbosity); every stage reads it as part of the frame",
  ],
)

// unfilled-name: a hole the card gives no default, wherever its text is; `user` needs none.
const holed: Card = {
  ...base,
  names: { char: "依瑞丝" },
  frame: [{ id: "style", text: "{{char}} 与 {{user}}，{{a}}" }],
  fiction: [{ id: "f", text: "{{b}}" }],
  greetings: [{ text: "{{c}}" }],
  lore: [{ id: "l", layers: ["{{d}}。"], unlock: { all: [] }, offer: { any: [] } }],
  asks: [{ id: "product.notes", text: "{{e}}" }],
  products: [{ id: "town", text: "{{f}}" }],
  guard: ["{{g}}"],
  rules: { ...base.rules, readouts: [{ id: "q", text: "{{h}}", options: [{ id: "o", text: "{{i}}", do: [] }] }] },
}
assert.deepEqual(said(holed, "unfilled-name"), [
  "warn frame.style.text: {{a}} has no default in the card's names",
  "warn fiction.f.text: {{b}} has no default in the card's names",
  "warn lore.l.layers[0]: {{d}} has no default in the card's names",
  "warn greetings[0].text: {{c}} has no default in the card's names",
  "warn asks.product.notes.text: {{e}} has no default in the card's names",
  "warn products.town.text: {{f}} has no default in the card's names",
  "warn guard[0]: {{g}} has no default in the card's names",
  "warn rules.readouts.q.text: {{h}} has no default in the card's names",
  "warn rules.readouts.q.options.o.text: {{i}} has no default in the card's names",
])
// unsupported-macro: a scripted macro or anything else in braces that is not a plain key; a plain hole is not one.
assert.deepEqual(
  said(
    {
      ...base,
      names: { x: "X" },
      frame: [{ id: "style", text: "{{x}} {{setvar::hp::1}} {{random::a,b}}" }],
      products: [{ id: "town", text: "{{ 1x }}" }],
    },
    "unsupported-macro",
  ),
  [
    "error frame.style.text: {{setvar::hp::1}} is not a name: only a plain {{key}} is filled",
    "error frame.style.text: {{random::a,b}} is not a name: only a plain {{key}} is filled",
    "error products.town.text: {{ 1x }} is not a name: only a plain {{key}} is filled",
  ],
)

// inline-product: an output format asked in the text.
assert.deepEqual(of({ ...base, frame: [{ id: "style", text: "每次回复末尾附上状态栏，并给出三个选项。" }] }), [
  "error inline-product frame.style.text",
])
assert.match(lint({ ...base, frame: [{ id: "style", text: "在回复的末尾列出选项。" }] })[0]!.hint!, /product/)

// empty-greeting: a greeting is text, a note, or both; with neither there is no node 0
assert.deepEqual(of({ ...base, greetings: [{ text: "开场。" }, { note: "由叙事者开场。" }, { do: [] }] }), [
  "error empty-greeting greetings[2]",
])
assert.ok(of({ ...base, greetings: [{ text: "  " }] }).includes("error empty-greeting greetings[0]"))

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
  yandao: [], // 起点 is an opening switch: set by the second greeting, read by a fiction variant
}
for (const [name, want] of Object.entries(templates)) assert.deepEqual(of(await loadCard(name)), want, name)
console.log("ok")
