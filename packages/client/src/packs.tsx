// Settings → 写作包 (docs/packs-brief.md): the library of packs as the settings page's master list and detail. A
// pack's detail is one scrolling column of sections (names, 文风与要求, 线索词条, 润色禁词, 小剧场, 快捷输入), each
// row edited in a modal; a long list opens in a drawer with a search. Every edit is one `PUT /packs/<id>` and a
// re-read of the active card view (the merged names and holes come from the server). pack.ts holds the pure parts.
import type { Fragment, Pack, PackEntry, Theater } from "@effect-tavern/runtime/src/fragment.ts"
import { hook } from "@effect-tavern/runtime/src/lore.ts"
import type { Entry } from "@effect-tavern/runtime/src/polish.ts"
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { ask, Drawer, Modal, Name, newId, Switch, ToList, type Pane } from "./controls.tsx"
import { Clue, Close, Export, Import, Next, Snippets as Plus, Trash } from "./icons.tsx"
import { draftOfSnippet, emptyDraft, snippetOf, type InsertDraft } from "./inserts.ts"
import { packCount, packHoles, serializePack, withPackName } from "./pack.ts"
import { cards, packs, player } from "./store.ts"
import { t } from "./i18n.ts"
import { deletePack, putPack, refreshActiveCard } from "./wire.ts"

// ───────── 写作包 ─────────
type DrawerKind = "entries" | "lexicon" | "theaters"
type ModalEdit =
  | { kind: "frag"; idx: number; id: string; at: "head" | "tail"; enabled: boolean; text: string }
  | { kind: "entry"; idx: number; id: string; text: string }
  | { kind: "lex"; idx: number; pattern: string; hint: string }
  | { kind: "theater"; idx: number; id: string; label: string; on: boolean; text: string }
  | { kind: "snip"; idx: number; draft: InsertDraft }

