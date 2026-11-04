// The Writing page (docs/packs-brief.md §九 §7): the per-card writing workbench over the reader, laid out as a
// full-stage two-column page (`.stage-card`, matching `card.tsx`). Left column: header, `dropped` warning strip, pack
// mounting chips (`local.mounts`) with `管理 →` pinned to the block header's right, proper-noun inputs (`layer.names`
// + `layer.holes`), and the per-card supplement (`extra` tail fragment in `local.fragments`). Right column: the 4
// narration switches (`local.switches` + compiled `layer.switches.sentences` + `taken` grey-out) and the per-turn
// record products (`layer.products` with `from`, `on`, `text`, and modal prompt override in `local.products`).
import type { Writing } from "@effect-tavern/runtime/src/fragment.ts"
import type { Local } from "@effect-tavern/runtime/src/layer.ts"
import { unfilled } from "@effect-tavern/runtime/src/names.ts"
import { createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Modal, newId, Switch } from "./controls.tsx"
import { Back, Next, Snippets as Plus } from "./icons.tsx"
import { cardNameKeys, orderedPacks, toggleMount, withoutProductPatch, withPackName, withProductPatch } from "./pack.ts"
import { extraOf, withExtra } from "./requirements.ts"
import { openSettings } from "./settings.tsx"
import { close, open } from "./pages.ts"
import { card, packs } from "./store.ts"
import { kindOf } from "./record.ts"
import { moot, pressing, sentence, SWITCHES, takenBy, type SwitchKey } from "./switches.ts"
import { putLocal, refreshActiveCard } from "./wire.ts"
import { t } from "./i18n.ts"

export const openWriting = () => open("writing")

const putLocalAndRefresh = async (cardId: string, edit: (l: Local) => Local) => {
  if (!cardId) return
  await putLocal(cardId, edit)
  await refreshActiveCard()
}

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

