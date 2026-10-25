// The adapter on a scripted session over a real socket: an action goes in as JSON, its events come back as SSE in the
// session's order, a bad body is a 400, a bad action is an `error` event, and `inspect` decides whether `call` events
// carry the request. `greet` opens a new root, `checkout` moves head, DELETE /nodes/<id> drops a subtree and answers with the Change.
import { LLMock } from "@copilotkit/aimock"
import { fake, fakeText } from "@effect-tavern/provider"
import type { Event } from "@effect-tavern/runtime/src/session.ts"
import { chat, player } from "@effect-tavern/runtime/test/cards/wuxia.ts"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { open } from "../src/data.ts"
import { library } from "../src/library.ts"
import { app, handle, serve } from "../src/serve.ts"

const model = {
  ...fake((o) =>
    o.responseFormat?.type === "json"
      ? {
          text: JSON.stringify({
            notes: ["N1"],
            options: ["A", "B", "C", "D"],
            people: [],
            scene: { place: "P", present: [] },
          }),
        }
      : /slow/.test(fakeText(o.prompt.at(-1)!))
        ? { text: "hello world ".repeat(20), delay: 20 }
        : { text: "hello world" },
  ),
  prefill: false,
  hat: "h",
}
const lib = library({ data: open(":memory:"), card: { ...chat, greetings: [{ text: "G" }] }, player, model })

const wired = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown // what JSON keeps: no `undefined` keys
const sse = (text: string) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [ev, data] = block.split("\n")
      return { event: ev!.slice(7), data: JSON.parse(data!.slice(6)) as Event & { message?: string } }
    })

