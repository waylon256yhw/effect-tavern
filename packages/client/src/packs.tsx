// Settings → 写作包 (docs/packs-brief.md §九 §7, §十): `[harness, ...packs]` share one row shape (`Layer`) and one
// 6-tab full-height workbench (文风与要求, 线索词条, 润色禁词, 记录与小剧场, 快捷输入, 问法). `harness` is marked 内置 and
// cannot be deleted. Every edit is one `PUT /packs/<id>` and a re-read of the active card.
import { SLOTS, type Format, type Fragment, type Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import { harness, type Ask, type Layer, type PackEntry } from "@effect-tavern/runtime/src/layer.ts"
import { hook } from "@effect-tavern/runtime/src/lore.ts"
import type { Entry } from "@effect-tavern/runtime/src/polish.ts"
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { ask, Modal, Name, newId, Switch, ToList, type Pane, dialogHandle } from "./controls.tsx"
import { Clue, Close, Export, Import, Snippets as Plus, Trash } from "./icons.tsx"
import { caretOf, draftOfFormat, draftOfSnippet, emptyDraft, formatOf, snippetOf, type InsertDraft } from "./inserts.ts"
import { FILE, mergeLexicon, parseLexicon, serializeLexicon } from "./lexicon.ts"
import {
  isReservedPack,
  packHoles,
  serializePack,
  withoutProductPatch,
  withPackName,
  withProductPatch,
} from "./pack.ts"
import { addFragment, atOf, removeFragment, setFragmentAt, setFragmentText } from "./requirements.ts"
import { cards, locals, packs } from "./store.ts"
import { SWITCHES } from "./switches.ts"
import { type Key, t } from "./i18n.ts"
import { deletePack, putPack, refreshActiveCard } from "./wire.ts"

type PackTab = "prose" | "entries" | "lexicon" | "products" | "inputs" | "asks"
const PACK_TABS: [PackTab, Key][] = [
  ["prose", "writing.tabProse"],
  ["entries", "packs.entries"],
  ["lexicon", "packs.lexicon"],
  ["products", "packs.tabProducts"],
  ["inputs", "writing.tabInputs"],
  ["asks", "packs.tabAsks"],
]

const CODE_HARNESS = harness("act")
const DEFAULT_ASKS = new Map((CODE_HARNESS.asks ?? []).map((a) => [a.id, a.text]))
const DEFAULT_PRODUCTS = new Map((CODE_HARNESS.products ?? []).map((p) => [p.id, p]))
const DEFAULT_SNIPPETS = new Map((CODE_HARNESS.snippets ?? []).map((s) => [s.name, s]))
const DEFAULT_FORMAT = new Map((CODE_HARNESS.format ?? []).map((f) => [f.label, f]))
/** Whether a harness-row item is its code default (the overlay stores only what differs; `overlaid` merges over the default). */
const isDefault = (item: unknown, def: unknown) => JSON.stringify(item) === JSON.stringify(def)
type Save = (edit: (p: Layer) => Layer) => Promise<void>

const stageAskLabels = (): [string, string][] => [
  ["stage.role", t("packs.askStageRole")],
  ["lookup", t("settings.stageLookup")],
  ["direct", t("settings.stageDirect")],
  ["decide.first", t("packs.askDecideFirst")],
  ["decide.again", t("packs.askDecideAgain")],
  ["check", t("settings.stageCheck")],
  ["polish", t("settings.stagePolish")],
  ["record.tools", t("packs.askRecordTools")],
  ["record.readout", t("packs.askRecordReadout")],
  ["narrate.role", t("packs.askNarrateRole")],
  ["narrate.turn", t("packs.askNarrateTurn")],
  ["narrate.correction", t("packs.askNarrateCorrection")],
  ["narrate.blocks", t("packs.askNarrateBlocks")],
  ["narrate.demand", t("packs.askNarrateDemand")],
  ["input.thought", t("packs.askInputThought")],
]

const leaveArea = (e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
  if (e.key !== "Escape") return
  e.preventDefault()
  e.currentTarget.blur()
}
const leaveInput = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
  if (e.isComposing || (e.key !== "Enter" && e.key !== "Escape")) return
  e.preventDefault()
  e.currentTarget.blur()
}

