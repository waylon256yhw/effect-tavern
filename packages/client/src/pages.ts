// The page over the reader (review/architecture-review-2026-10-30.html card 8): the one owner of what a page is, over
// the active tab's page stack (tabs.ts holds the list; a tab switch swaps the stack, #123). Open pushes
// the page it covers, so close returns there (Settings or Writing from the card page back to the card page, Inspect
// from the Timeline back to the Timeline), the reader when nothing is under it; each page's load list runs on open. A
// fresh start lands on home (a home tab: no story, no card; a card entered from it is pushed over home, and Back there
// lets the card go; a story opened from it takes the tab over); a reload comes back on the tab it left. Landing on a
// story (a story opened, made or deleted) decides card or reader once: an empty log lands on the card
// page, and no story at all lands on the first card's page over home. The sidebar's shelf and workspace (#117) go through here
// too: `browse` is a card picked on the shelf, `showCard` a card's page by id (no story of it yet), `toReader` the way
// back from any page, which also puts the open story's card back in the view. Landing reads the story's card (stories of every card
// share one listing) and picks up a turn in flight there. One Escape rule for every page, mounted once by the App. The
// reader stays mounted under all of it, so a turn in flight keeps streaming; another story only stops reading it.
import { layerOf } from "./fold.ts"
import { latestOf } from "./stories.ts"
import { reading } from "./reading.ts"
import {
  activeOf,
  card,
  cards,
  isHome,
  layer,
  log,
  page,
  type Page,
  registry,
  stories,
  type Tab,
  tabs,
} from "./store.ts"
import { edit, forget, home, load, remembered, select } from "./tabs.ts"
import * as wire from "./wire.ts"
import type { Listing } from "./wire.ts"

type Kind = Exclude<Page, object> | "inspect"
const kindOf = (p: Page): Kind => (typeof p === "object" ? "inspect" : p)
/** What each page reads when it opens; a page not named reads nothing of its own. */
const loads: Partial<Record<Kind, () => unknown>> = {
  inspect: wire.fetchCalls,
  settings: wire.fetchSettings,
}
const tab = () => activeOf(registry.get(tabs)) // the page stack is the active tab's (tabs.ts)

/** A page over the current one. The same page again (the Inspect page walking to another node, or the settings moved
 *  to another section) replaces it: no return point, no reload. The reader is under every page, never over one:
 *  opening it drops whatever covered it (Begin on an empty story the player had browsed Settings or Writing from). */
export const open = (p: Page): void => {
  if (p === "reader") return toReader()
  const { page: at, under } = tab()
  if (kindOf(at) === kindOf(p)) return edit({ page: p })
  edit({ page: p, under: at === "reader" ? under : [...under, at] })
  void loads[kindOf(p)]?.()
}
/** Back to the page this one covered, the reader when none. Back onto home is the tab a home tab again: the card it
 *  was on is let go, and the sidebar is back on the shelf. */
export const close = (): void => {
  const { under } = tab()
  if (!under.length) return toReader()
  const to = under.at(-1)!
  edit({ page: to, under: under.slice(0, -1), ...(to === "home" ? { card: null } : {}) })
  if (to === "home") registry.set(layer, "shelf")
}
/** Where a page's Back goes from this tab: the story (or a page over it), home, or nowhere (the bottom of the stack:
 *  the key is not drawn). */
export const backOf = (t: Tab): "story" | "home" | null =>
  t.under.at(-1) === "home" ? "home" : t.under.length || t.story !== null ? "story" : null
/** The open story's row, when the listing names one. */
const current = () => {
  const lib = registry.get(stories)
  return lib?.stories.find((s) => s.id === lib.current)
}
/** On the story as if just opened, in the active tab: an empty log lands on the card page (pick an opening, or
 *  begin), a story in progress in the reader; nothing to go back to. The sidebar is on the story's card (its
 *  workspace). No story at all (an empty library) is the first card's page over home, the sidebar on the shelf. */
