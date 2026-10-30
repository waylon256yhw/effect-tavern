// The sidebar (#117, #68): the install's standing column, the harness's own. A tree of card → story: a group head is
// the card's name (a tap opens its card page: entering a card makes no story, only Begin there does), under it the
// card's stories, the starred first (stories.ts `ranked`), the open one on a tint, a dot on one whose turn runs on
// the server (the listing's `busy`; while any row has one the listing is re-read every few seconds, else never). A
// row's ⋯ menu: rename, star, export; no delete here, nor on the row: a story is deleted in one place, the cleanup
// sheet (manager.tsx), opened from the foot. Over the tree a search: the title here, the turns on the server
// (`GET /stories/search`, every card's), a hit's group opened and a line of the hit under its row. At the foot the
// install's keys: settings, theme, language, and the cleanup. Desktop: the left card, foldable (`collapsed`, the
// strip has the way back). Phone: the same column in a drawer the strip's ☰ opens. Both are mounted; the dialogs
// are held by ref, the popovers by an id the mount prefixes. The story's own entries (persona, writing, the two
// pages) are the strip's (strip.tsx), not here: this column is the install's.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { roam } from "./controls.tsx"
import {
  Clue,
  Close,
  Dots,
  Edit,
  Export,
  Next,
  Settings,
  Shade,
  Sidebar as Fold,
  Sliders,
  Star,
  StarFill,
  Translate,
} from "./icons.tsx"
import { Manager } from "./manager.tsx"
import { openSettings } from "./settings.tsx"
import { card, cards, page, stories, type StoryRow } from "./store.ts"
import { type Hit, matches, pieces, ranked, turnLabel } from "./stories.ts"
import { flip, theme } from "./theme.ts"
import { openCard, openStory } from "./pages.ts"
import { exportUrl, fetchStories, nameStory, searchStories, starStory } from "./wire.ts"
import { flip as flipLocale, locale, t } from "./i18n.ts"

/** The desktop sidebar folded away (the strip's key unfolds it); the phone's drawer is a dialog, not this. */
export const [collapsed, setCollapsed] = createSignal(false)

/** `text` with every `q` in a `<mark>`. */
const Mark = (props: { text: string; q: string }) => (
  <For each={pieces(props.text, props.q)} keyed={false}>
    {(p) => (
      <Show when={p().hit} fallback={p().text}>
        <mark>{p().text}</mark>
      </Show>
    )}
  </For>
)

/** The column: search, the tree, the foot. `at` prefixes the popovers' ids (two mounts, desktop and the drawer);
 *  `onLeave` is the drawer's close, called when a row or a head takes the player somewhere. */
