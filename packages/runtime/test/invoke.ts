import assert from "node:assert/strict"
import { fake } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { makeSession, outcome, type Event } from "../src/session.ts"
import { chat } from "./cards/index.ts"
import { defaultAnswer, readStage } from "./script.ts"
import type { Rows } from "../src/layer.ts"

const card = {
  ...chat,
  lore: [
    { id: "secret", layers: ["SECRET ONE", "SECRET TWO"], unlock: [{ all: [] }, { all: [] }], offer: { any: [] } },
    {
      id: "guide",
      invoke: "manual" as const,
      layers: ["GUIDE ONE", "GUIDE TWO", "LOCKED GUIDE"],
      unlock: [{ all: [] }, { all: [] }, { any: [] }],
      offer: { all: [] },
    },
    { id: "locked", layers: ["LOCKED"], unlock: { any: [] }, offer: { any: [] } },
  ],
}
let rows: Rows = {
  packs: [
    {
      id: "p",
      name: "P",
      entries: [
        { id: "always", text: "ALWAYS BODY", invoke: "always" },
        { id: "manual", text: "MANUAL BODY", invoke: "manual" },
        { id: "auto", text: "AUTO BODY" },
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
      S.node(g.id).invocable.map((e) => e.id),
      ["secret", "guide", "p/manual", "p/auto"],
    )
    for (const id of ["locked", "missing", "guide#3", "p/always"]) {
      const result = yield* Effect.exit(go(S.act(g.id, { text: "", invoke: [id] })))
      assert.equal(result._tag, "Failure")
      assert.equal(calls.length, 0)
    }
    const t = yield* go(S.act(g.id, { text: "", invoke: ["secret", "guide", "p/manual", "p/auto"] }))
    assert.deepEqual(t.read, [
      { id: "secret", layer: 1 },
      { id: "secret", layer: 2 },
      { id: "p/auto", layer: 1 },
    ])
    assert.deepEqual(t.fired, [])
    assert.ok(text("narrate").includes("GUIDE ONE") && text("narrate").includes("GUIDE TWO"))
    assert.ok(text("narrate").includes("MANUAL BODY") && !text("narrate").includes("LOCKED GUIDE"))
    assert.ok(text("narrate").includes("ALWAYS BODY"))
    for (const c of calls) for (const m of c.msgs) assert.notEqual(m.content, "")
    assert.ok(S.node(t.id).invocable.some((e) => e.id === "guide"))
    const next = yield* go(S.act(t.id, { text: "continue" }))
    assert.ok(!text("narrate").includes("GUIDE ONE") && !text("narrate").includes("MANUAL BODY"))
    assert.ok(text("narrate").includes("ALWAYS BODY"))
    assert.ok(
      !text("lookup").includes("guide") && !text("lookup").includes("p/manual") && !text("lookup").includes("p/always"),
    )
    const folded = yield* go(S.act(next.id, { text: "continue" }))
    assert.ok(S.node(folded.id).invocable.some((e) => e.id === "secret"))
    yield* go(S.act(folded.id, { text: "continue", note: "look for a setting" }))
    assert.ok(text("lookup").includes("secret=") && text("lookup").includes("Player note: look for a setting"))
    assert.ok(!text("narrate").includes("SECRET ONE"))
    for (const rerun of [() => S.swipe(t.id), () => S.reword(t.id)]) {
      const sibling = yield* go(rerun())
      assert.deepEqual(sibling.input.invoke, t.input.invoke)
      assert.ok(text("narrate").includes("MANUAL BODY"))
    }
    rows = {}
    yield* go(S.reword(t.id))
    assert.ok(!text("narrate").includes("MANUAL BODY"))
    const old = JSON.parse(JSON.stringify({ ...t, input: { text: "legacy", pin: "secret" } }))
    const replay = makeSession({
      card,
      rows: () => ({}),
      model: () => model,
      store: { read: () => ({ nodes: [g.turn, old], head: old.id }), write: () => {} },
    })
    assert.deepEqual(replay.node(old.id).turn.read, t.read)
    yield* go(replay.reword(old.id))
  }),
)
console.log("invoke ok")
