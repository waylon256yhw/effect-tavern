// The Writing page (issue #69): the player's writing workbench, in play. One rule puts the player layer's fields here
// and its entities in Settings: Persona, Hat and Provider are library rows with ids, so they get the settings page's
// list and detail; `Player.writing`, `products`, `global`, `forCard`, `snippets` and `format` are fields of one
// document, so they get this page, over the reader like the card page (`page === "writing"`: the reader stays mounted,
// a turn in flight keeps streaming, Escape or Back returns to the line being read). The side panel's Writing chips
// open it. Tabs: the switches and the record products, the prose requirements (the per-card supplement and the
// global ones), the lexicon the polish stage scans, the quick inputs (the format keys and the snippets, each edited
// in a modal). Every edit is one `PUT /player` on change (blur or Enter), as the settings commit; nothing is
// optimistic. switches.ts, requirements.ts, lexicon.ts and inserts.ts hold the pure parts (tested).
import type { Format, Player, Snippet, Writing } from "@effect-tavern/runtime/src/fragment.ts"
import type { Entry } from "@effect-tavern/runtime/src/polish.ts"
import { createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Modal, newId, Switch } from "./controls.tsx"
import { Back, Clue, Close, Export, Import, Snippets as Plus } from "./icons.tsx"
import {
  caretOf,
  defaultsOf,
  draftOfFormat,
  draftOfSnippet,
  emptyDraft,
  formatOf,
  snippetOf,
  type InsertDraft,
} from "./inserts.ts"
import { FILE, mergeLexicon, parseLexicon, serializeLexicon } from "./lexicon.ts"
import { addGlobal, atOf, extraOf, removeGlobal, setGlobalAt, setGlobalText, withExtra } from "./requirements.ts"
import { card, page, player, registry } from "./store.ts"
import { moot, pressing, sentence, SWITCHES, type SwitchKey } from "./switches.ts"
import { fetchCard, putPlayer } from "./wire.ts"
import { type Key, t } from "./i18n.ts"

export const openWriting = () => registry.set(page, "writing")
const close = () => registry.set(page, "reader")

type Tab = "switches" | "prose" | "polish" | "inputs"
const TABS: [Tab, Key][] = [
  ["switches", "writing.tabSwitches"],
  ["prose", "writing.tabProse"],
  ["polish", "writing.tabPolish"],
  ["inputs", "writing.tabInputs"],
]

export const WritingPage = () => {
  const view = read(card)
  const [tab, setTab] = createSignal<Tab>("switches")
  onSettled(() => {
    // a field that prevents it keeps its Escape (a search, a row being typed); so does an open popover or dialog
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (document.querySelector(":popover-open, dialog[open]")) return
      close()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })
  return (
    <div class="inspect wpage">
      <article class="wsheet" aria-label={t("writing.title")}>
        <header class="whead">
          <button type="button" class="icon" aria-label={t("common.backToStory")} onClick={close}>
            <Back />
          </button>
          <h1>{t("writing.title")}</h1>
          <Show when={view()?.title}>{(t) => <span class="tag">{t()}</span>}</Show>
          <span class="spacer" />
          <nav class="wtabs" role="tablist" aria-label={t("writing.sections")}>
            <For each={TABS} keyed={(row) => row[0]}>
              {(row) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === row()[0] ? "true" : "false"}
                  onClick={() => setTab(row()[0])}
                >
                  {t(row()[1])}
                </button>
              )}
            </For>
          </nav>
        </header>
        <div class="wbody">
          <Show when={tab() === "switches"}>
            <Switches />
          </Show>
          <Show when={tab() === "prose"}>
            <Prose />
          </Show>
          <Show when={tab() === "polish"}>
            <Polish />
          </Show>
          <Show when={tab() === "inputs"}>
            <Inputs />
          </Show>
        </div>
      </article>
    </div>
  )
}

/** The player layer's `writing` rewritten by `f`; nothing until the layer has arrived. */
const useWriting = () => {
  const me = read(player)
  const write = (f: (w: Writing) => Writing) => {
    const p = me()
    if (p) void putPlayer({ ...p, writing: f(p.writing ?? {}) })
  }
  return { me, write }
}

