// The wire adapter at the session's seam: one process, one session, no logic of its own.
//   POST /        an Action (src/session.ts `Action`, decoded at this boundary) → the events it causes, as SSE, one
//                 `event:` per kind; a failure is an `error` event. Closing the response is the stop: before the first
//                 character of a draft it interrupts the action (nothing is saved, the model request aborts); once a
//                 delta was sent it halts the prose where it is and the turn finishes into a `stopped` node.
//   GET  /nodes   the snapshot: every node's projection and head, for a client that just opened.
//   GET  /player  the player layer in force; PUT /player replaces it whole (decoded as `Player` at this boundary,
//                 written to the library, in force from the next request; a bad body is a 400).
//   GET  /stories this card's stories (id, turns, the last line, updated), newest first, and which one is open.
//                 POST /stories opens a new one,
//                 PUT /stories/<id> opens that one (404 when there is none), DELETE /stories/<id> removes it (the open
//                 one gone, the newest remaining opens, or a new one). Each answers the listing; the client re-reads
//                 /nodes, and the trace starts over.
//   GET  /personas  the player's personas; PUT /personas/<id> {name, text} writes one (in force from the next request
//                 where it is picked), DELETE /personas/<id> removes it and its picks (the client re-reads /player).
//                 Both answer the list. Which persona is in force on a card is the player's (`Player.persona`).
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
import { decodePlayer } from "@effect-tavern/runtime/src/fragment.ts"
import { decodeAction, perform, type Event } from "@effect-tavern/runtime/src/session.ts"
import { Cause, Deferred, Effect, Fiber, Schema, Stream } from "effect"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Library } from "./library.ts"

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

export const handle = (lib: Library, { inspect = false } = {}) => {
  const shown = (e: Event) => (inspect || e.kind !== "call" ? e : { ...e, msgs: [] })
  return async (req: IncomingMessage, res: ServerResponse) => {
    const s = lib.session // the open story's
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(v))
    }
    const bad = (e: unknown, status = 400) => json(status, { error: e instanceof Error ? e.message : String(e) })
    const stories = () => json(200, { current: lib.story, stories: lib.stories.list() })
    if (req.method === "GET" && req.url === "/stories") return stories()
    if (req.method === "POST" && req.url === "/stories") {
      lib.stories.create()
      return stories()
    }
    const storyAt = /^\/stories\/(\d+)$/.exec(req.url ?? "")
    if (storyAt && (req.method === "PUT" || req.method === "DELETE")) {
      try {
        if (req.method === "PUT") lib.stories.open(Number(storyAt[1]))
        else lib.stories.del(Number(storyAt[1]))
      } catch (e) {
        return bad(e, 404)
      }
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
    if (req.method === "GET" && req.url === "/player") return json(200, s.player)
    if (req.method === "PUT" && req.url === "/player") {
      try {
        s.setPlayer(decodePlayer(JSON.parse(await body(req))))
      } catch (e) {
        return json(400, { error: e instanceof Error ? e.message : String(e) })
      }
      return json(200, s.player)
    }
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
    if (req.method === "GET" && req.url === "/calls") return json(200, lib.calls.list())
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
    const trace = lib.calls // the story the action runs in, whatever opens meanwhile
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
