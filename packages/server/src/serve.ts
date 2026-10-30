// The wire adapter at the session's seam: one process, a session per story, no logic of its own. A request names its
// story in `x-tavern-story` (the client's `stories.current`); a story route (/card, /nodes, /calls, /turn, /stop,
// POST /, DELETE /nodes/<id>) without the header, or with one naming no story, is a 404. The rest (/stories, /cards,
// /player, /personas, /hats, /secrets, /providers, /routing) is the install's, the same for every story. A story runs
// one turn at a time (turn.ts): an action on a story whose turn is in flight, a synchronous one too (greet, checkout,
// setField, a node dropped), is a 409 {error, code: "busy"}; a delete skips a busy story; stories run side by side,
// with no lock across them.
//   POST /      an Action (src/session.ts `Action`, decoded at this boundary) starts the story's turn and answers its
//                 events as SSE, one `event:` per kind; a failure is an `error` event {message, code?} (code "no-model":
//                 no routing pair and no environment model, library.ts `NoModel`). The turn is the story's, not the
//                 response's: closing the response stops nothing, the turn lands whoever listens.
//   GET  /turn    the turn in flight, to a client that comes back to the story: 204 when idle; else SSE, one `attach`
//                 event {phase, draft: {parent, input, text, prev?} | null} then the live events (no replay). A turn
//                 that failed with nobody listening answers once: `attach` with its draft, then its `error`, and ends.
//   POST /stop    the player's stop {stopped: "withdrawn" | "halted" | null}: before the first character the action is
//                 interrupted and nothing is saved (its stream ends, nothing more), after it the prose halts and the
//                 turn finishes a `stopped` node down the same streams; null when nothing ran.
//   GET  /nodes   the snapshot: every node's projection and head, for a client that just opened.
//   GET  /player  the player layer in force; PUT /player replaces it whole (decoded as `Player` at this boundary,
//                 written to the library, in force from the next request; a bad body is a 400).
//   GET  /stories every card's stories (id, card, title or null, starred, turns: the nodes with a player line or note,
//                 so a greeting is none, last: the last turn's input or null, updated, busy: the phase of a turn in
//                 flight or null), newest first, and `current`: the story the client is to be on (the one it named
//                 while that one is there, else the newest, null on an empty library).
//                 POST /stories {card} makes a new one of that card (400 when there is none) and answers it as
//                 `current`, PUT /stories/<id> answers that one (404
//                 when there is none), with a body {title?: string | null, starred?: boolean} names or stars it
//                 instead (blank = null, `updated` untouched), DELETE /stories with {ids: number[]} removes those
//                 among them in one go (a busy one stays; there is no single delete: the cleanup sheet is the one
//                 place a story is deleted, #117). Every one answers the listing.
//                 The server opens nothing: the client adopts `current`, sends it from then on, re-reads /nodes, and
//                 the trace starts over. GET /stories/search?q=… is the manager's search: the stories whose head's
//                 line holds q in a player line, a note or the prose, each as {id, turn, kind, text, count} (data.ts
//                 `Hit`; the title is the client's to match). GET /stories/<id>/export.md is the head's line as a
//                 reading copy, GET /stories/<id>/export.json the tree whole as a backup (export.ts), both as
//                 attachments named by the title.
//   GET  /personas  the player's personas; PUT /personas/<id> {name, text} writes one (in force from the next request
//                 where it is picked), DELETE /personas/<id> removes it and its picks (the client re-reads /player).
//                 Both answer the list. Which persona is in force on a card is the player's (`Player.persona`).
//   GET  /hats    the player's hats; PUT /hats/<id> {name, narrate?, review?} writes one (decoded as `Hat`, in force
//                 from the next request on a connection that names it), DELETE /hats/<id> removes it. Both answer the list.
//   GET  /secrets the key vault as {id, name, type, hint}: a value never leaves the server. POST /secrets
//                 {name, type?, value} adds one and answers it the same way; PUT /secrets/<id> {name, type?, value?} renames,
//                 retypes or rekeys it in place; DELETE /secrets/<id> removes it (a provider naming it then has no key). Both answer the list.
//                 A write with a value and no type reads the type off the key (provider `secretType`: `sk-ant-oat…` is a bearer).
//                 GET /secrets/<id>/value {value} is the one route that answers a key: the owner's deliberate reveal or
//                 copy, one request per click (404 when there is none); no listing ever carries it.
//   GET  /providers  the player's model providers (provider providers.ts `Provider`), a key only as a secret id.
//                 PUT /providers/<id> writes one (decoded as `Provider` without id), DELETE /providers/<id> removes it
//                 and the routing pairs on it. Both answer the list. GET /providers/<id>/models lists the service's
//                 models from every endpoint the provider has, merged ({id, format?}[], the format where the listing
//                 puts the model off the default protocol and onto an endpoint the provider has; every listing
//                 failing is a 502 {error}). POST /providers/<id>/test {model?}
//                 probes: with a model one request for a few tokens' answer, without one the listing from every endpoint
//                 the provider has (one request per distinct listing URL). The answer is the probes, 200 whatever they
//                 found (provider `Probe`: {formats, url, method, status, ms, ok, code?, error?}, status 0 = nothing
//                 answered); a 400 {error} is the provider's configuration (no key, no endpoint, a bad URL).
//   GET  /models/names  the model-name table (provider names.ts `Names`): {[owner/model]: {name, family}}, what the
//                 settings lists name and group a model id by, without the network.
//   GET  /routing which (provider, model) runs each stage: {default?, stages?}; PUT /routing replaces it (in force
//                 from the next request).
//   DELETE /nodes/<id>  the node and everything under it gone (a thread is a root's subtree); the reply is the Change.
//   GET  /calls   the story's `call` events by node id: the inspector's trace. The turn files them in the library
//                 under the node they made once it lands (turn.ts), whoever listened; they go with the node, and only
//                 a story's last 200 nodes keep theirs.
//   GET  /cards   every card the install knows, as {id, title}: the card files, then the library's table (tavern.ts
//                 `shelf`). GET /cards/<id> is what a client draws that card by (404 when there is none), before any
//                 story of it exists: id, title and summary, the default channel, the rules as data (field bounds,
//                 options, action ids), the openings whole, the declared products' shapes, the quick inputs
//                 (snippets), the format keys, the fiction's modules without their text, the guard and lore as counts,
//                 and what the card's text costs each turn, estimated (session.ts `cardView`).
//                 Fragment bodies, guard lines and lore never leave the server.
//   GET  /card    the same for the story's own card.
// `inspect` keeps the request messages on `call` events (the stream and /calls); they carry the card's fragment
// bodies, so a player client gets phase, answer and usage only.
import { Provider, Secret } from "@effect-tavern/provider"
import { decodePlayer, Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { decodeAction, type Event } from "@effect-tavern/runtime/src/session.ts"
import { Cause, Effect, Fiber, Schema, Stream, Struct } from "effect"
import { readFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, resolve, sep } from "node:path"
import { backup, disposition, markdown } from "./export.ts"
import { NoModel, Routing, type Library } from "./library.ts"
import type { Out } from "./turn.ts"

const body = (req: IncomingMessage, limit = 1 << 20) =>
  new Promise<string>((resolve, reject) => {
    let s = ""
    req.setEncoding("utf8")
    req.on("data", (c: string) => {
      s += c
      if (s.length > limit) {
        reject(new Error("body too large"))
        req.destroy()
      }
    })
    req.on("end", () => resolve(s))
    req.on("error", reject)
  })
/** A failed action as its `error` event: the message, and the code of the one failure the client acts on (no model:
 *  its way into Settings). */
const failure = (c: Cause.Cause<unknown>): { message: string; code?: string } => {
  const e = Cause.squash(c)
  if (e instanceof NoModel) return { message: e.message, code: e.code }
  return { message: e instanceof Error ? e.message : String(e) }
}

// The body besides Action and Player, decoded here like them.
const PersonaBody = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, text: Schema.String }))
const HatBody = Schema.decodeUnknownSync(Hat.mapFields(Struct.omit(["id"])))
const ProviderBody = Schema.decodeUnknownSync(Provider.mapFields(Struct.omit(["id"])))
const SecretBody = Schema.decodeUnknownSync(
  Schema.Struct({ name: Secret.fields.name, type: Schema.optionalKey(Secret.fields.type), value: Secret.fields.value }),
)
const SecretMeta = Schema.decodeUnknownSync(
  Schema.Struct({
    name: Secret.fields.name,
    type: Schema.optionalKey(Secret.fields.type),
    value: Schema.optionalKey(Secret.fields.value),
  }),
)
const TestBody = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.optionalKey(Schema.String) }))
const RoutingBody = Schema.decodeUnknownSync(Routing)
const StoryBody = Schema.decodeUnknownSync(
  Schema.Struct({
    title: Schema.optionalKey(Schema.NullOr(Schema.String)),
    starred: Schema.optionalKey(Schema.Boolean),
  }),
)
const IdsBody = Schema.decodeUnknownSync(Schema.Struct({ ids: Schema.Array(Schema.Number) }))
const NewStory = Schema.decodeUnknownSync(Schema.Struct({ card: Schema.String }))