export const WritingPage = () => {
  const view = read(card)
  const allPacks = read(packs)
  const cardId = () => view()?.id ?? ""
  const title = () => view()?.title ?? ""
  const loc = () => view()?.local
  const layer = () => view()?.layer

  const fromLabel = (from: string): string => {
    if (from === "harness") return t("writing.builtin")
    if (from === "card") return title() || t("side.cardDefault")
    if (from === "local") return t("packs.local")
    return allPacks().find((p) => p.id === from)?.name ?? from
  }

  const mountedIds = () => loc()?.mounts ?? view()?.mounts.map((m) => m.id) ?? []
  const chips = () => orderedPacks(allPacks(), mountedIds())
  const nameKeys = () => cardNameKeys(layer()?.holes, layer()?.names)
  const extra = () => extraOf(loc())
  const dropped = () => layer()?.dropped ?? []

  return (
    <div class="inspect wpage">
      <article class="wsheet" aria-label={t("writing.title")}>
        {/* Left column: header, warnings, pack mounts, proper nouns, per-card extra requirement */}
        <section class="wcol wleft" aria-label={t("writing.title")}>
          <header class="whead">
            <button type="button" class="icon" aria-label={t("common.backToStory")} onClick={close}>
              <Back />
            </button>
            <h1>{t("writing.title")}</h1>
            <Show when={title()}>{(c) => <span class="tag">{c()}</span>}</Show>
          </header>

          <Show when={dropped().length > 0}>
            <div class="dropped-strip">
              <For each={dropped()} keyed={false}>
                {(d) => (
                  <span class="tag warn">{`${fromLabel(d().from)}${d().id ? ` · ${d().id}` : ""}: ${d().why}`}</span>
                )}
              </For>
            </div>
          </Show>

          {/* 1. 写作包挂载 (`local.mounts`) */}
          <div class="wcard">
            <div class="block-title">
              <h3>{t("settings.packs")}</h3>
              <div class="right">
                <button type="button" class="btn sm ghost" onClick={() => openSettings("packs")}>
                  <span>{t("packs.manage")}</span> <Next />
                </button>
              </div>
            </div>
            <Show when={chips().length > 0} fallback={<p class="none">{t("packs.noUserPacks")}</p>}>
              <div class="pack-chips">
                <For each={chips()} keyed={(p) => p.id}>
                  {(p) => (
                    <button
                      type="button"
                      class="pack-chip"
                      aria-pressed={mountedIds().includes(p().id) ? "true" : "false"}
                      disabled={!cardId()}
                      onClick={() => {
                        const cid = cardId()
                        const pid = p().id
                        void putLocalAndRefresh(cid, (l) => toggleMount(l, pid))
                      }}
                    >
                      <span>{p().name}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* 2. 本卡代称 (`layer.names` + `layer.holes`) */}
          <Show when={nameKeys().length > 0}>
            <div class="wcard">
              <div class="block-title">
                <h3>{t("packs.names")}</h3>
                <span class="tag mono">{`{{user}} = ${layer()?.names.user ?? ""}`}</span>
              </div>
              <div class="name-chips">
                <For each={nameKeys()} keyed={(k) => k}>
                  {(k) => (
                    <label class="name-chip" data-unfilled={layer()?.holes.includes(k()) ? "true" : "false"}>
                      <span class="hole-key mono">{`{{${k()}}}`}</span>
                      <input
                        value={loc()?.names?.[k()] ?? layer()?.names[k()] ?? ""}
                        placeholder={t("packs.unfilled")}
                        aria-label={k()}
                        disabled={!cardId()}
                        onChange={(e) => {
                          const cid = cardId()
                          const key = k()
                          const val = e.currentTarget.value
                          void putLocalAndRefresh(cid, (l) => withPackName(l, key, val))
                        }}
                        onKeyDown={leaveInput}
                      />
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* 3. 本卡补充 (`extra` fragment in `local.fragments`) */}
          <div class="wcard grow">
            <div class="block-title">
              <h3>{t("switches.cardExtra")}</h3>
              <div class="right">
                <span class="tag mono">{t("common.chars", { n: extra().length })}</span>
              </div>
            </div>
            <div class="field-well grow">
              <textarea
                aria-label={t("switches.cardExtra")}
                placeholder={t("writing.extraPlaceholder", { card: title() })}
                disabled={!cardId()}
                value={extra()}
                onChange={(e) => {
                  const cid = cardId()
                  const text = e.currentTarget.value
                  void putLocalAndRefresh(cid, (l) => withExtra(l, text))
                }}
                onKeyDown={leaveArea}
              />
            </div>
          </div>
        </section>

        {/* Right column: narration switches and per-turn record products */}
        <section class="wcol wright" aria-label={t("writing.switches")}>
          <SwitchesAndProducts fromLabel={fromLabel} />
        </section>
      </article>
    </div>
  )
}

interface ProductEditDraft {
  id: string
  isNew: boolean
  label: string
  text: string
}

const SwitchesAndProducts = (props: { fromLabel: (from: string) => string }) => {
  const view = read(card)
  const cardId = () => view()?.id ?? ""
  const loc = () => view()?.local
  const layer = () => view()?.layer
  const localSw = () => loc()?.switches
  const effSw = () => layer()?.switches.value
  const sentences = () => layer()?.switches.sentences

  const writeSwitches = (f: (w: Writing) => Writing) => {
    const cid = cardId()
    if (!cid) return
    void putLocalAndRefresh(cid, (l) => {
      const next = Object.fromEntries(Object.entries(f(l.switches ?? {})).filter(([, v]) => v !== undefined)) as Writing
      const { switches: _, ...rest } = l
      return Object.keys(next).length ? { ...rest, switches: next } : rest
    })
  }
  const setSwitch = (key: SwitchKey, value: string | boolean) =>
    writeSwitches((x) => ({ ...x, [key]: pressing(key, x, value) }))
  const resetSwitches = () => writeSwitches(({ pov: _p, echo: _e, agency: _a, verbosity: _v, ...rest }) => rest)

  const activeSentence = (key: SwitchKey) => {
    const val = effSw()?.[key]
    return val !== undefined ? sentence(key, val, sentences()) : t("switches.followCard")
  }

  const products = () => layer()?.products ?? []
  const lit = () => products().filter((p) => p.on).length

  const flipProduct = (prod: { id: string; on: boolean }) => {
    const cid = cardId()
    if (!cid) return
    void putLocalAndRefresh(cid, (l) => {
      const next = withProductPatch(l.products, { id: prod.id, on: !prod.on })
      return { ...l, products: next }
    })
  }

  const [editingProd, setEditingProd] = createSignal<ProductEditDraft | null>(null)
  let prodDlg!: HTMLDialogElement

  const openNewTheater = () => {
    setEditingProd({ id: newId("th"), isNew: true, label: "", text: "" })
    prodDlg.showModal()
  }
  const openEditProduct = (p: { id: string; label?: string; text?: string }) => {
    const own = loc()?.products?.find((x) => x.id === p.id)
    setEditingProd({
      id: p.id,
      isNew: false,
      label: own?.label ?? p.label ?? p.id,
      text: own?.text ?? p.text ?? "",
    })
    prodDlg.showModal()
  }
  const saveProduct = () => {
    const d = editingProd()
    const cid = cardId()
    if (!d || !cid || !d.label.trim() || !d.text.trim()) return
    void putLocalAndRefresh(cid, (l) => {
      const next = withProductPatch(l.products, {
        id: d.id,
        label: d.label.trim(),
        text: d.text.trim(),
        ...(d.isNew ? { on: false } : {}),
      })
      return { ...l, products: next }
    })
    prodDlg.close()
  }
  const removeProductPatch = () => {
    const d = editingProd()
    const cid = cardId()
    if (!d || !cid) return
    void putLocalAndRefresh(cid, (l) => {
      const next = withoutProductPatch(l.products, d.id)
      const { products: _, ...rest } = l
      return next.length ? { ...rest, products: next } : rest
    })
    prodDlg.close()
  }
  const hasLocalPatch = (id: string) =>
    loc()?.products?.some((x) => x.id === id && (x.text !== undefined || x.label !== undefined)) ?? false
  const isLocalOnly = (id: string) =>
    products().find((p) => p.id === id)?.from === "local" &&
    !["notes", "options", "inner"].includes(id) &&
    !(view()?.mounts ?? []).length

  const Group = (gprops: { kind: ReturnType<typeof kindOf>; title: string }) => {
    const of = () => products().filter((p) => kindOf(p) === gprops.kind)
    return (
      <Show when={of().length}>
        <h4 class="prod-kind">{gprops.title}</h4>
        <For each={of()} keyed={(p) => p.id}>
          {(p) => {
            const textOf = () => (p() as { text?: string }).text
            const missing = () => unfilled(textOf() ?? "", layer()?.names ?? {})
            return (
              <div
                class="prod-item"
                data-editable="true"
                onClick={() => openEditProduct({ id: p().id, label: p().label, text: textOf() })}
              >
                <div class="prod-top">
                  <span class={{ pname: true, pid: !p().label }}>{p().label ?? p().id}</span>
                  <For each={missing()}>{(m) => <span class="tag warn mono">{`{{${m}}}`}</span>}</For>
                  <span class="tag">{props.fromLabel(p().from)}</span>
                  <Show when={p().id !== "notes"} fallback={<span class="tag">{t("writing.alwaysOn")}</span>}>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Switch
                        on={!!p().on}
                        label={p().label ?? p().id}
                        onFlip={() => flipProduct({ id: p().id, on: !!p().on })}
                      />
                    </span>
                  </Show>
                </div>
                <span class="prod-preview">{textOf() ?? t("writing.cardPrompt")}</span>
              </div>
            )
          }}
        </For>
      </Show>
    )
  }

  return (
    <>
      <div class="wsec">
        <div class="block-title">
          <h3>{t("writing.switches")}</h3>
          <div class="right">
            <button type="button" class="btn sm ghost" disabled={!cardId()} onClick={resetSwitches}>
              {t("writing.allFollowCard")}
            </button>
          </div>
        </div>
        <div class="sw-grid">
          <For each={SWITCHES} keyed={(s) => s.key}>
            {(s) => {
              const taken = () => takenBy(s().key, layer())
              const disabled = () => !cardId() || moot(s().key, effSw()) || taken() !== null
              return (
                <fieldset class="sw-card" disabled={disabled()}>
                  <div class="sw-head">
                    <legend>{t(s().label)}</legend>
                    <Show when={taken()}>
                      {(who) => <span class="tag">{t("writing.takenBy", { from: props.fromLabel(who()) })}</span>}
                    </Show>
                  </div>
                  <div class="sw-pills">
                    <For each={s().values} keyed={(v) => String(v[0])}>
                      {(v) => (
                        <button
                          type="button"
                          aria-pressed={(localSw()?.[s().key] ?? effSw()?.[s().key]) === v()[0] ? "true" : "false"}
                          title={sentence(s().key, v()[0], sentences())}
                          disabled={disabled()}
                          onClick={() => setSwitch(s().key, v()[0])}
                        >
                          {t(v()[1])}
                        </button>
                      )}
                    </For>
                  </div>
                  <p class="sw-sentence">{activeSentence(s().key)}</p>
                </fieldset>
              )
            }}
          </For>
        </div>
      </div>

      <div class="wsec grow">
        <div class="block-title">
          <h3>{t("writing.products")}</h3>
          <div class="right">
            <span class="tag mono">
              {lit()} / {products().length}
            </span>
            <button type="button" class="btn sm" disabled={!cardId()} onClick={openNewTheater}>
              <Plus /> <span>{t("packs.addTheater")}</span>
            </button>
          </div>
        </div>
        <div class="prod-grid scroller fade">
          <Group kind="world" title={t("writing.kindWorld")} />
          <Group kind="context" title={t("writing.kindContext")} />
          <Group kind="theater" title={t("writing.kindTheater")} />
        </div>
      </div>

      <Modal
        title={editingProd()?.isNew ? t("packs.addTheater") : t("packs.editTheater")}
        dialog={(el) => (prodDlg = el)}
        onClose={() => setEditingProd(null)}
      >
        <Show when={editingProd()}>
          {(d) => (
            <>
              <div class="modal-body">
                <label class="mfield">
                  <span>{t("writing.name")}</span>
                  <input
                    class="field"
                    value={d().label}
                    onInput={(e) => setEditingProd({ ...d(), label: e.currentTarget.value })}
                  />
                </label>
                <label class="mfield">
                  <span>{t("packs.prompt")}</span>
                  <div class="field-well">
                    <textarea
                      rows="6"
                      placeholder={t("writing.cardPrompt")}
                      value={d().text}
                      onInput={(e) => setEditingProd({ ...d(), text: e.currentTarget.value })}
                    />
                  </div>
                </label>
              </div>
              <div class="modal-foot">
                <Show when={!d().isNew && hasLocalPatch(d().id)}>
                  <button type="button" class="btn sm ghost danger" onClick={removeProductPatch}>
                    {isLocalOnly(d().id) ? t("common.delete") : t("packs.restoreDefault")}
                  </button>
                  <span class="spacer" />
                </Show>
                <button type="button" class="btn sm ghost" onClick={() => prodDlg.close()}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  class="btn sm primary"
                  disabled={!d().label.trim() || !d().text.trim()}
                  onClick={saveProduct}
                >
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