const run = async (inspect: boolean) => {
  const server = serve(lib, { inspect }).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const post = (v: unknown, signal?: AbortSignal) => fetch(base, { method: "POST", body: JSON.stringify(v), signal })
  try {
    assert.deepEqual(await (await fetch(`${base}/nodes`)).json(), wired(lib.session.snapshot()))
    const about = (await (await fetch(`${base}/card`)).json()) as Record<string, unknown>
    assert.equal(about["input"], "act") // undeclared = act
    // the card's projection: the openings whole, the fiction without its text, the guard and lore as counts
    assert.deepEqual(
      [about["greetings"], about["guard"], about["lore"], about["director"], about["fiction"]],
      [
        [{ text: "G" }],
        0,
        { entries: 0, layers: 0 },
        false,
        [
          { id: "pei", label: "裴青舟" },
          { id: "pei-cool", label: "裴青舟（戒备）", when: { path: "bond", op: "lt", value: 8 } },
          { id: "pei-warm", label: "裴青舟（松动）", when: { path: "bond", op: "gte", value: 8 } },
        ],
      ],
    )

    // the player layer: read whole, replaced whole; the card's quick inputs follow it at once, a bad body is a 400
    assert.deepEqual(await (await fetch(`${base}/player`)).json(), wired(player))
    const mine = { ...player, writing: { pov: "third" as const }, snippets: [{ name: "Q", text: "q" }] }
    const put = (v: unknown) => fetch(`${base}/player`, { method: "PUT", body: JSON.stringify(v) })
    assert.deepEqual(await (await put(mine)).json(), wired(mine))
    assert.equal(
      ((await (await fetch(`${base}/card`)).json()) as { snippets: { name: string }[] }).snippets[0]!.name,
      "Q",
    )
    assert.equal((await put({ global: "no" })).status, 400)
    assert.equal((await put(player)).status, 200)

    const r = await post({ kind: "act", parent: null, input: { text: "hi" } })
    assert.equal(r.headers.get("content-type"), "text/event-stream")
    const evs = sse(await r.text())
    assert.deepEqual(
      evs.map((e) => e.event),
      ["stage", "delta", "delta", "call", "stage", "call", "change"],
    )
    const calls = evs.filter((e) => e.event === "call").map((e) => e.data as Extract<Event, { kind: "call" }>)
    assert.deepEqual(
      calls.map((c) => c.msgs.length > 0),
      [inspect, inspect],
    )
    const node = (evs.at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.equal(node.turn.input.text, "hi")
    assert.deepEqual(node, wired(lib.session.node(node.id))) // the wire carries the projection whole
    assert.equal(lib.session.log.head, node.id)
    // the trace stays on the server, by node, stripped the same way as the stream; every call carries its duration
    const trace = (await (await fetch(`${base}/calls`)).json()) as Record<string, Extract<Event, { kind: "call" }>[]>
    assert.deepEqual(trace[node.turn.id], wired(calls))
    assert.deepEqual(
      calls.map((c) => typeof c.ms === "number" && c.ms >= 0),
      [true, true],
    )

    const picked = sse(await (await post({ kind: "pick", node: node.turn.id, option: 1 })).text())
    assert.equal((picked.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.turn.input.text, "B")

    // stop: the client closes the response once the prose streams; the turn finishes into a `stopped` node it reads back.
    const ac = new AbortController()
    const size = lib.session.log.nodes.size
    const slow = await post({ kind: "act", parent: null, input: { text: "slow" } }, ac.signal)
    const reader = slow.body!.getReader()
    let got = ""
    while (!/event: delta/.test(got)) got += new TextDecoder().decode((await reader.read()).value)
    ac.abort()
    while (lib.session.log.nodes.size === size) await new Promise((r) => setTimeout(r, 10))
    const stopped = [...lib.session.log.nodes.values()].at(-1)!
    const kept = (stopped.reply[0] as { text: string }).text
    assert.deepEqual([stopped.input.text, stopped.end, kept.length > 0 && kept.length < 240], ["slow", "stopped", true])
    assert.equal(
      ((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes.length,
      lib.session.log.nodes.size,
    )

    const bad = await post({ kind: "fly" })
    assert.equal(bad.status, 400)
    assert.equal((await post("{")).status, 400)

    const err = sse(
      await (await post({ kind: "setField", node: node.turn.id, effects: [{ path: "x", set: 1 }] })).text(),
    )
    assert.deepEqual([err.length, err[0]!.event, /x/.test(err[0]!.data.message!)], [1, "error", true])
    // A parent that does not exist is a defect on the stream, not a new root (it once became its own parent and spun).
    const orphan = sse(await (await post({ kind: "act", parent: 99, input: { text: "hi" } })).text())
    assert.deepEqual([orphan.length, orphan[0]!.event, /99/.test(orphan[0]!.data.message!)], [1, "error", true])

    // a new thread is a greeting root; dropping a root takes its subtree, the trace with it, and ids never come back
    const greeted = sse(await (await post({ kind: "greet" })).text())
    const g = (greeted.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.turn
    assert.deepEqual([g.parent, g.input.text, (g.reply[0] as { text: string }).text], [null, "", "G"])
    const noSuch = sse(await (await post({ kind: "greet", greeting: 3 })).text())
    assert.deepEqual([noSuch.length, noSuch[0]!.event], [1, "error"])
    const tree = [...lib.session.log.nodes.keys()]
    // checkout: head to a version's newest leaf (its follow-up comes back); act without a parent lands under head
    const back = sse(await (await post({ kind: "checkout", node: node.id })).text())
    assert.deepEqual(back.at(-1)!.data, { kind: "change", head: node.id + 1 }) // "hi" → its pick "B"
    const under = sse(await (await post({ kind: "act", input: { text: "under head" } })).text())
    const u = (under.at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.deepEqual([u.parent, lib.session.log.head], [node.id + 1, u.id])
    const hadTrace = Object.keys((await (await fetch(`${base}/calls`)).json()) as object).length
    const c = (await (await fetch(`${base}/nodes/${node.id}`, { method: "DELETE" })).json()) as {
      dropped: number[]
      head: number | null
    }
    assert.deepEqual(
      [c.dropped, c.head],
      [[node.id, node.id + 1, u.id], Math.max(...tree.filter((id) => id !== node.id && id !== node.id + 1))],
    ) // head was inside: the newest survivor
    assert.ok(Object.keys((await (await fetch(`${base}/calls`)).json()) as object).length < hadTrace)
    assert.equal((await fetch(`${base}/nodes/${node.id}`, { method: "DELETE" })).status, 404)
    const again = sse(await (await post({ kind: "act", parent: null, input: { text: "hi" } })).text())
    assert.equal((again.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.id, u.id + 1) // one past every id ever handed out, the dropped tail's included

    // The library on the wire. A persona is the player's, picked per card on the player row: the pick puts its text in
    // the narrator's head (seen when inspecting) from the next request on, an edit of the persona too, no new story;
    // deleting it drops the pick. A new story opens empty; switching back finds the first story's nodes; a story that is
    // not there is a 404.
    const first = lib.story
    const persona = (id: string, v?: unknown) =>
      fetch(`${base}/personas/${id}`, {
        method: v === undefined ? "DELETE" : "PUT",
        body: v === undefined ? undefined : JSON.stringify(v),
      })
    const monk = { id: "monk", name: "行脚僧", text: "你是路过的行脚僧。" }
    assert.deepEqual(await (await persona("monk", { name: monk.name, text: monk.text })).json(), [monk])
    assert.equal((await persona("monk", { name: 1 })).status, 400)
    assert.deepEqual(await (await fetch(`${base}/personas`)).json(), [monk])
    const me = (await (await fetch(`${base}/player`)).json()) as Record<string, unknown>
    await fetch(`${base}/player`, { method: "PUT", body: JSON.stringify({ ...me, persona: { [chat.id]: "monk" } }) })
    const opened = (await (await fetch(`${base}/stories`, { method: "POST" })).json()) as {
      current: number
      stories: { id: number }[]
    }
    assert.deepEqual([opened.current !== first, opened.stories.length], [true, 2])
    assert.deepEqual(((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes, [])
    const headOf = async (text: string) => {
      const got = sse(await (await post({ kind: "act", parent: null, input: { text } })).text())
      return JSON.stringify((got.find((e) => e.event === "call")!.data as Extract<Event, { kind: "call" }>).msgs)
    }
    assert.equal((await headOf("who am i")).includes(monk.text), inspect)
    await persona("monk", { name: monk.name, text: "你是还俗的武僧。" })
    assert.equal((await headOf("and now")).includes("你是还俗的武僧。"), inspect) // the edit is in force, same story
    const listed = (await (await fetch(`${base}/stories`)).json()) as { stories: { turns: number; last: string }[] }
    assert.deepEqual([listed.stories[0]!.turns, listed.stories[0]!.last], [2, "and now"]) // the row is named by the player's last line
    assert.equal(
      ((await (await fetch(`${base}/stories/${first}`, { method: "PUT" })).json()) as { current: number }).current,
      first,
    )
    assert.equal(
      ((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes.length,
      lib.session.log.nodes.size,
    )
    assert.equal((await fetch(`${base}/stories/999`, { method: "PUT" })).status, 404)
    const left = (await (await fetch(`${base}/stories/${opened.current}`, { method: "DELETE" })).json()) as {
      current: number
      stories: unknown[]
    }
    assert.deepEqual([left.current, left.stories.length], [first, 1])
    assert.deepEqual(await (await persona("monk")).json(), [])
    assert.equal(((await (await fetch(`${base}/player`)).json()) as { persona?: object }).persona, undefined) // the pick went with it
    assert.equal((await headOf("who now")).includes(monk.text), false)

    // A hat is a library row the connection names by id (`model.hat` is "h" here): absent, the connection is bare; put,
    // its narrate tail ends the next request; deleted, gone again. A bad body is a 400.
    const hat = (v?: unknown) =>
      fetch(`${base}/hats/h`, {
        method: v === undefined ? "DELETE" : "PUT",
        body: v === undefined ? undefined : JSON.stringify(v),
      })
    const h = { name: "续写", narrate: { tail: [{ role: "user", text: "HAT-TAIL" }] } }
    assert.equal((await headOf("bare")).includes("HAT-TAIL"), false)
    assert.deepEqual(await (await hat(h)).json(), [{ id: "h", ...h }])
    assert.equal((await hat({ name: "x", narrate: { tail: [{ role: "tool", text: "" }] } })).status, 400)
    assert.deepEqual(await (await fetch(`${base}/hats`)).json(), [{ id: "h", ...h }])
    assert.equal((await headOf("worn")).includes("HAT-TAIL"), inspect)
    assert.deepEqual(await (await hat()).json(), [])
    assert.equal((await headOf("gone")).includes("HAT-TAIL"), false)
  } finally {
    server.close()
  }
}
await run(true)
await run(false)

// Settings on the wire, against a stub upstream that speaks openai-compatible: a secret goes in once and comes back
// only as a hint (no provider or secret response ever carries the value); a provider names it by id; the listing and
// the test go through the provider's endpoint with its key; a routing pair is in force from the next request, per
// stage, and a pair that does not resolve fails that request naming the provider; deleting the provider clears it.
{
  const VALUE = "sk-test-0123456789abcdef"
  const seen: string[] = []
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const upstream = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`)
    if (req.url === "/v1/models") return void res.end(JSON.stringify({ data: [{ id: "m" }, { id: "n" }] }))
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
  const up = `http://localhost:${(upstream.address() as AddressInfo).port}`
  const routed = library({ data: open(":memory:"), card: chat, player, model })
  const server = serve(routed, { inspect: true }).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, v?: unknown) => {
    const r = await fetch(base + path, { method, body: v === undefined ? undefined : JSON.stringify(v) })
    const text = await r.text()
    assert.ok(!text.includes(VALUE), `${method} ${path} leaked the key`)
    return { status: r.status, body: text ? (JSON.parse(text) as any) : undefined }
  }
  try {
    const made = (await call("POST", "/secrets", { name: "Relay key", type: "api_key", value: VALUE })).body
    assert.deepEqual(made, { id: made.id, name: "Relay key", type: "api_key", hint: "sk-tes****cdef" })
    assert.equal((await call("POST", "/secrets", { name: "x", type: "password", value: "v" })).status, 400)
    const relay = {
      name: "Relay",
      enabled: true,
      defaultFormat: "openai-compatible",
      endpoints: { "openai-compatible": { url: up } },
      secret: made.id,
      models: [{ id: "m" }],
    }
    assert.deepEqual((await call("PUT", "/providers/relay", relay)).body, [{ id: "relay", ...relay }])
    assert.equal((await call("PUT", "/providers/bad", { ...relay, key: VALUE, enabled: "yes" })).status, 400)
    assert.deepEqual((await call("GET", "/providers/relay/models")).body, ["m", "n"])
    assert.ok(seen.at(-1)!.endsWith(`Bearer ${VALUE}`)) // the key rode to the upstream, never back to the client
    const listed = (await call("POST", "/providers/relay/test")).body
    assert.deepEqual([listed.url, listed.status, typeof listed.ms], [`${up}/v1/models`, 200, "number"])
    const asked = (await call("POST", "/providers/relay/test", { model: "m" })).body
    assert.deepEqual([asked.url, asked.method, asked.status], [`${up}/v1/chat/completions`, "POST", 200])
    assert.equal((await call("POST", "/providers/none/test")).status, 404)

    // routing: narrate on the relay, every other stage on the environment's model
    const act = async (text: string) =>
      sse(await (await fetch(base, { method: "POST", body: JSON.stringify({ kind: "act", input: { text } }) })).text())
    const prose = (evs: ReturnType<typeof sse>) =>
      (evs.at(-1)!.data as Extract<Event, { kind: "change" }>)
        .node!.turn.reply.map((p) => (p as { text: string }).text)
        .join("")
    assert.equal(prose(await act("before")), "hello world")
    const pair = { provider: "relay", model: "m" }
    assert.deepEqual((await call("PUT", "/routing", { stages: { narrate: pair } })).body, { stages: { narrate: pair } })
    assert.equal(prose(await act("after")), "ROUTED")
    await call("PUT", "/providers/relay", { ...relay, enabled: false })
    const off = await act("off")
    assert.deepEqual([off.at(-1)!.event, /provider "Relay": disabled/.test(off.at(-1)!.data.message!)], ["error", true])
    await call("PUT", "/routing", { default: pair })
    await call("DELETE", "/providers/relay")
    assert.deepEqual((await call("GET", "/routing")).body, {})
    assert.equal(prose(await act("gone")), "hello world")
    // a retyped key replaces the value in place: one entry, the new hint, the old key gone from the vault
    const NEXT = "sk-next-9876543210fedcba"
    const rekeyed = await fetch(`${base}/secrets/${made.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Relay key", type: "auth_token", value: NEXT }),
    })
    const after = await rekeyed.text()
    assert.ok(!after.includes(NEXT))
    assert.deepEqual(JSON.parse(after), [
      { id: made.id, name: "Relay key", type: "auth_token", hint: "sk-nex****dcba" },
    ])
    assert.equal((await call("PUT", `/secrets/${made.id}`, { name: "x", type: "api_key", value: 1 })).status, 400)
    assert.deepEqual((await call("DELETE", `/secrets/${made.id}`)).body, [])
  } finally {
    server.close()
    upstream.close()
  }
}

// The listing and the test against aimock's native Anthropic surface (anthropic-version enforced): the model route
// answers the catalog, the test answers the Trace of the fetch it made, the listing's without a model, a one-token
// /v1/messages with one.
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
  const server = serve(library({ data, card: chat, player, model })).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const post = async (v: unknown) =>
    (await fetch(`${base}/providers/a/test`, { method: "POST", body: JSON.stringify(v) })).json() as Promise<any>
  try {
    assert.deepEqual(await (await fetch(`${base}/providers/a/models`)).json(), ["claude-haiku-5-5"])
    const listed = await post({})
    assert.deepEqual(
      [listed.url, listed.method, listed.status, typeof listed.ms],
      [`${mock.url}/v1/models`, "GET", 200, "number"],
    )
    const asked = await post({ model: "claude-haiku-5-5" })
    assert.deepEqual([asked.url, asked.method, asked.status], [`${mock.url}/v1/messages`, "POST", 200])
  } finally {
    server.close()
    await mock.stop()
  }
}

// The app on one port: /api is the session with the prefix stripped; a path with an extension is a file of the build
// (hashed assets cached for good) or a 404; any other path is the client's index.html.
{
  const dist = await mkdtemp(join(tmpdir(), "tavern-dist-"))
  await mkdir(join(dist, "assets"))
  await writeFile(join(dist, "index.html"), "<!doctype html><title>t</title>")
  await writeFile(join(dist, "assets", "a.js"), "export {}")
  const server = createServer(app(handle(lib), dist)).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  try {
    const got = async (path: string) => {
      const r = await fetch(base + path)
      return [r.status, r.headers.get("content-type"), r.headers.get("cache-control"), await r.text()] as const
    }
    const index = [200, "text/html; charset=utf-8", "no-cache", "<!doctype html><title>t</title>"]
    assert.deepEqual(await got("/"), index)
    assert.deepEqual(await got("/stories"), index) // the client's route, not the session's
    assert.deepEqual(await got("/assets/a.js"), [
      200,
      "text/javascript",
      "public, max-age=31536000, immutable",
      "export {}",
    ])
    assert.equal((await got("/assets/b.js"))[0], 404)
    assert.deepEqual((await got("/..%2Fassets%2Fa.js")).slice(0, 2), [200, "text/html; charset=utf-8"]) // never above the build
    assert.equal(((await (await fetch(`${base}/api/card`)).json()) as { id: string }).id, chat.id)
    assert.ok(Array.isArray(((await (await fetch(`${base}/api/stories`)).json()) as { stories: unknown[] }).stories))
    assert.equal((await fetch(`${base}/api`)).status, 404) // the session's "/" takes POST only
  } finally {
    server.close()
    await rm(dist, { recursive: true })
  }
}

// The library alone: deleting the open story opens the newest remaining one, or a new one when none is left.
const solo = library({ data: open(":memory:"), card: chat, player, model })
const a = solo.story
solo.stories.create()
const b = solo.story
solo.stories.del(b)
assert.equal(solo.story, a)
solo.stories.del(a)
assert.ok(solo.story !== a && solo.stories.list().length === 1)
console.log("ok")
