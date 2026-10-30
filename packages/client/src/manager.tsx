// The cleanup sheet (#75, kept by #117 as the one place a story is deleted): every story of every card as a row with
// a checkbox (the card's name as a tag, the title, the turns and the time), the quick picks (the empties, the
// never-named-nor-starred), and 删除选中, which confirms and sends the checked ids in one batch (DELETE /stories).
// A story whose turn runs on the server cannot be checked: the server skips it, and a box that did nothing would
// need explaining. Opening, naming, starring and exporting a story are the sidebar's (side.tsx); the list is
// read-only here, nothing on a row opens it.
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Sheet } from "./readings.tsx"
import { ago, empty, ranked, unnamed } from "./stories.ts"
import { cards, stories, type StoryRow } from "./store.ts"
import { deleteStories } from "./pages.ts"
import { t } from "./i18n.ts"

export const Manager = (props: {
  /** The dialog, for its opener (showModal), as the Sheet hands it out. */
  dialog: (el: HTMLDialogElement) => void
  /** The phone's drawer under the sheet: a delete that moves the reader closes it too. */
  onLeave?: () => void
}) => {
  const lib = read(stories)
  const shelf = read(cards)
  const rows = () => lib()?.stories ?? []
  const [picked, setPicked] = createSignal<ReadonlySet<number>>(new Set())
  let dialog!: HTMLDialogElement
  let confirm!: HTMLDialogElement
  const list = createMemo(() => ranked(rows()))
  const titleOf = (id: string) => shelf().find((c) => c.id === id)?.title ?? id
  const empties = createMemo(() => rows().filter((s) => empty(s) && !s.busy).length)
  const unnameds = createMemo(() => rows().filter((s) => unnamed(s) && !s.busy).length)
  /** The checked rows still there and still idle: a deleted story leaves the set by itself, a busy one cannot go. */
  const chosen = createMemo(() => rows().filter((s) => picked().has(s.id) && !s.busy))
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
            .filter((s) => keep(s) && !s.busy)
            .map((s) => s.id),
        ]),
    )
  /** Shown: the checks start over (the dialog's own toggle event). */
  const reset = () => setPicked(new Set<number>())
  const commit = () => {
    const ids = chosen().map((s) => s.id)
    confirm.close()
    if (!ids.length) return
    const open = lib()?.current
    if (open != null && ids.includes(open)) {
      dialog.close()
      props.onLeave?.()
    }
    void deleteStories(ids)
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
          <span>{t("manager.cleanup")}</span>
          <span class="tag mono">{rows().length}</span>
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
              <button type="button" class="btn xs ghost" onClick={reset}>
                {t("manager.clear")}
              </button>
            </Show>
          </span>
          <button type="button" class="chip danger" disabled={!chosen().length} onClick={() => confirm.showModal()}>
            {t("manager.deleteSelected")}
            {chosen().length ? ` ${chosen().length}` : ""}
          </button>
        </footer>
      }
    >
      <div class="manager">
        <div class="list scroller" role="list">
          <For each={list()} keyed={(s) => s.id}>
            {(s) => (
              <label
                class="card"
                role="listitem"
                aria-current={s().id === lib()?.current ? "true" : undefined}
                data-checked={picked().has(s().id) && !s().busy ? "" : undefined}
                title={s().busy ? t("manager.busyHint") : undefined}
              >
                <input
                  type="checkbox"
                  class="box"
                  aria-label={t("manager.select", { title: s().title ?? t("stories.newStory") })}
                  checked={picked().has(s().id) && !s().busy}
                  disabled={!!s().busy}
                  onChange={() => toggle(s().id)}
                />
                <span class="body">
                  <span class="top">
                    <span class="tag">{titleOf(s().card)}</span>
                    <span class={{ name: true, unnamed: s().title === null }}>
                      {s().title ?? t("stories.newStory")}
                    </span>
                    <Show when={s().busy}>
                      <i class="dot" />
                    </Show>
                  </span>
                  <span class="meta">
                    {s().turns
                      ? t("manager.turnsUpdated", { turns: s().turns, when: ago(s().updated) })
                      : t("manager.noTurns", { when: ago(s().updated) })}
                  </span>
                </span>
              </label>
            )}
          </For>
          <Show when={!list().length}>
            <div class="empty">
              <span>{t("manager.noStories")}</span>
            </div>
          </Show>
        </div>
      </div>
      <dialog class="confirm" ref={(el) => (confirm = el)} closedby="any">
        <p>{t("manager.confirmDelete", { n: chosen().length })}</p>
        <div class="row">
          <button type="button" class="chip state" onClick={() => confirm.close()}>
            {t("common.cancel")}
          </button>
          <button type="button" class="chip danger" onClick={commit}>
            {t("common.delete")}
          </button>
        </div>
      </dialog>
    </Sheet>
  )
}