const arrive = async (): Promise<void> => {
  const cur = current()
  if (!cur && !registry.get(cards).length) await wire.fetchCards()
  const id = cur?.card ?? registry.get(cards)[0]?.id ?? null
  const at = cur && registry.get(log).nodes.size ? "reader" : "card"
  edit({ story: cur?.id ?? null, card: id, page: at, under: cur ? [] : ["home"] })
  registry.set(layer, layerOf(cur?.id))
  if (!cur && id !== null && registry.get(card)?.id !== id) await wire.fetchCardOf(id)
}
/** Back to the reader from any page: what covered it is dropped, and the card view is the tab's story's again (a card
 *  browsed from the shelf had replaced it), as is the sidebar's workspace. A tab with no story has no reader: a home
 *  tab goes back to home; on a card tab (home under its card page) and the settings tab this does nothing. */
export const toReader = (): void => {
  const t = tab()
  if (isHome(t)) return edit({ page: "home", under: [] })
  const cur = current() // the tab's story: a tab with one has it in the slots
  if (t.story === null || !cur) return
  edit({ page: "reader", under: [], card: cur.card })
  if (registry.get(card)?.id !== cur.card) void wire.fetchCard()
}
/** A card's page, by id: the open story's card as the view holds it, another read by id (no story of it needed). The
 *  tab keeps its story (Escape takes it back); the sidebar's workspace follows the card. Where "新建故事" and a card's
 *  head go: no story is made until Begin (#116). From a home tab the card page is pushed over home: its Back returns
 *  there, and the tab is a home tab again. */
export const showCard = async (id: string): Promise<void> => {
  if (tab().card !== id) edit({ card: id })
  if (registry.get(card)?.id !== id) await wire.fetchCardOf(id)
  open("card")
}
/** A tab clicked: another one is switched to; the active one again is nothing (each page has its own Back). */
export const pick = (id: number): void => {
  if (id !== tab().id) void select(id)
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

/** This load is the browser's reload of the page (⌘R, Vite's full reload), not a fresh open of it (a new window or
 *  tab, the address typed): the navigation entry says which. */
const reloaded = (): boolean => {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
    return nav?.type === "reload"
  } catch {
    return false // no Performance API (tests): a fresh start
  }
}
/** First load: the listing first (it names the story every request after is on), then the player's layer; the
 *  routing is the card page's Model row. A reload comes back where it was: the remembered tabs, on the one that was
 *  active, its story read and a turn in flight on it picked up (turn.ts `attach`). A fresh start lands on home: the
 *  remembered tabs stay on the strip, a home tab is active, no story is in the slots and the sidebar is on the shelf
 *  (tabs.ts `home`). */
export const boot = async (): Promise<void> => {
  await Promise.all([wire.fetchStories(), wire.fetchCards()])
  const kept = remembered() // the tabs the device holds, on stories and cards still there (tabs.ts)
  const resumed = kept && reloaded() ? kept : null
  await Promise.all([
    reading.activate(resumed ? activeOf(resumed).story : null),
    wire.fetchPersonas(),
    wire.fetchPlayer(),
    wire.fetchRouting(),
  ])
  await (resumed ? load(resumed) : home(kept))
}
/** A story made: the client is on the story the listing names, as just opened (reading.ts: the old story out of the
 *  slots, this one in). */
export const land = async (listing: Listing): Promise<void> => {
  registry.set(stories, listing)
  await reading.activate(listing.current)
  await arrive()
}
/** A delete answered: nothing lands. A tab on a deleted story stays, on its card's page with no story (home under
 *  it); when that is the active tab, the slots empty under it. Every other tab, the active one included, stays where
 *  it is. */
export const onDelete = async (listing: Listing, deleted: readonly number[]): Promise<void> => {
  const was = tab().story
  reading.drop(deleted) // no record of a dead story; its id named again is read afresh
  forget(deleted)
  registry.set(stories, { ...listing, current: tab().story }) // the server's pick is not the tab's
  if (was !== null && deleted.includes(was)) await reading.activate(null)
}
export const openStory = async (id: number): Promise<void> => {
  await reading.activate(id) // its own PUT answers the listing
  await arrive()
}
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
/** The App's one keydown listener: Escape over any page but the bottoms of a stack (the reader, home). */
export const onKey = (e: KeyboardEvent): void => {
  const at = registry.get(page)
  if (e.key !== "Escape" || at === "reader" || at === "home") return
  const covered = !!document.querySelector(":popover-open, dialog[open], .side-drawer[data-open='true']")
  const what = escaping(e, covered)
  if (what === "blur") (e.target as HTMLElement).blur()
  else if (what === "close") close()
}
