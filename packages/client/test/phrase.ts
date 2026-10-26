// The declared rules in words: the wuxia card's ending, actions and odds, and the shapes the other cards use.
import { full } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { chance, cond, effect, labels } from "../src/phrase.ts"

const by = labels(full.rules)
assert.equal(cond(full.rules.over!, by), "体力 = 0 or 敌手 = 0")
assert.equal(
  cond({ all: [{ path: "bond", op: "gte", value: 8 }, { not: { any: [{ event: "x" }, { path: "hp", is: 0 }] } }] }, by),
  "交情 ≥ 8 and not (on x or 体力 = 0)",
)
assert.deepEqual([cond({ any: [] }, by), cond({ all: [] }, by)], ["never", "always"]) // a lore entry that never unlocks
assert.deepEqual([cond({ path: "恋人", is: true }, by), cond({ path: "恋人", is: false }, by)], ["恋人", "not 恋人"])
assert.deepEqual(
  full.rules.actions[0]!.hit!.map((e) => effect(e, by)),
  ["敌手 −10", "event strike:hit"],
)
assert.deepEqual(
  [
    effect({ path: "局势", set: 7 }, by),
    effect({ path: "起点", set: "血案" }, by),
    effect({ path: "hp", add: { path: "foe" } }, by),
  ],
  ["局势 = 7", "起点 = 血案", "体力 + 敌手"],
)
assert.deepEqual(
  [chance(0.6, by), chance({ path: "hp" }, by), chance({ judge: "how likely is it" }, by)],
  ["60%", "by 体力", "judged"],
)
console.log("phrase ok")
