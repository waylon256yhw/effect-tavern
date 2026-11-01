// Delay real wire reads across page/tab entry points; stale completions must not claim another destination.
import assert from "node:assert/strict"
import { newStory, open, openStory, showCard, toHome } from "../src/pages.ts"
import { activeOf, card, log, page, registry, stories, tabs, type CardView, type StoryRow } from "../src/store.ts"
import { add, select } from "../src/tabs.ts"
import { turn } from "../src/turn.ts"
import { fetchCardOf } from "../src/wire.ts"

turn.attach = () => {}
turn.abandon = () => {}
const rows = [1, 2, 3].map((id) => ({ id, card: `c${id}`, busy: null }) as StoryRow)
const gates = new Map<string, { started: () => void; wait: Promise<void> }>()
const hold = (path: string) => {
  let started!: () => void
  let release!: () => void
  const seen = new Promise<void>((resolve) => {
    started = resolve
  })
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  gates.set(path, { started, wait })
  return { seen, release }
}
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const path = String(url)
  const story = Number(new Headers(init?.headers).get("x-tavern-story"))
  const gate = gates.get(path)
  if (gate) {
    gates.delete(path)
    gate.started()
    await gate.wait
  }
  if (path.startsWith("/api/cards/")) return Response.json({ id: path.split("/").at(-1) })
  if (path === "/api/card") return Response.json({ id: `c${story}` })
  if (path === "/api/nodes") return Response.json({ nodes: [{ id: story, parent: null, turn: {} }], head: story })
  if (path === "/api/stories" && init?.method === "POST") return Response.json({ current: 3, stories: rows })
  if (path === "/api/stories") return Response.json({ current: story || null, stories: rows })
  if (path.startsWith("/api/stories/")) return Response.json({ current: Number(path.split("/").at(-1)), stories: rows })
  return Response.json([])
}) as typeof fetch
const at = () => activeOf(registry.get(tabs))
registry.set(stories, { current: null, stories: rows })
await toHome()
registry.set(card, { id: "initial" } as CardView)

// Older reads, including same-tab refreshes, cannot overwrite a newer card read.
let gate = hold("/api/cards/old")
const old = fetchCardOf("old")
await gate.seen
await fetchCardOf("new")
gate.release()
await old
assert.equal(registry.get(card)?.id, "new")

// A card request already in flight is discarded when another card is picked.
gate = hold("/api/cards/a")
const a = showCard("a")
await gate.seen
const b = showCard("b")
gate.release()
await Promise.all([a, b])
assert.deepEqual([at().card, registry.get(card)?.id, registry.get(page)], ["b", "b", "card"])

// Loading a card cannot reopen it over the Writing page chosen while waiting.
gate = hold("/api/cards/slow")
const slow = showCard("slow")
await gate.seen
open("writing")
gate.release()
await slow
assert.equal(registry.get(page), "writing")

// Opening a story and switching tabs use the same queue; arrive must not overwrite the new home tab.
await openStory(1)
const first = at().id
gate = hold("/api/stories/2")
const story = openStory(2)
await gate.seen
const home = add()
gate.release()
await Promise.all([story, home])
assert.deepEqual([at().story, registry.get(stories)?.current, registry.get(log).nodes.size], [null, null, 0])
assert.equal(registry.get(tabs).list.find((t) => t.id === first)?.story, 1)

// Returning to the original tab does not revive its superseded story request (A → B → A).
await select(first)
gate = hold("/api/stories/2")
const otherStory = openStory(2)
await gate.seen
const away = add()
const back = select(first)
gate.release()
await Promise.all([otherStory, away, back])
assert.deepEqual([at().story, registry.get(stories)?.current, registry.get(card)?.id], [1, 1, "c1"])

// Browsing a card while a story opens preserves the tab's original story and restores its Reading.
gate = hold("/api/stories/2")
const opening = openStory(2)
await gate.seen
const browse = showCard("browse")
gate.release()
await Promise.all([opening, browse])
assert.deepEqual(
  [at().story, registry.get(stories)?.current, at().card, registry.get(card)?.id],
  [1, 1, "browse", "browse"],
)

// Begin's caller gets false if creation completed after leaving, so it cannot greet the newly active story.
gate = hold("/api/stories")
const creating = newStory("c3")
await gate.seen
const leaving = add()
gate.release()
assert.equal(await creating, false)
await leaving
assert.deepEqual([at().story, registry.get(stories)?.current], [null, null])
console.log("navigation ok")
