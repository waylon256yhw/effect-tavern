// The page over the reader (review/architecture-review-2026-10-30.html card 8): the one owner of `page`. Open pushes
// the page it covers, so close returns there (settings from the card page back to the card page, Inspect from the
// Timeline back to the Timeline), the reader when nothing is under it; each page's load list runs on open. Landing on a
// story (first load, a story opened, made or deleted) decides card or reader once: an empty log lands on the card
// page, and no story at all lands on the first card's page. The sidebar's shelf and workspace (#117) go through here
// too: `browse` is a card picked on the shelf, `showCard` a card's page by id (no story of it yet), `toReader` the way
// back from any page, which also puts the open story's card back in the view. Landing reads the story's card (stories of every card
// share one listing) and picks up a turn in flight there. One Escape rule for every page, mounted once by the App. The
// reader stays mounted under all of it, so a turn in flight keeps streaming; another story only stops reading it.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { layerOf } from "./fold.ts"
import { latestOf, stays } from "./stories.ts"
import { calls, card, cards, editing, focus, layer, log, page, type Page, pin, registry, stories } from "./store.ts"
import { turn } from "./turn.ts"
import * as wire from "./wire.ts"
import type { Listing } from "./wire.ts"

type Kind = Exclude<Page, object> | "inspect"
const kindOf = (p: Page): Kind => (typeof p === "object" ? "inspect" : p)
/** What each page reads when it opens; a page not named reads nothing of its own. */
const loads: Partial<Record<Kind, () => unknown>> = {
  inspect: wire.fetchCalls,
  settings: () =>
    Promise.all([
      wire.fetchProviders(),
      wire.fetchSecrets(),
      wire.fetchRouting(),
      wire.fetchHats(),
      wire.fetchCards(),
      wire.fetchNames(),
    ]),
}
let under: Page[] = [] // the pages the current one covers, the reader at the bottom implied

/** A page over the current one. The same page again (the Inspect page walking to another node) replaces it: no
 *  return point, no reload. The reader is under every page, never over one: opening it drops whatever covered it
 *  (Begin on an empty story the player had browsed Settings or Writing from). */
export const open = (p: Page): void => {
  const at = registry.get(page)
  if (p === "reader") {
    under = []
    return registry.set(page, p)
  }
  if (kindOf(at) === kindOf(p)) return registry.set(page, p)
  if (at !== "reader") under.push(at)
  registry.set(page, p)
  void loads[kindOf(p)]?.()
}
/** Back to the page this one covered, the reader when none. */
export const close = (): void => registry.set(page, under.pop() ?? "reader")
/** The open story's row, when the listing names one. */
const current = () => {
  const lib = registry.get(stories)
  return lib?.stories.find((s) => s.id === lib.current)
}
/** On the story as if just opened: an empty log lands on the card page (pick an opening, or begin), a story in
 *  progress in the reader; nothing to go back to. The sidebar is on the story's card (its workspace), on the shelf
 *  when there is no story at all. */
const arrive = () => {
  under = []
  registry.set(page, registry.get(log).nodes.size ? "reader" : "card")
  const cur = current()
  registry.set(focus, cur?.card ?? registry.get(card)?.id ?? null)
  registry.set(layer, layerOf(cur?.id))
}
/** Back to the reader from any page: what covered it is dropped, and the card view is the open story's again (a card
 *  browsed from the shelf had replaced it), as is the sidebar's workspace. */
export const toReader = (): void => {
  open("reader")
  const cur = current()
  if (!cur) return
  registry.set(focus, cur.card)
  if (registry.get(card)?.id !== cur.card) void wire.fetchCard()
}
/** A card's page, by id: the open story's card as the view holds it, another read by id (no story of it needed). The
 *  sidebar's workspace follows. Where "新建故事" and a card's head go: no story is made until Begin (#116). */
