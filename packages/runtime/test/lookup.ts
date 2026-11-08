import assert from "node:assert/strict"
import { fake, fakeText, type FakeCall } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { makeSession, outcome, type Event } from "../src/session.ts"
import type { Card } from "../src/card.ts"
import { chat } from "./cards/index.ts"
import { defaultAnswer, readStage } from "./script.ts"

const lore = (id: string, body = `${id} body`): Card["lore"][number] => ({
  id,
  layers: [body],
  unlock: { all: [] },
  offer: { any: [] },
})
const fixture = (entries: Card["lore"], answer: (o: FakeCall, n: number) => unknown) => {
  let n = 0
  const lookup: FakeCall[] = []
  const calls: Extract<Event, { kind: "call" }>[] = []
  const light = fake((o) => {
    lookup.push(o)
    return { text: JSON.stringify(answer(o, n++)) }
  })
  const other = fake((o) => defaultAnswer(readStage(o), { notes: "a note" }))
  const S = makeSession({
    card: { ...chat, lore: entries, products: [] },
    rows: () => ({}),
    model: (p) => (p === "lookup" ? light : other),
  })
  const g = S.greet({ text: "opening" }).node!
  const go = (s: ReturnType<typeof S.act>) =>
    Effect.runPromise(
      outcome(
        s.pipe(
          Stream.tap((e) =>
            Effect.sync(() => {
              if (e.kind === "call") calls.push(e)
            }),
          ),
        ),
      ),
    )
  return { S, g, go, lookup, calls }
}
const messages = (o: FakeCall) => o.prompt.map(fakeText)
const entries = [lore("a", "A points to b."), lore("b", "B points to c."), lore("c"), lore("d")]
{
  const f = fixture(entries, () => ({ read: ["a", "a"], more: false }))
  const t = await f.go(f.S.act(f.g.id, { text: "about a" }))
  assert.equal(f.lookup.length, 1)
  assert.deepEqual(t.read, [{ id: "a", layer: 1 }])
  assert.ok(!JSON.stringify(f.lookup[0]!.responseFormat).includes('"search"'))
}
{
  const f = fixture(entries, () => ({ read: [], more: true }))
  await f.go(f.S.act(f.g.id, { text: "nothing" }))
  assert.equal(f.lookup.length, 1)
}
{
  const f = fixture(entries, (o) => ({ read: [readStage(o).again ? "b" : "a"], more: !readStage(o).again }))
  const t = await f.go(f.S.act(f.g.id, { text: "there", note: "look carefully" }))
  assert.equal(f.lookup.length, 2)
  const [first, second] = f.calls.filter((c) => c.phase === "lookup")
  assert.deepEqual(second!.msgs.slice(0, first!.msgs.length), first!.msgs)
  assert.ok(messages(f.lookup[1]!).includes("Read: a=A points to b."))
  assert.deepEqual(
    t.read.map((d) => d.id),
    ["a", "b"],
  )
  const schema = JSON.stringify(f.lookup[1]!.responseFormat)
  assert.ok(!schema.includes('"a"') && schema.includes('"b"'))
  await f.go(f.S.swipe(t.id))
  assert.equal(f.lookup.length, 4)
  const reword = await f.go(f.S.reword(t.id))
  assert.equal(f.lookup.length, 4)
  assert.deepEqual(reword.read, t.read)
}
for (const size of [2, 4]) {
  const f = fixture(entries.slice(0, size), (_, n) => ({ read: [entries[n]!.id], more: true }))
  const t = await f.go(f.S.act(f.g.id, { text: "follow" }))
  assert.equal(f.lookup.length, Math.min(size, 3))
  assert.equal(t.read.length, Math.min(size, 3))
  for (let i = 1; i < f.lookup.length; i++) {
    assert.deepEqual(f.lookup[i]!.prompt.slice(0, f.lookup[i - 1]!.prompt.length), f.lookup[i - 1]!.prompt)
  }
}
{
  const layered = { ...lore("layered"), layers: ["ONE", "TWO"], unlock: [{ all: [] }, { all: [] }] }
  const f = fixture([layered, ...entries], (_, n) => ({ read: n ? [] : ["layered"], more: false }))
  const t = await f.go(f.S.act(f.g.id, { text: "read layered" }))
  await f.go(f.S.act(t.id, { text: "go there" }))
  const doc = messages(f.lookup[1]!)
  assert.ok(doc.some((m) => m.includes("read layered → -; read layered; fired -")))
  assert.ok(doc.findIndex((m) => m.startsWith("Ledger:")) < doc.findIndex((m) => m.includes("Index:")))
}
const large = [
  lore("town", `Town ${"padding ".repeat(1000)}.`),
  lore("noodle", "Noodles. 福记面馆 西栅街面"),
  lore("street", "Street. 西栅街面"),
  { ...lore("layered", "Visible."), layers: ["Visible.", "hiddenkeyword"], unlock: [{ all: [] }, { any: [] }] },
  { ...lore("manual", "hiddenkeyword"), invoke: "manual" as const },
  { ...lore("locked", "hiddenkeyword"), unlock: { any: [] } },
]
for (const query of ["福记面馆 西栅街面", "hiddenkeyword"]) {
  const f = fixture(large, (o) => ({
    read: readStage(o).again && query !== "hiddenkeyword" ? ["noodle"] : [],
    more: false,
    search: readStage(o).again ? "" : query,
  }))
  const t = await f.go(f.S.act(f.g.id, { text: "find it" }))
  assert.equal(f.lookup.length, 2)
  const doc = readStage(f.lookup[0]!)
  assert.equal(doc.catalog, true)
  assert.ok(doc.index.every(([, hook]) => hook === ""))
  assert.ok(JSON.stringify(f.lookup[0]!.responseFormat).includes('"search"'))
  assert.ok(messages(f.lookup[1]!).includes("Read: -"))
  const found = messages(f.lookup[1]!).find((m) => m.startsWith("Found:"))!
  assert.equal(found, query === "hiddenkeyword" ? "Found: -" : "Found: noodle=Noodles., street=Street.")
  assert.deepEqual(
    t.read.map((d) => d.id),
    query === "hiddenkeyword" ? [] : ["noodle"],
  )
}
{
  const f = fixture(large, (o) => ({ read: [], more: false, search: readStage(o).again ? "" : "福记面馆" }))
  const held = await f.go(f.S.act(f.g.id, { text: "", invoke: ["noodle"] }))
  assert.equal(f.lookup.length, 0)
  await f.go(f.S.act(held.id, { text: "find it" }))
  assert.ok(messages(f.lookup[1]!).includes("Found: -"))
}
{
  const f = fixture(large, (o) => ({ read: [], more: true, search: readStage(o).again ? "" : "西栅街面" }))
  await f.go(f.S.act(f.g.id, { text: "find it", invoke: ["noodle"] }))
  assert.ok(messages(f.lookup[1]!).includes("Found: street=Street."))
}
{
  const f = fixture(large, () => ({ read: [], more: true, search: "missing" }))
  await f.go(f.S.act(f.g.id, { text: "search again" }))
  assert.equal(f.lookup.length, 3) // search-only progress is bounded too
}
{
  const f = fixture(large, () => ({ read: [], more: true, search: "   " }))
  await f.go(f.S.act(f.g.id, { text: "nothing" }))
  assert.equal(f.lookup.length, 1)
}
{
  const matches = Array.from({ length: 10 }, (_, i) => lore(`match${i}`, "Shared hook."))
  const f = fixture([...large, ...matches], (o) => ({
    read: [],
    more: false,
    search: readStage(o).again ? "" : "shared",
  }))
  await f.go(f.S.act(f.g.id, { text: "find" }))
  assert.ok(
    messages(f.lookup[1]!).includes(
      `Found: ${matches
        .slice(0, 8)
        .map((e) => `${e.id}=Shared hook.`)
        .join(", ")}`,
    ),
  )
}
console.log("lookup ok")
