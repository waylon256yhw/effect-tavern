// The library (src/library.ts) through its own interface, over an in-memory store: stories and their sessions on the
// cards their rows name, the turn in flight (src/turn.ts), the persona cascade, the vault, routing and its pruning, the
// fold policy, model listings and probes against local fake upstreams, the card shelf. What the wire makes of it
// (status codes, SSE, headers) is test/serve.ts's.
import { LLMock } from "@copilotkit/aimock"
import { fake, fakeText, type Model } from "@effect-tavern/provider"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { policyFor } from "@effect-tavern/runtime/src/history.ts"
import { chat, plain as player } from "@effect-tavern/runtime/test/cards/index.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/test/script.ts"
import { Effect, Fiber, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { open, type Data } from "../src/data.ts"
import { library, NoModel } from "../src/library.ts"
import { shelf } from "../src/tavern.ts"
import type { Out } from "../src/turn.ts"

// the localhost upstreams below stay off a shell proxy: through one, a refused socket comes back as the proxy's 502
process.env.NO_PROXY = "localhost,127.0.0.1"
const env = fake(() => ({ text: "hello world" }))
const model = () => env
const at = (s: { address: () => unknown }) => `http://localhost:${(s.address() as AddressInfo).port}`
const chats = shelf([chat], open(":memory:")) // a shelf of one, where the card does not matter
const canned = { notes: "N1", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }

/** A library over `data` with chat and `other` on its shelf (no table cards unless the test writes some). */
const other: Card = { ...chat, id: "other", title: "别处" }
const over = (data: Data, m: () => Model = model) =>
  library({ data, cards: shelf([chat, other], data), player, model: m })

// The library holds no open story and binds no card: a session per story, on the card its row names, opened on first
// use and kept. A player write reaches every open session. The listing is every card's, each row naming its card and
// whether a turn is in flight; a card's own is a filter. A batch delete with a card takes that card's own among the
// ids, their sessions with them.
{
  const data = open(":memory:")
  const solo = over(data)
  const a = solo.stories.create(chat.id)
  const b = solo.stories.create(chat.id)
  assert.throws(() => solo.stories.create("nowhere"), /no card nowhere/)
  assert.equal(solo.session(a), solo.session(a))
  assert.notEqual(solo.session(a), solo.session(b))
  solo.setPlayer({ ...solo.player, persona: { [chat.id]: "monk" } })
  assert.deepEqual(
    [solo.session(a).player.persona, solo.session(b).player.persona],
    [{ [chat.id]: "monk" }, { [chat.id]: "monk" }],
  )
  solo.stories.delMany([b])
  assert.throws(() => solo.session(b), /no story/)
  solo.stories.delMany([b]) // gone already: nothing to do
  const theirs = solo.stories.create(other.id)
  assert.deepEqual(
    solo.stories.list().map((s) => [s.id, s.card, s.busy]),
    [
      [theirs, other.id, null],
      [a, chat.id, null],
    ],
  )
  assert.equal(solo.session(theirs).meta.id, other.id) // the story's card, not the first on the shelf
  assert.deepEqual(
    solo.stories.list(chat.id).map((s) => s.id),
    [a],
  )
  const [x, y] = [solo.stories.create(chat.id), solo.stories.create(chat.id)]
  solo.session(x)
  solo.stories.delMany([x, y, theirs, 999], chat.id)
  assert.deepEqual(
    solo.stories.list(chat.id).map((s) => s.id),
    [a],
  )
  assert.throws(() => solo.session(x), /no story/) // its open session went with it
  assert.equal(data.stories.list("other")[0]?.id, theirs) // another card's id is left alone
}

// The turn in flight is the story's (src/turn.ts), crossed in process as the wire crosses it. Three stories, two on one
// card and one on another, each run a turn at once and each lands. A turn whose only listener goes away runs on to its
// node; a late `attach` gets the phase and the draft so far, then the live events to the node. A second turn on a busy
// story is refused. A stop before the first character withdraws (nothing saved, the story free at once), after it the
// turn finishes a `stopped` node. A failure nobody heard waits for one attach, which consumes it. The persona in force
// is each story's own card's pick.
{
  const seen: string[] = [] // every narrate request, as text
  const slow = fake((o) => {
    const doc = readStage(o)
    if (doc.phase === "record" && o.prompt.some((m) => fakeText(m).includes("lost"))) return { text: "not json" } // record fails
    if (doc.phase !== "narrate") return defaultAnswer(doc, canned)
    seen.push(o.prompt.map(fakeText).join("\n"))
    return { text: "hello world ".repeat(10), delay: 10 }
  })
  const data = open(":memory:")
  const lib = over(data, () => slow)
  const run = (s: Stream.Stream<Out>) => Effect.runPromise(Stream.runCollect(s)).then((es) => [...es])
  const landed = (es: Out[]) => (es.at(-1) as Extract<Out, { kind: "change" }>).node!
  const act = (text: string) => ({ kind: "act" as const, parent: null, input: { text } })
  const [p, q, r] = [lib.stories.create(chat.id), lib.stories.create(chat.id), lib.stories.create(other.id)]
  const all = await Promise.all([p, q, r].map((id) => run(lib.turn(id).start(act(`story ${id}`)))))
  assert.deepEqual(
    all.map((es) => landed(es).turn.input.text),
    [p, q, r].map((id) => `story ${id}`),
  )
  assert.deepEqual(
    [p, q, r].map((id) => lib.session(id).log.nodes.size),
    [1, 1, 1],
  )
  assert.ok(Object.keys(lib.calls(p).list()).length === 1) // filed by the turn under its node

  // the listener leaves mid-narrate; the turn goes on, an attach picks it up where it stands and runs to the node
  const t = lib.turn(p)
  const gone = Effect.runFork(Stream.runDrain(t.start(act("slow"))))
  while (!t.attach()?.draft?.text) await new Promise((f) => setTimeout(f, 5))
  await Effect.runPromise(Fiber.interrupt(gone))
  assert.equal(lib.stories.list().find((s) => s.id === p)!.busy, "narrate")
  assert.throws(() => t.start(act("again")), /in flight/)
  lib.stories.delMany([p]) // skipped while busy: its writes would land on nothing
  assert.ok(lib.exists(p))
  const back = t.attach()!
  assert.deepEqual(
    [back.phase, back.draft!.parent, back.draft!.input, back.draft!.text.length > 0],
    ["narrate", null, { text: "slow" }, true],
  )
  const rest = await run(back.events)
  assert.equal(landed(rest).turn.input.text, "slow")
  assert.equal(landed(rest).turn.end, "end")
  assert.deepEqual([t.busy, t.attach(), lib.session(p).log.nodes.size], [null, undefined, 2])

  // stop: before the first character nothing is saved and the story is free at once; after it a `stopped` node lands
  const early = run(t.start(act("never")))
  assert.equal(t.stop(), "withdrawn")
  assert.equal(t.busy, null)
  assert.deepEqual(
    (await early).filter((e) => e.kind !== "stage"),
    [],
  ) // the stream ends clean: no prose, no node, no error
  assert.equal(lib.session(p).log.nodes.size, 2)
  const late = t.start(act("cut"))
  const cut = run(late)
  while (!t.attach()?.draft?.text) await new Promise((f) => setTimeout(f, 5))
  assert.equal(t.stop(), "halted")
  const halted = landed(await cut).turn
  assert.deepEqual([halted.input.text, halted.end], ["cut", "stopped"])
  assert.equal(t.stop(), null)
  assert.equal(lib.session(p).log.nodes.size, 3)

  // a failure nobody heard: kept for one attach with its draft, then gone
  const bad = Effect.runFork(Stream.runDrain(t.start({ kind: "act", input: { text: "lost" } })))
  await Effect.runPromise(Fiber.interrupt(bad)) // gone before narrate is through, so before record fails
  while (t.busy) await new Promise((f) => setTimeout(f, 5))
  const failed = t.attach()
  assert.deepEqual(failed?.draft, { parent: 2, input: { text: "lost" }, text: "hello world ".repeat(10), fresh: true })
  const told = await run(failed!.events)
  assert.deepEqual(
    told.map((e) => e.kind),
    ["error"],
  )
  assert.equal(t.attach(), undefined)

  // the persona: each story's own card's pick
  lib.personas.put({ id: "monk", name: "行脚僧", text: "你是路过的行脚僧。" })
  lib.setPlayer({ ...lib.player, persona: { [other.id]: "monk" } })
  await run(lib.turn(p).start(act("who")))
  assert.equal(seen.at(-1)!.includes("你是路过的行脚僧。"), false)
  await run(lib.turn(r).start(act("who")))
  assert.equal(seen.at(-1)!.includes("你是路过的行脚僧。"), true)
}

// A persona deleted is gone from every card it was picked on; the others' picks stay, and an empty map is no map.
{
  const lib = over(open(":memory:"))
  lib.personas.put({ id: "monk", name: "行脚僧", text: "你是路过的行脚僧。" })
  lib.setPlayer({ ...lib.player, persona: { [chat.id]: "monk", other: "monk", third: "nun" } })
  lib.personas.del("monk")
  assert.deepEqual([lib.personas.list(), lib.player.persona], [[], { third: "nun" }])
  lib.personas.del("nun")
  assert.equal(lib.player.persona, undefined)
}

// The vault: a value goes in once and comes back only as a hint (first six, last four; none of a short key), except on
// the one reveal. A write with a value and no type reads the type off the key: an OAuth token is a bearer, anything else
// a key; a rename without a value keeps the type it had.
{
  const lib = library({ data: open(":memory:"), cards: chats, player })
  const VALUE = "sk-test-0123456789abcdef"
  const made = lib.secrets.add({ name: "Relay key", type: "api_key", value: VALUE })
  assert.deepEqual(made, { id: made.id, name: "Relay key", type: "api_key", hint: "sk-tes****cdef" })
  assert.ok(!JSON.stringify(lib.secrets.list()).includes(VALUE))
  assert.equal(lib.secrets.value(made.id), VALUE)
  const NEXT = "sk-next-9876543210fedcba"
  lib.secrets.set(made.id, { name: "Relay key", type: "auth_token", value: NEXT })
  assert.deepEqual(lib.secrets.list(), [{ id: made.id, name: "Relay key", type: "auth_token", hint: "sk-nex****dcba" }])
  const typeOf = () => lib.secrets.list()[0]!.type
  lib.secrets.set(made.id, { name: "Relay key", value: "sk-ant-oat01-abcdefghij" })
  assert.equal(typeOf(), "auth_token")
  lib.secrets.set(made.id, { name: "Renamed" })
  assert.deepEqual([typeOf(), lib.secrets.value(made.id)], ["auth_token", "sk-ant-oat01-abcdefghij"])
  lib.secrets.set(made.id, { name: "Relay key", value: "user_0123456789abcdef" })
  assert.equal(typeOf(), "api_key")
  const untyped = lib.secrets.add({ name: "Oat", value: "sk-ant-oat01-0123456789" })
  assert.equal(untyped.type, "auth_token")
  assert.equal(lib.secrets.add({ name: "Short", value: "short" }).hint, "****")
  assert.throws(() => lib.secrets.set("none", { name: "x" }), /no secret none/)
  lib.secrets.del(untyped.id)
  assert.equal(lib.secrets.value(untyped.id), undefined)
}

// Routing: a stage runs on its own pair, else the default's, else the environment's model, else NoModel; `pinned` puts
// the environment's over the row. A pair that does not resolve fails naming the provider. A disabled provider keeps its
// pairs (it can be switched back on); a model dropped from its list takes its pairs; a deleted provider takes all.
// The fold policy follows the narrate pair's model entry, never throwing: no pair, or pinned, is 8000.
{
  const data = open(":memory:")
  data.secrets.put({ id: "k", name: "K", type: "api_key", value: "v" })
  const relay = {
    id: "relay",
    name: "Relay",
    enabled: true,
    defaultFormat: "openai-compatible" as const,
    endpoints: { "openai-compatible": { url: "http://localhost:1" } },
    secret: "k",
    models: [{ id: "m", contextTokens: 16000 }, { id: "n" }],
  }
  const lib = library({ data, cards: chats, player, model })
  const on = (m: Model) => (m === env ? "env" : (m.model as { modelId: string }).modelId)
  const pair = (model: string) => ({ provider: "relay", model })
  assert.equal(on(lib.model("narrate")), "env")
  assert.deepEqual(lib.policy(), policyFor())
  assert.equal(lib.policy().budget, 8000)
  lib.providers.put(relay)
  lib.routing.write({ default: pair("m"), stages: { lookup: pair("n") } })
  assert.deepEqual([on(lib.model("lookup")), on(lib.model("narrate"))], ["n", "m"])
  assert.deepEqual([lib.policy(), lib.policy().budget], [policyFor(16000), 0]) // a 16k window folds everything it may
  lib.providers.put({ ...relay, models: [{ id: "m", contextTokens: 200000 }, { id: "n" }] })
  assert.ok(lib.policy().budget > 0) // a 200k one keeps the tail
  const pinned = library({ data, cards: chats, player, model, pinned: true })
  assert.deepEqual([on(pinned.model("lookup")), pinned.policy().budget], ["env", 8000])
  assert.throws(() => library({ data: open(":memory:"), cards: chats, player }).model("narrate"), NoModel)

  lib.providers.put({ ...relay, enabled: false })
  assert.throws(() => lib.model("narrate"), /provider "Relay": disabled/)
  assert.deepEqual(lib.routing.read(), { default: pair("m"), stages: { lookup: pair("n") } })
  lib.providers.put({ ...relay, enabled: false, models: [{ id: "n" }] })
  assert.deepEqual(lib.routing.read(), { stages: { lookup: pair("n") } })
  lib.routing.write({ default: pair("n") })
  lib.providers.del("relay")
  assert.deepEqual(lib.routing.read(), {})
  assert.equal(on(lib.model("narrate")), "env") // the stage follows the environment's model again
}

// Listings and probes against a stub upstream that speaks openai-compatible: the key rides to the upstream; endpoints
// on one listing URL are one request; a listing that fails is left out while another answers, all failing is the
// error; a model only another host lists goes under that host's format; a dead endpoint is a probe of status 0 with
// the socket's code; an address that answers with no listing is reached, not ok; a provider's configuration throws.
{
  const VALUE = "sk-test-0123456789abcdef"
  const seen: string[] = []
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const upstream = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`)
    if (req.url === "/v1/models")
      return void res.end(JSON.stringify({ data: [{ id: "m" }, { id: "n", supported_endpoints: ["/messages"] }] }))
    if (req.method === "GET") return void res.end("<!doctype html><title>not an api</title>") // a reverse proxy's page
    let s = ""
    req.on("data", (c) => (s += c))
    req.on("end", () => {
      if (JSON.parse(s).stream) {
        res.writeHead(200, { "content-type": "text/event-stream" })
        res.end(chunk({ role: "assistant", content: "ROUTED" }, null) + chunk({}, "stop") + "data: [DONE]\n\n")
      } else
        res.end(
          JSON.stringify({
            id: "c",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [{ index: 0, message: { role: "assistant", content: "o" }, finish_reason: "length" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        )
    })
  }).listen(0)
  const up = at(upstream)
  const dead = createServer().listen(0)
  const deadUrl = at(dead)
  dead.close()
  const host = createServer((_, res) => res.end(JSON.stringify({ data: [{ id: "o" }, { id: "m" }] }))).listen(0)
  const hostUrl = at(host)
  const lib = library({ data: open(":memory:"), cards: chats, player, model })
  const made = lib.secrets.add({ name: "Relay key", type: "api_key", value: VALUE })
  const relay = {
    id: "relay",
    name: "Relay",
    enabled: true,
    defaultFormat: "openai-compatible" as const,
    endpoints: { "openai-compatible": { url: up } } as Record<string, { url: string }>,
    secret: made.id,
    models: [{ id: "m" }],
  }
  const put = (p: Partial<typeof relay> & { secret?: string }) => lib.providers.put({ ...relay, ...p })
  try {
    put({})
    // `n` is off the default protocol by the upstream's word, but the provider has no endpoint on it: no format yet
    assert.deepEqual(await lib.providers.models("relay"), [{ id: "m" }, { id: "n" }])
    assert.ok(seen.at(-1)!.endsWith(`Bearer ${VALUE}`))
    const listed = await lib.providers.test("relay")
    assert.deepEqual(
      [listed.length, listed[0]!.formats, listed[0]!.url, listed[0]!.status, listed[0]!.ok, typeof listed[0]!.ms],
      [1, ["openai-compatible"], `${up}/v1/models`, 200, true, "number"],
    )
    const asked = await lib.providers.test("relay", "m")
    assert.deepEqual(
      [asked.length, asked[0]!.formats, asked[0]!.url, asked[0]!.method, asked[0]!.status, asked[0]!.ok],
      [1, ["openai-compatible"], `${up}/v1/chat/completions`, "POST", 200, true],
    )
    // three endpoints, two on one address: one listing request per distinct URL, the default's first; the dead one is
    // left out of the listing while the shared address answers, and is a probe of its own; `n` now has an endpoint
    put({ endpoints: { "openai-compatible": { url: up }, anthropic: { url: up }, gemini: { url: deadUrl } } })
    assert.deepEqual(await lib.providers.models("relay"), [{ id: "m" }, { id: "n", format: "anthropic" }])
    const probes = await lib.providers.test("relay")
    assert.deepEqual(
      probes.map((p) => [p.formats, p.url, p.status, p.ok, p.code]),
      [
        [["openai-compatible", "anthropic"], `${up}/v1/models`, 200, true, undefined],
        [["gemini"], `${deadUrl}/v1beta/models`, 0, false, "ECONNREFUSED"],
      ],
    )
    assert.equal(seen.filter((s) => s.startsWith("GET /v1/models")).length, 4) // one request for the shared address
    assert.match(probes[1]!.error!, /ECONNREFUSED/)
    put({ endpoints: { "openai-compatible": { url: `${up}/x` } } })
    const [page] = await lib.providers.test("relay")
    assert.deepEqual([page!.status, page!.ok, page!.error], [200, false, "model listing failed: not JSON"])
    // two hosts: a model only the other host lists, with no word of its own on formats, goes under that host's format;
    // one both list is on the default and gets none
    put({ endpoints: { "openai-compatible": { url: up }, anthropic: { url: hostUrl } } })
    assert.deepEqual(await lib.providers.models("relay"), [
      { id: "m" },
      { id: "n", format: "anthropic" },
      { id: "o", format: "anthropic" },
    ])
    put({ endpoints: { "openai-compatible": { url: deadUrl } } })
    await assert.rejects(lib.providers.models("relay")) // every listing failing is the error, not an empty list
    put({ secret: undefined })
    await assert.rejects(lib.providers.test("relay"), /provider "Relay": no key/)
  } finally {
    upstream.close()
    host.close()
  }
}

// The listing and the test against aimock's native Anthropic surface (anthropic-version enforced): the listing answers
// the catalog, the test answers the Trace of the fetch it made, the listing's without a model, a few tokens'
// /v1/messages with one, a disabled provider probed all the same.
{
  const mock = new LLMock({ port: 0, policy: { requiredHeaders: "enforce", modelCatalog: "native" } })
  mock.on({ model: "claude-haiku-5-5" }, { content: "ok" })
  await mock.start()
  const data = open(":memory:")
  data.secrets.put({ id: "k", name: "K", type: "api_key", value: "test-key" })
  data.providers.put({
    id: "a",
    name: "A",
    enabled: false, // a probe does not need it switched on
    defaultFormat: "anthropic",
    endpoints: { anthropic: { url: mock.url } },
    secret: "k",
    models: [],
  })
  const lib = library({ data, cards: chats, player, model })
  try {
    assert.deepEqual(await lib.providers.models("a"), [{ id: "claude-haiku-5-5" }])
    const [listed] = await lib.providers.test("a")
    assert.deepEqual(
      [listed!.url, listed!.method, listed!.status, listed!.ok, typeof listed!.ms],
      [`${mock.url}/v1/models`, "GET", 200, true, "number"],
    )
    const [asked] = await lib.providers.test("a", "claude-haiku-5-5")
    assert.deepEqual(
      [asked!.url, asked!.method, asked!.status, asked!.ok],
      [`${mock.url}/v1/messages`, "POST", 200, true],
    )
    // a model the mock does not know: the request went (the trace's URL and status), the answer was no
    const [refused] = await lib.providers.test("a", "claude-none")
    assert.deepEqual([refused!.url, refused!.method, refused!.ok], [`${mock.url}/v1/messages`, "POST", false])
    assert.ok(refused!.status >= 400 && typeof refused!.error === "string" && refused!.error.length > 0)
  } finally {
    await mock.stop()
  }
}

// The cards (tavern.ts `shelf`): the card files, then the library's table, one row per id (first wins), the id where
// there is no title. A table card opens a story like a file card; one that does not decode fails when asked for.
{
  const dir = await mkdtemp(join(tmpdir(), "tavern-cards-"))
  const file = join(dir, "t.db")
  const data = open(file)
  const { id: _, ...body } = chat
  new DatabaseSync(file)
    .prepare("insert into card values (?, ?, ?, 0), (?, ?, '{}', 0), (?, ?, '{}', 0)")
    .run("mine", "我的", JSON.stringify(body), chat.id, "dup", "broken", "坏的")
  const lib = library({ data, cards: shelf([chat, { ...chat, id: "bare", title: undefined }], data), player, model })
  try {
    assert.deepEqual(lib.cards(), [
      { id: chat.id, title: chat.title ?? chat.id },
      { id: "bare", title: "bare" },
      { id: "broken", title: "坏的" },
      { id: "mine", title: "我的" },
    ])
    const mine = lib.stories.create("mine")
    assert.deepEqual([lib.session(mine).meta.id, lib.view("mine").id], ["mine", "mine"])
    assert.throws(() => lib.stories.create("broken"))
    assert.throws(() => lib.view("none"), /no card none/)
  } finally {
    await rm(dir, { recursive: true })
  }
}
console.log("library ok")