export const handle = (lib: Library, { inspect = false } = {}) => {
  const shown = (e: Event) => (inspect || e.kind !== "call" ? e : { ...e, msgs: [] })
  return async (req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(v))
    }
    const bad = (e: unknown, status = 400) => json(status, { error: e instanceof Error ? e.message : String(e) })
    /** The body, decoded; `empty` stands in for a blank one. Throws on a bad or too-large body, for `reply`. */
    const read = async <T>(decode: (u: unknown) => T, empty?: string): Promise<T> =>
      decode(JSON.parse((await body(req)) || (empty ?? "")))
    /** What `f` gives as 200, or what it throws as `status`. */
    const reply = async (f: () => unknown, status = 400) => {
      try {
        return json(200, await f())
      } catch (e) {
        return bad(e, status)
      }
    }
    const named = req.headers["x-tavern-story"]
    const asked = typeof named === "string" && named !== "" ? Number(named) : undefined
    /** The listing, with the story the client is to be on: the one it named while that one is still there, else the
     *  newest, none on an empty library. */
    const stories = (current?: number) => {
      const rows = lib.stories.list()
      const named = current ?? (asked !== undefined && lib.exists(asked) ? asked : undefined)
      return { current: named ?? rows[0]?.id ?? null, stories: rows }
    }
    if (req.method === "GET" && req.url === "/stories") return json(200, stories())
    if (req.method === "POST" && req.url === "/stories")
      return reply(async () => stories(lib.stories.create((await read(NewStory)).card)))
    if (req.method === "DELETE" && req.url === "/stories")
      return reply(async () => (lib.stories.delMany((await read(IdsBody)).ids), stories()))
    const searching = req.method === "GET" && /^\/stories\/search(?:\?(.*))?$/.exec(req.url ?? "")
    if (searching) return json(200, lib.stories.search(new URLSearchParams(searching[1] ?? "").get("q") ?? ""))
    const exporting = req.method === "GET" && /^\/stories\/(\d+)\/export\.(md|json)$/.exec(req.url ?? "")
    if (exporting) {
      const id = Number(exporting[1])
      const x = lib.stories.export(id)
      if (!x) return json(404, { error: `no story ${id}` })
      const md = exporting[2] === "md"
      res.writeHead(200, {
        "content-type": md ? "text/markdown; charset=utf-8" : "application/json",
        "content-disposition": disposition(x.story, md ? "md" : "json"),
      })
      res.end(md ? markdown(x) : JSON.stringify(backup(x), null, 2))
      return
    }
    const storyAt = /^\/stories\/(\d+)$/.exec(req.url ?? "")
    if (storyAt && req.method === "PUT") {
      const id = Number(storyAt[1])
      if (!lib.exists(id)) return json(404, { error: `no story ${id}` })
      return reply(async () => {
        const raw = await body(req)
        if (raw === "") return stories(id) // a blank body is the switch: this story becomes the current one
        const b = StoryBody(JSON.parse(raw))
        if (b.title !== undefined) lib.stories.title(id, b.title)
        if (b.starred !== undefined) lib.stories.star(id, b.starred)
        return stories()
      })
    }
    if (req.method === "GET" && req.url === "/personas") return json(200, lib.personas.list())
    const personaAt = /^\/personas\/([^/]+)$/.exec(req.url ?? "")
    if (personaAt && (req.method === "PUT" || req.method === "DELETE")) {
      const id = decodeURIComponent(personaAt[1]!)
      return reply(async () => {
        if (req.method === "PUT") lib.personas.put({ id, ...(await read(PersonaBody)) })
        else lib.personas.del(id)
        return lib.personas.list()
      })
    }
    if (req.method === "GET" && req.url === "/hats") return json(200, lib.hats.list())
    const hatAt = /^\/hats\/([^/]+)$/.exec(req.url ?? "")
    if (hatAt && (req.method === "PUT" || req.method === "DELETE")) {
      const id = decodeURIComponent(hatAt[1]!)
      return reply(async () => {
        if (req.method === "PUT") lib.hats.put({ id, ...(await read(HatBody)) })
        else lib.hats.del(id)
        return lib.hats.list()
      })
    }
    if (req.method === "GET" && req.url === "/secrets") return json(200, lib.secrets.list())
    if (req.method === "POST" && req.url === "/secrets")
      return reply(async () => lib.secrets.add(await read(SecretBody)))
    const valueAt = req.method === "GET" && /^\/secrets\/([^/]+)\/value$/.exec(req.url ?? "")
    if (valueAt) {
      const value = lib.secrets.value(decodeURIComponent(valueAt[1]!))
      return value === undefined ? json(404, { error: "no such secret" }) : json(200, { value })
    }
    const secretAt = /^\/secrets\/([^/]+)$/.exec(req.url ?? "")
    if (secretAt && (req.method === "PUT" || req.method === "DELETE")) {
      const id = decodeURIComponent(secretAt[1]!)
      return reply(async () => {
        if (req.method === "PUT") lib.secrets.set(id, await read(SecretMeta))
        else lib.secrets.del(id)
        return lib.secrets.list()
      })
    }
    if (req.method === "GET" && req.url === "/providers") return json(200, lib.providers.list())
    const providerAt = /^\/providers\/([^/]+)(\/models|\/test)?$/.exec(req.url ?? "")
    if (providerAt) {
      const id = decodeURIComponent(providerAt[1]!)
      const known = lib.providers.list().some((p) => p.id === id)
      if (!providerAt[2] && (req.method === "PUT" || req.method === "DELETE"))
        return reply(async () => {
          if (req.method === "PUT") lib.providers.put({ id, ...(await read(ProviderBody)) })
          else lib.providers.del(id)
          return lib.providers.list()
        })
      if (!known && providerAt[2]) return json(404, { error: `no provider ${id}` })
      if (providerAt[2] === "/models" && req.method === "GET") return reply(() => lib.providers.models(id), 502)
      // a bad body, or the provider's configuration (no key, no endpoint): 400; a probe's finding is a 200's Probe
      if (providerAt[2] === "/test" && req.method === "POST")
        return reply(async () => lib.providers.test(id, (await read(TestBody, "{}")).model))
    }
    if (req.method === "GET" && req.url === "/models/names") return json(200, lib.names())
    if (req.method === "GET" && req.url === "/routing") return json(200, lib.routing.read())
    if (req.method === "PUT" && req.url === "/routing")
      return reply(async () => (lib.routing.write(await read(RoutingBody)), lib.routing.read()))
    if (req.method === "GET" && req.url === "/player") return json(200, lib.player)
    if (req.method === "PUT" && req.url === "/player")
      return reply(async () => (lib.setPlayer(await read(decodePlayer)), lib.player))
    if (req.method === "GET" && req.url === "/cards") return json(200, lib.cards())
    const cardAt = req.method === "GET" && /^\/cards\/([^/]+)$/.exec(req.url ?? "")
    if (cardAt) return reply(() => lib.view(decodeURIComponent(cardAt[1]!)), 404)
    // Everything below is one story's: the one the request names.
    if (asked === undefined || !lib.exists(asked)) return json(404, { error: `no story ${asked ?? ""}`.trim() })
    const story = asked
    const s = lib.session(story)
    const turn = lib.turn(story)
    if (req.method === "GET" && req.url === "/card") return json(200, lib.view(lib.cardOf(story)!))
    if (req.method === "GET" && req.url === "/nodes") return json(200, s.snapshot())
    if (req.method === "GET" && req.url === "/calls")
      return json(
        200,
        Object.fromEntries(
          Object.entries(lib.calls(story).list()).map(([id, cs]) => [id, cs.map((c) => shown(c as Event))]),
        ),
      )
    if (req.method === "POST" && req.url === "/stop") return json(200, { stopped: turn.stop() })
    /** Streams `events` as SSE, after `first` when given; the response's close unsubscribes, nothing more. */
    const stream = (events: Stream.Stream<Out>, first?: [string, unknown]) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      let closed = false
      const send = (name: string, v: unknown) => {
        if (!closed) res.write(`event: ${name}\ndata: ${JSON.stringify(v)}\n\n`)
      }
      if (first) send(...first)
      const fiber = Effect.runFork(
        Stream.runForEach(events, (e) =>
          Effect.sync(() => (e.kind === "error" ? send("error", failure(e.cause)) : send(e.kind, shown(e)))),
        ).pipe(Effect.ensuring(Effect.sync(() => void (closed || res.end())))),
      )
      // `req` "close" means the request body was consumed (Node ≥ 16), not that the client went away; the response's does.
      res.on("close", () => {
        if (res.writableFinished) return
        closed = true
        Effect.runFork(Fiber.interrupt(fiber))
      })
    }
    if (req.method === "GET" && req.url === "/turn") {
      const at = turn.attach()
      if (!at) {
        res.writeHead(204)
        return void res.end()
      }
      return stream(at.events, ["attach", { phase: at.phase, draft: at.draft }])
    }
    const dropping = req.method === "DELETE" && /^\/nodes\/(\d+)$/.exec(req.url ?? "")
    if (!dropping && (req.method !== "POST" || req.url !== "/")) return json(404, { error: "not found" })
    const busy = () => json(409, { error: `story ${story} is busy: ${turn.busy}`, code: "busy" })
    if (dropping) return turn.busy ? busy() : reply(() => s.drop(Number(dropping[1])), 404) // its nodes' calls go with them
    let action
    try {
      action = await read(decodeAction)
    } catch (e) {
      return bad(e)
    }
    if (turn.busy) return busy()
    stream(turn.start(action))
  }
}
export const serve = (lib: Library, opts?: { inspect?: boolean }) => createServer(handle(lib, opts))

const types: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
}
/** The whole tavern on one port, what a phone runs: the session's handler under /api (the prefix stripped, as Vite's
 *  mount does), and under everything else the client build (`vp build` → packages/client/dist): a path with an
 *  extension is that file (hashed assets cached for good) or a 404, any other path is index.html, the client's own. */
export const app = (api: (req: IncomingMessage, res: ServerResponse) => Promise<void>, dist: string) => {
  const root = resolve(dist)
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? "/"
    if (url === "/api" || url.startsWith("/api/")) {
      req.url = url.slice(4) || "/"
      return api(req, res)
    }
    const path = decodeURIComponent(new URL(url, "http://x").pathname)
    const file = resolve(root, `.${path}`)
    const page = !extname(path) || !file.startsWith(root + sep)
    const asset = page ? join(root, "index.html") : file
    try {
      const body = await readFile(asset)
      res.writeHead(200, {
        "content-type": types[extname(asset).slice(1)] ?? "application/octet-stream",
        "cache-control": page ? "no-cache" : "public, max-age=31536000, immutable",
      })
      res.end(body)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end(page ? "no client build: vp build in packages/client" : "not found")
    }
  }
}