export const Packs = (props: Pane) => {
  const list = read(packs)
  const allLocals = read(locals)
  const known = read(cards)
  const pack = () => list().find((p) => p.id === props.picked) ?? list()[0]
  const [tab, setTab] = createSignal<PackTab>("prose")
  let fileInput!: HTMLInputElement

  /** Each pack's mounted cards by title, derived from `locals[cardId].mounts`. */
  const mounts = createMemo(() => {
    const by = new Map<string, string[]>()
    for (const [cid, loc] of Object.entries(allLocals())) {
      const title = known().find((x) => x.id === cid)?.title ?? cid
      for (const pid of loc.mounts ?? []) by.set(pid, [...(by.get(pid) ?? []), title])
    }
    return by
  })
  const onCards = (id: string) => mounts().get(id) ?? []

  const savePack = async (id: string, edit: (p: Layer) => Layer) => {
    await putPack(id, edit)
    await refreshActiveCard()
  }
  const removePack = async (id: string) => {
    await deletePack(id)
    await refreshActiveCard()
  }
  const create = async () => {
    const id = newId("pack")
    await savePack(id, () => ({ id, name: t("packs.newPack") }))
    props.onPick(id)
  }
  const [importError, setImportError] = createSignal("")
  const onImportFile = async (f: File) => {
    let body: unknown
    try {
      body = JSON.parse(await f.text())
    } catch {
      return setImportError(t("packs.invalidFile"))
    }
    const { id: _, ...rest } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
    const id = newId("pack")
    try {
      await savePack(id, () => ({ id, ...rest }) as Layer)
      setImportError("")
      props.onPick(id)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t("packs.invalidFile"))
    }
  }
  const exportPack = (p: Layer) => {
    const url = URL.createObjectURL(new Blob([serializePack(p)], { type: "application/json" }))
    const a = Object.assign(document.createElement("a"), { href: url, download: `${p.name}.pack.json` })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <aside class="master-card" aria-label={t("settings.packs")}>
        <div class="master-list scroller top">
          <For each={list()} keyed={(x) => x.id}>
            {(x) => (
              <button
                type="button"
                class="p-row"
                aria-selected={x().id === pack()?.id ? "true" : "false"}
                onClick={() => props.onPick(x().id)}
              >
                <span class="p-name">{x().name}</span>
                <Show when={x().id === "harness"}>
                  <span class="tag">{t("writing.builtin")}</span>
                </Show>
                <Show when={!isReservedPack(x().id)}>
                  <For each={onCards(x().id)}>{(c) => <span class="tag">{c}</span>}</For>
                </Show>
              </button>
            )}
          </For>
        </div>
        <div class="master-foot pack-foot">
          <button type="button" class="btn" onClick={() => void create()}>
            <Plus /> <span>{t("packs.newPack")}</span>
          </button>
          <button type="button" class="icon boxed" aria-label={t("writing.import")} onClick={() => fileInput.click()}>
            <Import />
          </button>
          <input
            type="file"
            accept=".json,application/json"
            hidden
            ref={(el) => (fileInput = el)}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0]
              e.currentTarget.value = ""
              if (f) void onImportFile(f)
            }}
          />
          <Show when={importError()}>{(m) => <span class="tag warn">{m()}</span>}</Show>
        </div>
      </aside>
      <section class="detail-card pack-detail-card" aria-label={t("settings.packs")}>
        <Show when={pack()} fallback={<div class="empty">{t("packs.noPacks")}</div>}>
          {(p) => {
            const holes = () => packHoles(p())
            const save: Save = (edit) => savePack(p().id, edit)
            return (
              <>
                <header class="detail-header pack-detail-header">
                  <ToList onBack={props.onBack} />
                  <Show
                    when={!isReservedPack(p().id)}
                    fallback={
                      <>
                        <h2>{p().name}</h2>
                        <Show when={p().id === "harness"}>
                          <span class="tag">{t("writing.builtin")}</span>
                        </Show>
                      </>
                    }
                  >
                    <Name
                      value={p().name}
                      label={t("packs.packName")}
                      onCommit={(name) => void savePack(p().id, (x) => ({ ...x, name }))}
                    />
                    <For each={onCards(p().id)}>{(c) => <span class="tag">{c}</span>}</For>
                  </Show>
                  <span class="spacer" />
                  <nav class="wtabs" role="tablist" aria-label={t("writing.sections")}>
                    <For each={PACK_TABS} keyed={(row) => row[0]}>
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
                  <Show when={!isReservedPack(p().id)}>
                    <button type="button" class="btn sm ghost" onClick={() => exportPack(p())}>
                      <Export /> <span>{t("common.export")}</span>
                    </button>
                    <button
                      type="button"
                      class="icon sm"
                      aria-label={t("packs.deletePack")}
                      onClick={() => ask(t("packs.confirmDelete", { name: p().name }), () => void removePack(p().id))}
                    >
                      <Trash />
                    </button>
                  </Show>
                </header>

                <Show when={holes().length > 0}>
                  <div class="wmount">
                    <div class="wmount-row">
                      <span class="wmount-label">{t("packs.names")}</span>
                      <For each={holes()} keyed={(k) => k}>
                        {(k) => (
                          <label class="name-chip">
                            <span class="hole-key mono">{`{{${k()}}}`}</span>
                            <input
                              value={p().names?.[k()] ?? ""}
                              placeholder={t("packs.defaultValue")}
                              aria-label={k()}
                              onChange={(e) => {
                                const key = k()
                                const val = e.currentTarget.value
                                void savePack(p().id, (x) => withPackName(x, key, val))
                              }}
                              onKeyDown={leaveInput}
                            />
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <div class="pack-tab-body">
                  <Show when={tab() === "prose"}>
                    <ProseTab pack={p()} onSave={save} />
                  </Show>
                  <Show when={tab() === "entries"}>
                    <EntriesTab pack={p()} onSave={save} />
                  </Show>
                  <Show when={tab() === "lexicon"}>
                    <LexiconTab pack={p()} onSave={save} />
                  </Show>
                  <Show when={tab() === "products"}>
                    <ProductsTab pack={p()} onSave={save} />
                  </Show>
                  <Show when={tab() === "inputs"}>
                    <InputsTab pack={p()} onSave={save} />
                  </Show>
                  <Show when={tab() === "asks"}>
                    <AsksTab pack={p()} onSave={save} />
                  </Show>
                </div>
              </>
            )
          }}
        </Show>
      </section>
    </>
  )
}

