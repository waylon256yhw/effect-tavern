// The same application operations through a local caller and HTTP; no browser or real model.
import { fake } from "@effect-tavern/provider"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { Effect, Stream } from "effect"
import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { open } from "../src/data.ts"
import { library, type PublicEvent } from "../src/library.ts"
import { serve } from "../src/serve.ts"
import { Busy } from "../src/turn.ts"

const card: Card = {
  id: "headless",
  title: "Original",
  frame: [],
  fiction: [{ id: "secret", text: "PRIVATE FICTION" }],
  greetings: [{ text: "Hello" }],
  lore: [],
  guard: [],
  rules: { fields: [{ path: "score", type: "int", min: 0, max: 100, initial: 1 }], actions: [] },
}
const data = open(":memory:")
const model = fake((call) => {
  const doc = readStage(call)
  return { ...defaultAnswer(doc, { notes: "N" }), ...(doc.phase === "record" && { delay: 100 }) }
})
// A file-only source: installing must work without relying on tavern.shelf's database composition.
const lib = library({
  data,
  cards: { list: () => [{ id: card.id, title: card.title! }], get: () => card },
  model: () => model,
})
const server = serve(lib)
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const direct = lib.stories.create(card.id)
const remote = lib.stories.create(card.id)
const http = (story: number, path: string, method = "GET", body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { "x-tavern-story": String(story) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const collect = (stream: Stream.Stream<PublicEvent>) => Effect.runPromise(Stream.runCollect(stream))
const wired = (value: unknown) => JSON.parse(JSON.stringify(value))
const sse = (text: string) =>
  text
    .trim()
    .split("\n\n")
    .map((block) => JSON.parse(block.split("\ndata: ")[1]!))
try {
  const invalid = { kind: "act", input: { text: 42 } }
  assert.throws(() => lib.submit(direct, invalid))
  assert.equal((await http(remote, "/", "POST", invalid)).status, 400)
  assert.throws(() => lib.packs.put({ id: "p", name: 42 }))
  assert.equal((await http(remote, "/packs/p", "PUT", { name: 42 })).status, 400)
  assert.throws(() => lib.locals.write({ id: "local", name: card.id, card: card.id, mounts: 42 }))
  assert.equal((await http(remote, `/cards/${card.id}/local`, "PUT", { mounts: 42 })).status, 400)

  const greeting = { kind: "greet" }
  const localEvents = await collect(lib.submit(direct, greeting))
  const remoteEvents = sse(await (await http(remote, "/", "POST", greeting)).text())
  assert.deepEqual(wired(localEvents), remoteEvents)
  assert.ok(!JSON.stringify(localEvents).includes("PRIVATE FICTION"))

  const original = lib.session(direct)
  assert.throws(() => lib.cards.put({ ...card, rules: { fields: "wrong" } }))
  assert.equal(lib.session(direct), original) // rejected writes do not evict
  lib.cards.put({
    ...card,
    title: "Installed",
    rules: { ...card.rules, fields: [{ ...card.rules.fields[0]!, initial: 7 }] },
  })
  const installed = lib.session(direct)
  assert.notEqual(installed, original)
  assert.equal(installed.meta.title, "Installed")
  assert.equal(installed.node(0).state.score, 7) // old logs deliberately reinterpret current rules
  const context = await (await http(direct, "/context?node=0")).json()
  assert.deepEqual(context, wired(installed.activeContext(0)))
  assert.equal(lib.cards.list().filter((c) => c.id === card.id).length, 1)

  let record!: () => void
  const ready = new Promise<void>((resolve) => {
    record = resolve
  })
  const done = collect(
    lib.submit(direct, { kind: "act", input: { text: "go" } }).pipe(
      Stream.tap((event) =>
        Effect.sync(() => {
          if (event.kind === "stage" && event.phase === "record") record()
        }),
      ),
    ),
  )
  await ready
  const node = installed.log.head!
  assert.throws(() => lib.submit(direct, greeting), Busy)
  assert.throws(() => lib.drop(direct, node), Busy)
  assert.equal((await http(direct, "/", "POST", greeting)).status, 409)
  assert.equal((await http(direct, `/nodes/${node}`, "DELETE")).status, 409)
  assert.throws(() => lib.submit(direct, { kind: "skipRecord", node: 999 }))
  assert.equal((await http(direct, "/", "POST", { kind: "skipRecord", node: 999 })).status, 400)

  const attachment = lib.attach(direct)!
  assert.equal(attachment.phase, "record")
  const attached = collect(attachment.events)
  lib.cards.put({
    ...card,
    title: "Next",
    rules: { ...card.rules, fields: [{ ...card.rules.fields[0]!, initial: 9 }] },
  })
  assert.equal(lib.session(direct), installed) // a running turn retains its definition
  assert.equal(lib.session(remote).meta.title, "Next") // an idle sibling reloads immediately
  const skipped = await collect(lib.submit(direct, { kind: "skipRecord", node }))
  assert.equal(skipped[0]?.kind, "change")
  const finished = await done
  assert.ok((await attached).some((e) => e.kind === "change" && e.node?.settlementStatus === "skipped"))
  assert.ok(finished.every((e) => e.kind !== "change" || !e.node || !("turn" in e.node)))
  assert.equal(installed.node(node).state.score, 7)
  assert.equal(lib.session(direct).node(node).state.score, 9)
  assert.equal(lib.session(direct).meta.title, "Next")
  assert.equal(lib.attach(direct), undefined)
  assert.equal(lib.stop(direct), null)
  const trace = lib.trace(direct, node)
  assert.ok(trace.length > 0)
  assert.ok(trace.every((c) => c.msgs.length === 0 && c.out === undefined))
  assert.deepEqual(await (await http(direct, `/nodes/${node}/trace`)).json(), wired(trace))
  assert.ok(lib.trace(direct, node, true).some((c) => c.msgs.length > 0))
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  data.close()
}
console.log("headless ok")
