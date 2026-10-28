// The stories manager (#75): every story of the card in one sheet, the picker's mechanism one step wider. A search
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
import { stories, type StoryRow, working } from "./store.ts"
import { newStory, searchStories, starStory } from "./wire.ts"

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
    void newStory()
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
          <span>全部故事</span>
          <span class="tag mono">{rows().length}</span>
          <button type="button" class="btn sm ghost" disabled={busy()} onClick={make}>
            <Snippets aria-hidden="true" />
            <span>新建</span>
          </button>
        </>
      }
      footer={
        <footer class="manage">
          <span class="quick">
            <span>快选</span>
            <button type="button" class="btn xs" onClick={() => pickAll(empty)} title="只有开场白的档">
              空档 {empties()}
            </button>
            <button type="button" class="btn xs" onClick={() => pickAll(unnamed)} title="没起名也没收藏的档">
              未命名未收藏 {unnameds()}
            </button>
            <Show when={chosen().length}>
              <button type="button" class="btn xs ghost" onClick={() => setPicked(new Set<number>())}>
                清空
              </button>
            </Show>
          </span>
          <button
            type="button"
            class="chip danger"
            disabled={!chosen().length || busy()}
            onClick={() => props.onDelete(chosen())}
          >
            删除选中{chosen().length ? ` ${chosen().length}` : ""}
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
              placeholder="搜索标题、玩家台词或正文"
              aria-label="搜索故事"
              onInput={(e) => ask(e.currentTarget.value)}
            />
          </div>
          <div class="filter" role="group" aria-label="筛选故事">
            <button type="button" aria-pressed={filter() === "all" ? "true" : "false"} onClick={() => setFilter("all")}>
              <span>全部</span>
              <span class="n">{rows().length}</span>
            </button>
            <button
              type="button"
              aria-pressed={filter() === "starred" ? "true" : "false"}
              onClick={() => setFilter("starred")}
            >
              <StarFill aria-hidden="true" />
              <span>收藏</span>
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
                  title="打开这个故事"
                  onClick={() => busy() || props.onOpen(s())}
                >
                  <input
                    type="checkbox"
                    class="box"
                    aria-label={`勾选「${s().title ?? "New story"}」`}
                    checked={picked().has(s().id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(s().id)}
                  />
                  <button
                    type="button"
                    class="star"
                    aria-label={s().starred ? "取消收藏" : "收藏"}
                    aria-pressed={s().starred ? "true" : "false"}
                    title={s().starred ? "已收藏：左栏置顶（点击取消）" : "收藏：左栏置顶"}
                    onClick={(e) => (e.stopPropagation(), void starStory(s().id, !s().starred))}
                  >
                    <Show when={s().starred} fallback={<Star aria-hidden="true" />}>
                      <StarFill aria-hidden="true" />
                    </Show>
                  </button>
                  <div class="body">
                    <div class="top">
                      <span class={{ name: true, unnamed: s().title === null }}>
                        <Mark text={s().title ?? "New story"} q={q()} />
                      </span>
                      <Show when={s().id === lib()?.current}>
                        <span class="tag ok">当前</span>
                      </Show>
                      <span class="acts" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          class="icon"
                          aria-label="重命名"
                          title="重命名"
                          onClick={() => props.onRename(s())}
                        >
                          <Edit />
                        </button>
                        <button
                          type="button"
                          class="icon"
                          aria-label="导出"
                          title="导出：阅读稿 .md 或完整树 .json"
                          onClick={() => props.onExport(s())}
                        >
                          <Export />
                        </button>
                        <button
                          type="button"
                          class="icon danger"
                          aria-label="删除"
                          title="删除这个故事"
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
                        <Show when={line()} fallback={<div class="preview none">尚未开始对话</div>}>
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
                            {turnLabel(h())} · {kindLabel[h().kind]}
                            {h().count > 1 ? ` · 共 ${h().count} 处` : ""}
                          </span>
                          <Mark text={h().text} q={q()} />
                        </div>
                      )}
                    </Show>
                    <div class="meta">
                      {s().turns
                        ? `${s().turns} 轮 · 最后更新 ${ago(s().updated, "zh")}`
                        : `0 轮（空档） · ${ago(s().updated, "zh")}`}
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
                  ? `没有匹配「${q().trim()}」的故事（已检索标题、玩家台词与正文）`
                  : filter() === "starred"
                    ? "还没有收藏的故事：点卡片上的星标即可收藏，收藏的故事在左栏置顶。"
                    : "这张卡还没有故事。"}
              </span>
              <Show when={q().trim()}>
                <button type="button" class="btn sm" onClick={() => ((search.value = ""), ask(""))}>
                  清空搜索
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Sheet>
  )
}
