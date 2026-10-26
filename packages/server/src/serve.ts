// The wire adapter at the session's seam: one process, a session per story, no logic of its own. A request names its
// story in `x-tavern-story` (the client's `stories.current`); without the header it is on the most recently updated
// story, and a header naming no story is a 404 on every story route (/card, /nodes, /calls, POST /). The rest
// (/player, /personas, /hats, /secrets, /providers, /routing) is the install's, the same for every story.
//   POST /      an Action (src/session.ts `Action`, decoded at this boundary) → the events it causes, as SSE, one
//                 `event:` per kind; a failure is an `error` event. Closing the response is the stop: before the first
//                 character of a draft it interrupts the action (nothing is saved, the model request aborts); once a
//                 delta was sent it halts the prose where it is and the turn finishes into a `stopped` node.
//   GET  /nodes   the snapshot: every node's projection and head, for a client that just opened.
//   GET  /player  the player layer in force; PUT /player replaces it whole (decoded as `Player` at this boundary,
//                 written to the library, in force from the next request; a bad body is a 400).
//   GET  /stories this card's stories (id, turns, the last line, updated), newest first, and `current`: the
//                 story the client is to be on (the one it named while that one is there, else the newest). POST
//                 /stories makes a new one and answers it as `current`, PUT /stories/<id> answers that one (404 when
//                 there is none), DELETE /stories/<id> removes it. The server opens nothing: the client adopts
//                 `current`, sends it from then on, re-reads /nodes, and the trace starts over.
//   GET  /personas  the player's personas; PUT /personas/<id> {name, text} writes one (in force from the next request
//                 where it is picked), DELETE /personas/<id> removes it and its picks (the client re-reads /player).
//                 Both answer the list. Which persona is in force on a card is the player's (`Player.persona`).
//   GET  /hats    the player's hats; PUT /hats/<id> {name, narrate?, review?} writes one (decoded as `Hat`, in force
//                 from the next request on a connection that names it), DELETE /hats/<id> removes it. Both answer the list.
//   GET  /secrets the key vault as {id, name, type, hint}: a value never leaves the server. POST /secrets
//                 {name, type, value} adds one and answers it the same way; PUT /secrets/<id> {name, type, value?} renames,
//                 retypes or rekeys it in place; DELETE /secrets/<id> removes it (a provider naming it then has no key). Both answer the list.
//                 GET /secrets/<id>/value {value} is the one route that answers a key: the owner's deliberate reveal or
//                 copy, one request per click (404 when there is none); no listing ever carries it.
//   GET  /providers  the player's model providers (provider providers.ts `Provider`), a key only as a secret id.
//                 PUT /providers/<id> writes one (decoded as `Provider` without id), DELETE /providers/<id> removes it
//                 and the routing pairs on it. Both answer the list. GET /providers/<id>/models lists the service's
//                 models (string[]; a failure is a 502 {error}). POST /providers/<id>/test {model?} makes one minimal
//                 request, a one-token answer with a model, the listing without: the Trace {url, method, status, ms},
//                 or a 502 {error, trace?}.
//   GET  /routing which (provider, model) runs each stage: {default?, stages?}; PUT /routing replaces it (in force
//                 from the next request).
//   DELETE /nodes/<id>  the node and everything under it gone (a thread is a root's subtree); the reply is the Change.
//   GET  /calls   the open story's `call` events by node id: the inspector's trace. They evaporate with the SSE (a
//                 stop closes it before record's call), so the adapter files them in the library under the node they
//                 made once it lands; they go with the node.
//   GET  /card    what a client draws the card by: id, title and summary, the default channel, the rules as data (field
//                 bounds, options, action ids), the openings whole, the products' shapes, the quick inputs (snippets),
//                 the format keys, the fiction's modules without their text, the guard and lore as counts, and what
//                 the card's text costs each turn, estimated.
//                 Fragment bodies, guard lines and lore never leave the server.
// `inspect` keeps the request messages on `call` events; they carry the card's fragment bodies, so a player client
// gets phase, answer and usage only.
import { Provider, Secret } from "@effect-tavern/provider"
import { decodePlayer, Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { decodeAction, perform, type Event } from "@effect-tavern/runtime/src/session.ts"
import { Cause, Deferred, Effect, Fiber, Schema, Stream, Struct } from "effect"
import { readFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, resolve, sep } from "node:path"
import { Routing, type Library } from "./library.ts"

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
const reason = (c: Cause.Cause<unknown>) => {
  const e = Cause.squash(c)
  return e instanceof Error ? e.message : String(e)
}

export type Call = Extract<Event, { kind: "call" }>
// The body besides Action and Player, decoded here like them.
const PersonaBody = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, text: Schema.String }))
const HatBody = Schema.decodeUnknownSync(Hat.mapFields(Struct.omit(["id"])))
const ProviderBody = Schema.decodeUnknownSync(Provider.mapFields(Struct.omit(["id"])))
const SecretBody = Schema.decodeUnknownSync(Secret.mapFields(Struct.omit(["id"])))
const SecretMeta = Schema.decodeUnknownSync(
  Schema.Struct({ name: Secret.fields.name, type: Secret.fields.type, value: Schema.optionalKey(Secret.fields.value) }),
)
const TestBody = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.optionalKey(Schema.String) }))
const RoutingBody = Schema.decodeUnknownSync(Routing)

