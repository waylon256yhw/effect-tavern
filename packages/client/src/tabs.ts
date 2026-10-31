// The tabs on the top strip (docs/shell-brief-2.md, #123), Cherry Studio's model: views many, data one. A tab is an
// address (store.ts `Tab`: a story or none, its card, its page stack, the reader's scroll); every tab reads the one
// Reading in the slots (reading.ts), so a switch swaps the page stack and the scroll and then activates the tab's
// story (the same story again is nothing). A tab with no story is a card's page (home under it), home, or the
// settings (one tab at most, opened by every way into them), and nothing else: under it the slots
// are empty and the listing names no story, so nothing typed or begun there lands in another tab's story. Two tabs on
// one story are two windows on it, never refused. This module is the one writer of the list; pages.ts says what a page is and writes the active
// tab's page and story through `edit`. "+" is always a home tab. Bounded at eight: a "+" on a full strip drops the
// oldest tab but the active one; × on the last tab leaves a home tab. The device remembers the list and which one is
// active, never the page stacks: a tab comes back on its
// story's reader, on its card's page, on home (a home tab: no story, no card), or on the settings. A reload comes back
// on the tab that was active; a fresh start keeps the list on the strip and lands on a home tab (`home`, pages.ts
// `boot`). A story
// whose turn lands while no active tab is on it is unread until a tab of it is activated (in memory, from the
// listing's `busy`: nothing new on the server).
import { untrack } from "solid-js"
import { registry } from "./atom.ts"
import * as Atom from "./atom.ts"
import { reading } from "./reading.ts"
import {
  activeOf,
  card,
  cards,
  type Id,
  isHome,
  isSettings,
  layer,
  log,
  stories,
  type Tab,
  tabs,
  type Tabs,
} from "./store.ts"
import * as wire from "./wire.ts"

export const CAP = 8
const KEY = "tabs"
let next = 1 // the store's first tab is 0
const now = () => registry.get(tabs)
/** The reader's scroll, as the reader (App.tsx) hands it: read when a tab is left, put back once the story has
 *  rendered on the way in. Nothing without a reader (tests, before it mounts). */
export const scroll = { get: (): number | undefined => undefined, set: (_top: number): void => {} }

/** The active tab, changed in place: its page stack, its story and card (pages.ts). */
export const edit = (patch: Partial<Omit<Tab, "id">>): void => {
  const s = now()
  registry.set(tabs, { ...s, list: s.list.map((t) => (t.id === s.active ? { ...t, ...patch } : t)) })
  if (patch.story !== undefined) seen(patch.story)
}

/** On the tab now active, once the switch before it is done: its story in the slots and its card in the view; a story
 *  tab back on an empty log is on its card page (a restored tab), and the scroll it was left at comes back. The
 *  sidebar is on the tab's card's workspace, on the shelf for a tab on no card (home, the settings). The settings tab
 *  reads its lists each time it is shown, a reload onto it included. */
const show = async (id: number): Promise<void> => {
  const t = now().list.find((x) => x.id === id)
  if (!t) return
  seen(t.story)
  registry.set(layer, t.card === null ? "shelf" : "workspace")
  if (isSettings(t)) void wire.fetchSettings()
  await reading.activate(t.story) // none: the slots empty, no story named
  if (t.card !== null && registry.get(card)?.id !== t.card) {
    const own = registry.get(stories)?.stories.find((s) => s.id === t.story)?.card === t.card
    await (own ? wire.fetchCard() : wire.fetchCardOf(t.card)) // the story's card, or one browsed on this tab
  }
  if (now().active !== id) return
  if (t.page === "reader" && t.story !== null && !registry.get(log).nodes.size) edit({ page: "card" })
  if (t.scroll !== undefined) scroll.set(t.scroll)
}
let last: Promise<void> = Promise.resolve()
/** `list` with `id` active: the tab left (when it is still on the strip) keeps its scroll; then the way in. */
const go = (list: readonly Tab[], id: number): Promise<void> => {
  const s = now()
  const top = scroll.get()
  registry.set(tabs, { list: list.map((t) => (t.id === s.active ? { ...t, scroll: top } : t)), active: id })
  return (last = last.catch(() => {}).then(() => show(id)))
}
/** Another tab: its page stack, its scroll, its story. The active one again does nothing here (pages.ts `pick`). */
export const select = (id: number): Promise<void> => {
  const s = now()
  return id === s.active || !s.list.some((t) => t.id === id) ? last : go(s.list, id)
}
const homeTab = (): Tab => ({ id: next++, story: null, card: null, page: "home", under: [] })
/** A new tab at the end, made active; on a full strip the oldest tab but the active one goes. */
const append = (fresh: Tab): Promise<void> => {
  const s = now()
  let list = s.list
  if (list.length >= CAP) {
    const old = list.find((t) => t.id !== s.active)!
    list = list.filter((t) => t !== old)
  }
  return go([...list, fresh], fresh.id)
}
/** "+": a home tab, whatever the active tab or the sidebar is on; never a copy of the one before it. */
export const add = (): Promise<void> => append(homeTab())
/** The settings tab: the one on the strip, or a new one opened from the active tab (its × hands back there). */
export const settingsTab = (): Promise<void> => {
  const there = now().list.find((t) => isSettings(t))
  if (there) return select(there.id)
  return append({ id: next++, story: null, card: null, page: "settings", under: [], from: now().active })
}
/** ×: the tab gone; the active one hands over to the tab it was opened from when that is still there, else to its
 *  neighbour, the right one first. The last tab gives way to a home tab (nothing, when it is one on its home). */