// ───────── 开关与记录: the four switches, then the record products ─────────
const BUILTIN_PRODUCTS = new Set(["notes", "options", "inner"])
const Switches = () => {
  const { me, write } = useWriting()
  const view = read(card)
  const w = () => me()?.writing
  const set = (key: SwitchKey, value: string | boolean | undefined) => write((x) => ({ ...x, [key]: value })) // an undefined value leaves the JSON: unset
  const reset = () => write(({ pov: _p, echo: _e, agency: _a, verbosity: _v, ...rest }) => rest)
  const products = () => view()?.products ?? []
  const onOf = (p: { id: string; on: boolean }) => me()?.products?.[p.id] ?? p.on
  /** The toggle back to the declared default leaves the JSON (the player's map holds only what differs). */
  const flip = (prod: { id: string; on: boolean }) => {
    const p = me()
    if (!p) return
    const want = !onOf(prod)
    const { [prod.id]: _, ...rest } = p.products ?? {}
    const next = want === prod.on ? rest : { ...rest, [prod.id]: want }
    void putPlayer({ ...p, products: Object.keys(next).length ? next : undefined })
  }
  const lit = () => products().filter((p) => onOf(p)).length
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("writing.tabSwitches")}>
      <div class="wsec">
        <div class="block-title">
          <h3>{t("writing.switches")}</h3>
          <div class="right">
            <button type="button" class="btn sm ghost" disabled={!me()} onClick={reset}>
              {t("writing.allFollowCard")}
            </button>
          </div>
        </div>
        {/* a switch is a slot: unset, the card's own text holds; a value's title is the sentence it compiles to */}
        <div class="sw-grid">
          <For each={SWITCHES} keyed={(s) => s.key}>
            {(s) => (
              <fieldset class="sw-card" disabled={moot(s().key, w())}>
                <legend>{t(s().label)}</legend>
                <div class="sw-pills">
                  <For each={s().values} keyed={(v) => String(v[0])}>
                    {(v) => (
                      <button
                        type="button"
                        aria-pressed={w()?.[s().key] === v()[0] ? "true" : "false"}
                        title={sentence(s().key, v()[0])}
                        disabled={!me()}
                        onClick={() => set(s().key, pressing(s().key, w(), v()[0]))}
                      >
                        {t(v()[1])}
                      </button>
                    )}
                  </For>
                </div>
              </fieldset>
            )}
          </For>
        </div>
      </div>
      {/* the record products: the harness's and the card's, by shown name; notes is the chronicle every fold reads
          and stays on; the rest are the player's toggles over the declared default */}
      <div class="wsec grow">
        <div class="block-title">
          <h3>{t("writing.products")}</h3>
          <div class="right">
            <span class="tag mono">
              {lit()} / {products().length}
            </span>
          </div>
        </div>
        <div class="prod-grid scroller fade">
          <For each={products()} keyed={(p) => p.id}>
            {(p) => (
              <div class="prod-item">
                <span class={{ pname: true, pid: !p().label }}>{p().label ?? p().id}</span>
                <Show when={!BUILTIN_PRODUCTS.has(p().id) && view()?.title}>
                  {(t) => <span class="tag">{t()}</span>}
                </Show>
                <Show when={p().id !== "notes"} fallback={<span class="tag">{t("writing.alwaysOn")}</span>}>
                  <Switch on={onOf(p())} label={p().label ?? p().id} onFlip={() => flip(p())} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  )
}

