// The dialogs the library needs, mounted once by the shell and opened from anywhere (#117): a story's rename, the
// delete confirm (one story, or the manager's checked set), the export's two formats, the card's story manager
// (manager.tsx), the persona picker and the tag manager (#133: every word of `Player.tags` with its card count, an
// inline rename and a delete, each one PUT /player). The sidebar's rows carry none of these (a row only switches the
// story); the manager's cards and the workspace's persona and tag rows call them. Each opener is a module function like
// `openSettings`, bound to its dialog when the component mounts; before that it does nothing.
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { roam } from "./controls.tsx"
import { Check, Close, Clue, Jump } from "./icons.tsx"
import { Manager } from "./manager.tsx"
import { dropTag, renameTag, tagCounts, tagsOfLocals, withTags } from "./query.ts"
import { Sheet } from "./readings.tsx"
import { openSettings } from "./settings.tsx"
import { deleteStories, deleteStory, openStory } from "./pages.ts"
import { focus, locals, log, page, personas, stories, type StoryRow } from "./store.ts"
import { openOn, personaOn } from "./stories.ts"
import { exportUrl, nameStory, pickStoryPersona, putLocal } from "./wire.ts"
import { t } from "./i18n.ts"

const bound = {
  manager: () => {},
  picker: () => {},
  rename: (_s: StoryRow) => {},
  del: (_rows: readonly StoryRow[]) => {},
  exp: (_s: StoryRow) => {},
  tags: () => {},
}
/** This card's stories: every one with its star, the search, the cleanup and the exports. */
export const openManager = (): void => bound.manager()
/** The persona in force (the open story's, else the card's default), picked from the player's. */
export const openPicker = (): void => bound.picker()
export const openRename = (s: StoryRow): void => bound.rename(s)
export const openDelete = (rows: readonly StoryRow[]): void => bound.del(rows)
export const openExport = (s: StoryRow): void => bound.exp(s)
/** Every word the player files cards under: its count, a rename, a delete. */
export const openTagManager = (): void => bound.tags()

export const StoryDialogs = () => {
  const lib = read(stories)
  const people = read(personas)
  const allLocals = read(locals)
  const cardId = read(focus)
  const pg = read(page)
  const nodes = read(log)
  // the persona in force: the open story's when it is of the focused card, and the pick writes that story alone; on
  // the card's page or with none open there, the card's default (`Local.persona`), which a new story of the card
  // starts on
  const current = () => people().find((p) => p.id === personaOn(lib(), allLocals(), cardId(), pg()))
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
    const c = cardId()
    if (c === null) return
    const s = openOn(lib(), c, pg())
    if (s) return void pickStoryPersona(s.id, id ?? null)
    // the card's page: Begin lands in the open story when it is empty and of this card (card.tsx `fresh`), so that one
    // takes the new default too
    const kept = openOn(lib(), c, "reader")
    if (kept && nodes().nodes.size === 0) void pickStoryPersona(kept.id, id ?? null)
    void putLocal(c, ({ persona: _p, ...rest }) => (id === undefined ? rest : { ...rest, persona: id }))
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
  // the tag manager: one fixed order (most cards, then the word); a click on a word edits it in place, Enter renames it
  // on every card, Escape or a blur keeps it; × drops it from every card (no confirm: one PUT, the word can be retyped)
  let tagman!: HTMLDialogElement
  const allTags = createMemo(() => tagsOfLocals(allLocals()))
  const counts = createMemo(() => tagCounts(allTags()))
  const [editing, setEditing] = createSignal<string | null>(null)
  bound.tags = () => {
    setEditing(null)
    tagman.showModal()
  }
  const applyRenameTag = (from: string, to: string) => {
    const cur = allTags()
    const next = renameTag(cur, from, to)
    for (const c of Object.keys(cur))
      if (cur[c]?.includes(from)) void putLocal(c, (l) => withTags(l, () => next?.[c] ?? []))
  }
  const applyDropTag = (word: string) => {
    const cur = allTags()
    const next = dropTag(cur, word)
    for (const c of Object.keys(cur))
      if (cur[c]?.includes(word)) void putLocal(c, (l) => withTags(l, () => next?.[c] ?? []))
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
      <Sheet dialog={(el) => (tagman = el)} heading={<span>{t("tags.manage")}</span>}>
        <div class="manager tagman">
          <Show
            when={counts().length}
            fallback={
              <div class="empty">
                <span>{t("tags.empty")}</span>
              </div>
            }
          >
            <div class="tagman-chips scroller" role="list">
              <For each={counts()} keyed={([w]) => w}>
                {(row) => (
                  <span class="chip" role="listitem">
                    <Show
                      when={editing() === row()[0]}
                      fallback={
                        <button
                          type="button"
                          class="word"
                          aria-label={`${row()[0]} · ${t("tags.rename")}`}
                          onClick={() => setEditing(row()[0])}
                        >
                          {row()[0]}
                        </button>
                      }
                    >
                      <input
                        class="field"
                        value={row()[0]}
                        size={Math.max(row()[0].length + 2, 4)}
                        aria-label={t("tags.rename")}
                        ref={(el) => queueMicrotask(() => el.select())}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.isComposing || e.keyCode === 229) return // an IME's confirming key is not a commit
                          if (e.key === "Escape") {
                            e.preventDefault() // the field's Escape, not the dialog's
                            e.stopPropagation()
                            setEditing(null)
                          } else if (e.key === "Enter") {
                            e.preventDefault()
                            const from = row()[0]
                            const to = e.currentTarget.value
                            setEditing(null)
                            if (to.trim() && to.trim() !== from) applyRenameTag(from, to)
                          }
                        }}
                      />
                    </Show>
                    <span class="count" title={t("tags.cards", { n: row()[1] })}>
                      {row()[1]}
                    </span>
                    <button
                      type="button"
                      class="del"
                      aria-label={`${row()[0]} · ${t("common.delete")}`}
                      onClick={() => applyDropTag(row()[0])}
                    >
                      <Close aria-hidden="true" />
                    </button>
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Sheet>
      {/* the picker: a search over the player's personas and their rows, the card's own first; made and edited on
        the settings page */}
      <Sheet
        dialog={(el) => (picker = el)}
        heading={
          <>
            <span>{t("side.pickPersona")}</span>
            <button type="button" class="btn sm ghost" onClick={manage}>
              <span>{t("side.managePersonas")}</span>
              <Jump aria-hidden="true" />
            </button>
          </>
        }
      >
        <div class="picker">
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
          <div class="list scroller" role="menu" onKeyDown={roam}>
            <Show when={showDefault()}>
              <button
                type="button"
                role="menuitemradio"
                class="item"
                aria-checked={current() ? "false" : "true"}
                onClick={() => (picker.close(), pick(undefined))}
              >
                <span class="name">{t("side.cardDefault")}</span>
                <Check class="check" aria-hidden="true" />
              </button>
            </Show>
            <For each={hits()} keyed={(p) => p.id}>
              {(p) => {
                const bio = () => p().text.split("\n")[0]?.trim() ?? ""
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    class="item"
                    aria-checked={p().id === current()?.id ? "true" : "false"}
                    onClick={() => (picker.close(), pick(p().id))}
                  >
                    <span class="name">{p().name}</span>
                    <Check class="check" aria-hidden="true" />
                    <Show when={bio()}>{(b) => <span class="bio">{b()}</span>}</Show>
                  </button>
                )
              }}
            </For>
            <Show when={q().trim() && !hits().length && !showDefault()}>
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
