// The stories manager (#75): every story of every card in one sheet, the picker's mechanism one step wider. A search
// over the title here and over the turns on the server (the stories are unnamed as a rule, so a title search finds
// nothing: the hit is a turn's line, note or prose, shown in the card's preview line in place of the last line
// written), the 全部 / 收藏 toggle, three-line cards (checkbox, star, name and its three actions; the preview; the
// turns and the time), and the cleanup's footer: the issue's two quick picks and 删除选中. Opening, renaming, deleting
// and exporting a story are the session's (side.tsx holds the dialogs); this file holds the list and what is checked.
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Clue, Edit, Export, Snippets, Star, StarFill, Trash } from "./icons.tsx"
import { Sheet } from "./readings.tsx"
import { ago, empty, kindLabel, matches, pieces, preview, ranked, turnLabel, unnamed, type Hit } from "./stories.ts"
import { card, registry, stories, type StoryRow, working } from "./store.ts"
import { newStory } from "./pages.ts"
import { searchStories, starStory } from "./wire.ts"
import { t } from "./i18n.ts"

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

export const Manager = (props: {
  /** The dialog, for its opener (showModal), as the Sheet hands it out. */
  dialog: (el: HTMLDialogElement) => void
  onOpen: (s: StoryRow) => void
  onRename: (s: StoryRow) => void
  onDelete: (rows: readonly StoryRow[]) => void
  onExport: (s: StoryRow) => void
}) => {
  const lib = read(stories)
  const busy = read(working)
  const rows = () => lib()?.stories ?? []
  const [q, setQ] = createSignal("")
  const [hits, setHits] = createSignal<ReadonlyMap<number, Hit>>(new Map())
  const [filter, setFilter] = createSignal<"all" | "starred">("all")
  const [picked, setPicked] = createSignal<ReadonlySet<number>>(new Set())
  let dialog!: HTMLDialogElement
  let search!: HTMLInputElement
  // the search: the title at once, the turns from the server after a pause in the typing; an answer to an older
  // query than the one typed is dropped
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  const ask = (text: string) => {
    setQ(text)
    setHits(new Map()) // the last query's hits go with it: a stale one would keep its row and its snippet under the new marks
    clearTimeout(timer)
    const n = ++seq
    const t = text.trim()
    if (!t) return
    timer = setTimeout(() => {
      void searchStories(t).then((found) => {
        if (n === seq) setHits(new Map(found.map((h) => [h.id, h])))
      })
    }, 200)
  }
  const list = createMemo(() =>
    ranked(rows())
      .filter((s) => filter() === "all" || s.starred)
      .filter((s) => matches(s, q(), hits())),
  )
  const starred = createMemo(() => rows().filter((s) => s.starred).length)
  const empties = createMemo(() => rows().filter(empty).length)
  const unnameds = createMemo(() => rows().filter(unnamed).length)
  /** The checked rows still there: a deleted story leaves the set by itself. */
  const chosen = createMemo(() => rows().filter((s) => picked().has(s.id)))
  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const pickAll = (keep: (s: StoryRow) => boolean) =>
    setPicked(
      (p) =>
        new Set([
          ...p,
          ...rows()
            .filter(keep)
            .map((s) => s.id),
        ]),
    )
  /** Shown: the search and the checks start over, the field takes the focus (the dialog's own toggle event). */
  const reset = () => {
    ask("")
    search.value = ""
    setFilter("all")
    setPicked(new Set<number>())
    search.focus()
  }
  const make = () => {
    dialog.close()
    dialog.parentElement?.closest("dialog")?.close() // the phone's session sheet: the new story opens the card page
    void newStory(registry.get(card)!.id)
  }
  return (
    <Sheet
      dialog={(el) => {
        dialog = el
        el.addEventListener("toggle", (e) => void ((e as ToggleEvent).newState === "open" && reset()))
        props.dialog(el)
      }}
      heading={
        <>
          <span>{t("manager.allStories")}</span>
          <span class="tag mono">{rows().length}</span>
          <button type="button" class="btn sm ghost" onClick={make}>
            <Snippets aria-hidden="true" />
            <span>{t("common.new")}</span>
          </button>
        </>
      }
      footer={
        <footer class="manage">
          <span class="quick">
            <span>{t("manager.quickPick")}</span>
            <button type="button" class="btn xs" onClick={() => pickAll(empty)} title={t("manager.emptyHint")}>
              {t("manager.empty")} {empties()}
            </button>
            <button type="button" class="btn xs" onClick={() => pickAll(unnamed)} title={t("manager.unnamedHint")}>
              {t("manager.unnamed")} {unnameds()}
            </button>
            <Show when={chosen().length}>
              <button type="button" class="btn xs ghost" onClick={() => setPicked(new Set<number>())}>
                {t("manager.clear")}
              </button>
            </Show>
          </span>
          <button
            type="button"
            class="chip danger"
            disabled={!chosen().length || busy()}
            onClick={() => props.onDelete(chosen())}
          >
            {t("manager.deleteSelected")}
            {chosen().length ? ` ${chosen().length}` : ""}
          </button>
        </footer>
      }
    >
      <div class="manager">
        <div class="search">
          <div class="input-box sm">
            <Clue aria-hidden="true" />
            <input
              type="search"
              ref={(el) => (search = el)}
              placeholder={t("manager.searchPlaceholder")}
              aria-label={t("manager.searchLabel")}
              onInput={(e) => ask(e.currentTarget.value)}
            />
          </div>
          <div class="filter" role="group" aria-label={t("manager.filterLabel")}>
            <button type="button" aria-pressed={filter() === "all" ? "true" : "false"} onClick={() => setFilter("all")}>
              <span>{t("manager.all")}</span>
              <span class="n">{rows().length}</span>
            </button>
            <button
              type="button"
              aria-pressed={filter() === "starred" ? "true" : "false"}
              onClick={() => setFilter("starred")}
            >
              <StarFill aria-hidden="true" />
              <span>{t("manager.starred")}</span>
              <span class="n">{starred()}</span>
            </button>
          </div>
        </div>
        <div class="list scroller" role="list">
          <For each={list()} keyed={(s) => s.id}>
            {(s) => {
              const hit = () => hits().get(s().id)
              const line = () => preview(s())
              return (
                <div
                  class="card"
                  role="listitem"
                  aria-current={s().id === lib()?.current ? "true" : undefined}
                  data-checked={picked().has(s().id) ? "" : undefined}
                  title={t("manager.openStory")}
                  onClick={() => props.onOpen(s())}
                >
                  <input
                    type="checkbox"
                    class="box"
                    aria-label={t("manager.select", { title: s().title ?? t("stories.newStory") })}
                    checked={picked().has(s().id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(s().id)}
                  />
                  <button
                    type="button"
                    class="star"
                    aria-label={s().starred ? t("manager.unstar") : t("manager.star")}
                    aria-pressed={s().starred ? "true" : "false"}
                    title={s().starred ? t("manager.starredHint") : t("manager.starHint")}
                    onClick={(e) => (e.stopPropagation(), void starStory(s().id, !s().starred))}
                  >
                    <Show when={s().starred} fallback={<Star aria-hidden="true" />}>
                      <StarFill aria-hidden="true" />
                    </Show>
                  </button>
                  <div class="body">
                    <div class="top">
                      <span class={{ name: true, unnamed: s().title === null }}>
                        <Mark text={s().title ?? t("stories.newStory")} q={q()} />
                      </span>
                      <Show when={s().id === lib()?.current}>
                        <span class="tag ok">{t("manager.current")}</span>
                      </Show>
                      <span class="acts" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          class="icon"
                          aria-label={t("manager.rename")}
                          title={t("manager.rename")}
                          onClick={() => props.onRename(s())}
                        >
                          <Edit />
                        </button>
                        <button
                          type="button"
                          class="icon"
                          aria-label={t("common.export")}
                          title={t("manager.exportHint")}
                          onClick={() => props.onExport(s())}
                        >
                          <Export />
                        </button>
                        <button
                          type="button"
                          class="icon danger"
                          aria-label={t("common.delete")}
                          title={t("manager.deleteStory")}
                          disabled={busy()}
                          onClick={() => props.onDelete([s()])}
                        >
                          <Trash />
                        </button>
                      </span>
                    </div>
                    {/* the preview: the turn the search hit, else the last line written, else the opening alone */}
                    <Show
                      when={hit()}
                      fallback={
                        <Show when={line()} fallback={<div class="preview none">{t("manager.notStarted")}</div>}>
                          {(l) => (
                            <div class="preview">
                              <Mark text={l()} q={q()} />
                            </div>
                          )}
                        </Show>
                      }
                    >
                      {(h) => (
                        <div class="preview">
                          <span class="where">
                            {turnLabel(h())} · {kindLabel(h().kind)}
                            {h().count > 1 ? t("manager.hits", { n: h().count }) : ""}
                          </span>
                          <Mark text={h().text} q={q()} />
                        </div>
                      )}
                    </Show>
                    <div class="meta">
                      {s().turns
                        ? t("manager.turnsUpdated", { turns: s().turns, when: ago(s().updated) })
                        : t("manager.noTurns", { when: ago(s().updated) })}
                    </div>
                  </div>
                </div>
              )
            }}
          </For>
          <Show when={!list().length}>
            <div class="empty">
              <span>
                {q().trim()
                  ? t("manager.noMatch", { q: q().trim() })
                  : filter() === "starred"
                    ? t("manager.noStarred")
                    : t("manager.noStories")}
              </span>
              <Show when={q().trim()}>
                <button type="button" class="btn sm" onClick={() => ((search.value = ""), ask(""))}>
                  {t("manager.clearSearch")}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Sheet>
  )
}
