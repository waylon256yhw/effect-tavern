// The session beside the reading: what holds for the whole story and is byte-stable in the request head: the card,
// this card's stories (which one is open), the persona the player is on this card, the writing in force (chips that
// open the Writing page, writing.tsx), the armed pin, the two pages that look at the story (Timeline, Inspector), the theme and the settings. The left card on desktop; on a phone, the sheet
// the title opens. Both can be mounted; the dialogs are held by ref, so neither needs an id. Stories are the library's: a
// story is one root's tree. The persona is a player asset, a sibling of the card, not a step of a story: the pick is
// `Player.persona[card]`, changeable any time (one head rewrite, like a writing switch); this card only picks one. The
// pick is a sheet with a search (a popover is pinned to the column or hangs out of the card, and a long list is a chore
// on a phone); making and editing personas is the settings page's. The card shows four stories, the starred first
// and the open one among them; every story, with the star, the search, the cleanup and the exports, is the manager's
// sheet (manager.tsx, #75), opened from the row under the four. The dialogs a story needs (rename, the delete
// confirm, the export's two formats) are here, one each, for the card's rows and the manager's cards alike.
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { openCard } from "./card.tsx"
import {
  Check,
  Clue,
  Edit,
  Jump,
  Next,
  Pin,
  Probe,
  Settings,
  Shade,
  Snippets,
  Trash,
  Tree,
  Translate,
} from "./icons.tsx"
import { openInspector } from "./inspector.tsx"
import { Manager } from "./manager.tsx"
import { Sheet } from "./readings.tsx"
import { openSettings } from "./settings.tsx"
import { card, path, personas, pin, player, stories, type StoryRow, working } from "./store.ts"
import { ago, shown } from "./stories.ts"
import { chosen } from "./switches.ts"
import { flip, theme } from "./theme.ts"
import { openTimeline } from "./timeline.tsx"
import { deleteStories, deleteStory, exportUrl, nameStory, newStory, openStory, putPlayer } from "./wire.ts"
import { openWriting } from "./writing.tsx"
import { flip as flipLocale, locale, t } from "./i18n.ts"

/** The menu's keyboard: arrows move focus among the items and wrap, Home/End jump; Escape and outside clicks are the popover's. */
export const roam = (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role^=menuitem]")]
  const i = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
  const d = { ArrowDown: 1, ArrowUp: -1, Home: -i, End: items.length - 1 - i }[e.key]
  if (d === undefined) return
  e.preventDefault()
  items.at((i + d) % items.length)?.focus()
}
const closeUp = (el: HTMLElement) => {
  el.closest<HTMLElement>("[popover]")?.hidePopover()
  el.closest("dialog")?.close() // the phone's sheet: a pick is the end of the visit
}