export const showCard = async (id: string): Promise<void> => {
  registry.set(focus, id)
  if (registry.get(card)?.id !== id) await wire.fetchCardOf(id)
  open("card")
}
/** A card picked on the shelf: its workspace, and the stage on its latest story (the open one when it is this card's,
 *  else the newest), or on its page when it has none. */
export const browse = async (id: string): Promise<void> => {
  registry.set(layer, "workspace")
  const lib = registry.get(stories)
  const mine = lib?.stories.filter((s) => s.card === id) ?? []
  if (!mine.length) return showCard(id)
  if (mine.some((s) => s.id === lib?.current)) return toReader()
  await openStory(latestOf(mine)!.id)
}

/** First load: the listing first (it names the story every request after is on), then the card, the nodes and the
 *  player's layer; the routing is the card page's Model row. With no story at all, the first card's page: a story
 *  begins there. A turn already in flight on the story is picked up (turn.ts `attach`). */
export const boot = async (): Promise<void> => {
  await wire.fetchStories()
  await Promise.all([on(), wire.fetchCards(), wire.fetchPersonas(), wire.fetchPlayer(), wire.fetchRouting()])
  arrive()
}
/** The story the listing names, read: its card, its nodes, its turn in flight; with none, the first card's page over
 *  an empty log. */
const on = async (): Promise<void> => {
  if (registry.get(stories)?.current == null) {
    registry.set(log, L.of<Node>())
    if (!registry.get(cards).length) await wire.fetchCards()
    const first = registry.get(cards)[0]
    if (first) await wire.fetchCardOf(first.id)
    return
  }
  await Promise.all([wire.fetchCard(), wire.fetchNodes()])
  turn.attach()
}

/** A story call answered: the client is on the story the listing names, as just opened. The old story's streams are
 *  closed (its events must not land on this log; its turn runs on, on the server), its draft, pin, editor and calls
 *  gone; a turn in flight on the new one is picked up. */
export const land = async (listing: Listing): Promise<void> => {
  registry.set(stories, listing)
  turn.abandon()
  registry.set(pin, null)
  registry.set(editing, null)
  registry.set(calls, new Map())
  await on()
  arrive()
}
/** A delete answered: when the open story was not among the deleted and is still the one to be on, only the listing
 *  moves (the reader keeps its draft and its place); otherwise the client lands on the story the listing names
 *  (stories.ts `stays`: the id alone cannot tell a placeholder from the story it replaced). */
export const onDelete = async (listing: Listing, deleted: readonly number[]): Promise<void> => {
  if (stays(registry.get(stories)?.current, deleted, listing.current)) registry.set(stories, listing)
  else await land(listing)
}
export const openStory = async (id: number): Promise<void> => land(await wire.openStory(id))
export const newStory = async (card: string): Promise<void> => land(await wire.newStory(card))
export const deleteStory = async (id: number): Promise<void> => onDelete(await wire.deleteStory(id), [id])
export const deleteStories = async (ids: readonly number[]): Promise<void> =>
  onDelete(await wire.deleteStories(ids), ids)

/** What an Escape does over a page, in order: a field that wants it prevented it; an open popover, dialog or drawer
 *  takes its own; in a field it leaves the field (the first Escape, the browser's clear of a search box aside); else
 *  the page closes. */
export const escaping = (
  e: { defaultPrevented: boolean; target: EventTarget | null },
  covered: boolean,
): "close" | "blur" | null => {
  if (e.defaultPrevented || covered) return null
  const el = e.target as HTMLElement | null
  if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return "blur"
  return "close"
}
/** The App's one keydown listener: Escape over any page but the reader. */
export const onKey = (e: KeyboardEvent): void => {
  if (e.key !== "Escape" || registry.get(page) === "reader") return
  const covered = !!document.querySelector(":popover-open, dialog[open], .side-drawer[data-open='true']")
  const what = escaping(e, covered)
  if (what === "blur") (e.target as HTMLElement).blur()
  else if (what === "close") close()
}