// ───────── 1. 文风与要求 (`Layer.fragments`) ─────────
const ProseTab = (props: { pack: Layer; onSave: Save }) => {
  const frags = () => props.pack.fragments ?? []
  const noMode = () => (props.pack.id === "harness" ? "yield" : "override") // what a fragment with no `mode` does (layer.ts)
  const [draft, setDraft] = createSignal<string | null>(null)
  const commitDraft = () => {
    const d = draft()
    if (d === null) return
    setDraft(null)
    if (d.trim()) void props.onSave((p) => addFragment(p, newId("req"), d, "tail"))
  }
  const updateFrag = (idx: number, patch: Partial<Fragment>) =>
    void props.onSave((p) => {
      const cur = [...(p.fragments ?? [])]
      const now = cur[idx]
      if (!now) return p
      cur[idx] = { ...now, ...patch }
      return { ...p, fragments: cur }
    })
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("writing.tabProse")}>
      <div class="prose-card grow">
        <div class="block-title">
          <h3>{t("writing.tabProse")}</h3>
          <span class="tag mono">{frags().length}</span>
          <div class="right">
            <button type="button" class="btn sm" disabled={draft() !== null} onClick={() => setDraft("")}>
              <Plus /> <span>{t("writing.addRequirement")}</span>
            </button>
          </div>
        </div>
        <div class="frag-list scroller fade">
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
                <button type="button" class="icon sm" aria-label={t("writing.discard")} onClick={() => setDraft(null)}>
                  <Close />
                </button>
              </div>
              <div class="field-well">
                <textarea
                  aria-label={t("writing.requirement")}
                  placeholder={
                    props.pack.id === "harness" ? t("writing.harnessPlaceholder") : t("writing.globalPlaceholder")
                  }
                  value={draft() ?? ""}
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                  onKeyDown={leaveArea}
                />
              </div>
            </div>
          </Show>
          <For each={frags()} keyed={false}>
            {(f, i) => (
              <div class="frag-row" data-off={f().enabled === false ? "true" : "false"}>
                <div class="frag-bar">
                  <div class="at-toggle" role="group" aria-label={t("writing.position")}>
                    <button
                      type="button"
                      aria-pressed={atOf(f()) === "tail" ? "true" : "false"}
                      onClick={() => void props.onSave((p) => setFragmentAt(p, i, "tail"))}
                    >
                      {t("writing.atTail")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={atOf(f()) === "head" ? "true" : "false"}
                      onClick={() => void props.onSave((p) => setFragmentAt(p, i, "head"))}
                    >
                      {t("writing.atHead")}
                    </button>
                  </div>
                  <Show when={atOf(f()) === "head"}>
                    <select
                      class="field sm mono"
                      aria-label={t("packs.slot")}
                      value={SLOTS.includes(f().id) ? f().id : ""}
                      onChange={(e) => {
                        const val = e.currentTarget.value || newId("req")
                        updateFrag(i, { id: val })
                      }}
                    >
                      <option value="">{t("packs.slotCustom")}</option>
                      <For each={SLOTS} keyed={(s) => s}>
                        {(s) => <option value={s()}>{s()}</option>}
                      </For>
                    </select>
                    <select
                      class="field sm"
                      aria-label={t("packs.mode")}
                      value={f().mode ?? noMode()}
                      onChange={(e) => {
                        const val = e.currentTarget.value as "override" | "yield" | "both"
                        updateFrag(i, { mode: val === noMode() ? undefined : val })
                      }}
                    >
                      <option value="override">{t("packs.modeOverride")}</option>
                      <option value="yield">{t("packs.modeYield")}</option>
                      <option value="both">{t("packs.modeBoth")}</option>
                    </select>
                  </Show>
                  <span class="spacer" />
                  <span class="tag mono">{t("common.chars", { n: (f().text ?? "").length })}</span>
                  <Switch
                    on={f().enabled !== false}
                    label={f().id}
                    onFlip={() => updateFrag(i, { enabled: f().enabled === false ? undefined : false })}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.removeRequirement")}
                    onClick={() => void props.onSave((p) => removeFragment(p, i))}
                  >
                    <Close />
                  </button>
                </div>
                <div class="field-well">
                  <textarea
                    aria-label={t("writing.requirement")}
                    placeholder={t("writing.emptyRemoves")}
                    value={f().text ?? ""}
                    onChange={(e) => {
                      const text = e.currentTarget.value
                      void props.onSave((p) => setFragmentText(p, i, text))
                    }}
                    onKeyDown={leaveArea}
                  />
                </div>
              </div>
            )}
          </For>
          <Show when={!frags().length && draft() === null}>
            <p class="none">{props.pack.id === "harness" ? t("writing.noHarness") : t("writing.noGlobal")}</p>
          </Show>
        </div>
      </div>
    </section>
  )
}