// ───────── 文风与要求: the per-card supplement and the global requirements ─────────
/** Escape leaves a textarea and keeps the page (the change fires on blur); Enter is a line break. */
const leaveArea = (e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
  if (e.key !== "Escape") return
  e.preventDefault()
  e.currentTarget.blur()
}
const Prose = () => {
  const me = read(player)
  const view = read(card)
  const cardId = () => view()?.id ?? ""
  const title = () => view()?.title ?? ""
  const extra = () => (me() ? extraOf(me()!, cardId()) : "")
  const globals = () => me()?.global ?? []
  const put = (f: (p: Player) => Player) => {
    const p = me()
    if (p) void putPlayer(f(p))
  }
  // a new requirement: a row at the top of the list, kept here until it is left with text (then it is the player's)
  const [draft, setDraft] = createSignal<string | null>(null)
  const commitDraft = () => {
    const d = draft()
    if (d === null) return
    setDraft(null)
    put((p) => addGlobal(p, newId("req"), d, "tail"))
  }
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("writing.tabProse")}>
      <div class="prose-grid">
        {/* this card's supplement: one text, in the tail of every narrate request on this card and no other */}
        <div class="prose-card mine">
          <div class="block-title">
            <h3>{t("switches.cardExtra")}</h3>
            <Show when={title()}>{(t) => <span class="tag">{t()}</span>}</Show>
            <div class="right">
              <span class="tag mono">{t("common.chars", { n: extra().length })}</span>
            </div>
          </div>
          <div class="field-well grow">
            <textarea
              aria-label={t("switches.cardExtra")}
              placeholder={t("writing.extraPlaceholder", { card: title() })}
              disabled={!me()}
              value={extra()}
              onChange={(e) => put((p) => withExtra(p, cardId(), e.currentTarget.value))}
              onKeyDown={leaveArea}
            />
          </div>
        </div>
        {/* the global requirements: every card, each at the head (before the card's frame) or the tail */}
        <div class="prose-card">
          <div class="block-title">
            <h3>{t("writing.global")}</h3>
            <span class="tag">{t("writing.allCards")}</span>
            <div class="right">
              <button type="button" class="btn sm" disabled={!me() || draft() !== null} onClick={() => setDraft("")}>
                <Plus /> <span>{t("writing.addRequirement")}</span>
              </button>
            </div>
          </div>
          <div class="frag-list">
            <Show when={draft() !== null}>
              <div
                class="frag-row"
                onFocusOut={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitDraft()
                }}
              >
                <div class="frag-bar">
                  <div class="at-toggle" role="group" aria-label={t("writing.position")}>
                    <button type="button" aria-pressed="true" tabindex="-1">
                      {t("writing.atTail")}
                    </button>
                    <button type="button" aria-pressed="false" disabled>
                      {t("writing.atHead")}
                    </button>
                  </div>
                  <span class="spacer" />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.discard")}
                    onClick={() => setDraft(null)}
                  >
                    <Close />
                  </button>
                </div>
                <div class="field-well">
                  <textarea
                    aria-label={t("writing.requirement")}
                    placeholder={t("writing.globalPlaceholder")}
                    value={draft() ?? ""}
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={leaveArea}
                  />
                </div>
              </div>
            </Show>
            <For each={globals()} keyed={false}>
              {(f, i) => (
                <div class="frag-row">
                  <div class="frag-bar">
                    <div class="at-toggle" role="group" aria-label={t("writing.position")}>
                      <button
                        type="button"
                        aria-pressed={atOf(f()) === "tail" ? "true" : "false"}
                        onClick={() => put((p) => setGlobalAt(p, i, "tail"))}
                      >
                        {t("writing.atTail")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={atOf(f()) === "head" ? "true" : "false"}
                        onClick={() => put((p) => setGlobalAt(p, i, "head"))}
                      >
                        {t("writing.atHead")}
                      </button>
                    </div>
                    <span class="spacer" />
                    <span class="tag mono">{t("common.chars", { n: (f().text ?? "").length })}</span>
                    <button
                      type="button"
                      class="icon sm"
                      aria-label={t("writing.removeRequirement")}
                      onClick={() => put((p) => removeGlobal(p, i))}
                    >
                      <Close />
                    </button>
                  </div>
                  <div class="field-well">
                    <textarea
                      aria-label={t("writing.requirement")}
                      placeholder={t("writing.emptyRemoves")}
                      value={f().text ?? ""}
                      onChange={(e) => put((p) => setGlobalText(p, i, e.currentTarget.value))}
                      onKeyDown={leaveArea}
                    />
                  </div>
                </div>
              )}
            </For>
            <Show when={!globals().length && draft() === null}>
              <p class="none">{t("writing.noGlobal")}</p>
            </Show>
          </div>
        </div>
      </div>
    </section>
  )
}