export const Session = () => {
  const view = read(card)
  const lib = read(stories)
  const people = read(personas)
  const me = read(player)
  const pinned = read(pin)
  const line = read(path)
  const busy = read(working) // the story stays put while a turn is in flight
  /** A pinned entry by its hook: on the node it was armed from, or an earlier one (a told entry leaves `readable`). */
  const hookOf = (id: string) =>
    line()
      .flatMap((n) => n.readable)
      .find((e) => e.id === id)?.hook ?? id
  // The persona in force on this card, and the pick: a change of the player's own layer, nothing of the story's.
  const cardId = () => view()?.id ?? ""
  const current = () => people().find((p) => p.id === me()?.persona?.[cardId()])
  const writing = createMemo(() => chosen(me()?.writing, !!me()?.forCard[cardId()]?.some((f) => f.text?.trim())))
  // the picker: the search over name and text, the rows it leaves; opened from the row, closed by a pick
  const [q, setQ] = createSignal("")
  const hits = createMemo(() => {
    const t = q().trim().toLowerCase()
    return t ? people().filter((p) => p.name.toLowerCase().includes(t) || p.text.toLowerCase().includes(t)) : people()
  })
  /** The card's own row stays while the search is empty or names it; the rule under it only when rows follow. */
  const showDefault = () => !q().trim() || t("side.cardDefault").includes(q().trim())
  let picker!: HTMLDialogElement
  let search!: HTMLInputElement
  const openPicker = () => {
    setQ("")
    search.value = ""
    picker.showModal()
    search.focus()
  }
  /** The settings page's personas: the picker closes, and on a phone the session sheet under it (a page is a leave). */
  const manage = () => {
    picker.close()
    picker.parentElement?.closest("dialog")?.close()
    openSettings("personas")
  }
  const pick = (id: string | undefined) => {
    const p = me()
    if (!p) return
    const { [cardId()]: _, ...rest } = p.persona ?? {}
    const next = id === undefined ? rest : { ...rest, [cardId()]: id }
    void putPlayer({ ...p, persona: Object.keys(next).length ? next : undefined }) // an empty map leaves the JSON like any unset key
  }
  // the rename dialog (the header's pencil, for the open story): the confirm's shape with a field; Enter or Save names
  // it, blank clears the name back to "New story", Escape or Cancel keeps it. Not a double-click on a row: its two
  // clicks would open the story twice, and on a phone close the sheet the dialog lives in
  const [renaming, setRenaming] = createSignal<StoryRow | null>(null)
  let confirm!: HTMLDialogElement
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
    const t = name.value.trim()
    if (t !== (s.title ?? "")) void nameStory(s.id, t)
  }
  // the delete confirm: the one story a trash names (the header's, for the open story; a manager card's), or the
  // manager's checked set; its own list, so a cancel leaves the checks as they were. One is the single call, several
  // the batch, and the reader only moves when the open story went
  const [doomed, setDoomed] = createSignal<readonly StoryRow[]>([])
  const openDelete = (rows: readonly StoryRow[]) => {
    if (!rows.length) return
    setDoomed(rows)
    confirm.showModal()
  }
  const commitDelete = () => {
    const rows = doomed()
    confirm.close()
    if (rows.length === 1) void deleteStory(rows[0]!.id)
    else if (rows.length) void deleteStories(rows.map((s) => s.id))
  }
  // the export: the two formats of #75 as links the browser downloads, the server naming the file by the title
  const [exporting, setExporting] = createSignal<StoryRow | null>(null)
  let exportDialog!: HTMLDialogElement
  const openExport = (s: StoryRow) => {
    setExporting(s)
    exportDialog.showModal()
  }
  // the manager: every story; a card opens its story and closes the sheet (on a phone the session sheet under it too)
  let manager!: HTMLDialogElement
  const openFromManager = (s: StoryRow) => {
    manager.close()
    manager.parentElement?.closest("dialog")?.close()
    if (s.id !== lib()?.current) void openStory(s.id)
  }
  return (
    <>
      <div class="session">
        {/* the card: its name with the way in beside it (a badge at rest, not a hover), its line to three rows */}
        <button
          type="button"
          class="cardhead"
          onClick={(e) => (closeUp(e.currentTarget), openCard())}
          aria-label={t("side.theCard")}
        >
          <span class="top">
            <h1>{view()?.title}</h1>
            <span class="enter" aria-hidden="true">
              <Next />
            </span>
          </span>
          <Show when={view()?.summary}>{(s) => <p>{s()}</p>}</Show>
        </button>
        <section class="stories" aria-label={t("side.stories")}>
          <h2>
            {t("side.stories")}
            <button
              type="button"
              class="icon"
              aria-label={t("stories.newStory")}
              disabled={busy()}
              onClick={(e) => (closeUp(e.currentTarget), void newStory())}
            >
              <Snippets />
            </button>
            <button
              type="button"
              class="icon"
              aria-label={t("side.renameStory")}
              disabled={busy() || !lib()?.stories.some((s) => s.id === lib()?.current)}
              onClick={() => openRename(lib()!.stories.find((s) => s.id === lib()!.current)!)}
            >
              <Edit />
            </button>
            <button
              type="button"
              class="icon"
              aria-label={t("side.deleteStory")}
              disabled={busy() || !lib()?.stories.some((s) => s.id === lib()?.current)}
              onClick={() => openDelete(lib()!.stories.filter((s) => s.id === lib()!.current))}
            >
              <Trash />
            </button>
          </h2>
          {/* four rows: the starred first, then the newest, the open one among them whatever its rank (stories.ts) */}
          <ul>
            <For each={shown(lib()?.stories ?? [], lib()?.current)} keyed={(s) => s.id}>
              {(s) => (
                <li>
                  {/* the name the player gave, or "New story" (every story of a card opens on the same greeting, so no
                    line of the text would tell them apart); under it the turns and the time, the time alone at none */}
                  <button
                    type="button"
                    class="story"
                    aria-current={s().id === lib()?.current ? "true" : undefined}
                    disabled={busy()}
                    onClick={(e) => {
                      closeUp(e.currentTarget) // the open one too: on a phone, back to the reader
                      if (s().id !== lib()?.current) void openStory(s().id)
                    }}
                  >
                    <span class={{ first: true, unnamed: s().title === null }}>
                      {s().title ?? t("stories.newStory")}
                    </span>
                    <span class="meta">
                      {s().turns ? t("side.turns", { n: s().turns }) : ""}
                      {ago(s().updated)}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          {/* the rest, and the star, the search, the cleanup, the exports: the manager's sheet */}
          <button type="button" class="all" disabled={!lib()} onClick={() => manager.showModal()}>
            <span>{t("side.allStories", { n: lib()?.stories.length ?? 0 })}</span>
            <Next class="chev" aria-hidden="true" />
          </button>
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
          <dialog class="confirm" ref={(el) => (confirm = el)} closedby="any" onClose={() => setDoomed([])}>
            <p>
              {doomed().length > 1
                ? t("side.confirmDeleteMany", { n: doomed().length })
                : t("side.confirmDeleteOne", { title: doomed()[0]?.title ?? t("stories.newStory") })}
            </p>
            <div class="row">
              <button type="button" class="chip state" onClick={() => confirm.close()}>
                {t("common.cancel")}
              </button>
              <button type="button" class="chip danger" onClick={commitDelete}>
                {t("common.delete")}
              </button>
            </div>
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
        </section>
        {/* who the player is on this card: one chip, the persona in force (the card's own when none is picked); the row
          opens the picker below, never disabled: with no persona made it still shows the card's own and the way to
          make one. Head text like the switches: a change rewrites the cached prefix, no new story */}
        <section class="persona" aria-label={t("common.persona")}>
          <h2>{t("common.persona")}</h2>
          <button type="button" class="chosen" disabled={!me()} onClick={openPicker}>
            <span class="chips">
              <span class="chip">{current()?.name ?? t("side.cardDefault")}</span>
            </span>
            <Next class="chev" aria-hidden="true" />
          </button>
        </section>
        {/* the writing in force, as chips: the switches set (the card's own text holds for the rest) and a per-card
          supplement, every one whole, wrapping when the row is short of them (three four-character chips fill one
          line; the English ones, or five, take two; the card's spare height is the stories zone's). One button, the
          Writing page (a change there is a head rewrite, so it reads as a preference) */}
        <section class="writing" aria-label={t("side.writing")}>
          <h2>{t("side.writing")}</h2>
          <button
            type="button"
            class="chosen"
            disabled={!me()}
            title={writing().join(" · ")}
            onClick={(e) => (closeUp(e.currentTarget), openWriting())}
          >
            <span class="chips">
              <For each={writing()} keyed={(l) => l}>
                {(l) => <span class="chip">{l()}</span>}
              </For>
            </span>
            <Next class="chev" aria-hidden="true" />
          </button>
        </section>
        <Show when={pinned()}>
          {(p) => (
            <section class="pinned">
              <h2>{t("side.pinned")}</h2>
              <p>
                <Pin aria-hidden="true" />
                <span>{hookOf(p())}</span>
              </p>
            </section>
          )}
        </Show>
        <nav class="tools" aria-label={t("side.pages")}>
          <button
            type="button"
            class="icon"
            aria-label={t("common.timeline")}
            onClick={(e) => (closeUp(e.currentTarget), openTimeline())}
          >
            <Tree />
          </button>
          <button
            type="button"
            class="icon"
            aria-label={t("side.inspector")}
            disabled={line().length === 0}
            onClick={(e) => (closeUp(e.currentTarget), openInspector())}
          >
            <Probe />
          </button>
          {/* the theme (theme.ts): a flip, not a page, so the phone's sheet stays; pressed while the dark side holds */}
          <button
            type="button"
            class="icon theme"
            aria-label={t("side.darkTheme")}
            aria-pressed={theme() === "dark" ? "true" : "false"}
            onClick={flip}
          >
            <Shade />
          </button>
          {/* the interface's language (i18n.ts): a flip like the theme, the device's pick; pressed while English holds */}
          <button
            type="button"
            class="icon"
            aria-label={t("side.language")}
            aria-pressed={locale() === "en" ? "true" : "false"}
            onClick={flipLocale}
          >
            <Translate />
          </button>
          <button
            type="button"
            class="icon"
            aria-label={t("common.settings")}
            onClick={(e) => (closeUp(e.currentTarget), openSettings())}
          >
            <Settings />
          </button>
        </nav>
      </div>
      {/* the manager: a sheet beside the session like the picker, every story with its star, the search, the cleanup */}
      <Manager
        dialog={(el) => (manager = el)}
        onOpen={openFromManager}
        onRename={openRename}
        onDelete={openDelete}
        onExport={openExport}
      />
      {/* the picker: a sheet beside the session (not in it: the sheet's heading is not a session caption), a search over
        the player's personas and two-line rows, the card's own first; made and edited on the settings page */}
      <Sheet
        dialog={(el) => (picker = el)}
        heading={t("side.pickPersona")}
        footer={
          <footer>
            <button type="button" class="btn ghost" onClick={manage}>
              <span>{t("side.managePersonas")}</span>
              <Jump aria-hidden="true" />
            </button>
          </footer>
        }
      >
        <div class="picker">
          <div class="search">
            <div class="input-box sm">
              <Clue aria-hidden="true" />
              <input
                type="search"
                ref={(el) => (search = el)}
                placeholder={t("side.searchPersonas")}
                aria-label={t("side.searchPersonasLabel")}
                onInput={(e) => setQ(e.currentTarget.value)}
              />
            </div>
            <span class="tag mono">{people().length}</span>
          </div>
          <div class="list scroller" role="menu" onKeyDown={roam}>
            <Show when={showDefault()}>
              <button
                type="button"
                role="menuitemradio"
                class="item default"
                aria-checked={current() ? "false" : "true"}
                onClick={() => (picker.close(), pick(undefined))}
              >
                <span class="name">
                  {t("side.cardDefault")}
                  <span class="tag">{t("side.withCard")}</span>
                </span>
                <Check class="check" aria-hidden="true" />
                <span class="bio">{t("side.cardPersonaBio")}</span>
              </button>
              <Show when={hits().length}>
                <hr />
              </Show>
            </Show>
            <For each={hits()} keyed={(p) => p.id}>
              {(p) => (
                <button
                  type="button"
                  role="menuitemradio"
                  class="item"
                  aria-checked={p().id === current()?.id ? "true" : "false"}
                  onClick={() => (picker.close(), pick(p().id))}
                >
                  <span class="name">{p().name}</span>
                  <Check class="check" aria-hidden="true" />
                  <span class="bio">{p().text.split("\n")[0]}</span>
                </button>
              )}
            </For>
            <Show when={!people().length}>
              <div class="empty">
                <span>{t("side.noPersonas")}</span>
                <button type="button" class="btn sm" onClick={manage}>
                  <Snippets aria-hidden="true" />
                  <span>{t("side.makeOne")}</span>
                </button>
              </div>
            </Show>
            <Show when={people().length && q().trim() && !hits().length && !showDefault()}>
              <div class="empty">
                <span>{t("side.noPersonaMatch", { q: q().trim() })}</span>
              </div>
            </Show>
          </div>
        </div>
      </Sheet>
    </>
  )
}

/** Desktop's left card. */
export const Side = () => (
  <aside class="side">
    <Session />
  </aside>
)
