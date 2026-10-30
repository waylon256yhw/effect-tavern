// The strip over the reading (#117): the story's own entries, what is byte-stable in the request head and belongs
// to this story, not the install. Desktop, one slim row at the top of the reading column with no line under it (the
// column's fade is the transition): the way back for a folded sidebar, `card › story` (the card's name opens its
// page, the story's name ends in an ellipsis), the persona in force as a chip (the picker), one writing chip (the
// first of `chosen()`, the stance: the Writing page), and the two pages that look at the story, Timeline and
// Inspector. Phone (under 72rem), the same row is the bar: ☰ opens the sidebar's drawer, `card › story ▾` opens
// the story sheet (the card head, the persona, the writing, the two pages), Status opens the state table with a
// dot when this turn moved the state. The pin is nowhere here: armed and shown in the Record alone.
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { roam } from "./controls.tsx"
import { Caret, Check, Clue, Jump, Menu, Next, Probe, Sidebar as Fold, Snippets, Status, Tree } from "./icons.tsx"
import { openInspector } from "./inspector.tsx"
import { Sheet, StatusTable } from "./readings.tsx"
import { fieldChanged } from "./record.ts"
import { openSettings } from "./settings.tsx"
import { setCollapsed, collapsed } from "./side.tsx"
import { card, latest, path, personas, player, stories } from "./store.ts"
import { chosen } from "./switches.ts"
import { openTimeline } from "./timeline.tsx"
import { openCard } from "./pages.ts"
import { putPlayer } from "./wire.ts"
import { openWriting } from "./writing.tsx"
import { t } from "./i18n.ts"

const closeUp = (el: HTMLElement) => el.closest("dialog")?.close() // the phone's sheet: a pick is the end of the visit

export const Strip = () => {
  const view = read(card)
  const lib = read(stories)
  const people = read(personas)
  const me = read(player)
  const line = read(path)
  const last = read(latest)
  const cardId = () => view()?.id ?? ""
  const story = () => lib()?.stories.find((s) => s.id === lib()?.current)
  const title = () => story()?.title ?? t("stories.newStory")
  // The persona in force on this card, and the pick: a change of the player's own layer, nothing of the story's.
  const current = () => people().find((p) => p.id === me()?.persona?.[cardId()])
  const writing = createMemo(() => chosen(me()?.writing, !!me()?.forCard[cardId()]?.some((f) => f.text?.trim())))
  const changed = createMemo(() => {
    const l = last()
    return l !== null && fieldChanged(view()?.rules, l.node, l.prev)
  })
  // the picker: the search over name and text, the rows it leaves; opened from the chip, closed by a pick
  const [q, setQ] = createSignal("")
  const hits = createMemo(() => {
    const s = q().trim().toLowerCase()
    return s ? people().filter((p) => p.name.toLowerCase().includes(s) || p.text.toLowerCase().includes(s)) : people()
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
  /** The settings page's personas: the picker closes, and on a phone the story sheet under it (a page is a leave). */
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
  return (
    <header class="strip">
      <Show when={collapsed()}>
        <button type="button" class="icon desk" aria-label={t("side.expand")} onClick={() => setCollapsed(false)}>
          <Fold />
        </button>
      </Show>
      <button type="button" class="icon phone" aria-label={t("strip.menu")} commandfor="drawer" command="show-modal">
        <Menu />
      </button>
      {/* desktop: the card's name is the way to its page, the story's name stands */}
      <span class="crumb desk">
        <button type="button" class="cardname" title={t("side.theCard")} onClick={() => openCard(cardId())}>
          {view()?.title}
        </button>
        <span class="sep" aria-hidden="true">
          ›
        </span>
        <span class={{ storyname: true, unnamed: story()?.title === null }}>{title()}</span>
      </span>
      {/* phone: the whole crumb opens the story sheet */}
      <button type="button" class="crumb phone" commandfor="story" command="show-modal">
        <span class="cardname">{view()?.title}</span>
        <span class="sep" aria-hidden="true">
          ›
        </span>
        <span class={{ storyname: true, unnamed: story()?.title === null }}>{title()}</span>
        <Caret aria-hidden="true" />
      </button>
      <span class="chips desk">
        <button type="button" class="chip" disabled={!me()} title={t("common.persona")} onClick={openPicker}>
          {current()?.name ?? t("side.cardDefault")}
        </button>
        <button type="button" class="chip" disabled={!me()} title={writing().join(" · ")} onClick={() => openWriting()}>
          {writing()[0]}
        </button>
      </span>
      <span class="spacer" />
      <button type="button" class="icon desk" aria-label={t("common.timeline")} onClick={() => openTimeline()}>
        <Tree />
      </button>
      <button
        type="button"
        class="icon desk"
        aria-label={t("side.inspector")}
        disabled={line().length === 0}
        onClick={() => openInspector()}
      >
        <Probe />
      </button>
      <button class="icon phone" aria-label={t("common.status")} commandfor="status" command="show-modal">
        <Status />
        <Show when={changed()}>
          <i class="dot" />
        </Show>
      </button>
      <Sheet id="status" heading={t("common.status")}>
        <StatusTable />
      </Sheet>
      {/* the story sheet (phone): the card head, the persona, the writing, the two pages */}
      <Sheet id="story" heading={title()}>
        <div class="session">
          <button
            type="button"
            class="cardhead"
            onClick={(e) => (closeUp(e.currentTarget), openCard(cardId()))}
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
          <section class="persona" aria-label={t("common.persona")}>
            <h2>{t("common.persona")}</h2>
            <button type="button" class="chosen" disabled={!me()} onClick={openPicker}>
              <span class="chips">
                <span class="chip">{current()?.name ?? t("side.cardDefault")}</span>
              </span>
              <Next class="chev" aria-hidden="true" />
            </button>
          </section>
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
          </nav>
        </div>
      </Sheet>
      {/* the picker: a sheet beside the strip (on a phone over the story sheet), a search over the player's personas
        and two-line rows, the card's own first; made and edited on the settings page */}
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
    </header>
  )
}