// ───────── 润色与禁词: the polish switch and the lexicon it scans by ─────────
const clean = (e: { pattern: string; hint?: string }): Entry =>
  e.hint?.trim() ? { pattern: e.pattern.trim(), hint: e.hint.trim() } : { pattern: e.pattern.trim() }
/** Enter commits (the change fires on blur); Escape leaves the field and keeps the page (the page's Escape defers). */
const leave = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
  if (e.isComposing || (e.key !== "Enter" && e.key !== "Escape")) return
  e.preventDefault()
  e.currentTarget.blur()
}

const Polish = () => {
  const { me, write } = useWriting()
  const lex = (): readonly Entry[] => me()?.writing?.lexicon ?? []
  const on = () => me()?.writing?.polish !== false
  const setLex = (entries: readonly Entry[]) =>
    write(({ lexicon: _lexicon, ...w }) => (entries.length ? { ...w, lexicon: entries } : w))
  const flip = () => write(({ polish: _polish, ...w }) => (on() ? { ...w, polish: false } : w)) // on is the default: unset
  const edit = (i: number, patch: Partial<Entry>) => {
    const next = lex().map((e, j) => (j === i ? clean({ ...e, ...patch }) : e))
    setLex(next.filter((e) => e.pattern)) // a pattern cleared is the row removed
  }
  const remove = (i: number) => setLex(lex().filter((_, j) => j !== i))
  // the search: a glass that opens to a field in the title row, filtering by pattern or hint
  const [q, setQ] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const shown = () => {
    const s = q().trim()
    return lex()
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !s || e.pattern.includes(s) || (e.hint ?? "").includes(s))
  }
  // a new entry: a row at the top of the list, kept here until it is left with a pattern (then it is the player's)
  const [draft, setDraft] = createSignal<{ pattern: string; hint: string } | null>(null)
  const commitDraft = () => {
    const d = draft()
    if (!d) return
    setDraft(null)
    if (d.pattern.trim()) setLex([clean(d), ...lex()])
  }
  // the file: 导入 adds a file's entries after the player's, 导出 downloads the list (lexicon.ts)
  let file!: HTMLInputElement
  const [notice, setNotice] = createSignal<string | null>(null)
  const onFile = async (f: File) => {
    const r = parseLexicon(await f.text())
    if ("error" in r) return setNotice(r.error)
    const merged = mergeLexicon(lex(), r.entries)
    setNotice(t("writing.importN", { n: merged.length - lex().length }))
    setLex(merged)
  }
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([serializeLexicon(lex())], { type: "application/json" }))
    const a = Object.assign(document.createElement("a"), { href: url, download: FILE })
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("writing.tabPolish")}>
      <div class="block-title lex-title">
        <h3>{t("writing.lexicon")}</h3>
        <span class="tag mono">{t("common.entries", { n: lex().length })}</span>
        <label class="inline-search" data-open={searching() || !!q() ? "true" : "false"}>
          <Clue aria-hidden="true" />
          <input
            type="search"
            placeholder={t("writing.searchEntries")}
            aria-label={t("writing.searchEntriesLabel")}
            value={q()}
            onFocus={() => setSearching(true)}
            onBlur={() => setSearching(false)}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return
              e.preventDefault() // the search's Escape: the page stays
              setQ("")
              e.currentTarget.blur()
            }}
          />
        </label>
        <div class="right">
          <Show when={notice()}>{(n) => <span class="tag">{n()}</span>}</Show>
          <button type="button" class="btn sm ghost" disabled={!me()} onClick={() => file.click()}>
            <Import /> <span>{t("writing.import")}</span>
          </button>
          <button type="button" class="btn sm ghost" disabled={!lex().length} onClick={exportFile}>
            <Export /> <span>{t("common.export")}</span>
          </button>
          <button
            type="button"
            class="btn sm"
            disabled={!me() || !!draft()}
            onClick={() => (setNotice(null), setDraft({ pattern: "", hint: "" }))}
          >
            <Plus /> <span>{t("writing.addEntry")}</span>
          </button>
          <label class="polish-switch">
            <span>{t("writing.polish")}</span>
            <Switch on={on()} label={t("writing.polish")} onFlip={flip} />
          </label>
        </div>
      </div>
      <input
        type="file"
        accept=".json,application/json"
        hidden
        ref={(el) => (file = el)}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          e.currentTarget.value = "" // the same file again is a new pick
          if (f) void onFile(f)
        }}
      />
      {/* the list dims while polish is off: the entries stay, nothing scans */}
      <Show
        when={lex().length || draft()}
        fallback={
          <div class="lex-empty">
            <div class="empty-card">
              <p>{t("writing.lexiconEmpty")}</p>
              <button type="button" class="btn" disabled={!me()} onClick={() => file.click()}>
                <Import /> <span>{t("writing.importFile")}</span>
              </button>
            </div>
          </div>
        }
      >
        <div class="lex-wrap" data-off={on() ? "false" : "true"}>
          <div class="lex-head">
            <span>{t("writing.patternHead")}</span>
            <span>{t("writing.hint")}</span>
            <span />
          </div>
          <div class="lex-list scroller fade">
            <Show when={draft()}>
              {(d) => (
                <div
                  class="lex-row"
                  onFocusOut={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitDraft()
                  }}
                >
                  <input
                    class="field"
                    placeholder={t("writing.patternPlaceholder")}
                    aria-label={t("writing.pattern")}
                    value={d().pattern}
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    onInput={(e) => setDraft({ ...d(), pattern: e.currentTarget.value })}
                    onKeyDown={leave}
                  />
                  <input
                    class="field"
                    placeholder={t("writing.hintPlaceholder")}
                    aria-label={t("writing.hint")}
                    value={d().hint}
                    onInput={(e) => setDraft({ ...d(), hint: e.currentTarget.value })}
                    onKeyDown={leave}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.discard")}
                    onClick={() => setDraft(null)}
                  >
                    <Close />
                  </button>
                </div>
              )}
            </Show>
            <For each={shown()} keyed={(x) => x.i}>
              {(x) => (
                <div class="lex-row">
                  <input
                    class="field"
                    aria-label={t("writing.pattern")}
                    value={x().e.pattern}
                    onChange={(e) => edit(x().i, { pattern: e.currentTarget.value })}
                    onKeyDown={leave}
                  />
                  <input
                    class="field"
                    placeholder={t("writing.hintPlaceholder")}
                    aria-label={t("writing.hint")}
                    value={x().e.hint ?? ""}
                    onChange={(e) => edit(x().i, { hint: e.currentTarget.value })}
                    onKeyDown={leave}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.deleteEntry")}
                    onClick={() => remove(x().i)}
                  >
                    <Close />
                  </button>
                </div>
              )}
            </For>
            <Show when={q().trim() && !shown().length}>
              <p class="none">{t("writing.noEntries")}</p>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  )
}