export const Sidebar = (props: { at: string; onLeave?: () => void }) => {
  const lib = read(stories)
  const shelf = read(cards)
  const own = read(card)
  const pg = read(page)
  const [q, setQ] = createSignal("")
  const [hits, setHits] = createSignal<ReadonlyMap<number, Hit>>(new Map())
  // the search: the title at once, the turns from the server after a pause in the typing; an answer to an older
  // query than the one typed is dropped
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  const ask = (text: string) => {
    setQ(text)
    setHits(new Map())
    clearTimeout(timer)
    const n = ++seq
    const s = text.trim()
    if (!s) return
    timer = setTimeout(() => {
      void searchStories(s).then((found) => {
        if (n === seq) setHits(new Map(found.map((h) => [h.id, h])))
      })
    }, 200)
  }
  // a group is open by default when it holds the open story; `toggled` holds the cards the player flipped from that;
  // a search opens every group it leaves
  const [toggled, setToggled] = createSignal<ReadonlySet<string>>(new Set())
  const isOpen = (id: string) => {
    if (q().trim()) return true
    const dflt = own()?.id === id
    return toggled().has(id) ? !dflt : dflt
  }
  const fold = (id: string) =>
    setToggled((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })
  /** The groups: every card on the shelf with its rows; under a search, only the groups with a row left or a
   *  matching name. */
  const groups = createMemo(() => {
    const rows = ranked(lib()?.stories ?? [])
    const s = q().trim().toLowerCase()
    return shelf()
      .map((c) => ({
        ...c,
        rows: rows.filter((r) => r.card === c.id && matches(r, q(), hits())),
      }))
      .filter((g) => !s || g.rows.length || g.title.toLowerCase().includes(s))
  })
  const viewing = () => {
    const p = pg()
    return typeof p === "object" && "card" in p ? p.card : null
  }
  // the busy dots: while any row has one, the listing is re-read every few seconds (a turn ending on another story
  // is seen nowhere else); with none, never
  createEffect(
    () => !!lib()?.stories.some((s) => s.busy),
    (busy) => {
      if (!busy) return
      const id = setInterval(() => void fetchStories(), 3000)
      return () => clearInterval(id)
    },
  )
  // the rename dialog: the confirm's shape with a field; Enter or Save names it, blank clears the name back to
  // "New story", Escape or Cancel keeps it
  const [renaming, setRenaming] = createSignal<StoryRow | null>(null)
  let rename!: HTMLDialogElement
  let name!: HTMLInputElement
  const openRename = (s: StoryRow) => {
    setRenaming(s)
    name.value = s.title ?? ""
    rename.showModal()
    name.select()
  }
  const commitRename = () => {
    const s = renaming()
    if (!s) return
    const v = name.value.trim()
    if (v !== (s.title ?? "")) void nameStory(s.id, v)
  }
  // the export: the two formats of #75 as links the browser downloads, the server naming the file by the title
  const [exporting, setExporting] = createSignal<StoryRow | null>(null)
  let exportDialog!: HTMLDialogElement
  const openExport = (s: StoryRow) => {
    setExporting(s)
    exportDialog.showModal()
  }
  let manager!: HTMLDialogElement
  const go = (f: () => void) => {
    props.onLeave?.()
    f()
  }
  const closeMenu = (el: HTMLElement) => el.closest<HTMLElement>("[popover]")?.hidePopover()
  return (
    <div class="sidebar">
      <div class="top">
        <div class="input-box sm">
          <Clue aria-hidden="true" />
          <input
            type="search"
            placeholder={t("side.search")}
            aria-label={t("side.searchLabel")}
            onInput={(e) => ask(e.currentTarget.value)}
          />
        </div>
        <Show
          when={props.onLeave}
          fallback={
            <button type="button" class="icon" aria-label={t("side.collapse")} onClick={() => setCollapsed(true)}>
              <Fold />
            </button>
          }
        >
          <button type="button" class="icon" aria-label={t("common.close")} onClick={() => props.onLeave?.()}>
            <Close />
          </button>
        </Show>
      </div>
      <nav class="tree" aria-label={t("side.stories")}>
        <For each={groups()} keyed={(g) => g.id}>
          {(g) => (
            <section class="group" aria-label={g().title}>
              <div class="head" aria-current={viewing() === g().id ? "page" : undefined}>
                <button
                  type="button"
                  class="fold"
                  aria-expanded={isOpen(g().id) ? "true" : "false"}
                  aria-label={isOpen(g().id) ? t("side.foldGroup") : t("side.unfoldGroup")}
                  onClick={() => fold(g().id)}
                >
                  <Next aria-hidden="true" />
                </button>
                {/* the name: a tap is the card page; folded, a dot stands for the busy rows inside */}
                <button type="button" class="name" title={t("side.theCard")} onClick={() => go(() => openCard(g().id))}>
                  <span class="first">
                    <Mark text={g().title} q={q()} />
                  </span>
                  <Show when={!isOpen(g().id) && g().rows.some((r) => r.busy)}>
                    <i class="dot" title={t("side.busy")} />
                  </Show>
                  <Next class="enter" aria-hidden="true" />
                </button>
              </div>
              <Show when={isOpen(g().id)}>
                <ul>
                  <For each={g().rows} keyed={(r) => r.id}>
                    {(r) => {
                      const hit = () => hits().get(r().id)
                      const id = () => `${props.at}-menu-${r().id}`
                      return (
                        <li>
                          <div class="row">
                            <button
                              type="button"
                              class="story"
                              aria-current={r().id === lib()?.current && !viewing() ? "true" : undefined}
                              onClick={() => go(() => r().id !== lib()?.current && void openStory(r().id))}
                            >
                              <Show when={r().starred}>
                                <StarFill class="star" aria-hidden="true" />
                              </Show>
                              <span class={{ first: true, unnamed: r().title === null }}>
                                <Mark text={r().title ?? t("stories.newStory")} q={q()} />
                              </span>
                              <Show when={r().busy}>
                                <i class="dot" title={t("side.busy")} />
                              </Show>
                            </button>
                            <button
                              type="button"
                              class="icon more"
                              aria-label={t("side.storyActions")}
                              aria-haspopup="menu"
                              popovertarget={id()}
                            >
                              <Dots />
                            </button>
                            <div
                              id={id()}
                              class="versions menu"
                              popover
                              role="menu"
                              onKeyDown={roam}
                              onFocusOut={(e) =>
                                !e.currentTarget.contains(e.relatedTarget as HTMLElement | null) &&
                                e.currentTarget.hidePopover()
                              }
                              onToggle={(e) =>
                                e.newState === "open" &&
                                e.currentTarget.matches(":popover-open") &&
                                e.currentTarget.querySelector<HTMLElement>("[role=menuitem]")?.focus()
                              }
                            >
                              <button
                                type="button"
                                role="menuitem"
                                class="version"
                                tabindex="-1"
                                onClick={(e) => (closeMenu(e.currentTarget), openRename(r()))}
                              >
                                <Edit class="kind" aria-hidden="true" />
                                <span class="first">{t("side.renameStory")}</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                class="version"
                                tabindex="-1"
                                onClick={(e) => (closeMenu(e.currentTarget), void starStory(r().id, !r().starred))}
                              >
                                <Show when={r().starred} fallback={<Star class="kind" aria-hidden="true" />}>
                                  <StarFill class="kind" aria-hidden="true" />
                                </Show>
                                <span class="first">{r().starred ? t("side.unstar") : t("side.star")}</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                class="version"
                                tabindex="-1"
                                onClick={(e) => (closeMenu(e.currentTarget), openExport(r()))}
                              >
                                <Export class="kind" aria-hidden="true" />
                                <span class="first">{t("common.export")}</span>
                              </button>
                            </div>
                          </div>
                          {/* the search's hit: the turn and a piece of the line, one row of small print */}
                          <Show when={hit()}>
                            {(h) => (
                              <button
                                type="button"
                                class="hit"
                                onClick={() => go(() => r().id !== lib()?.current && void openStory(r().id))}
                              >
                                <span class="where">{turnLabel(h())} ·</span>
                                <Mark text={h().text} q={q()} />
                              </button>
                            )}
                          </Show>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </Show>
            </section>
          )}
        </For>
        <Show when={!groups().length}>
          <p class="empty">{q().trim() ? t("side.noMatch", { q: q().trim() }) : t("side.noStories")}</p>
        </Show>
      </nav>
      {/* the install's keys: the two device flips show their state as pressed keys; the cleanup at the other end */}
      <nav class="foot" aria-label={t("side.install")}>
        <button type="button" class="icon" aria-label={t("common.settings")} onClick={() => go(() => openSettings())}>
          <Settings />
        </button>
        <button
          type="button"
          class="icon"
          aria-label={t("side.darkTheme")}
          aria-pressed={theme() === "dark" ? "true" : "false"}
          onClick={flip}
        >
          <Shade />
        </button>
        <button
          type="button"
          class="icon"
          aria-label={t("side.language")}
          aria-pressed={locale() === "en" ? "true" : "false"}
          onClick={flipLocale}
        >
          <Translate />
        </button>
        <span class="spacer" />
        <button
          type="button"
          class="icon"
          aria-label={t("side.manage")}
          disabled={!lib()}
          onClick={() => manager.showModal()}
        >
          <Sliders />
        </button>
      </nav>
      <dialog class="confirm" ref={(el) => (rename = el)} closedby="any" onClose={() => setRenaming(null)}>
        <form method="dialog" onSubmit={commitRename}>
          <p>{t("side.renameStory")}</p>
          <input
            class="field"
            ref={(el) => (name = el)}
            aria-label={t("side.storyName")}
            placeholder={t("stories.newStory")}
          />
          <div class="row">
            <button type="button" class="chip state" onClick={() => rename.close()}>
              {t("common.cancel")}
            </button>
            <button type="submit" class="chip primary">
              {t("common.save")}
            </button>
          </div>
        </form>
      </dialog>
      <dialog class="confirm" ref={(el) => (exportDialog = el)} closedby="any" onClose={() => setExporting(null)}>
        <p>{t("side.exportTitle", { title: exporting()?.title ?? t("stories.newStory") })}</p>
        <p class="sub">{t("side.exportHint")}</p>
        <div class="row">
          <button type="button" class="chip state" onClick={() => exportDialog.close()}>
            {t("common.cancel")}
          </button>
          <a
            class="chip state"
            href={exportUrl(exporting()?.id ?? 0, "json")}
            download
            onClick={() => exportDialog.close()}
          >
            {t("side.exportJson")}
          </a>
          <a
            class="chip primary"
            href={exportUrl(exporting()?.id ?? 0, "md")}
            download
            onClick={() => exportDialog.close()}
          >
            {t("side.exportMd")}
          </a>
        </div>
      </dialog>
      {/* the cleanup: every story with a checkbox, the quick picks, delete; the one place a story is deleted */}
      <Manager dialog={(el) => (manager = el)} onLeave={props.onLeave} />
    </div>
  )
}

/** Desktop's left card, and the phone's drawer (a modal dialog sliding in from the left; the strip's ☰ opens it). */
export const Side = () => {
  let drawer!: HTMLDialogElement
  return (
    <>
      <aside class="side">
        <Sidebar at="desk" />
      </aside>
      <dialog id="drawer" class="drawer" ref={(el) => (drawer = el)} closedby="any">
        <Sidebar at="phone" onLeave={() => drawer.close()} />
      </dialog>
    </>
  )
}
