// The self-check card: a wuxia duel with layered lore, a readout and one guard line. `chat` is the same card with
// everything structured switched off: no actions, lore or director, so a turn is narrate + record only (README §2).
import type { Card } from "../../src/card.ts"
import { decodeFragments as frags, type Player } from "../../src/fragment.ts"

export const player: Player = { global: frags([{ id: "language", text: "Write in Chinese." }]), forCard: {} }

export const full: Card = {
  id: "wuxia",
  title: "竹林",
  frame: frags([{ id: "setting", text: "Frame: wuxia" }]),
  // Bands of the readout are `when` fragments: the narrator reads the band's text, never the number.
  fiction: frags([
    { id: "a", text: "A: swordsman" },
    { id: "a-cool", text: "A keeps the player at arm's length.", when: { path: "bond", op: "lt", value: 8 } },
    { id: "a-warm", text: "A trusts the player.", when: { path: "bond", op: "gte", value: 8 } },
  ]),
  greetings: [],
  rules: {
    fields: [
      { path: "hp", label: "体力", group: "Body", type: "int", min: 0, max: 100, initial: 40 },
      { path: "foe", label: "敌手", group: "People", type: "int", min: 0, initial: 30 },
      { path: "bond", label: "交情", group: "People", type: "int", min: -30, max: 100, initial: 0 }, // a readout: never settled before the prose
    ],
    readouts: [
      {
        id: "warmth",
        text: "how A treated the player this turn",
        options: [
          { id: "cold", text: "cold", do: [{ path: "bond", add: -5 }] },
          { id: "flat", text: "indifferent", do: [] },
          { id: "warm", text: "warm", do: [{ path: "bond", add: 4 }] },
          { id: "close", text: "intimate", do: [{ path: "bond", add: 8 }, { event: "warmth:close" }] },
        ],
      },
    ],
    actions: [
      {
        id: "strike",
        text: "attack B",
        roll: 0.6,
        hit: [{ path: "foe", add: -10 }, { event: "strike:hit" }],
        miss: [{ path: "hp", add: -10 }, { event: "strike:miss" }],
      },
      { id: "talk", text: "talk", do: [{ event: "talk" }] },
    ],
    over: {
      any: [
        { path: "hp", is: 0 },
        { path: "foe", is: 0 },
      ],
    },
    cap: 4,
  },
  lore: [
    {
      id: "li",
      // Layer 2 opens on a beat event (settled before the prose); layer 3 on a readout event, which is emitted after
      // the prose and so can only open the window on the following turn.
      layers: [
        "Li: A's lost friend; crane tattoo on the left shoulder.",
        "B is Li.",
        "Li once made A swear to finish it, should they ever cross swords.",
      ],
      unlock: { all: [] },
      offer: { any: [{ event: "strike:hit" }, { event: "warmth:close" }] },
    },
    { id: "heir", layers: ["Li was heir to the throne."], unlock: { any: [] }, offer: { all: [] } }, // hidden: never in play
  ],
  guard: ["B does not die"],
  director: true,
  // Record products (src/product.ts), one of each flavour: a default switched on (options, capped list), a feed record
  // with a nested table (scene: read back to the model as `Current:`), and a recall table (people: rows the lookup
  // stage can deliver later, like lore).
  products: [
    { id: "options", on: true },
    {
      id: "scene",
      text: "Where the scene stands now: the place, and who is present with their mood.",
      shape: {
        kind: "record",
        keys: [
          { key: "place", type: "text" },
          {
            key: "present",
            shape: {
              kind: "table",
              columns: [
                { key: "name", type: "text" },
                { key: "mood", type: "enum", options: ["calm", "tense"] },
              ],
            },
          },
        ],
      },
      feed: true,
    },
    {
      id: "people",
      text: "People named this scene who are not in Known, one row each.",
      shape: {
        kind: "table",
        columns: [
          { key: "name", type: "text" },
          { key: "note", type: "text" },
        ],
        max: 8,
      },
      recall: "name",
    },
  ],
}
export const chat: Card = {
  ...full,
  rules: { fields: full.rules.fields, actions: [] },
  lore: [],
  guard: [],
  director: false,
}