export const remove = (id: number): Promise<void> => {
  const s = now()
  const i = s.list.findIndex((t) => t.id === id)
  if (i < 0) return last
  if (s.list.length === 1) {
    const only = s.list[0]!
    if (isHome(only) && only.page === "home") return last
    const fresh = homeTab()
    registry.set(tabs, { list: [fresh], active: fresh.id })
    return (last = last.catch(() => {}).then(() => show(fresh.id)))
  }
  const list = s.list.filter((t) => t.id !== id)
  if (id !== s.active) {
    registry.set(tabs, { ...s, list })
    return last
  }
  const back = list.find((t) => t.id === s.list[i]!.from)
  // the closed tab's scroll goes with it
  registry.set(tabs, { list, active: (back ?? s.list[i + 1] ?? s.list[i - 1])!.id })
  return (last = last.catch(() => {}).then(() => show(now().active)))
}
/** Deleted stories: a tab on one stays, on its card's page with no story and home under it. */
export const forget = (ids: readonly Id[]): void => {
  const s = now()
  registry.set(tabs, {
    ...s,
    list: s.list.map((t): Tab =>
      t.story !== null && ids.includes(t.story)
        ? { id: t.id, story: null, card: t.card, page: "card", under: ["home"] }
        : t,
    ),
  })
}

/** The list as the device hands it back: a story the listing does not name, or a story-less tab on a card the shelf
 *  does not have, is dropped; eight at most; the active one by index, the first when it was dropped. No page stack:
 *  a story tab is on its reader (`show` turns an empty one to its card page), a card tab on its card page with home
 *  under it, a home tab (neither) on home, the settings tab (one at most) on the settings. */
export const restore = (
  raw: unknown,
  lib: { stories: readonly { id: Id; card: string }[] } | null,
  shelf: readonly { id: string }[],
): Tabs | null => {
  let v: { tabs?: unknown; active?: unknown }
  try {
    v = JSON.parse(String(raw))
  } catch {
    return null
  }
  if (!v || !Array.isArray(v.tabs)) return null
  const list: Tab[] = []
  let active: number | undefined
  v.tabs.slice(0, CAP).forEach((x: { story?: unknown; card?: unknown; settings?: unknown } | null, i: number) => {
    const row = typeof x?.story === "number" ? lib?.stories.find((s) => s.id === x.story) : undefined
    const id = next++
    if (row) list.push({ id, story: row.id, card: row.card, page: "reader", under: [] })
    else if (x?.settings === true) {
      if (list.some((t) => isSettings(t))) return
      list.push({ id, story: null, card: null, page: "settings", under: [] })
    } else if (x?.story === null && x.card === null) list.push({ ...homeTab(), id })
    else if (x?.story === null && shelf.some((c) => c.id === x.card))
      list.push({ id, story: null, card: x.card as string, page: "card", under: ["home"] })
    else return
    if (i === v.active) active = id
  })
  return list.length ? { list, active: active ?? list[0]!.id } : null
}
/** The remembered list, when there is one the device still holds and the library still names. */
export const remembered = (): Tabs | null => {
  try {
    return restore(localStorage.getItem(KEY), registry.get(stories), registry.get(cards))
  } catch {
    return null // no storage: one tab, as boot lands
  }
}
/** A list restored at boot: in place, and on its active tab (boot activates its story first). */
export const load = (s: Tabs): Promise<void> => {
  registry.set(tabs, s)
  return (last = show(s.active))
}
/** A fresh start: the remembered tabs (if any) stay on the strip, and a home tab is active: the one among them, else
 *  a new one at the end (on a full strip the oldest goes). Nothing is read for the tabs left behind until one of them
 *  is picked; boot has emptied the slots. */
export const home = (kept: Tabs | null): Promise<void> => {
  let list = kept?.list ?? []
  let at = list.find((t) => isHome(t))
  if (!at) {
    at = homeTab()
    list = [...list.slice(Math.max(0, list.length - CAP + 1)), at]
  }
  return load({ list, active: at.id })
}
registry.subscribe(tabs, (s) => {
  try {
    const list = s.list.map((t) => (isSettings(t) ? { settings: true } : { story: t.story, card: t.card }))
    localStorage.setItem(KEY, JSON.stringify({ tabs: list, active: s.list.findIndex((t) => t.id === s.active) }))
  } catch {
    // a browser without storage keeps the tabs for the page's life
  }
})

// The unread marks: a story whose `busy` went from a phase to none in the listing while the active tab was not on it.
// Written by the listing's subscriber against the listing before it; the active tab's story is never marked, and a
// tab of a marked story made active (`show`, or the story entered in the active tab through `edit`) clears it.
export const unread = Atom.make<ReadonlySet<Id>>(new Set<Id>()).pipe(Atom.keepAlive)
const seen = (story: Id | null): void => {
  const m = registry.get(unread)
  if (story === null || !m.has(story)) return
  const next = new Set(m)
  next.delete(story)
  registry.set(unread, next)
}
let running = new Set<Id>()
registry.subscribe(stories, (lib) => {
  const now = new Set(lib?.stories.flatMap((s) => (s.busy === null ? [] : [s.id])))
  const on = activeOf(untrack(tabs)).story // read in place: a registry get would flush inside this effect's flush
  const done = [...running].filter((id) => !now.has(id) && id !== on)
  running = now
  if (done.length) registry.set(unread, new Set([...untrack(unread), ...done]))
})
