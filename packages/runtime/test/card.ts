// Tests for src/card.ts: the three earlier RPG prototypes written as data, settled by the interpreter.
import assert from "node:assert/strict"
import { Schema } from "effect"
import { Greeting, decodeCard, decodeRules, makeCard, rollOf, type Beat } from "../src/card.ts"
import { full } from "./cards/wuxia.ts"
import { holds } from "../src/cond.ts"

// ───────── harness.ts as data: fight (judged chance) / rest / talk, gold and hp with bounds ─────────
const tavern = makeCard(
  decodeRules({
    fields: [
      { path: "hp", type: "int", min: 0, max: 100, initial: 100 },
      { path: "gold", type: "int", min: 0, initial: 0 },
      { path: "day", type: "int", initial: 1 },
    ],
    actions: [
      {
        id: "fight",
        text: "fight the foe",
        roll: { judge: "how likely the player wins" },
        hit: [{ path: "gold", add: 25 }, { event: "You win {gold} gold." }],
        miss: [{ path: "hp", add: -55 }, { event: "You take 55 damage." }],
      },
      {
        id: "rest",
        text: "rest",
        do: [{ path: "hp", add: 20 }, { path: "day", add: 1 }, { event: "You rest (hp {hp})." }],
      },
      { id: "talk", text: "talk", do: [{ event: "Nothing happens." }] },
    ],
  }),
)
// Judge chance rides on the beat; the die is the seed. Same chance + new seed = reroll; find one seed each way.
const seedWhere = (p: number, hit: boolean) => {
  for (let s = 1; ; s++) if (rollOf(s) < p === hit) return s
}
let r = tavern.fold(tavern.initial, [{ next: "fight", chance: 0.7, seed: seedWhere(0.7, true) }])
assert.deepEqual([r.s.gold, r.events], [25, ["You win 25 gold."]])
r = tavern.fold(r.s, [{ next: "fight", chance: 0.2, seed: seedWhere(0.2, false) }])
assert.deepEqual([r.s.hp, r.events], [45, ["You take 55 damage."]])
r = tavern.fold(r.s, [{ next: "rest", seed: 0 }])
assert.deepEqual([r.s.hp, r.s.day, r.events], [65, 2, ["You rest (hp 65)."]])
// Bounds clamp instead of failing: resting at 95 hp stops at 100 (§4.2's rule engine).
assert.equal(tavern.fold({ ...tavern.initial, hp: 95 }, [{ next: "rest", seed: 0 }]).s.hp, 100)
// A judged action without the chance on the beat is a bug, not a silent default.
assert.throws(() => tavern.settle(tavern.initial, { next: "fight", seed: 1 }), /judge chance missing/)
// The decide schema carries `chance` only because an available action is judged; its enum is the gate.
assert.ok(Schema.decodeUnknownSync(tavern.decideSchema(tavern.initial))({ next: "fight", chance: 0.5 }))
assert.throws(() => Schema.decodeUnknownSync(tavern.decideSchema(tavern.initial))({ next: "steal" }))
assert.throws(() => Schema.decodeUnknownSync(tavern.decideSchema(tavern.initial))({ next: "fight", chance: 1.5 }))

// ───────── beats.ts as data: strike / flee, over when hp or foe hits 0, availability gate on flee ─────────
const duel = makeCard(
  decodeRules({
    fields: [
      { path: "hp", type: "int", min: 0, initial: 40 },
      { path: "foe", type: "int", min: 0, initial: 30 },
      { path: "fled", type: "boolean", initial: false },
    ],
    actions: [
      {
        id: "strike",
        text: "strike",
        roll: 0.6,
        hit: [{ path: "foe", add: -10 }, { event: "strike:hit" }],
        miss: [{ path: "hp", add: -10 }, { event: "strike:miss" }],
      },
      {
        id: "flee",
        text: "flee",
        when: { path: "hp", op: "lt", value: 40 },
        do: [{ path: "fled", set: true }, { event: "fled" }],
      }, // only once hurt
    ],
    over: {
      any: [
        { path: "hp", is: 0 },
        { path: "foe", is: 0 },
        { path: "fled", is: true },
      ],
    },
    cap: 4,
  }),
)
assert.deepEqual(
  duel.available(duel.initial).map((a) => a.id),
  ["strike"],
) // flee gated out at full hp
assert.throws(() => duel.settle(duel.initial, { next: "flee", seed: 1 }), /not an available action/)
const hit: Beat = { next: "strike", seed: seedWhere(0.6, true) }
const hits = [hit, hit, hit]
// Three hits bring foe to 0 and the code ends the fight.
let d = duel.fold(duel.initial, hits)
assert.deepEqual([d.s.foe, duel.over(d.s)], [0, true])
// One miss opens flee; fleeing sets the over condition too.
d = duel.fold(duel.initial, [{ next: "strike", seed: seedWhere(0.6, false) }])
assert.deepEqual(
  duel.available(d.s).map((a) => a.id),
  ["strike", "flee"],
)
d = duel.fold(d.s, [{ next: "flee", seed: 0 }])
assert.ok(duel.over(d.s) && d.events.includes("fled"))
assert.equal(duel.cap, 4)