// ───────── 2. 线索词条 (`Layer.entries`) ─────────
const EntriesTab = (props: { pack: Layer; onSave: Save }) => {
  const entries = () => props.pack.entries ?? []
  const [q, setQ] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [draft, setDraft] = createSignal<{ id: string; text: string } | null>(null)
  const shown = () => {
    const s = q().trim()
    return entries()
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !s || e.id.includes(s) || e.text.includes(s))
  }
  const setEntries = (edit: (list: readonly PackEntry[]) => PackEntry[]) =>
    void props.onSave((p) => {
      const next = edit(p.entries ?? [])
      const { entries: _, ...rest } = p
      return next.length ? { ...rest, entries: next } : rest
    })
  const commitDraft = () => {
    const d = draft()
    if (!d) return
    setDraft(null)
    const text = d.text.trim()
    if (!text) return
    setEntries((list) => [{ id: d.id.trim() || hook(text).slice(0, 16) || `entry-${list.length + 1}`, text }, ...list])
  }
  const updateEntry = (idx: number, patch: Partial<PackEntry>) =>
    setEntries((list) => {
      const cur = [...list]
      const now = cur[idx]
      if (!now) return cur
      const text = (patch.text ?? now.text).trim()
      if (!text) return cur.filter((_, j) => j !== idx)
      const id = (patch.id ?? now.id).trim() || hook(text).slice(0, 16) || now.id
      cur[idx] = { ...now, ...patch, id, text }
      return cur
    })
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("packs.entries")}>
      <div class="prose-card grow">
        <div class="block-title lex-title">
          <h3>{t("packs.entries")}</h3>
          <span class="tag mono">{entries().length}</span>
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
                e.preventDefault()
                setQ("")
                e.currentTarget.blur()
              }}
            />
          </label>
          <div class="right">
            <button
              type="button"
              class="btn sm"
              disabled={draft() !== null}
              onClick={() => setDraft({ id: "", text: "" })}
            >
              <Plus /> <span>{t("packs.addEntry")}</span>
            </button>
          </div>
        </div>
        <div class="frag-list scroller fade">
          <Show when={draft()}>
            {(d) => (
              <div
                class="frag-row"
                onFocusOut={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitDraft()
                }}
              >
                <div class="frag-bar">
                  <input
                    class="field sm mono"
                    placeholder={t("writing.name")}
                    aria-label={t("writing.name")}
                    value={d().id}
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    onInput={(e) => setDraft({ ...d(), id: e.currentTarget.value })}
                    onKeyDown={leaveInput}
                  />
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
                    aria-label={t("packs.content")}
                    placeholder={t("packs.content")}
                    value={d().text}
                    onInput={(e) => setDraft({ ...d(), text: e.currentTarget.value })}
                    onKeyDown={leaveArea}
                  />
                </div>
              </div>
            )}
          </Show>
          <For each={shown()} keyed={(x) => x.i}>
            {(x) => (
              <div class="frag-row">
                <div class="frag-bar">
                  <input
                    class="field sm mono"
                    aria-label={t("writing.name")}
                    value={x().e.id}
                    onChange={(e) => updateEntry(x().i, { id: e.currentTarget.value })}
                    onKeyDown={leaveInput}
                  />
                  <label class="tag">
                    <input
                      type="checkbox"
                      checked={x().e.access?.model ?? true}
                      onChange={(e) =>
                        updateEntry(x().i, {
                          access: { model: e.currentTarget.checked, player: x().e.access?.player ?? true },
                        })
                      }
                    />
                    {t("invoke.auto")}
                  </label>
                  <label class="tag">
                    <input
                      type="checkbox"
                      checked={x().e.access?.player ?? true}
                      onChange={(e) =>
                        updateEntry(x().i, {
                          access: { player: e.currentTarget.checked, model: x().e.access?.model ?? true },
                        })
                      }
                    />
                    {t("invoke.manual")}
                  </label>
                  <select
                    aria-label={t("invoke.mode")}
                    value={x().e.activation ?? "on_demand"}
                    onChange={(e) =>
                      updateEntry(x().i, { activation: e.currentTarget.value as "always" | "on_demand" })
                    }
                  >
                    <option value="on_demand">{t("invoke.onDemand")}</option>
                    <option value="always">{t("invoke.always")}</option>
                  </select>
                  <select
                    aria-label={t("invoke.residency")}
                    value={x().e.residency ?? "window"}
                    onChange={(e) =>
                      updateEntry(x().i, { residency: e.currentTarget.value as "permanent" | "window" | "turn" })
                    }
                  >
                    <option value="permanent">{t("invoke.permanent")}</option>
                    <option value="window">{t("invoke.window")}</option>
                    <option value="turn">{t("invoke.turn")}</option>
                  </select>
                  <span class="tag">{hook(x().e.text)}</span>
                  <span class="spacer" />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.deleteEntry")}
                    onClick={() => {
                      const i = x().i
                      setEntries((list) => list.filter((_, j) => j !== i))
                    }}
                  >
                    <Close />
                  </button>
                </div>
                <div class="field-well">
                  <textarea
                    aria-label={t("packs.content")}
                    value={x().e.text}
                    onChange={(e) => updateEntry(x().i, { text: e.currentTarget.value })}
                    onKeyDown={leaveArea}
                  />
                </div>
              </div>
            )}
          </For>
          <Show when={!entries().length && !draft()}>
            <p class="none">{t("packs.noEntries")}</p>
          </Show>
          <Show when={q().trim() && !shown().length}>
            <p class="none">{t("writing.noEntries")}</p>
          </Show>
        </div>
      </div>
    </section>
  )
}

