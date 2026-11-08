import assert from "node:assert/strict"
import { fake } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { makeSession, outcome, type Event } from "../src/session.ts"
import { narratorHistory } from "../src/history.ts"
import { chat, full } from "./cards/index.ts"
import { defaultAnswer, readStage } from "./script.ts"
import { decodeLayer, type Rows } from "../src/layer.ts"
import { decodeCard } from "../src/card.ts"

const card = {
  ...chat,
  lore: [
    { id: "secret", layers: ["MODEL SECRET"], unlock: { all: [] }, offer: { any: [] } },
    {
      id: "guide",
      access: { model: false, player: true },
      residency: "turn" as const,
      layers: ["GUIDE ONE", "GUIDE TWO", "LOCKED GUIDE"],
      unlock: [{ all: [] }, { all: [] }, { any: [] }],
      offer: { all: [] },
    },
    {
      id: "locked",
      access: { model: true, player: true },
      layers: ["LOCKED"],
      unlock: { any: [] },
      offer: { any: [] },
    },
    {
      id: "p/auto",
      access: { model: true, player: true },
      layers: ["COLLIDING SECRET"],
      unlock: { any: [] },
      offer: { any: [] },
    },
  ],
}
assert.throws(
  () => decodeLayer({ id: "old", name: "Old", entries: [{ id: "x", text: "hidden", invoke: "manual" }] }),
  /no longer supported/,
)
assert.throws(() => decodeCard({ ...card, lore: [{ ...card.lore[0], invoke: "manual" }] }), /no longer supported/)
let rows: Rows = {
  packs: [
    {
      id: "p",
      name: "P",
      entries: [
        { id: "always", text: "ALWAYS BODY", activation: "always" },
        { id: "manual", text: "MANUAL BODY", access: { model: false, player: true }, residency: "turn" },
        { id: "auto", text: "AUTO BODY" },
        { id: "permanent", text: "PERMANENT BODY", residency: "permanent" },
      ],
    },
  ],
  local: { id: "local", name: "Local", card: "test", mounts: ["p"] },
}
const model = fake((o) =>
  defaultAnswer(readStage(o), { notes: "a note", scene: { place: "Here", present: [] }, people: [] }),
)
const S = makeSession({ card, rows: () => rows, model: () => model, policy: { budget: 0, keep: 2, block: 2 } })
let calls: Extract<Event, { kind: "call" }>[] = []
const go = (s: Stream.Stream<Event, unknown>) => {
  calls = []
  return outcome(
    s.pipe(
      Stream.tap((e) =>
        Effect.sync(() => {
          if (e.kind === "call") calls.push(e)
        }),
      ),
    ),
  )
}
const text = (phase: string) => JSON.stringify(calls.filter((c) => c.phase === phase).map((c) => c.msgs))
await Effect.runPromise(
  Effect.gen(function* () {
    const g = S.greet({ text: "Opening" }).node!
    assert.deepEqual(
      S.node(g.id).playerCatalog.map((e) => e.id),
      ["card:guide", "pack:p/always", "pack:p/manual", "pack:p/auto", "pack:p/permanent"],
    )
    for (const id of ["card:secret", "card:locked", "missing"]) {
      assert.equal((yield* Effect.exit(go(S.act(g.id, { text: "", invoke: [id] }))))._tag, "Failure")
      assert.equal(calls.length, 0)
    }
    const t = yield* go(
      S.act(g.id, {
        text: "",
        invoke: ["card:guide", "pack:p/always", "pack:p/manual", "pack:p/auto", "pack:p/permanent"],
      }),
    )
    assert.deepEqual(
      calls.map((c) => c.phase),
      ["narrate", "record"],
    )
    assert.ok(text("narrate").includes("GUIDE TWO") && !text("narrate").includes("LOCKED GUIDE"))
    assert.ok(text("narrate").includes("MANUAL BODY") && text("narrate").includes("ALWAYS BODY"))
    assert.ok(!text("narrate").includes("MODEL SECRET"))
    assert.ok(!S.node(t.id).playerCatalog.some((e) => e.id === "card:p/auto"))
    assert.ok(!text("narrate").includes("COLLIDING SECRET"))
    assert.equal(narratorHistory([g.turn, t]).filter((m) => m.role === "user").length, 1)
    const next = yield* go(S.act(t.id, { text: "continue" }))
    assert.ok(!text("narrate").includes("GUIDE ONE") && !text("narrate").includes("MANUAL BODY"))
    assert.ok(text("narrate").includes("AUTO BODY") && text("lookup").includes("AUTO BODY"))
    let last = next
    for (let i = 0; i < 4; i++) last = yield* go(S.act(last.id, { text: "continue" }))
    assert.ok(!text("narrate").includes("AUTO BODY"))
    assert.ok(text("narrate").includes("PERMANENT BODY"))
    const frozen = structuredClone(t.deliveries)
    rows = {}
    assert.deepEqual(S.node(t.id).delivered, frozen)
    const rerun = yield* go(S.reword(t.id))
    assert.deepEqual(rerun.deliveries, frozen)
    assert.ok(text("narrate").includes("MANUAL BODY"))
    assert.deepEqual(
      S.node(t.id).playerCatalog.map((e) => e.id),
      ["card:guide"],
    )
    const replay = makeSession({
      card: { ...card, lore: [] },
      rows: () => ({}),
      model: () => model,
      store: { read: () => ({ nodes: [...S.log.nodes.values()], head: t.id }), write: () => {} },
    })
    yield* go(replay.reword(t.id))
    assert.ok(text("narrate").includes("GUIDE TWO")) // card changes cannot rewrite frozen deliveries
    // Chip-only editing is a real turn: check and record run, not the greeting edit shortcut.
    const active = makeSession({ card: { ...full, lore: card.lore }, rows: () => ({}), model: () => model })
    const a = yield* go(active.act(null, { text: "", invoke: ["card:guide"] }))
    yield* go(active.edit(a.id, { text: "Edited chip-only turn" }))
    assert.deepEqual(
      calls.map((c) => c.phase),
      ["check", "record"],
    )
    assert.ok(text("record").includes("Edited chip-only turn"))
  }),
)
console.log("invoke ok")