export const handle = (lib: Library, { inspect = false } = {}) => {
  const shown = (e: Event) => (inspect || e.kind !== "call" ? e : { ...e, msgs: [] })
  return async (req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(v))
    }
    const bad = (e: unknown, status = 400) => json(status, { error: e instanceof Error ? e.message : String(e) })
    const named = req.headers["x-tavern-story"]
    const asked = typeof named === "string" && named !== "" ? Number(named) : undefined
    /** The listing, with the story the client is to be on: the one it named while that one is still there. */
    const stories = (current = asked !== undefined && lib.exists(asked) ? asked : lib.newest()) =>
      json(200, { current, stories: lib.stories.list() })
    if (req.method === "GET" && req.url === "/stories") return stories()
    if (req.method === "POST" && req.url === "/stories") return stories(lib.stories.create())
    const storyAt = /^\/stories\/(\d+)$/.exec(req.url ?? "")
    if (storyAt && (req.method === "PUT" || req.method === "DELETE")) {
      const id = Number(storyAt[1])
      if (!lib.exists(id)) return json(404, { error: `no story ${id}` })
      if (req.method === "PUT") return stories(id)
      lib.stories.del(id)
      return stories()
    }
    if (req.method === "GET" && req.url === "/personas") return json(200, lib.personas.list())
    const personaAt = /^\/personas\/([^/]+)$/.exec(req.url ?? "")
    if (personaAt && (req.method === "PUT" || req.method === "DELETE")) {
      const id = decodeURIComponent(personaAt[1]!)
      try {
        if (req.method === "PUT") lib.personas.put({ id, ...PersonaBody(JSON.parse(await body(req))) })
        else lib.personas.del(id)
      } catch (e) {
        return bad(e)
      }
      return json(200, lib.personas.list())
    }
    if (req.method === "GET" && req.url === "/hats") return json(200, lib.hats.list())
    const hatAt = /^\/hats\/([^/]+)$/.exec(req.url ?? "")
    if (hatAt && (req.method === "PUT" || req.method === "DELETE")) {
      const id = decodeURIComponent(hatAt[1]!)
      try {
        if (req.method === "PUT") lib.hats.put({ id, ...HatBody(JSON.parse(await body(req))) })
        else lib.hats.del(id)
      } catch (e) {
        return bad(e)
      }
      return json(200, lib.hats.list())
    }
    if (req.method === "GET" && req.url === "/secrets") return json(200, lib.secrets.list())
    if (req.method === "POST" && req.url === "/secrets") {
      try {
        return json(200, lib.secrets.add(SecretBody(JSON.parse(await body(req)))))
      } catch (e) {
        return bad(e)
      }
    }
    const valueAt = req.method === "GET" && /^\/secrets\/([^/]+)\/value$/.exec(req.url ?? "")
    if (valueAt) {
      const value = lib.secrets.value(decodeURIComponent(valueAt[1]!))
      return value === undefined ? json(404, { error: "no such secret" }) : json(200, { value })
    }
    const secretAt = /^\/secrets\/([^/]+)$/.exec(req.url ?? "")
    if (secretAt && (req.method === "PUT" || req.method === "DELETE")) {
      const id = decodeURIComponent(secretAt[1]!)
      try {
        if (req.method === "PUT") lib.secrets.set(id, SecretMeta(JSON.parse(await body(req))))
        else lib.secrets.del(id)
      } catch (e) {
        return bad(e)
      }
      return json(200, lib.secrets.list())
    }
    if (req.method === "GET" && req.url === "/providers") return json(200, lib.providers.list())
    const providerAt = /^\/providers\/([^/]+)(\/models|\/test)?$/.exec(req.url ?? "")
    if (providerAt) {
      const id = decodeURIComponent(providerAt[1]!)
      const known = lib.providers.list().some((p) => p.id === id)
      if (!providerAt[2] && (req.method === "PUT" || req.method === "DELETE")) {
        try {
          if (req.method === "PUT") lib.providers.put({ id, ...ProviderBody(JSON.parse(await body(req))) })
          else lib.providers.del(id)
        } catch (e) {
          return bad(e)
        }
        return json(200, lib.providers.list())
      }
      if (!known && providerAt[2]) return json(404, { error: `no provider ${id}` })
      if (providerAt[2] === "/models" && req.method === "GET") {
        try {
          return json(200, await lib.providers.models(id))
        } catch (e) {
          return bad(e, 502)
        }
      }
      if (providerAt[2] === "/test" && req.method === "POST") {
        let model: string | undefined
        try {
          model = TestBody(JSON.parse((await body(req)) || "{}")).model
        } catch (e) {
          return bad(e)
        }
        const r = await lib.providers.test(id, model)
        return r.error === undefined ? json(200, r.trace) : json(502, r)
      }
    }
    if (req.method === "GET" && req.url === "/routing") return json(200, lib.routing.read())
    if (req.method === "PUT" && req.url === "/routing") {
      try {
        lib.routing.write(RoutingBody(JSON.parse(await body(req))))
      } catch (e) {
        return bad(e)
      }
      return json(200, lib.routing.read())
    }
    if (req.method === "GET" && req.url === "/player") return json(200, lib.player)
    if (req.method === "PUT" && req.url === "/player") {
      try {
        lib.setPlayer(decodePlayer(JSON.parse(await body(req))))
      } catch (e) {
        return json(400, { error: e instanceof Error ? e.message : String(e) })
      }
      return json(200, lib.player)
    }
    // Everything below is one story's: the one the request names, or the most recently updated when it names none.
    const story = asked ?? lib.newest()
    let s
    try {
      s = lib.session(story)
    } catch (e) {
      return bad(e, 404)
    }
    if (req.method === "GET" && req.url === "/card")
      return json(200, {
        ...s.meta,
        greetings: s.greetings,
        fiction: s.fiction,
        rules: s.rules,
        products: s.products,
        snippets: s.snippets,
        format: s.format,
      })
    if (req.method === "GET" && req.url === "/nodes") return json(200, s.snapshot())
    const dropping = req.method === "DELETE" && /^\/nodes\/(\d+)$/.exec(req.url ?? "")
    if (dropping) {
      let c
      try {
        c = s.drop(Number(dropping[1]))
      } catch (e) {
        return json(404, { error: e instanceof Error ? e.message : String(e) })
      }
      return json(200, c) // the dropped nodes' calls went with them
    }
    if (req.method === "GET" && req.url === "/calls") return json(200, lib.calls(story).list())
    if (req.method !== "POST" || req.url !== "/") return json(404, { error: "not found" })
    let action
    try {
      action = decodeAction(JSON.parse(await body(req)))
    } catch (e) {
      return json(400, { error: e instanceof Error ? e.message : String(e) })
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    let closed = false
    let narrating = false
    const send = (name: string, v: unknown) => {
      if (!closed) res.write(`event: ${name}\ndata: ${JSON.stringify(v)}\n\n`)
    }
    const made: Call[] = [] // this action's calls, filed under its node once the node exists (an amend appends)
    const trace = lib.calls(story)
    const stop = Effect.runSync(Deferred.make<void>())
    const fiber = Effect.runFork(
      Stream.runForEach(perform(s, action, Deferred.await(stop)), (e) =>
        Effect.sync(() => {
          // Each draft starts over: a stop before its first character withdraws the turn, even on the correction rewrite.
          if (e.kind === "stage" && e.phase === "narrate") narrating = false
          if (e.kind === "delta" && e.part.type === "text-delta") narrating = true // reasoning is not prose: the client counts the same
          const v = shown(e)
          if (v.kind === "call") made.push(v)
          if (v.kind === "change" && v.node) trace.add(v.node.id, made.splice(0))
          send(e.kind, v)
        }),
      ).pipe(
        Effect.catchCause((c) => Effect.sync(() => send("error", { message: reason(c) }))),
        Effect.ensuring(Effect.sync(() => void (closed || res.end()))),
      ),
    )
    // `req` "close" means the request body was consumed (Node ≥ 16), not that the client went away; the response's does.
    res.on("close", () => {
      if (res.writableFinished) return
      closed = true
      if (narrating) Effect.runSync(Deferred.succeed(stop, undefined))
      else Effect.runFork(Fiber.interrupt(fiber))
    })
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