// ───────── Cond's one new leaf: this turn's events, for lore windows (§19.1) ─────────
assert.equal(holds({ event: "strike:hit" }, {}, ["strike:hit"]), true)
assert.equal(
  holds({ all: [{ event: "strike:hit" }, { path: "foe", op: "gt", value: 0 }] }, { foe: 20 }, ["strike:miss"]),
  false,
)

// Chance from a state path: skill drives the odds.
const skilled = makeCard(
  decodeRules({
    fields: [
      { path: "skill", type: "number", min: 0, max: 1, initial: 1 },
      { path: "wins", type: "int", initial: 0 },
    ],
    actions: [
      { id: "try", text: "try", roll: { path: "skill" }, hit: [{ path: "wins", add: 1 }], miss: [{ event: "miss" }] },
    ],
  }),
)
assert.equal(skilled.fold(skilled.initial, [{ next: "try", seed: 7 }]).s.wins, 1) // skill 1 → always hits
assert.equal(skilled.fold({ skill: 0, wins: 0 }, [{ next: "try", seed: 7 }]).s.wins, 0)

// ───────── Readouts: asked after the prose, answered by enum, settled by code; `when` gates the question ─────────
const bond = makeCard(
  decodeRules({
    fields: [
      { path: "bond", type: "int", min: -30, max: 100, initial: 0 },
      { path: "met", type: "boolean", initial: false },
    ],
    actions: [],
    readouts: [
      {
        id: "warmth",
        text: "how she treated the player",
        options: [
          { id: "cold", text: "cold", do: [{ path: "bond", add: -5 }] },
          { id: "warm", text: "warm", do: [{ path: "bond", add: 4 }] },
        ],
      },
      {
        id: "met",
        text: "did they meet",
        when: { path: "met", is: false },
        options: [
          { id: "no", text: "no", do: [] },
          { id: "yes", text: "yes", do: [{ path: "met", set: true }, { event: "met" }] },
        ],
      },
    ],
  }),
)
assert.deepEqual(
  bond.asked(bond.initial).map((q) => q.id),
  ["warmth", "met"],
)
const b = bond.settleReadouts(bond.initial, { warmth: "warm", met: "yes" })
assert.deepEqual([b.s.bond, b.s.met, b.events], [4, true, ["met"]])
assert.deepEqual(
  bond.asked(b.s).map((q) => q.id),
  ["warmth"],
) // answered once, never asked again
assert.equal(bond.settleReadouts({ bond: -28, met: true }, { warmth: "cold" }).s.bond, -30) // bounds clamp
assert.throws(() => bond.settleReadouts(bond.initial, { warmth: "hot" }), /not a readout option/)
assert.ok(Schema.decodeUnknownSync(bond.readoutSchema(b.s)!)({ warmth: "warm" }))
assert.throws(() => Schema.decodeUnknownSync(bond.readoutSchema(b.s)!)({})) // every asked question is answered
assert.throws(() => Schema.decodeUnknownSync(bond.readoutSchema(b.s)!)({ warmth: "hot" }))
assert.equal(tavern.readoutSchema(tavern.initial), undefined) // nothing declared → nothing asked

// ───────── Enum fields: a closed set, gated on every set; `when` reads it like any other value ─────────
const routed = makeCard(
  decodeRules({
    fields: [
      { path: "route", type: "enum", options: ["calm", "blood"], initial: "calm" },
      { path: "heat", type: "int", min: 0, max: 10, initial: 2 },
    ],
    actions: [
      {
        id: "riot",
        text: "riot",
        do: [{ path: "route", set: "blood" }, { path: "heat", add: 5 }, { event: "riot" }],
      },
      { id: "hide", text: "hide", when: { path: "route", is: "blood" }, do: [] },
    ],
  }),
)
assert.deepEqual(
  routed.available(routed.initial).map((a) => a.id),
  ["riot"],
)
const rr = routed.fold(routed.initial, [{ next: "riot", seed: 0 }])
assert.deepEqual([rr.s.route, rr.s.heat, rr.events], ["blood", 7, ["riot"]])
assert.deepEqual(
  routed.available(rr.s).map((a) => a.id),
  ["riot", "hide"],
)
assert.throws(() => routed.apply(routed.initial, [{ path: "route", set: "fire" }])) // outside the closed set
assert.throws(() => routed.apply(routed.initial, [{ path: "heat", set: "hot" }])) // a string on an int
assert.throws(
  () => makeCard(decodeRules({ fields: [{ path: "r", type: "enum", initial: "x" }], actions: [] })),
  /enum needs options/,
)
// A greeting's opening uses the same effect vocabulary; the harness applies it before the first turn (test/loop.ts).
const g = Schema.decodeUnknownSync(Greeting)({ text: "G", do: [{ path: "route", set: "blood" }, { event: "riot" }] })
assert.deepEqual(routed.apply(routed.initial, g.do!), { s: { route: "blood", heat: 2 }, events: ["riot"] })
assert.throws(() => Schema.decodeUnknownSync(Greeting)({ text: "G", do: [{ path: "route", go: "blood" }] }))

assert.deepEqual(decodeCard({ ...full, version: "1.2", source: "hand" }).version, "1.2") // optional metadata, decoded as-is
console.log(tavern.menu(tavern.initial).join("\n"))
console.log("ok")
