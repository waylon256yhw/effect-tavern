// The page over the reader (src/pages.ts) on a stubbed wire: close returns to the page under, the reader at the
// bottom; landing on a story decides card or reader, forgets what was under, closes the old story's stream, reads the
// story's card and picks up its turn in flight; no story at all lands on the first card's page; a delete that leaves
// the open story open moves nothing; one Escape rule.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { close, deleteStories, escaping, land, open, openStory } from "../src/pages.ts"
import { card, log, page, registry, stories } from "../src/store.ts"
import { turn } from "../src/turn.ts"

const node = (id: number, parent: number | null) =>
  ({ id, parent, turn: { id, parent, input: { text: "" }, reply: [], end: "end" } }) as any
let nodes: unknown[] = [] // what GET /nodes answers
const listing = (current: number | null) => ({ current, stories: [] })
const asked: string[] = [] // every path requested
;(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  const path = String(url)
  asked.push(path)
  const body =
    path === "/api/nodes"
      ? { nodes, head: nodes.length ? (nodes.at(-1) as { id: number }).id : null }
      : path === "/api/cards"
        ? [{ id: "first", title: "一" }]
        : path.startsWith("/api/cards/")
          ? { id: path.split("/").at(-1), greetings: [] }
          : path === "/api/stories" && init?.method === "DELETE"
            ? listing(1) // the open story stays the one to be on
            : path.startsWith("/api/stories/")
              ? listing(Number(path.split("/").at(-1)))
              : [] // the settings' lists
  return new Response(JSON.stringify(body))
}
let abandoned = 0
let attached = 0
turn.abandon = () => void abandoned++
turn.attach = () => void attached++ // landing picks up a turn in flight (turn.ts; GET /turn)
const at = () => registry.get(page)

// the stack: each page returns to the one it covered
open("card")
open("settings")
assert.equal(at(), "settings")
close()
assert.equal(at(), "card")
close()
assert.equal(at(), "reader")
close()
assert.equal(at(), "reader") // nothing under the reader
// the reader is under every page: opening it drops what covered it (Begin after browsing Settings from the card page)
open("card")
open("settings")
open("card")
open("reader")
assert.equal(at(), "reader")
close()
assert.equal(at(), "reader")

// Inspect from the Timeline returns to the Timeline; walking the Inspect page is no new return point
open("timeline")
open({ inspect: 1 })
open({ inspect: 2 })
assert.deepEqual(at(), { inspect: 2 })
close()
assert.equal(at(), "timeline")

// landing: an empty log lands on the card page with nothing under it, the old stream closed
open({ inspect: 1 })
await land(listing(1))
assert.deepEqual([at(), abandoned, registry.get(stories)?.current], ["card", 1, 1])
close()
assert.equal(at(), "reader")

// a story in progress lands in the reader
nodes = [node(0, null)]
open("writing")
await openStory(2)
assert.deepEqual([at(), abandoned, registry.get(stories)?.current, registry.get(log).nodes.size], ["reader", 2, 2, 1])
assert.deepEqual([attached, asked.includes("/api/card")], [2, true]) // the story's own card read, its turn picked up

// no story at all (an empty library): the first card's page over an empty log, no story route asked, nothing attached
asked.length = 0
await land(listing(null))
assert.deepEqual(
  [at(), registry.get(card)?.id, registry.get(log).nodes.size, attached, asked.includes("/api/nodes")],
  ["card", "first", 0, 2, false],
)
await openStory(2)

// a delete of another story: the open one stays, nothing lands; of the open one, the client lands on the next
registry.set(stories, listing(1))
registry.set(log, L.of({ nodes: [node(0, null), node(1, 0)], head: 1 }))
open("timeline")
await deleteStories([7])
assert.deepEqual([at(), abandoned, registry.get(log).nodes.size], ["timeline", 4, 2]) // two more landings above
await deleteStories([1])
assert.deepEqual([at(), abandoned, registry.get(log).nodes.size], ["reader", 5, 1])

// Escape: a field that prevents it keeps it; a popover, dialog or drawer takes it; a field is left first; else close
const target = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable }) as unknown as EventTarget
assert.equal(escaping({ defaultPrevented: true, target: target("DIV") }, false), null)
assert.equal(escaping({ defaultPrevented: false, target: target("INPUT") }, true), null)
assert.equal(escaping({ defaultPrevented: false, target: target("INPUT") }, false), "blur")
assert.equal(escaping({ defaultPrevented: false, target: target("TEXTAREA") }, false), "blur")
assert.equal(escaping({ defaultPrevented: false, target: target("DIV", true) }, false), "blur")
assert.equal(escaping({ defaultPrevented: false, target: target("BUTTON") }, false), "close")
assert.equal(escaping({ defaultPrevented: false, target: null }, false), "close")
console.log("pages ok")
