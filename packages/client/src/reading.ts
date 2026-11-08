import { emptyDraft, type DraftModel } from "./composition.ts"
// A Reading (docs/shell-brief-2.md, #123): everything the client holds of one story. The slots are the atoms the
// components draw (the timeline, the card, the running prose, the typewriter's queue, the editor and the unified
// composition) and the turn's streams; this module is the one list of which of them are a story's. One Reading is
// in the slots, the rest are records: what the server does not hold of a story the player left (the half-typed line,
// its note, the armed invoke), by story id, bounded at the tab cap, the oldest dropped. Activate is the way in: it puts
// the story's record back, then always reads the story afresh (open, nodes, card, its turn in flight); activate(null)
// empties the slots and names no story (`stories.current` null: a card tab, an empty library); deactivate keeps
// the record, stops reading the streams (the turn runs on, on the server) and empties the slots. A record never holds
// the log: caching it would save one millisecond-scale local read and buy an invalidation problem (a turn running when
// the player left has moved on by the time they come back), so the timeline and card are read again. A
// deleted story leaves no record (`drop`: a library made before autoincrement hands a deleted id to the next story,
// whose composer must not get the dead one's line), and its id named again is read afresh. Activations run one at a
// time: a second waits for the first, so a slow read never lands in the next story's slots; the record goes back
// before any read, so a switch away mid-read records the line, not the emptied boxes.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { TimelineNode as Node } from "@effect-tavern/runtime/src/projection.ts"
import { composition, editing, type Id, log, registry, stories } from "./store.ts"
import { turn } from "./turn.ts"
import * as wire from "./wire.ts"
import type { Listing } from "./wire.ts"

export interface Deps {
  openStory: (id: Id) => Promise<Listing> // the blank PUT: the server checks the id and answers the listing on it
  fetchNodes: () => Promise<void>
  fetchCard: () => Promise<void>
  attach: () => void
  abandon: () => void
}
type Kept = DraftModel
const cap = 8 // the tab cap

export const createReading = (d: Deps) => {
  const records = new Map<Id, Kept>() // insertion order is age: a write moves the story to the newest end
  let active: Id | null | undefined // undefined: nothing in the slots (before the first activate, after a deactivate)
  let loaded = false // draft ownership begins before the reads; only a completed activation can be skipped
  /** The story out of the slots: what the server does not hold into its record, the streams closed, the slots empty. */
  const deactivate = (): void => {
    if (active != null) {
      records.delete(active)
      records.set(active, registry.get(composition))
      if (records.size > cap) records.delete(records.keys().next().value!)
    }
    active = undefined
    loaded = false
    d.abandon() // the streams, the draft and its queue, the revision, the error
    registry.set(composition, emptyDraft())
    registry.set(editing, null)
  }
  const run = async (id: Id | null): Promise<void> => {
    if (id === active && loaded) return
    deactivate()
    active = id
    if (id === null) {
      registry.set(log, L.of<Node>())
      const lib = registry.get(stories)
      if (lib) registry.set(stories, { ...lib, current: null }) // no story named: requests are the install's
      loaded = true
      return
    }
    const r = records.get(id) // before any read: the reads touch neither the boxes nor the invoke
    if (r) {
      registry.set(composition, r)
    }
    registry.set(stories, await d.openStory(id)) // `stories.current`: every request after names this story
    // A rejected read must not release the activation queue while its sibling can still write the slots.
    const reads = await Promise.allSettled([d.fetchNodes(), d.fetchCard()])
    for (const read of reads) if (read.status === "rejected") throw read.reason
    d.attach()
    loaded = true
  }
  let last: Promise<void> = Promise.resolve()
  /** A story into the slots, once any activate before it is done; the same one again does nothing. Null is no story
   *  (a tab on a card's page, an empty library): the slots empty, the log empty, and the listing names no story, so
   *  every request after is the install's. Which card the view shows is the caller's (tabs.ts, pages.ts). */
  const activate = (id: Id | null): Promise<void> => (last = last.catch(() => {}).then(() => run(id)))
  /** Deleted stories: their records gone; the active one among them leaves the slots unrecorded, so the next activate,
   *  of its id too, reads afresh. */
  const drop = (ids: readonly Id[]): void => {
    for (const id of ids) records.delete(id)
    if (active != null && ids.includes(active)) active = undefined
  }
  return { activate, deactivate, drop }
}
export type Reading = ReturnType<typeof createReading>

export const reading: Reading = createReading({
  openStory: wire.openStory,
  fetchNodes: wire.fetchNodes,
  fetchCard: wire.fetchCard,
  attach: () => turn.attach(), // read late: pages' test stubs the turn's own
  abandon: () => turn.abandon(),
})
