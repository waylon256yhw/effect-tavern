import assert from "node:assert/strict"
import { fake, type FakeCall, type FakeReply } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { makeSession, outcome, type Event } from "../src/session.ts"
import {
  contextLookup,
  deliveryText,
  freeze,
  loreResource,
  revision,
  residentOn,
  sectionResources,
  type Resource,
} from "../src/context.ts"
import type { Card } from "../src/card.ts"
import { chat } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

const lore = (id: string, body = `${id} body`): Card["lore"][number] => ({
  id,
  layers: [body],
  unlock: { all: [] },
  offer: { any: [] },
})
const fixture = (entries: Card["lore"], answer: (o: FakeCall, n: number) => FakeReply) => {
  let n = 0
  const lookup: FakeCall[] = []
  const calls: Extract<Event, { kind: "call" }>[] = []
  const light = fake((o) => {
    lookup.push(o)
    return answer(o, n++)
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
const call = (name: string, input: unknown): FakeReply => ({ text: "", toolCalls: [{ name, input }] })
const done = { text: "Context ready." }
const entries = [lore("a", "A points to card:b."), lore("b", "B points to card:c."), lore("c"), lore("d")]
// Multi-hop follows actual native tool results; no synthesized Read/Found protocol or ID enum.
{
  const f = fixture(entries, (o, n) => {
    if (n) assert.ok(o.prompt.some((m) => m.role === "tool"))
    return n === 0
      ? call("search_context", { query: "A points" })
      : n === 1
        ? call("read_context", { refs: ["card:a", "card:a"] })
        : n === 2
          ? call("read_context", { refs: ["card:b"] })
          : done
  })
  const t = await f.go(f.S.act(f.g.id, { text: "about a", note: "look carefully" }))
  assert.equal(f.lookup.length, 4)
  assert.deepEqual(
    t.read.map((d) => d.id),
    ["a", "b"],
  )
  assert.deepEqual(
    t.deliveries.map((d) => d.resourceId),
    ["card:a", "card:b"],
  )
  const trace = f.calls.find((c) => c.phase === "lookup")!.out as { trace: { calls: unknown[] }[] }
  assert.equal(trace.trace.flatMap((s) => s.calls).length, 3)
  assert.equal(f.lookup[0]!.responseFormat, undefined)
  const reword = await f.go(f.S.reword(t.id))
  assert.equal(f.lookup.length, 4)
  assert.deepEqual(reword.deliveries, t.deliveries)
}
// The journal keeps both versions if lookup reads layer 1 before the gate offers layer 2.
{
  const f = fixture([{ ...lore("layered", "BASE"), layers: ["BASE", "DEEP"], offer: { all: [] } }], (_, n) =>
    n === 0 ? call("read_context", { refs: ["card:layered"] }) : done,
  )
  const t = await f.go(f.S.act(f.g.id, { text: "find" }))
  assert.deepEqual(
    t.deliveries.map((d) => d.text),
    ["BASE", "BASE\n\nDEEP"],
  )
  assert.equal(t.deliveries[1]!.superseded, t.deliveries[0]!.revision)
  assert.deepEqual((await f.go(f.S.reword(t.id))).deliveries, t.deliveries)
}
// Recoverable permission errors return to the model; forbidden text never reaches a tool response.
{
  const f = fixture(
    [
      ...entries,
      { ...lore("locked", "LOCKED BODY"), unlock: { any: [] } },
      { ...lore("private", "PLAYER ONLY"), access: { model: false, player: true } },
    ],
    (_, n) =>
      n === 0
        ? call("read_context", { refs: ["card:locked", "card:a"] })
        : n === 1
          ? call("read_context", { refs: ["card:private"] })
          : n === 2
            ? call("read_context", { refs: ["card:a"] })
            : done,
  )
  const t = await f.go(f.S.act(f.g.id, { text: "find" }))
  assert.deepEqual(t.read, [{ id: "a", layer: 1 }])
  assert.ok(JSON.stringify(f.lookup[1]!.prompt).includes("unavailable_resource"))
  assert.ok(!JSON.stringify(f.lookup).includes("LOCKED BODY"))
  assert.ok(!JSON.stringify(f.lookup).includes("PLAYER ONLY"))
}
// Even huge catalogs never enumerate IDs in the initial request or tool schema.
{
  const large = Array.from({ length: 2000 }, (_, i) => lore(`entry${i}`, `Shared hook ${i}.`))
  const f = fixture(large, (_, n) => (n === 0 ? call("search_context", { query: "shared" }) : done))
  await f.go(f.S.act(f.g.id, { text: "find" }))
  assert.ok(JSON.stringify(f.lookup[0]).length < 16000)
  assert.ok(!JSON.stringify(f.lookup[0]).includes("entry1999"))
  const out = JSON.stringify(f.lookup[1]!.prompt)
  assert.ok(out.includes("card:entry7") && !out.includes("card:entry8"))
}
// Infinite search is bounded; successfully read context still reaches the narrator at the cap.
{
  const f = fixture(entries, () => call("read_context", { refs: ["card:a"] }))
  const t = await f.go(f.S.act(f.g.id, { text: "find" }))
  assert.equal(f.lookup.length, 5)
  assert.equal(t.deliveries.length, 1)
  assert.equal((f.calls.find((c) => c.phase === "lookup")!.out as { status: string }).status, "budget_exhausted")
}
// Failed lookup leaves no journal deliveries or node; a later attempt can read the same revision.
{
  const f = fixture(entries, (_, n) => {
    if (n === 1) throw new Error("lookup transport failed")
    return n === 0 || n === 2 ? call("read_context", { refs: ["card:a"] }) : done
  })
  await assert.rejects(f.go(f.S.act(f.g.id, { text: "find" })), /lookup transport failed/)
  assert.equal(f.S.log.nodes.size, 1)
  const retried = await f.go(f.S.act(f.g.id, { text: "find" }))
  assert.equal(retried.deliveries[0]!.resourceId, "card:a")
}
const r = (id: string, text: string, patch: Partial<Resource> = {}): Resource => ({
  resourceId: id,
  title: text.split(".")[0]!,
  text,
  revision: revision(text),
  source: "memory",
  access: { model: true, player: false },
  activation: "on_demand",
  residency: "window",
  disclosures: [],
  ...patch,
})
const tc = { toolCallId: "test", signal: new AbortController().signal }
// The old version actually in the request is superseded, not mistaken for the current one.
{
  const old = r("memory:people/e_li", "李鹤 青城弃徒 警惕")
  const next = r(old.resourceId, "李鹤 青城弃徒 盟友")
  const lookup = contextLookup([next, r("memory:place/p1", "福记面馆 西栅街面")], [freeze(old)])
  assert.equal(lookup.search("李鹤 盟友")[0]!.supersedes, old.revision)
  const got = await lookup.tools.read_context.execute({ refs: [old.resourceId] }, tc)
  assert.equal(got.ok, true)
  assert.equal(lookup.delivered[0]!.superseded, old.revision)
  assert.match(lookup.delivered[0]!.text, /青城弃徒/)
  assert.equal(lookup.search("李鹤").length, 0)
  assert.equal(lookup.search("福记面馆 西栅街面").length, 1)
  await lookup.tools.read_context.execute({ refs: [old.resourceId] }, tc)
  assert.equal(lookup.delivered.length, 1)
}
// Residency depends on the request's injected snapshots, not just logical identity or history.
{
  const snapshots = [
    r("card:permanent", "P", { residency: "permanent" }),
    r("card:window", "W"),
    r("card:turn", "T", { residency: "turn" }),
  ]
  const path = [{ deliveries: snapshots.map((s) => freeze(s)) }, { deliveries: [] }]
  assert.deepEqual(
    residentOn(path, 0).map((r) => r.text),
    ["P", "W"],
  )
  assert.deepEqual(
    residentOn(path, 1).map((r) => r.text),
    ["P"],
  )
  assert.equal(contextLookup(snapshots, []).readable().length, 3)
}
// Ensemble ranking (#160): the named entry beats nine earlier entries that mention the name once in their body; the
// segmenter splits 茉璃 into single characters, which other ids share.
{
  const e = (id: string, title: string, text: string) => r(id, text, { source: "card", title })
  const cast = [
    "璃港守卫",
    "雾璃商人",
    "老船长",
    "灯塔看守",
    "渔村医师",
    "盐田工头",
    "港口书记",
    "夜市琴师",
    "璃窑匠人",
  ]
  const ensemble = [
    ...cast.map((n, i) => e(`card:${n}`, `${n}，港口人物`, `${n}在港口生活了${i + 3}年。与茉璃有过一面之缘。`)),
    e("card:灯塔", "灯塔，港口北端的旧塔", "灯塔立在北礁上，雾夜里由看守点灯。"),
    // The name in a title and thrice in the body still ranks below the entry the id names.
    e("card:港口编年", "茉璃上岸的那一年", "茉璃上岸那年港口结冰。人们说茉璃来自北方。茉璃自己不记得。"),
    e("card:茉璃", "茉璃，失忆的女航海士", "茉璃被冲上岸时什么都不记得。她的过去藏在一本湿透的航海日志里。"),
    e("card:初航_茉璃", "茉璃绕过灯塔的初航", "那年冬天，她独自驾船绕过灯塔，再没按原路回来。"),
  ]
  const ids = (q: string) =>
    contextLookup(ensemble, [])
      .search(q)
      .map((h) => h.resourceId)
  assert.equal(ids("茉璃")[0], "card:茉璃")
  assert.equal(ids("茉璃").length, 8)
  // Both words in the anchor, then one word in the anchor and the id, then anchor-only, then body-only mentions.
  const two = ids("茉璃 灯塔")
  assert.equal(two[0], "card:初航_茉璃")
  assert.deepEqual(new Set(two.slice(1, 4)), new Set(["card:灯塔看守", "card:灯塔", "card:茉璃"]))
  assert.equal(ids("茉璃的过去")[0], "card:茉璃")
  assert.deepEqual(ids("潜艇 xyz"), [])
}
// Sections (docs/sections-brief.md): an entry's appendices, read on demand; the face's snapshot never lists them.
{
  const mira = {
    id: "mira",
    layers: ["Mira keeps the lighthouse. She is tall."],
    sections: [
      { id: "kin", text: "Mira's kin live inland. Two brothers." },
      { id: "past", text: "Mira's years at sea. She sailed the Gray Reach for ten years." },
    ],
  }
  const harbor = { id: "harbor", layers: ["The Gray Reach harbor. Boats come in at dusk."] }
  const resources = [mira, harbor].flatMap((e) => [loreResource(e, 1), ...sectionResources(e, 1)])
  const [kin, past] = sectionResources(mira, 1)
  assert.equal(past!.resourceId, "card:mira#past")
  assert.deepEqual(
    [past!.access, past!.activation, past!.disclosures],
    [{ model: true, player: false }, "on_demand", []],
  )
  assert.deepEqual(loreResource(mira, 1), loreResource({ id: mira.id, layers: mira.layers }, 1)) // the face is today's, byte for byte
  // reading the face: the snapshot has no section text, the tool result lists the sections
  {
    const l = contextLookup(resources, [])
    const got = await l.tools.read_context.execute({ refs: ["card:mira"] }, tc)
    assert.ok(!JSON.stringify(l.delivered).includes("Gray Reach") && !JSON.stringify(l.delivered).includes("#kin"))
    assert.deepEqual((got as { value: { sections?: unknown }[] }).value[0]!.sections, [
      { resourceId: kin!.resourceId, title: kin!.title },
      { resourceId: past!.resourceId, title: past!.title },
    ])
    // the face resident, a section unread: still searchable, flagged resident, sections listed with the hit one first
    const hits = l.search("reach")
    assert.deepEqual(
      hits.map((h) => h.resourceId),
      ["card:harbor", "card:mira"], // the anchor hit ranks above the section-body hit
    )
    assert.equal(hits[1]!.resident, true)
    assert.deepEqual(
      hits[1]!.sections!.map((x) => x.resourceId),
      ["card:mira#past", "card:mira#kin"],
    )
    assert.match(l.told(l.delivered[0]!), /\nSections \(read_context\): card:mira#kin .* \| card:mira#past /)
    await l.tools.read_context.execute({ refs: ["card:mira#kin", "card:mira#past"] }, tc)
    assert.deepEqual(
      l.delivered.map((d) => d.resourceId),
      ["card:mira", "card:mira#kin", "card:mira#past"],
    )
    // every section resident: the entry leaves search, readable() holds only the other entry, the told line is bare
    assert.equal(l.told(l.delivered[0]!), deliveryText(l.delivered[0]!))
    assert.deepEqual(
      l.readable().map((r) => r.resourceId),
      ["card:harbor"],
    )
    assert.equal(l.search("mira").length, 0)
  }
  // reading a section alone brings its face along, ahead of it, within the 8-per-call cap
  {
    const l = contextLookup(resources, [])
    await l.tools.read_context.execute({ refs: ["card:mira#past"] }, tc)
    assert.deepEqual(
      l.delivered.map((d) => d.resourceId),
      ["card:mira", "card:mira#past"],
    )
    const face = contextLookup(resources, [freeze(resources[0]!)])
    await face.tools.read_context.execute({ refs: ["card:mira#past"] }, tc)
    assert.deepEqual(
      face.delivered.map((d) => d.resourceId),
      ["card:mira#past"],
    )
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      layers: [`E${i}.`],
      sections: [{ id: "s", text: "S." }],
    }))
    const capped = contextLookup(
      many.flatMap((e) => [loreResource(e, 1), ...sectionResources(e, 1)]),
      [],
    )
    const out = await capped.tools.read_context.execute({ refs: many.map((e) => `card:${e.id}#s`) }, tc)
    assert.equal((out as { code?: string }).code, "too_many_refs")
    assert.equal(capped.delivered.length, 0)
  }
}
// Session: a locked entry's sections are neither readable nor searchable; turn 2's lookup reads the section directory
// under the resident face, narrate never sees it.
{
  const f = fixture(
    [
      {
        ...lore("mira", "Mira keeps the lighthouse."),
        sections: [{ id: "past", text: "Mira's years at sea. She sailed the Gray Reach." }],
      },
      { ...lore("vault", "The vault."), unlock: { any: [] }, sections: [{ id: "deep", text: "VAULT SECRET." }] },
    ],
    (_, n) =>
      n === 0
        ? call("read_context", { refs: ["card:vault#deep"] })
        : n === 1
          ? call("search_context", { query: "vault secret" })
          : n === 2
            ? call("read_context", { refs: ["card:mira"] })
            : done,
  )
  const t1 = await f.go(f.S.act(f.g.id, { text: "who keeps the light" }))
  assert.ok(JSON.stringify(f.lookup[1]!.prompt).includes("unavailable_resource"))
  assert.ok(!JSON.stringify(f.lookup).includes("VAULT SECRET"))
  assert.ok(!JSON.stringify(f.lookup[2]!.prompt.at(-1)).includes("card:vault"))
  assert.deepEqual(
    t1.deliveries.map((d) => d.resourceId),
    ["card:mira"],
  )
  assert.ok(JSON.stringify(f.lookup[3]!.prompt.at(-1)).includes("card:mira#past")) // read_context's result lists it
  await f.go(f.S.act(t1.id, { text: "tell me about her past" }))
  assert.equal(f.lookup.length, 5)
  assert.ok(JSON.stringify(f.lookup[4]!.prompt).includes("Sections (read_context): card:mira#past"))
  const narrated = f.calls.filter((c) => c.phase === "narrate").map((c) => JSON.stringify(c.msgs))
  assert.equal(narrated.length, 2)
  assert.ok(narrated[1]!.includes("Mira keeps the lighthouse") && !narrated.some((m) => m.includes("#past")))
}
console.log("lookup ok")