// ───────── 3. 润色禁词 (`Layer.lexicon` + `Layer.switches.polish`) ─────────
const cleanLex = (e: { pattern: string; hint?: string }): Entry =>
  e.hint?.trim() ? { pattern: e.pattern.trim(), hint: e.hint.trim() } : { pattern: e.pattern.trim() }

const LexiconTab = (props: { pack: Layer; onSave: Save }) => {
  const lex = (): readonly Entry[] => props.pack.lexicon ?? []
  const on = () => props.pack.switches?.polish !== false
  const setLex = (edit: (entries: readonly Entry[]) => readonly Entry[]) =>
    void props.onSave((p) => {
      const next = edit(p.lexicon ?? [])
      const { lexicon: _, ...rest } = p
      return next.length ? { ...rest, lexicon: [...next] } : rest
    })
  const flipPolish = () =>
    void props.onSave((p) => {
      const { polish, ...restSw } = p.switches ?? {}
      const nextSw = polish !== false ? { ...restSw, polish: false } : restSw
      const { switches: _s, ...restPack } = p
      return Object.keys(nextSw).length ? { ...restPack, switches: nextSw } : restPack
    })
  const edit = (i: number, patch: Partial<Entry>) =>
    setLex((entries) => entries.map((e, j) => (j === i ? cleanLex({ ...e, ...patch }) : e)).filter((e) => e.pattern))
  const remove = (i: number) => setLex((entries) => entries.filter((_, j) => j !== i))

  const [q, setQ] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const shown = () => {
    const s = q().trim()
    return lex()
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !s || e.pattern.includes(s) || (e.hint ?? "").includes(s))
  }
  const [draft, setDraft] = createSignal<{ pattern: string; hint: string } | null>(null)
  const commitDraft = () => {
    const d = draft()
    if (!d) return
    setDraft(null)
    if (d.pattern.trim()) setLex((entries) => [cleanLex(d), ...entries])
  }
  let file!: HTMLInputElement
  const [notice, setNotice] = createSignal<string | null>(null)
  const onFile = async (f: File) => {
    const r = parseLexicon(await f.text())
    if ("error" in r) return setNotice(r.error)
    setLex((entries) => {
      const merged = mergeLexicon(entries, r.entries)
      setNotice(t("writing.importN", { n: merged.length - entries.length }))
      return merged
    })
  }
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([serializeLexicon(lex())], { type: "application/json" }))
    const a = Object.assign(document.createElement("a"), { href: url, download: FILE })
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("packs.lexicon")}>
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
              e.preventDefault()
              setQ("")
              e.currentTarget.blur()
            }}
          />
        </label>
        <div class="right">
          <Show when={notice()}>{(n) => <span class="tag">{n()}</span>}</Show>
          <button type="button" class="btn sm ghost" onClick={() => file.click()}>
            <Import /> <span>{t("writing.import")}</span>
          </button>
          <button type="button" class="btn sm ghost" disabled={!lex().length} onClick={exportFile}>
            <Export /> <span>{t("common.export")}</span>
          </button>
          <button
            type="button"
            class="btn sm"
            disabled={!!draft()}
            onClick={() => (setNotice(null), setDraft({ pattern: "", hint: "" }))}
          >
            <Plus /> <span>{t("writing.addEntry")}</span>
          </button>
          <label class="polish-switch">
            <span>{t("writing.polish")}</span>
            <Switch on={on()} label={t("writing.polish")} onFlip={flipPolish} />
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
          e.currentTarget.value = ""
          if (f) void onFile(f)
        }}
      />
      <Show
        when={lex().length || draft()}
        fallback={
          <div class="lex-empty">
            <div class="empty-card">
              <p>{t("writing.lexiconEmpty")}</p>
              <button type="button" class="btn" onClick={() => file.click()}>
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
                    onKeyDown={leaveInput}
                  />
                  <input
                    class="field"
                    placeholder={t("writing.hintPlaceholder")}
                    aria-label={t("writing.hint")}
                    value={d().hint}
                    onInput={(e) => setDraft({ ...d(), hint: e.currentTarget.value })}
                    onKeyDown={leaveInput}
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
                    onKeyDown={leaveInput}
                  />
                  <input
                    class="field"
                    placeholder={t("writing.hintPlaceholder")}
                    aria-label={t("writing.hint")}
                    value={x().e.hint ?? ""}
                    onChange={(e) => edit(x().i, { hint: e.currentTarget.value })}
                    onKeyDown={leaveInput}
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

// ───────── 4. 记录与小剧场 (`Layer.products`) ─────────
interface ProductDraft {
  id: string
  isNew: boolean
  label: string
  on: boolean
  trigger: "demand" | "turn"
  text: string
}
const ProductsTab = (props: { pack: Layer; onSave: Save }) => {
  const products = () => props.pack.products ?? []
  const [editing, setEditing] = createSignal<ProductDraft | null>(null)
  const dlg = dialogHandle()

  const openNew = () => {
    setEditing({ id: newId("th"), isNew: true, label: "", on: false, trigger: "demand", text: "" })
    void dlg.open()
  }
  const openEdit = (p: { id: string; label?: string; on?: boolean; trigger?: "demand" | "turn"; text?: string }) => {
    setEditing({
      id: p.id,
      isNew: false,
      label: p.label ?? p.id,
      on: !!p.on,
      trigger: p.trigger ?? "turn",
      text: p.text ?? "",
    })
    void dlg.open()
  }
  const save = () => {
    const d = editing()
    if (!d || !d.label.trim() || !d.text.trim()) return
    const item = {
      id: d.id,
      label: d.label.trim(),
      text: d.text.trim(),
      ...(d.id !== "notes" ? { on: d.on } : {}),
      ...(d.id !== "notes" && d.id !== "options"
        ? { trigger: props.pack.id === "harness" && d.trigger === "turn" ? undefined : d.trigger }
        : {}),
    }
    void props.onSave((p) => ({ ...p, products: withProductPatch(p.products, item) }))
    dlg.close()
  }
  const remove = () => {
    const d = editing()
    if (!d) return
    const def = defaultOf(d.id)
    void props.onSave((p) => {
      if (def) return { ...p, products: withProductPatch(p.products, { ...def, trigger: undefined }) }
      const next = withoutProductPatch(p.products, d.id)
      const { products: _, ...rest } = p
      return next.length ? { ...rest, products: next } : rest
    })
    dlg.close()
  }
  const defaultOf = (id: string) => (props.pack.id === "harness" ? DEFAULT_PRODUCTS.get(id) : undefined)
  /** Delete, or 恢复默认 on a built-in that differs from its default; an unmodified built-in offers neither. */
  const removable = (id: string) => {
    const def = defaultOf(id)
    return (
      !def ||
      !isDefault(
        products().find((p) => p.id === id),
        def,
      )
    )
  }

  return (
    <section class="wpanel" role="tabpanel" aria-label={t("packs.tabProducts")}>
      <div class="prose-card grow">
        <div class="block-title">
          <h3>{t("packs.tabProducts")}</h3>
          <span class="tag mono">{products().length}</span>
          <div class="right">
            <button type="button" class="btn sm" onClick={openNew}>
              <Plus /> <span>{t("packs.addTheater")}</span>
            </button>
          </div>
        </div>
        <div class="frag-list scroller fade">
          <For each={products()} keyed={(p) => p.id}>
            {(p) => (
              <div class="pack-row" onClick={() => openEdit(p())}>
                <span class="d-name">{p().label ?? p().id}</span>
                <span class="tag mono">{p().id}</span>
                <Show when={p().id !== "notes" && p().id !== "options"}>
                  <span class="tag">{p().trigger === "demand" ? t("packs.onDemand") : t("packs.everyTurn")}</span>
                </Show>
                <span class="row-text">{p().text ?? ""}</span>
                <Show when={p().id !== "notes"} fallback={<span class="tag">{t("writing.alwaysOn")}</span>}>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Switch
                      on={!!p().on}
                      label={p().label ?? p().id}
                      onFlip={() => {
                        const flip = { id: p().id, on: !p().on }
                        void props.onSave((x) => ({ ...x, products: withProductPatch(x.products, flip) }))
                      }}
                    />
                  </span>
                </Show>
              </div>
            )}
          </For>
          <Show when={!products().length}>
            <p class="none">{t("packs.noProducts")}</p>
          </Show>
        </div>
      </div>

      <Modal
        title={editing()?.isNew ? t("packs.addTheater") : t("packs.editTheater")}
        controller={dlg}
        onClose={() => setEditing(null)}
      >
        <Show when={editing()}>
          {(d) => (
            <>
              <div class="modal-body">
                <label class="mfield">
                  <span>{t("writing.name")}</span>
                  <input
                    class="field"
                    value={d().label}
                    onInput={(e) => setEditing({ ...d(), label: e.currentTarget.value })}
                  />
                </label>
                <Show when={d().id !== "notes" && d().id !== "options"}>
                  <div class="mfield">
                    <span>{t("packs.trigger")}</span>
                    <div class="at-toggle" role="group" aria-label={t("packs.trigger")}>
                      <button
                        type="button"
                        aria-pressed={d().trigger === "demand" ? "true" : "false"}
                        onClick={() => setEditing({ ...d(), trigger: "demand" })}
                      >
                        {t("packs.onDemand")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={d().trigger === "turn" ? "true" : "false"}
                        onClick={() => setEditing({ ...d(), trigger: "turn" })}
                      >
                        {t("packs.everyTurn")}
                      </button>
                    </div>
                  </div>
                </Show>
                <label class="mfield">
                  <span>{t("packs.prompt")}</span>
                  <div class="field-well">
                    <textarea
                      rows="6"
                      value={d().text}
                      onInput={(e) => setEditing({ ...d(), text: e.currentTarget.value })}
                    />
                  </div>
                </label>
              </div>
              <div class="modal-foot">
                <Show when={!d().isNew && removable(d().id)}>
                  <button type="button" class="btn sm ghost danger" onClick={remove}>
                    {defaultOf(d().id) ? t("packs.restoreDefault") : t("common.delete")}
                  </button>
                  <span class="spacer" />
                </Show>
                <button type="button" class="btn sm ghost" onClick={() => dlg.close()}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  class="btn sm primary"
                  disabled={!d().label.trim() || !d().text.trim()}
                  onClick={save}
                >
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

// ───────── 5. 快捷输入 (`Layer.format` & `Layer.snippets`) ─────────
const placed = <T,>(l: readonly T[], x: T, at: number): T[] =>
  at < 0 ? [x, ...l] : l.map((y, i) => (i === at ? x : y))
interface InputEditing {
  snippet: boolean
  at: number
  draft: InsertDraft
}
const InputsTab = (props: { pack: Layer; onSave: Save }) => {
  const keys = () => props.pack.format ?? []
  const snips = () => props.pack.snippets ?? []
  const setKeys = (edit: (list: readonly Format[]) => readonly Format[]) =>
    void props.onSave((p) => {
      const next = edit(p.format ?? [])
      const { format: _, ...rest } = p
      return next.length ? { ...rest, format: [...next] } : rest
    })
  const setSnips = (edit: (list: readonly Snippet[]) => readonly Snippet[]) =>
    void props.onSave((p) => {
      const next = edit(p.snippets ?? [])
      const { snippets: _, ...rest } = p
      return next.length ? { ...rest, snippets: [...next] } : rest
    })
  /** On the harness row, the code default under the item being edited (by its key: a snippet's name, a key's label). */
  const defaultOf = (e: InputEditing) =>
    props.pack.id !== "harness" || e.at < 0
      ? undefined
      : e.snippet
        ? DEFAULT_SNIPPETS.get(snips()[e.at]?.name ?? "")
        : DEFAULT_FORMAT.get(keys()[e.at]?.label ?? "")
  /** Delete, or 恢复默认 on a built-in that differs from its default; an unmodified built-in offers neither. */
  const removable = (e: InputEditing) => {
    const def = defaultOf(e)
    return !def || !isDefault(e.snippet ? snips()[e.at] : keys()[e.at], def)
  }
  const [editing, setEditing] = createSignal<InputEditing | null>(null)
  const dlg = dialogHandle()
  const open = (e: InputEditing) => (setEditing(e), void dlg.open())
  const patch = (f: Partial<InsertDraft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...f } } : e))
  const made = () => {
    const e = editing()
    return e ? (e.snippet ? snippetOf(e.draft) : formatOf(e.draft)) : undefined
  }
  const save = () => {
    const e = editing()
    const v = made()
    if (!e || !v) return
    if (e.snippet) setSnips((list) => placed(list, v as Snippet, e.at))
    else setKeys((list) => placed(list, v as Format, e.at))
    dlg.close()
  }
  const remove = () => {
    const e = editing()
    if (!e || e.at < 0) return
    const def = defaultOf(e) // a built-in has no "gone": absent in the overlay is back to default, so write the default
    if (e.snippet) setSnips((list) => (def ? placed(list, def as Snippet, e.at) : list.filter((_, i) => i !== e.at)))
    else setKeys((list) => (def ? placed(list, def as Format, e.at) : list.filter((_, i) => i !== e.at)))
    dlg.close()
  }
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("writing.tabInputs")}>
      <div class="input-card">
        <div class="block-title">
          <h3>{t("writing.formatKeys")}</h3>
          <span class="tag mono">{t("writing.keysN", { n: keys().length })}</span>
          <div class="right">
            <button
              type="button"
              class="btn sm"
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
        </div>
      </div>
      <div class="input-card grow">
        <div class="block-title">
          <h3>{t("writing.snippets")}</h3>
          <span class="tag mono">{t("common.entries", { n: snips().length })}</span>
          <div class="right">
            <button
              type="button"
              class="btn sm"
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
        controller={dlg}
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
                    disabled={!!defaultOf(e())}
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
                <Show when={e().at >= 0 && removable(e())}>
                  <button type="button" class="btn sm ghost danger" onClick={remove}>
                    {defaultOf(e()) ? t("packs.restoreDefault") : t("common.delete")}
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

// ───────── 6. 问法 (`Layer.asks`: stage instructions & switch sentences) ─────────
const AsksTab = (props: { pack: Layer; onSave: Save }) => {
  const ownMap = () => new Map((props.pack.asks ?? []).map((a) => [a.id, a.text]))
  const isHarness = () => props.pack.id === "harness"

  const setAsk = (id: string, raw: string) => {
    const text = raw.trim()
    const def = DEFAULT_ASKS.get(id) ?? ""
    const builtin = isHarness()
    void props.onSave((p) => {
      const cur = (p.asks ?? []).filter((a) => a.id !== id)
      let next: Ask[]
      if (builtin) {
        next = [...cur, { id, text: text || def }]
      } else {
        next = text && text !== def ? [...cur, { id, text }] : cur
      }
      const { asks: _, ...rest } = p
      return next.length ? { ...rest, asks: next } : rest
    })
  }

  const isModified = (id: string) => {
    const own = ownMap().get(id)
    const def = DEFAULT_ASKS.get(id) ?? ""
    return own !== undefined && own !== def
  }

  const switchAsks = () =>
    SWITCHES.flatMap((s) =>
      s.values.map(([val, labelKey]) => ({
        id: `switch.${s.key}.${String(val)}`,
        label: `${t(s.label)} · ${t(labelKey)}`,
      })),
    )

  return (
    <section class="wpanel" role="tabpanel" aria-label={t("packs.tabAsks")}>
      <div class="prose-card grow">
        <div class="frag-list scroller fade">
          <div class="block-title">
            <h3>{t("packs.stageAsks")}</h3>
          </div>
          <For each={stageAskLabels()} keyed={(row) => row[0]}>
            {(row) => {
              const id = () => row()[0]
              const def = () => DEFAULT_ASKS.get(id()) ?? ""
              const val = () => (isHarness() ? (ownMap().get(id()) ?? def()) : (ownMap().get(id()) ?? ""))
              return (
                <div class="frag-row">
                  <div class="frag-bar">
                    <span class="d-name">{row()[1]}</span>
                    <span class="tag mono">{id()}</span>
                    <span class="spacer" />
                    <Show when={isModified(id())}>
                      <button type="button" class="btn xs ghost" onClick={() => setAsk(id(), "")}>
                        {t("packs.restoreDefault")}
                      </button>
                    </Show>
                  </div>
                  <div class="field-well">
                    <textarea
                      aria-label={row()[1]}
                      placeholder={def()}
                      value={val()}
                      onChange={(e) => setAsk(id(), e.currentTarget.value)}
                      onKeyDown={leaveArea}
                    />
                  </div>
                </div>
              )
            }}
          </For>

          <div class="block-title">
            <h3>{t("packs.switchSentences")}</h3>
          </div>
          <For each={switchAsks()} keyed={(row) => row.id}>
            {(row) => {
              const id = () => row().id
              const def = () => DEFAULT_ASKS.get(id()) ?? ""
              const val = () => (isHarness() ? (ownMap().get(id()) ?? def()) : (ownMap().get(id()) ?? ""))
              return (
                <div class="frag-row">
                  <div class="frag-bar">
                    <span class="d-name">{row().label}</span>
                    <span class="tag mono">{id()}</span>
                    <span class="spacer" />
                    <Show when={isModified(id())}>
                      <button type="button" class="btn xs ghost" onClick={() => setAsk(id(), "")}>
                        {t("packs.restoreDefault")}
                      </button>
                    </Show>
                  </div>
                  <div class="field-well">
                    <textarea
                      aria-label={row().label}
                      placeholder={def()}
                      value={val()}
                      onChange={(e) => setAsk(id(), e.currentTarget.value)}
                      onKeyDown={leaveArea}
                    />
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </section>
  )
}
