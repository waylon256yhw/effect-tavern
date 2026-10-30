// A Reading (docs/shell-brief-2.md, #123): everything the client holds of one story. The slots are the atoms the
// components draw (the log, the card, the calls, the draft and the typewriter's queue, the pin, the editor, the
// composer's boxes) and the turn's streams; this module is the one list of which of them are a story's. One Reading is
// in the slots, the rest are records: what the server does not hold of a story the player left (the half-typed line,
// its note, the armed pin), by story id, bounded at the tab cap, the oldest dropped. Activate is the way in: it puts
// the story's record back, then always reads the story afresh (open, nodes, card, its turn in flight); deactivate keeps
// the record, stops reading the streams (the turn runs on, on the server) and empties the slots. A record never holds
// the log: caching it would save one millisecond-scale local read and buy an invalidation problem (a turn running when
// the player left has moved on by the time they come back), so the log, the card and the calls are read again. A
// deleted story leaves no record (`drop`: a library made before autoincrement hands a deleted id to the next story,
// whose composer must not get the dead one's line), and its id named again is read afresh. Activations run one at a
// time: a second waits for the first, so a slow read never lands in the next story's slots; the record goes back
// before any read, so a switch away mid-read records the line, not the emptied boxes.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { boxes, calls, cards, editing, type Id, log, pin, registry, setBoxes, stories } from "./store.ts"
import { turn } from "./turn.ts"
import * as wire from "./wire.ts"
import type { Listing } from "./wire.ts"

export interface Deps {
  openStory: (id: Id) => Promise<Listing> // the blank PUT: the server checks the id and answers the listing on it
  fetchNodes: () => Promise<void>
  fetchCard: () => Promise<void>
  fetchCards: () => Promise<void>
  fetchCardOf: (id: string) => Promise<void>
  attach: () => void
  abandon: () => void
}
type Kept = { boxes: ReturnType<typeof boxes>; pin: string | null }
const cap = 8 // the tab cap

export const createReading = (d: Deps) => {
  const records = new Map<Id, Kept>() // insertion order is age: a write moves the story to the newest end
  let active: Id | null | undefined // undefined: nothing in the slots (before the first activate, after a deactivate)
  /** The story out of the slots: what the server does not hold into its record, the streams closed, the slots empty. */
  const deactivate = (): void => {
    if (active != null) {
      records.delete(active)
      records.set(active, { boxes: boxes(), pin: registry.get(pin) })
      if (records.size > cap) records.delete(records.keys().next().value!)
    }
    active = undefined
    d.abandon() // the streams, the draft and its queue, the revision, the error
    setBoxes({ text: "", note: "", aside: false })
    registry.set(pin, null)
    registry.set(editing, null)
    registry.set(calls, new Map())
  }
  const run = async (id: Id | null): Promise<void> => {
    if (id === active) return
    deactivate()
    active = id
    if (id === null) {
      registry.set(log, L.of<Node>())
      if (!registry.get(cards).length) await d.fetchCards()
      const first = registry.get(cards)[0]
      if (first) await d.fetchCardOf(first.id)
      return
    }
    const r = records.get(id) // before any read: the reads touch neither the boxes nor the pin
    if (r) {
      setBoxes(r.boxes)
      registry.set(pin, r.pin)
    }
    registry.set(stories, await d.openStory(id)) // `stories.current`: every request after names this story
    await Promise.all([d.fetchNodes(), d.fetchCard()])
    d.attach()
  }
  let last: Promise<void> = Promise.resolve()
  /** A story into the slots, once any activate before it is done; the same one again does nothing. Null is no story
   *  at all (an empty library): the first card's page over an empty log. */
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
  fetchCards: wire.fetchCards,
  fetchCardOf: wire.fetchCardOf,
  attach: () => turn.attach(), // read late: pages' test stubs the turn's own
  abandon: () => turn.abandon(),
})
