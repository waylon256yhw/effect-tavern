// The stories manager (#75): every story of one card (the sidebar's workspace, #117) in one sheet, the picker's
// mechanism one step wider. A search over the title here and over the turns on the server (the stories are unnamed as a
// rule, so a title search finds nothing: the hit is a turn's line, note or prose, shown in the card's preview line in
// place of the last line written), the 全部 / 收藏 toggle, and story cards (star, name, time and actions; preview when
// present). Opening, renaming, deleting and exporting a story are the library's dialogs (dialogs.tsx).
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import type { DialogHandle } from "./controls.tsx"
import { Check, Clue, Edit, Export, Star, StarFill, Trash } from "./icons.tsx"
import { Sheet } from "./readings.tsx"
import { ago, kindLabel, matches, pieces, preview, ranked, turnLabel, type Hit } from "./stories.ts"
import { focus, stories, type StoryRow, working } from "./store.ts"
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
  /** The sheet's handle, kept by the opener. */
  controller: DialogHandle
  onOpen: (s: StoryRow) => void
  onRename: (s: StoryRow) => void
  onDelete: (rows: readonly StoryRow[]) => void
  onExport: (s: StoryRow) => void
}) => {
  const lib = read(stories)
  const busy = read(working)
  const at = read(focus)
  const rows = () => (lib()?.stories ?? []).filter((s) => s.card === at()) // this card's (#117: the manager is the workspace's)
  const [q, setQ] = createSignal("")
  const [hits, setHits] = createSignal<ReadonlyMap<number, Hit>>(new Map())
  const [filter, setFilter] = createSignal<"all" | "starred">("all")
  const [picked, setPicked] = createSignal<ReadonlySet<number>>(new Set())
  const [anchor, setAnchor] = createSignal<number | null>(null)
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
  /** The selected rows still present on this card: a deleted story leaves the set on its own. */
  const chosen = createMemo(() => rows().filter((s) => picked().has(s.id)))
  const selecting = () => chosen().length > 0
  const toggle = (id: number) => {
    setPicked((p) => {
      const next = new Set(p)
      if (!next.delete(id)) next.add(id)
      return next
    })
    setAnchor(id)
  }
  const rangeTo = (id: number) => {
    const cur = list()
    const a = anchor() !== null ? cur.findIndex((s) => s.id === anchor()) : -1
    const b = cur.findIndex((s) => s.id === id)
    if (a < 0 || b < 0) return toggle(id)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    setPicked((p) => new Set([...p, ...cur.slice(lo, hi + 1).map((s) => s.id)]))
    setAnchor(id)
  }
  // long-press (~350ms) on a card enters or toggles selection without firing the follow-up click
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let held = false
  let startX = 0
  let startY = 0
  const clearHold = () => clearTimeout(holdTimer)
  /** Shown: the search and selection start over (the field is drawn anew and takes the focus). */
  const reset = () => {
    ask("")
    setFilter("all")
    setPicked(new Set<number>())
    setAnchor(null)
  }
  return (
    <Sheet
      controller={props.controller}
      focus="input[type=search]"
      // Escape with stories checked clears the checks and keeps the sheet, wherever the focus is (a click on a card
      // leaves it on the sheet itself, above anything inside)
      onOpenChange={(open, details) => {
        if (open) reset()
        else if (details.reason === "escape-key" && selecting()) {
          details.cancel()
          setPicked(new Set<number>())
          setAnchor(null)
        }
      }}
      heading={t("manager.allStories")}
      tools={
        <Show when={chosen().length}>
          <span class="picked-bar">
            <span class="turns">#{chosen().length}</span>
            <button
              type="button"
              class="icon danger"
              aria-label={t("common.delete")}
              disabled={busy()}
              onClick={() => props.onDelete(chosen())}
            >
              <Trash />
            </button>
          </span>
        </Show>
      }
    >
      <div class="manager" data-selecting={selecting() ? "" : undefined}>
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
              {t("manager.all")}
            </button>
            <button
              type="button"
              aria-pressed={filter() === "starred" ? "true" : "false"}
              onClick={() => setFilter("starred")}
            >
              {t("manager.starred")}
            </button>
          </div>
        </div>
        <div class="list scroller" role="list">
          <For each={list()} keyed={(s) => s.id}>
            {(s) => {
              const hit = () => hits().get(s().id)
              const line = () => preview(s())
              const checked = () => picked().has(s().id)
              return (
                <div
                  class="card"
                  role="listitem"
                  aria-current={s().id === lib()?.current ? "true" : undefined}
                  data-checked={checked() ? "" : undefined}
                  onPointerDown={(e) => {
                    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return
                    held = false
                    startX = e.clientX
                    startY = e.clientY
                    clearHold()
                    holdTimer = setTimeout(() => {
                      held = true
                      toggle(s().id)
                    }, 350)
                  }}
                  onPointerMove={(e) => {
                    if (holdTimer && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) clearHold()
                  }}
                  onPointerUp={clearHold}
                  onPointerCancel={clearHold}
                  onPointerLeave={clearHold}
                  onClick={(e) => {
                    if (held) {
                      held = false
                      return
                    }
                    if (e.shiftKey) {
                      e.preventDefault()
                      rangeTo(s().id)
                      return
                    }
                    if (e.metaKey || e.ctrlKey || selecting()) {
                      toggle(s().id)
                      return
                    }
                    props.onOpen(s())
                  }}
                >
                  <span class="box" aria-hidden="true">
                    <Check />
                  </span>
                  <div class="body">
                    <div class="top">
                      <span class={{ name: true, unnamed: s().title === null }}>
                        <Mark text={s().title ?? t("stories.newStory")} q={q()} />
                      </span>
                      <span class={{ turns: true, zero: s().turns === 0 }}>#{s().turns}</span>
                      <span class="meta">{ago(s().updated)}</span>
                      <span class="acts" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          class="icon star"
                          aria-label={s().starred ? t("manager.unstar") : t("manager.star")}
                          aria-pressed={s().starred ? "true" : "false"}
                          onClick={() => void starStory(s().id, !s().starred)}
                        >
                          <Show when={s().starred} fallback={<Star aria-hidden="true" />}>
                            <StarFill aria-hidden="true" />
                          </Show>
                        </button>
                        <button
                          type="button"
                          class="icon"
                          aria-label={t("manager.rename")}
                          onClick={() => props.onRename(s())}
                        >
                          <Edit />
                        </button>
                        <button
                          type="button"
                          class="icon"
                          aria-label={t("common.export")}
                          onClick={() => props.onExport(s())}
                        >
                          <Export />
                        </button>
                        <button
                          type="button"
                          class="icon danger"
                          aria-label={t("common.delete")}
                          disabled={busy()}
                          onClick={() => props.onDelete([s()])}
                        >
                          <Trash />
                        </button>
                      </span>
                    </div>
                    <Show
                      when={hit()}
                      fallback={
                        <Show when={line()}>
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
                          </span>
                          <Mark text={h().text} q={q()} />
                        </div>
                      )}
                    </Show>
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
