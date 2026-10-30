// The dialogs the library needs, mounted once by the shell and opened from anywhere (#117): a story's rename, the
// delete confirm (one story, or the manager's checked set), the export's two formats, the card's story manager
// (manager.tsx) and the persona picker. The sidebar's rows carry none of these (a row only switches the story); the
// manager's cards and the workspace's persona row call them. Each opener is a module function like `openSettings`, bound to
// its dialog when the component mounts; before that it does nothing.
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { roam } from "./controls.tsx"
import { Check, Clue, Jump, Snippets } from "./icons.tsx"
import { Manager } from "./manager.tsx"
import { Sheet } from "./readings.tsx"
import { openSettings } from "./settings.tsx"
import { deleteStories, deleteStory, openStory } from "./pages.ts"
import { focus, personas, player, stories, type StoryRow } from "./store.ts"
import { exportUrl, nameStory, putPlayer } from "./wire.ts"
import { t } from "./i18n.ts"

const bound = {
  manager: () => {},
  picker: () => {},
  rename: (_s: StoryRow) => {},
  del: (_rows: readonly StoryRow[]) => {},
  exp: (_s: StoryRow) => {},
}
/** This card's stories: every one with its star, the search, the cleanup and the exports. */
export const openManager = (): void => bound.manager()
/** The persona in force on this card, picked from the player's. */
export const openPicker = (): void => bound.picker()
export const openRename = (s: StoryRow): void => bound.rename(s)
export const openDelete = (rows: readonly StoryRow[]): void => bound.del(rows)
export const openExport = (s: StoryRow): void => bound.exp(s)

export const StoryDialogs = () => {
  const lib = read(stories)
  const people = read(personas)
  const me = read(player)
  const cardId = read(focus)
  // the persona in force on the focused card, and the pick: a change of the player's own layer, nothing of the story's
  const current = () => people().find((p) => p.id === me()?.persona?.[cardId() ?? ""])
  // the picker: the search over name and text, the rows it leaves; opened from the workspace's row, closed by a pick
  const [q, setQ] = createSignal("")
  const hits = createMemo(() => {
    const t = q().trim().toLowerCase()
    return t ? people().filter((p) => p.name.toLowerCase().includes(t) || p.text.toLowerCase().includes(t)) : people()
  })
  /** The card's own row stays while the search is empty or names it; the rule under it only when rows follow. */
  const showDefault = () => !q().trim() || t("side.cardDefault").includes(q().trim())
  let picker!: HTMLDialogElement
  let search!: HTMLInputElement
  bound.picker = () => {
    setQ("")
    search.value = ""
    picker.showModal()
    search.focus()
  }
  /** The settings page's personas: the picker closes (a page is a leave). */
  const manage = () => {
    picker.close()
    openSettings("personas")
  }
  const pick = (id: string | undefined) => {
    const p = me()
    const c = cardId()
    if (!p || c === null) return
    const { [c]: _, ...rest } = p.persona ?? {}
    const next = id === undefined ? rest : { ...rest, [c]: id }
    void putPlayer({ ...p, persona: Object.keys(next).length ? next : undefined }) // an empty map leaves the JSON like any unset key
  }
  // the rename dialog: the confirm's shape with a field; Enter or Save names it, blank clears the name back to
  // "New story", Escape or Cancel keeps it
  const [renaming, setRenaming] = createSignal<StoryRow | null>(null)
  let confirm!: HTMLDialogElement
  let rename!: HTMLDialogElement
  let name!: HTMLInputElement
  bound.rename = (s) => {
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
  // the delete confirm: the one story a trash names, or the manager's checked set; its own list, so a cancel leaves
  // the checks as they were. One is the single call, several the batch, and the reader only moves when the open
  // story went
  const [doomed, setDoomed] = createSignal<readonly StoryRow[]>([])
  bound.del = (rows) => {
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
  bound.exp = (s) => {
    setExporting(s)
    exportDialog.showModal()
  }
  // the manager: this card's stories; a card opens its story and closes the sheet
  let manager!: HTMLDialogElement
  bound.manager = () => manager.showModal()
  const openFromManager = (s: StoryRow) => {
    manager.close()
    if (s.id !== lib()?.current) void openStory(s.id)
  }
  return (
    <>
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
      {/* the manager: a sheet, every story of this card with its star, the search, the cleanup */}
      <Manager
        dialog={(el) => (manager = el)}
        onOpen={openFromManager}
        onRename={(s) => bound.rename(s)}
        onDelete={(rows) => bound.del(rows)}
        onExport={(s) => bound.exp(s)}
      />
      {/* the picker: a search over the player's personas and two-line rows, the card's own first; made and edited on
        the settings page */}
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
