// The page over the reader (src/pages.ts) on a stubbed wire: close returns to the page under, the reader at the
// bottom; landing on a story decides card or reader, forgets what was under, closes the old story's stream, reads the
// story's card and picks up its turn in flight; no story at all lands on the first card's page; a delete of another
// story moves nothing, of the open one leaves its tab on the card's page with nothing in the slots; one Escape rule.
import assert from "node:assert/strict"
import { backOf, close, deleteStory, escaping, land, open, openStory } from "../src/pages.ts"
import { activeOf, card, focus, layer, log, page, registry, stories, type StoryRow, tabs } from "../src/store.ts"
import { turn } from "../src/turn.ts"

const node = (id: number, parent: number | null) =>
  ({ id, parent, turn: { id, parent, input: { text: "" }, reply: [], end: "end" } }) as any
let nodes: unknown[] = [] // what GET /nodes answers
const rows = [1, 2, 3, 7].map((id) => ({ id, card: "first", busy: null, title: null }) as unknown as StoryRow)
const listing = (current: number | null) => ({ current, stories: current === null ? [] : rows })
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
          : path.startsWith("/api/stories/") && init?.method === "DELETE"
            ? listing(2) // the server's pick: never followed
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

// on a story in progress, the stack: each page returns to the one it covered
nodes = [node(0, null)]
await openStory(1)
open("workshop")
assert.equal(at(), "workshop")
close()
assert.equal(at(), "reader")
open("card")
open("writing")
assert.equal(at(), "writing")
close()
assert.equal(at(), "card")
assert.equal(backOf(activeOf(registry.get(tabs))), "story")
close()
assert.equal(at(), "reader")
close()
assert.equal(at(), "reader") // nothing under the reader
// the reader is under every page: opening it drops what covered it (Begin after browsing Writing from the card page)
open("card")
open("writing")
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
nodes = []
open({ inspect: 1 })
await land(listing(3))
assert.deepEqual([at(), abandoned, registry.get(stories)?.current], ["card", 2, 3])
close()
assert.equal(at(), "reader")

// a story in progress lands in the reader
nodes = [node(0, null)]
open("writing")
await openStory(2)
assert.deepEqual([at(), abandoned, registry.get(stories)?.current, registry.get(log).nodes.size], ["reader", 3, 2, 1])
assert.deepEqual([attached, asked.includes("/api/card")], [3, true]) // the story's own card read, its turn picked up

// no story at all (an empty library): the first card's page over home, no story route asked, nothing attached
asked.length = 0
await land(listing(null))
assert.deepEqual(
  [
    at(),
    backOf(activeOf(registry.get(tabs))),
    registry.get(card)?.id,
    registry.get(log).nodes.size,
    attached,
    asked.includes("/api/nodes"),
  ],
  ["card", "home", "first", 0, 3, false],
)
await openStory(2)

// a delete of another story: nothing moves, whatever the server picks; of the open one, its tab stays on the card's
// page over home with the slots empty, and its id named again (a library made before autoincrement hands a deleted id
// on) is read afresh
await openStory(1)
open("timeline")
await deleteStory(7)
assert.deepEqual([at(), abandoned, registry.get(log).nodes.size, registry.get(stories)?.current], ["timeline", 6, 1, 1])
await deleteStory(1)
assert.deepEqual(
  [at(), backOf(activeOf(registry.get(tabs))), abandoned, registry.get(log).nodes.size, registry.get(stories)?.current],
  ["card", "home", 7, 0, null],
)
close()
assert.deepEqual([at(), registry.get(focus), registry.get(layer)], ["home", null, "shelf"])
nodes = [node(0, null), node(1, 0)]
await openStory(1)
assert.deepEqual([at(), abandoned, registry.get(log).nodes.size], ["reader", 8, 2])

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