export const Packs = (props: Pane) => {
  const list = read(packs)
  const me = read(player)
  const known = read(cards)
  const pack = () => list().find((p) => p.id === props.picked) ?? list()[0]
  const [drawer, setDrawer] = createSignal<DrawerKind | null>(null)
  const [dq, setDq] = createSignal("")
  const [editing, setEditing] = createSignal<ModalEdit | null>(null)
  let modalDlg!: HTMLDialogElement
  let fileInput!: HTMLInputElement

  /** Player.packs read backwards: each pack's mounted cards by title. */
  const mounts = createMemo(() => {
    const by = new Map<string, string[]>()
    for (const [cid, pids] of Object.entries(me()?.packs ?? {})) {
      const title = known().find((x) => x.id === cid)?.title ?? cid
      for (const pid of pids) by.set(pid, [...(by.get(pid) ?? []), title])
    }
    return by
  })
  const onCards = (id: string) => mounts().get(id) ?? []

  const savePack = async (next: Pack) => {
    await putPack(next)
    await refreshActiveCard()
  }
  const removePack = async (id: string) => {
    await deletePack(id)
    await refreshActiveCard()
  }
  const create = async () => {
    const id = newId("pack")
    await savePack({ id, name: t("packs.newPack") })
    props.onPick(id)
  }
  const [importError, setImportError] = createSignal("")
  /** A pack file is the row's JSON (`serializePack`): the server decodes it as `Pack` and names what is wrong. */
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
      await savePack({ id, ...rest } as Pack)
      setImportError("")
      props.onPick(id)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t("packs.invalidFile"))
    }
  }
  const exportPack = (p: Pack) => {
    const url = URL.createObjectURL(new Blob([serializePack(p)], { type: "application/json" }))
    const a = Object.assign(document.createElement("a"), { href: url, download: `${p.name}.pack.json` })
    a.click()
    URL.revokeObjectURL(url)
  }

  const openModal = (m: ModalEdit) => {
    setEditing(m)
    modalDlg.showModal()
  }
  const openFrag = (p: Pack, idx: number) => {
    const cur = idx >= 0 ? p.fragments?.[idx] : undefined
    openModal({
      kind: "frag",
      idx,
      id: cur?.id ?? `req-${(p.fragments?.length ?? 0) + 1}`,
      at: cur?.at === "tail" ? "tail" : "head",
      enabled: cur?.enabled !== false,
      text: cur?.text ?? "",
    })
  }
  const openEntry = (p: Pack, idx: number) => {
    const cur = idx >= 0 ? p.entries?.[idx] : undefined
    openModal({ kind: "entry", idx, id: cur?.id ?? "", text: cur?.text ?? "" })
  }
  const openLex = (p: Pack, idx: number) => {
    const cur = idx >= 0 ? p.lexicon?.[idx] : undefined
    openModal({ kind: "lex", idx, pattern: cur?.pattern ?? "", hint: cur?.hint ?? "" })
  }
  const openTheater = (p: Pack, idx: number) => {
    const cur = idx >= 0 ? p.theaters?.[idx] : undefined
    openModal({
      kind: "theater",
      idx,
      id: cur?.id ?? newId("th"),
      label: cur?.label ?? "",
      on: !!cur?.on,
      text: cur?.text ?? "",
    })
  }
  const openSnip = (p: Pack, idx: number) => {
    const cur = idx >= 0 ? p.snippets?.[idx] : undefined
    openModal({ kind: "snip", idx, draft: cur ? draftOfSnippet(cur) : emptyDraft(true) })
  }

  const commitModal = () => {
    const p = pack()
    const e = editing()
    if (!p || !e) return
    if (e.kind === "frag") {
      const text = e.text.trim()
      if (!text) return
      const item: Fragment = {
        id: e.id,
        ...(e.at === "tail" ? { at: "tail" } : {}),
        ...(e.enabled ? {} : { enabled: false }),
        text,
      }
      const cur = [...(p.fragments ?? [])]
      if (e.idx >= 0) cur[e.idx] = item
      else cur.push(item)
      void savePack({ ...p, fragments: cur })
    } else if (e.kind === "entry") {
      const text = e.text.trim()
      if (!text) return
      const id = e.id.trim() || hook(text).slice(0, 16) || `entry-${(p.entries?.length ?? 0) + 1}`
      const item: PackEntry = { id, text }
      const cur = [...(p.entries ?? [])]
      if (e.idx >= 0) cur[e.idx] = item
      else cur.push(item)
      void savePack({ ...p, entries: cur })
    } else if (e.kind === "lex") {
      const pattern = e.pattern.trim()
      if (!pattern) return
      const hint = e.hint.trim()
      const item: Entry = hint ? { pattern, hint } : { pattern }
      const cur = [...(p.lexicon ?? [])]
      if (e.idx >= 0) cur[e.idx] = item
      else cur.push(item)
      void savePack({ ...p, lexicon: cur })
    } else if (e.kind === "theater") {
      const label = e.label.trim()
      const text = e.text.trim()
      if (!label || !text) return
      const item: Theater = {
        id: e.id,
        label,
        ...(e.on ? { on: true } : {}),
        text,
      }
      const cur = [...(p.theaters ?? [])]
      if (e.idx >= 0) cur[e.idx] = item
      else cur.push(item)
      void savePack({ ...p, theaters: cur })
    } else if (e.kind === "snip") {
      const item = snippetOf(e.draft)
      if (!item) return
      const cur = [...(p.snippets ?? [])]
      if (e.idx >= 0) cur[e.idx] = item
      else cur.push(item)
      void savePack({ ...p, snippets: cur })
    }
    modalDlg.close()
  }

  const deleteFromModal = () => {
    const p = pack()
    const e = editing()
    if (!p || !e || e.idx < 0) return
    if (e.kind === "frag") {
      const next = (p.fragments ?? []).filter((_, i) => i !== e.idx)
      const { fragments: _, ...rest } = p
      void savePack(next.length ? { ...rest, fragments: next } : rest)
    } else if (e.kind === "entry") {
      const next = (p.entries ?? []).filter((_, i) => i !== e.idx)
      const { entries: _, ...rest } = p
      void savePack(next.length ? { ...rest, entries: next } : rest)
    } else if (e.kind === "lex") {
      const next = (p.lexicon ?? []).filter((_, i) => i !== e.idx)
      const { lexicon: _, ...rest } = p
      void savePack(next.length ? { ...rest, lexicon: next } : rest)
    } else if (e.kind === "theater") {
      const next = (p.theaters ?? []).filter((_, i) => i !== e.idx)
      const { theaters: _, ...rest } = p
      void savePack(next.length ? { ...rest, theaters: next } : rest)
    } else if (e.kind === "snip") {
      const next = (p.snippets ?? []).filter((_, i) => i !== e.idx)
      const { snippets: _, ...rest } = p
      void savePack(next.length ? { ...rest, snippets: next } : rest)
    }
    modalDlg.close()
  }

  const modalTitle = () => {
    const e = editing()
    if (!e) return ""
    const isEdit = e.idx >= 0
    switch (e.kind) {
      case "frag":
        return isEdit ? t("packs.editRequirement") : t("writing.addRequirement")
      case "entry":
        return isEdit ? t("packs.editEntry") : t("packs.addEntry")
      case "lex":
        return isEdit ? t("packs.editLexicon") : t("writing.addEntry")
      case "theater":
        return isEdit ? t("packs.editTheater") : t("packs.addTheater")
      case "snip":
        return isEdit ? t("writing.editSnippet") : t("writing.newSnippet")
    }
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
                onClick={() => (setDrawer(null), props.onPick(x().id))}
              >
                <span class="p-name">{x().name}</span>
                <For each={onCards(x().id)}>{(c) => <span class="tag">{c}</span>}</For>
                <span class="tag mono">{packCount(x())}</span>
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
      <section class="detail-card" aria-label={t("settings.packs")}>
        <Show when={pack()} fallback={<div class="empty">{t("packs.noPacks")}</div>}>
          {(p) => {
            const holes = () => packHoles(p())
            const frags = () => p().fragments ?? []
            const entries = () => p().entries ?? []
            const lex = () => p().lexicon ?? []
            const theaters = () => p().theaters ?? []
            const snips = () => p().snippets ?? []
            return (
              <>
                <header class="detail-header">
                  <ToList onBack={props.onBack} />
                  <Name
                    value={p().name}
                    label={t("packs.packName")}
                    onCommit={(name) => void savePack({ ...p(), name })}
                  />
                  <For each={onCards(p().id)}>{(c) => <span class="tag">{c}</span>}</For>
                  <span class="spacer" />
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
                </header>
                <div class="detail-scroll scroller">
                  {/* Auto-derived proper-noun defaults (`Pack.names`) */}
                  <Show when={holes().length > 0}>
                    <div class="pack-mod">
                      <div class="block-title">
                        <h3>{t("packs.names")}</h3>
                        <span class="tag mono">{holes().length}</span>
                      </div>
                      <div class="name-chips">
                        <For each={holes()} keyed={(k) => k}>
                          {(k) => (
                            <label class="name-chip">
                              <span class="hole-key mono">{`{{${k()}}}`}</span>
                              <input
                                value={p().names?.[k()] ?? ""}
                                placeholder={t("packs.defaultValue")}
                                aria-label={k()}
                                onChange={(e) => void savePack(withPackName(p(), k(), e.currentTarget.value))}
                              />
                            </label>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* 1. 文风与要求 */}
                  <div class="pack-mod">
                    <div class="block-title">
                      <h3>{t("writing.tabProse")}</h3>
                      <span class="tag mono">{frags().length}</span>
                      <div class="right">
                        <button type="button" class="btn sm" onClick={() => openFrag(p(), -1)}>
                          <Plus /> <span>{t("writing.addRequirement")}</span>
                        </button>
                      </div>
                    </div>
                    <Show when={frags().length > 0}>
                      <div class="pack-rows">
                        <For each={frags()} keyed={false}>
                          {(f, i) => (
                            <div
                              class="pack-row"
                              data-off={f().enabled === false ? "true" : "false"}
                              onClick={() => openFrag(p(), i)}
                            >
                              <span class="tag">{f().at === "tail" ? t("writing.atTail") : t("writing.atHead")}</span>
                              <span class="row-text">{f().text}</span>
                              <span onClick={(e) => e.stopPropagation()}>
                                <Switch
                                  on={f().enabled !== false}
                                  label={f().id}
                                  onFlip={() => {
                                    const cur = [...frags()]
                                    const now = cur[i]!
                                    cur[i] = { ...now, enabled: now.enabled === false ? undefined : false }
                                    void savePack({ ...p(), fragments: cur })
                                  }}
                                />
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* 2. 线索词条 */}
                  <div class="pack-mod">
                    <div class="block-title">
                      <h3>{t("packs.entries")}</h3>
                      <span class="tag mono">{entries().length}</span>
                      <div class="right">
                        <Show when={entries().length > 0}>
                          <button type="button" class="btn sm ghost" onClick={() => (setDq(""), setDrawer("entries"))}>
                            <span>{t("packs.manage")}</span> <Next />
                          </button>
                        </Show>
                        <button type="button" class="btn sm" onClick={() => openEntry(p(), -1)}>
                          <Plus /> <span>{t("packs.addEntry")}</span>
                        </button>
                      </div>
                    </div>
                    <Show when={entries().length > 0}>
                      <div class="item-pills">
                        <For each={entries()} keyed={false}>
                          {(e, i) => (
                            <button type="button" class="item-pill" onClick={() => openEntry(p(), i)}>
                              <span>{e().id}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* 3. 润色禁词 */}
                  <div class="pack-mod">
                    <div class="block-title">
                      <h3>{t("packs.lexicon")}</h3>
                      <span class="tag mono">{lex().length}</span>
                      <div class="right">
                        <Show when={lex().length > 0}>
                          <button type="button" class="btn sm ghost" onClick={() => (setDq(""), setDrawer("lexicon"))}>
                            <span>{t("packs.manage")}</span> <Next />
                          </button>
                        </Show>
                        <button type="button" class="btn sm" onClick={() => openLex(p(), -1)}>
                          <Plus /> <span>{t("writing.addEntry")}</span>
                        </button>
                      </div>
                    </div>
                    <Show when={lex().length > 0}>
                      <div class="item-pills">
                        <For each={lex()} keyed={false}>
                          {(x, i) => (
                            <button type="button" class="item-pill" onClick={() => openLex(p(), i)}>
                              <span>{x().pattern}</span>
                              <Show when={x().hint}>{(h) => <span class="preview">{`→ ${h()}`}</span>}</Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* 4. 小剧场 */}
                  <div class="pack-mod">
                    <div class="block-title">
                      <h3>{t("writing.kindTheater")}</h3>
                      <span class="tag mono">{theaters().length}</span>
                      <div class="right">
                        <Show when={theaters().length > 0}>
                          <button type="button" class="btn sm ghost" onClick={() => (setDq(""), setDrawer("theaters"))}>
                            <span>{t("packs.manage")}</span> <Next />
                          </button>
                        </Show>
                        <button type="button" class="btn sm" onClick={() => openTheater(p(), -1)}>
                          <Plus /> <span>{t("packs.addTheater")}</span>
                        </button>
                      </div>
                    </div>
                    <Show when={theaters().length > 0}>
                      <div class="item-pills">
                        <For each={theaters()} keyed={false}>
                          {(th, i) => (
                            <button type="button" class="item-pill" onClick={() => openTheater(p(), i)}>
                              <Show when={th().on}>
                                <span class="dot-on" />
                              </Show>
                              <span>{th().label ?? th().id}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* 5. 快捷输入 */}
                  <div class="pack-mod">
                    <div class="block-title">
                      <h3>{t("writing.tabInputs")}</h3>
                      <span class="tag mono">{snips().length}</span>
                      <div class="right">
                        <button type="button" class="btn sm" onClick={() => openSnip(p(), -1)}>
                          <Plus /> <span>{t("writing.addSnippet")}</span>
                        </button>
                      </div>
                    </div>
                    <Show when={snips().length > 0}>
                      <div class="item-pills">
                        <For each={snips()} keyed={false}>
                          {(s, i) => (
                            <button type="button" class="item-pill" onClick={() => openSnip(p(), i)}>
                              <span>{s().name}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </div>

                {/* Slide-over drawer for bulk browsing / searching entries, lexicon, or theaters */}
                <Drawer
                  open={drawer() !== null}
                  label={
                    drawer() === "entries"
                      ? t("packs.entries")
                      : drawer() === "theaters"
                        ? t("writing.kindTheater")
                        : t("packs.lexicon")
                  }
                  onClose={() => setDrawer(null)}
                >
                  <Show when={drawer()}>
                    {(kind) => (
                      <>
                        <div class="drawer-head">
                          <h3>
                            {kind() === "entries"
                              ? t("packs.entries")
                              : kind() === "theaters"
                                ? t("writing.kindTheater")
                                : t("packs.lexicon")}
                          </h3>
                          <span class="spacer" />
                          <button
                            type="button"
                            class="btn sm"
                            onClick={() =>
                              kind() === "entries"
                                ? openEntry(p(), -1)
                                : kind() === "theaters"
                                  ? openTheater(p(), -1)
                                  : openLex(p(), -1)
                            }
                          >
                            <Plus />{" "}
                            <span>
                              {kind() === "entries"
                                ? t("packs.addEntry")
                                : kind() === "theaters"
                                  ? t("packs.addTheater")
                                  : t("writing.addEntry")}
                            </span>
                          </button>
                          <button
                            type="button"
                            class="icon sm"
                            aria-label={t("common.close")}
                            onClick={() => setDrawer(null)}
                          >
                            <Close />
                          </button>
                        </div>
                        <div class="drawer-search">
                          <div class="input-box sm">
                            <Clue aria-hidden="true" />
                            <input
                              type="search"
                              placeholder={t("writing.searchEntries")}
                              aria-label={t("writing.searchEntriesLabel")}
                              value={dq()}
                              onInput={(e) => setDq(e.currentTarget.value)}
                            />
                          </div>
                        </div>
                        <div class="drawer-body scroller">
                          <Show when={kind() === "entries"}>
                            <For
                              each={entries()
                                .map((e, i) => ({ e, i }))
                                .filter(
                                  ({ e }) => !dq().trim() || e.id.includes(dq().trim()) || e.text.includes(dq().trim()),
                                )}
                              keyed={(x) => x.i}
                            >
                              {(x) => (
                                <button type="button" class="pack-drawer-row" onClick={() => openEntry(p(), x().i)}>
                                  <span class="d-name">{x().e.id}</span>
                                  <span class="d-preview">{hook(x().e.text)}</span>
                                </button>
                              )}
                            </For>
                          </Show>
                          <Show when={kind() === "lexicon"}>
                            <For
                              each={lex()
                                .map((e, i) => ({ e, i }))
                                .filter(
                                  ({ e }) =>
                                    !dq().trim() ||
                                    e.pattern.includes(dq().trim()) ||
                                    (e.hint ?? "").includes(dq().trim()),
                                )}
                              keyed={(x) => x.i}
                            >
                              {(x) => (
                                <button type="button" class="pack-drawer-row" onClick={() => openLex(p(), x().i)}>
                                  <span class="d-name">{x().e.pattern}</span>
                                  <span class="d-preview">{x().e.hint ?? ""}</span>
                                </button>
                              )}
                            </For>
                          </Show>
                          <Show when={kind() === "theaters"}>
                            <For
                              each={theaters()
                                .map((th, i) => ({ th, i }))
                                .filter(
                                  ({ th }) =>
                                    !dq().trim() ||
                                    (th.label ?? th.id).includes(dq().trim()) ||
                                    (th.text ?? "").includes(dq().trim()),
                                )}
                              keyed={(x) => x.i}
                            >
                              {(x) => (
                                <button type="button" class="pack-drawer-row" onClick={() => openTheater(p(), x().i)}>
                                  <span class="d-name">{x().th.label ?? x().th.id}</span>
                                  <span class="d-preview">{x().th.text ?? ""}</span>
                                  <Show when={x().th.on}>
                                    <span class="tag">{t("writing.alwaysOn")}</span>
                                  </Show>
                                </button>
                              )}
                            </For>
                          </Show>
                        </div>
                      </>
                    )}
                  </Show>
                </Drawer>
              </>
            )
          }}
        </Show>
      </section>

      <Modal title={modalTitle()} dialog={(el) => (modalDlg = el)} onClose={() => setEditing(null)}>
        <Show when={editing()}>
          {(e) => (
            <>
              <div class="modal-body">
                <Show when={e().kind === "frag" && e()}>
                  {(f) => (
                    <>
                      <div class="mfield">
                        <span>{t("writing.position")}</span>
                        <div class="at-toggle" role="group" aria-label={t("writing.position")}>
                          <button
                            type="button"
                            aria-pressed={
                              (f() as Extract<ModalEdit, { kind: "frag" }>).at === "tail" ? "true" : "false"
                            }
                            onClick={() => setEditing({ ...(f() as Extract<ModalEdit, { kind: "frag" }>), at: "tail" })}
                          >
                            {t("writing.atTail")}
                          </button>
                          <button
                            type="button"
                            aria-pressed={
                              (f() as Extract<ModalEdit, { kind: "frag" }>).at === "head" ? "true" : "false"
                            }
                            onClick={() => setEditing({ ...(f() as Extract<ModalEdit, { kind: "frag" }>), at: "head" })}
                          >
                            {t("writing.atHead")}
                          </button>
                        </div>
                      </div>
                      <label class="mfield">
                        <span>{t("writing.requirement")}</span>
                        <div class="field-well">
                          <textarea
                            rows="5"
                            value={(f() as Extract<ModalEdit, { kind: "frag" }>).text}
                            onInput={(ev) =>
                              setEditing({
                                ...(f() as Extract<ModalEdit, { kind: "frag" }>),
                                text: ev.currentTarget.value,
                              })
                            }
                          />
                        </div>
                      </label>
                    </>
                  )}
                </Show>

                <Show when={e().kind === "entry" && e()}>
                  {(en) => (
                    <>
                      <label class="mfield">
                        <span>{t("writing.name")}</span>
                        <input
                          class="field"
                          value={(en() as Extract<ModalEdit, { kind: "entry" }>).id}
                          onInput={(ev) =>
                            setEditing({
                              ...(en() as Extract<ModalEdit, { kind: "entry" }>),
                              id: ev.currentTarget.value,
                            })
                          }
                        />
                      </label>
                      <label class="mfield">
                        <span>{t("packs.content")}</span>
                        <div class="field-well">
                          <textarea
                            rows="6"
                            value={(en() as Extract<ModalEdit, { kind: "entry" }>).text}
                            onInput={(ev) =>
                              setEditing({
                                ...(en() as Extract<ModalEdit, { kind: "entry" }>),
                                text: ev.currentTarget.value,
                              })
                            }
                          />
                        </div>
                      </label>
                    </>
                  )}
                </Show>

                <Show when={e().kind === "lex" && e()}>
                  {(lx) => (
                    <>
                      <label class="mfield">
                        <span>{t("writing.pattern")}</span>
                        <input
                          class="field"
                          value={(lx() as Extract<ModalEdit, { kind: "lex" }>).pattern}
                          onInput={(ev) =>
                            setEditing({
                              ...(lx() as Extract<ModalEdit, { kind: "lex" }>),
                              pattern: ev.currentTarget.value,
                            })
                          }
                        />
                      </label>
                      <label class="mfield">
                        <span>{t("writing.hint")}</span>
                        <input
                          class="field"
                          value={(lx() as Extract<ModalEdit, { kind: "lex" }>).hint}
                          onInput={(ev) =>
                            setEditing({
                              ...(lx() as Extract<ModalEdit, { kind: "lex" }>),
                              hint: ev.currentTarget.value,
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                </Show>

                <Show when={e().kind === "theater" && e()}>
                  {(th) => (
                    <>
                      <label class="mfield">
                        <span>{t("writing.name")}</span>
                        <input
                          class="field"
                          value={(th() as Extract<ModalEdit, { kind: "theater" }>).label}
                          onInput={(ev) =>
                            setEditing({
                              ...(th() as Extract<ModalEdit, { kind: "theater" }>),
                              label: ev.currentTarget.value,
                            })
                          }
                        />
                      </label>
                      <div class="mfield">
                        <span>{t("packs.trigger")}</span>
                        <div class="at-toggle" role="group" aria-label={t("packs.trigger")}>
                          <button
                            type="button"
                            aria-pressed={!(th() as Extract<ModalEdit, { kind: "theater" }>).on ? "true" : "false"}
                            onClick={() =>
                              setEditing({ ...(th() as Extract<ModalEdit, { kind: "theater" }>), on: false })
                            }
                          >
                            {t("packs.onDemand")}
                          </button>
                          <button
                            type="button"
                            aria-pressed={(th() as Extract<ModalEdit, { kind: "theater" }>).on ? "true" : "false"}
                            onClick={() =>
                              setEditing({ ...(th() as Extract<ModalEdit, { kind: "theater" }>), on: true })
                            }
                          >
                            {t("packs.everyTurn")}
                          </button>
                        </div>
                      </div>
                      <label class="mfield">
                        <span>{t("packs.prompt")}</span>
                        <div class="field-well">
                          <textarea
                            rows="6"
                            value={(th() as Extract<ModalEdit, { kind: "theater" }>).text}
                            onInput={(ev) =>
                              setEditing({
                                ...(th() as Extract<ModalEdit, { kind: "theater" }>),
                                text: ev.currentTarget.value,
                              })
                            }
                          />
                        </div>
                      </label>
                    </>
                  )}
                </Show>

                <Show when={e().kind === "snip" && e()}>
                  {(sn) => {
                    const s = () => (sn() as Extract<ModalEdit, { kind: "snip" }>).draft
                    const patchSnip = (f: Partial<InsertDraft>) =>
                      setEditing({
                        ...(sn() as Extract<ModalEdit, { kind: "snip" }>),
                        draft: { ...s(), ...f },
                      })
                    return (
                      <>
                        <label class="mfield">
                          <span>{t("writing.name")}</span>
                          <input
                            class="field"
                            value={s().label}
                            onInput={(ev) => patchSnip({ label: ev.currentTarget.value })}
                          />
                        </label>
                        <label class="mfield">
                          <span>{t("writing.description")}</span>
                          <input
                            class="field"
                            value={s().hint}
                            onInput={(ev) => patchSnip({ hint: ev.currentTarget.value })}
                          />
                        </label>
                        <div class="mfield">
                          <span>{t("writing.channel")}</span>
                          <div class="at-toggle" role="group" aria-label={t("writing.channelLabel")}>
                            <button
                              type="button"
                              aria-pressed={!s().note ? "true" : "false"}
                              onClick={() => patchSnip({ note: false })}
                            >
                              {t("writing.inStory")}
                            </button>
                            <button
                              type="button"
                              aria-pressed={s().note ? "true" : "false"}
                              onClick={() => patchSnip({ note: true })}
                            >
                              {t("writing.toNarrator")}
                            </button>
                          </div>
                        </div>
                        <label class="mfield">
                          <span>{t("writing.insertText")}</span>
                          <input
                            class="field"
                            value={s().text}
                            onInput={(ev) => patchSnip({ text: ev.currentTarget.value })}
                          />
                        </label>
                      </>
                    )
                  }}
                </Show>
              </div>
              <div class="modal-foot">
                <Show when={e().idx >= 0}>
                  <button type="button" class="btn sm ghost danger" onClick={deleteFromModal}>
                    {t("common.delete")}
                  </button>
                  <span class="spacer" />
                </Show>
                <button type="button" class="btn sm ghost" onClick={() => modalDlg.close()}>
                  {t("common.cancel")}
                </button>
                <button type="button" class="btn sm primary" onClick={commitModal}>
                  {t("common.save")}
                </button>
              </div>
            </>
          )}
        </Show>
      </Modal>
    </>
  )
}