// ───────── 快捷输入: the format keys and the snippets, the player's own before the harness defaults ─────────
const placed = <T,>(l: readonly T[], x: T, at: number): T[] =>
  at < 0 ? [x, ...l] : l.map((y, i) => (i === at ? x : y))
/** What is being edited: which list, which row (-1 a new one), and the editor's draft. */
interface Editing {
  snippet: boolean
  at: number
  draft: InsertDraft
}
const Inputs = () => {
  const me = read(player)
  const view = read(card)
  const keys = () => me()?.format ?? []
  const snips = () => me()?.snippets ?? []
  // the harness defaults, as the composer shows them after the player's: listed, not edited
  const keyDefaults = () => defaultsOf(view()?.format ?? [], keys(), (k) => `${k.label}\0${k.text}`)
  const snipDefaults = () => defaultsOf(view()?.snippets ?? [], snips(), (s) => s.name)
  // the composer reads the card view's merged lists: a write to the player's is followed by a read of the view
  const put = async (p: Player) => {
    await putPlayer(p)
    await fetchCard()
  }
  const setKeys = (list: readonly Format[]) => {
    const { format: _format, ...p } = me() ?? { global: [], forCard: {} }
    if (me()) void put(list.length ? { ...p, format: list } : p)
  }
  const setSnips = (list: readonly Snippet[]) => {
    const { snippets: _snippets, ...p } = me() ?? { global: [], forCard: {} }
    if (me()) void put(list.length ? { ...p, snippets: list } : p)
  }
  // the editor: one modal for both kinds, over the page
  const [editing, setEditing] = createSignal<Editing | null>(null)
  let dlg!: HTMLDialogElement
  const open = (e: Editing) => (setEditing(e), dlg.showModal())
  const patch = (f: Partial<InsertDraft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...f } } : e))
  const made = () => {
    const e = editing()
    return e ? (e.snippet ? snippetOf(e.draft) : formatOf(e.draft)) : undefined
  }
  const save = () => {
    const e = editing()
    const v = made()
    if (!e || !v) return
    // a new one goes first, at hand in the menu; an edit replaces its row
    if (e.snippet) setSnips(placed(snips(), v as Snippet, e.at))
    else setKeys(placed(keys(), v as Format, e.at))
    dlg.close()
  }
  const remove = () => {
    const e = editing()
    if (!e || e.at < 0) return
    if (e.snippet) setSnips(snips().filter((_, i) => i !== e.at))
    else setKeys(keys().filter((_, i) => i !== e.at))
    dlg.close()
  }
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("writing.tabInputs")}>
      {/* the keys: a row of glyphs over the box; the player's are buttons into the editor, the defaults after them */}
      <div class="input-card">
        <div class="block-title">
          <h3>{t("writing.formatKeys")}</h3>
          <span class="tag mono">{t("writing.keysN", { n: keys().length })}</span>
          <div class="right">
            <button
              type="button"
              class="btn sm"
              disabled={!me()}
              onClick={() => open({ snippet: false, at: -1, draft: emptyDraft(false) })}
            >
              <Plus /> <span>{t("writing.addKey")}</span>
            </button>
          </div>
        </div>
        <div class="fmt-chips">
          <For each={keys()} keyed={false}>
            {(k, i) => (
              <button
                type="button"
                class="fmt-btn"
                title={caretOf(k())}
                onClick={() => open({ snippet: false, at: i, draft: draftOfFormat(k()) })}
              >
                <span class="glyph">{k().label}</span>
                <span class="mode">{k().after !== undefined ? t("writing.caretMiddle") : t("writing.caretEnd")}</span>
              </button>
            )}
          </For>
          <For each={keyDefaults()} keyed={(k) => k.label}>
            {(k) => (
              <span class="fmt-btn builtin" title={t("writing.builtinOf", { glyph: caretOf(k()) })}>
                <span class="glyph">{k().label}</span>
                <span class="mode">{t("writing.builtin")}</span>
              </span>
            )}
          </For>
        </div>
      </div>
      {/* the snippets: the + menu's rows; a note one is a word to the narrator, the rest stay in the story */}
      <div class="input-card grow">
        <div class="block-title">
          <h3>{t("writing.snippets")}</h3>
          <span class="tag mono">{t("common.entries", { n: snips().length })}</span>
          <div class="right">
            <button
              type="button"
              class="btn sm"
              disabled={!me()}
              onClick={() => open({ snippet: true, at: -1, draft: emptyDraft(true) })}
            >
              <Plus /> <span>{t("writing.addSnippet")}</span>
            </button>
          </div>
        </div>
        <div class="snip-list scroller fade">
          <For each={snips()} keyed={false}>
            {(s, i) => (
              <button
                type="button"
                class="snip-row"
                onClick={() => open({ snippet: true, at: i, draft: draftOfSnippet(s()) })}
              >
                <span class="snip-cell sname">{s().name}</span>
                <span class="snip-cell stext mono">{caretOf(s()) || "—"}</span>
                <span class="snip-cell shint">
                  <span>{s().hint}</span>
                  <span class="tag">{s().note ? t("writing.toNarrator") : t("writing.inStory")}</span>
                </span>
              </button>
            )}
          </For>
          <For each={snipDefaults()} keyed={(s) => s.name}>
            {(s) => (
              <div class="snip-row builtin">
                <span class="snip-cell sname">{s().name}</span>
                <span class="snip-cell stext mono">{caretOf(s()) || "—"}</span>
                <span class="snip-cell shint">
                  <span>{s().hint}</span>
                  <span class="tag">{t("writing.builtin")}</span>
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
      <Modal
        title={
          editing()?.at === -1
            ? editing()?.snippet
              ? t("writing.newSnippet")
              : t("writing.newKey")
            : editing()?.snippet
              ? t("writing.editSnippet")
              : t("writing.editKey")
        }
        narrow
        dialog={(el) => (dlg = el)}
        onClose={() => setEditing(null)}
      >
        <Show when={editing()}>
          {(e) => (
            <>
              <div class="modal-body">
                <label class="mfield">
                  <span>{e().snippet ? t("writing.name") : t("writing.displayName")}</span>
                  <input
                    class="field"
                    placeholder={e().snippet ? t("writing.menuName") : t("writing.blankShowsGlyph")}
                    value={e().draft.label}
                    onInput={(ev) => patch({ label: ev.currentTarget.value })}
                  />
                </label>
                <Show when={e().snippet}>
                  <label class="mfield">
                    <span>{t("writing.description")}</span>
                    <input
                      class="field"
                      placeholder={t("writing.descriptionPlaceholder")}
                      value={e().draft.hint}
                      onInput={(ev) => patch({ hint: ev.currentTarget.value })}
                    />
                  </label>
                  <div class="mfield">
                    <span>{t("writing.channel")}</span>
                    <div class="at-toggle" role="group" aria-label={t("writing.channelLabel")}>
                      <button
                        type="button"
                        aria-pressed={!e().draft.note ? "true" : "false"}
                        onClick={() => patch({ note: false })}
                      >
                        {t("writing.inStory")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={e().draft.note ? "true" : "false"}
                        onClick={() => patch({ note: true })}
                      >
                        {t("writing.toNarrator")}
                      </button>
                    </div>
                  </div>
                </Show>
                <div class="mfield">
                  <span>{t("writing.caret")}</span>
                  <div class="at-toggle" role="group" aria-label={t("writing.caretLabel")}>
                    <button
                      type="button"
                      aria-pressed={e().draft.between ? "true" : "false"}
                      onClick={() => patch({ between: true })}
                    >
                      {t("writing.caretInside")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={!e().draft.between ? "true" : "false"}
                      onClick={() => patch({ between: false })}
                    >
                      {t("writing.caretAfter")}
                    </button>
                  </div>
                </div>
                <div class="mpair">
                  <label class="mfield">
                    <span>{e().draft.between ? t("writing.beforeCaret") : t("writing.insertText")}</span>
                    <input
                      class="field mono"
                      placeholder={e().draft.between ? t("writing.exampleOpenQuote") : t("writing.exampleEllipsis")}
                      value={e().draft.text}
                      onInput={(ev) => patch({ text: ev.currentTarget.value })}
                    />
                  </label>
                  <Show when={e().draft.between}>
                    <label class="mfield">
                      <span>{t("writing.afterCaret")}</span>
                      <input
                        class="field mono"
                        placeholder={t("writing.exampleCloseQuote")}
                        value={e().draft.after}
                        onInput={(ev) => patch({ after: ev.currentTarget.value })}
                      />
                    </label>
                  </Show>
                </div>
              </div>
              <div class="modal-foot">
                <Show when={e().at >= 0}>
                  <button type="button" class="btn sm ghost danger" onClick={remove}>
                    {t("common.delete")}
                  </button>
                </Show>
                <span class="spacer" />
                <button type="button" class="btn sm ghost" onClick={() => dlg.close()}>
                  {t("common.cancel")}
                </button>
                <button type="button" class="btn sm primary" disabled={!made()} onClick={save}>
                  {t("common.save")}
                </button>
              </div>
            </>
          )}
        </Show>
      </Modal>
    </section>
  )
}
