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
import { Back, Next, Prev, Snippets as Plus, User } from "./icons.tsx"
import {
  cardNameKeys,
  orderedPacks,
  productEdit,
  toggleMount,
  withoutProductPatch,
  withoutProductText,
  withPackName,
  withProductPatch,
} from "./pack.ts"
import { extraOf, withExtra } from "./requirements.ts"
import { openSettings } from "./settings.tsx"
import { close, open } from "./pages.ts"
import { card, locals, packs, page, personas, stories } from "./store.ts"
import { personaOn } from "./stories.ts"
import { openPicker } from "./dialogs.tsx"
import { kindOf } from "./record.ts"
import { moot, pressing, sentence, SWITCHES, takenBy, type SwitchKey } from "./switches.ts"
import { putLocal, refreshActiveCard } from "./wire.ts"
import { t } from "./i18n.ts"

export const openWriting = () => open("writing")

export const putLocalAndRefresh = async (cardId: string, edit: (l: Local) => Local) => {
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

/** `{{user}}` as a name chip (#170), here and on the new-story page: the persona in force (the open story's, else the
 *  card's default: the picker's own `current`) fills it last and wins, so with one picked the chip shows that name and
 *  takes no typing; with none, the name typed here (`local.names.user`). The person key opens the persona picker. */
export const UserChip = (props: { cardId: string; unfilled: boolean }) => {
  const view = read(card)
  const lib = read(stories)
  const allLocals = read(locals)
  const people = read(personas)
  const pg = read(page)
  const persona = () => people().find((p) => p.id === personaOn(lib(), allLocals(), props.cardId, pg()))
  return (
    <span class="name-chip" data-unfilled={props.unfilled ? "true" : "false"}>
      <span class="hole-key mono">{"{{user}}"}</span>
      <Show
        when={persona()}
        fallback={
          <input
            value={view()?.local.names?.user ?? view()?.layer.names.user ?? ""}
            placeholder={t("packs.unfilled")}
            aria-label="user"
            disabled={!props.cardId}
            onChange={(e) => {
              const cid = props.cardId
              const val = e.currentTarget.value
              void putLocalAndRefresh(cid, (l) => withPackName(l, "user", val))
            }}
            onKeyDown={leaveInput}
          />
        }
      >
        {(p) => <span class="persona-name">{p().name}</span>}
      </Show>
      <button
        type="button"
        class="icon"
        aria-label={t("side.pickPersona")}
        aria-pressed={persona() ? "true" : "false"}
        disabled={!props.cardId}
        onClick={openPicker}
      >
        <User />
      </button>
    </span>
  )
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

  const mountedIds = () => loc()?.mounts ?? []
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
              </div>
              <div class="name-chips">
                <For each={nameKeys()} keyed={(k) => k}>
                  {(k) => (
                    <Show
                      when={k() !== "user"}
                      fallback={<UserChip cardId={cardId()} unfilled={!!layer()?.holes.includes("user")} />}
                    >
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
                    </Show>
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
  trigger: "demand" | "turn"
}

const SwitchesAndProducts = (props: { fromLabel: (from: string) => string }) => {
  const view = read(card)
  const allPacks = read(packs)
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
  const worldProducts = () => products().filter((p) => kindOf(p) === "world")
  const contextProducts = () => products().filter((p) => kindOf(p) === "context")
  const theaters = () => products().filter((p) => kindOf(p) === "theater")

  const THEATER_PAGE_SIZE = 4
  const [thPage, setThPage] = createSignal(0)
  const thPages = () => Math.max(1, Math.ceil(theaters().length / THEATER_PAGE_SIZE))
  const curThPage = () => Math.min(thPage(), thPages() - 1)
  const pagedTheaters = () => theaters().slice(curThPage() * THEATER_PAGE_SIZE, (curThPage() + 1) * THEATER_PAGE_SIZE)

  let lastWheelAt = 0
  const stepTheaterWheel = (e: WheelEvent) => {
    if (thPages() <= 1) return
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (Math.abs(delta) < 12) return
    e.preventDefault()
    const now = Date.now()
    if (now - lastWheelAt < 220) return
    lastWheelAt = now
    const next = delta > 0 ? Math.min(thPages() - 1, curThPage() + 1) : Math.max(0, curThPage() - 1)
    if (next !== curThPage()) setThPage(next)
  }

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
    setEditingProd({ id: newId("th"), isNew: true, label: "", text: "", trigger: "demand" })
    prodDlg.showModal()
  }
  const openEditProduct = (p: { id: string; label?: string; text?: string; trigger?: "demand" | "turn" }) => {
    const own = loc()?.products?.find((x) => x.id === p.id)
    setEditingProd({
      id: p.id,
      isNew: false,
      label: own?.label ?? p.label ?? p.id,
      text: own?.text ?? p.text ?? "",
      trigger: own?.trigger ?? p.trigger ?? "turn",
    })
    prodDlg.showModal()
  }
  const shownProduct = (id: string) =>
    products().find((p) => p.id === id) as
      | {
          id: string
          from: string
          role?: "world" | "chronicle" | "theater"
          label?: string
          text?: string
          trigger?: "demand" | "turn"
        }
      | undefined
  const canTrigger = (d: ProductEditDraft) => d.isNew || (shownProduct(d.id)?.role === "theater" && d.id !== "options")
  const saveProduct = () => {
    const d = editingProd()
    const cid = cardId()
    if (!d || !cid) return
    const patch = productEdit(
      d.isNew ? undefined : shownProduct(d.id),
      d.id,
      d.label,
      d.text,
      canTrigger(d) ? d.trigger : undefined,
    )
    if (patch) {
      const nextPage = d.isNew ? Math.floor(theaters().length / THEATER_PAGE_SIZE) : curThPage()
      void putLocalAndRefresh(cid, (l) => ({ ...l, products: withProductPatch(l.products, patch) }))
      if (d.isNew) setThPage(nextPage)
    }
    prodDlg.close()
  }
  /** 删除 a theater the player made here (its whole patch); 恢复默认 elsewhere (label, text and trigger go, `on` stays). */
  const removeProductPatch = () => {
    const d = editingProd()
    const cid = cardId()
    if (!d || !cid) return
    const drop = isLocalOnly(d.id) ? withoutProductPatch : withoutProductText
    void putLocalAndRefresh(cid, (l) => {
      const next = drop(l.products, d.id)
      const { products: _, ...rest } = l
      return next.length ? { ...rest, products: next } : rest
    })
    prodDlg.close()
  }
  const hasLocalPatch = (id: string) =>
    loc()?.products?.some(
      (x) => x.id === id && (x.text !== undefined || x.label !== undefined || x.trigger !== undefined),
    ) ?? false
  // a theater the player made on this card: the local row is its author, its id is one this client minted
  // (controls.tsx `newId("th")`), and no pack in the library declares it (a pack's theater patched here is still the pack's)
  const isLocalOnly = (id: string) =>
    shownProduct(id)?.from === "local" &&
    id.startsWith("th-") &&
    !allPacks().some((p) => p.products?.some((x) => x.id === id))

  const ProductCard = (cprops: { item: ReturnType<typeof products>[number] }) => {
    const p = () => cprops.item
    const textOf = () => (p() as { text?: string }).text
    const missing = () => unfilled(textOf() ?? "", layer()?.names ?? {})
    return (
      <div
        class="prod-item"
        data-editable="true"
        onClick={() => openEditProduct({ id: p().id, label: p().label, text: textOf(), trigger: p().trigger })}
      >
        <div class="prod-top">
          <span class={{ pname: true, pid: !p().label }}>{p().label ?? p().id}</span>
          <For each={missing()}>{(m) => <span class="tag warn mono">{`{{${m}}}`}</span>}</For>
          <span class="tag">{props.fromLabel(p().from)}</span>
          <Show when={p().role === "theater" && p().id !== "options"}>
            <span class="tag">{p().trigger === "demand" ? t("packs.onDemand") : t("packs.everyTurn")}</span>
          </Show>
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
                  <legend>
                    {t(s().label)}
                    <Show when={taken()}>
                      {(who) => <span class="tag">{t("writing.takenBy", { from: props.fromLabel(who()) })}</span>}
                    </Show>
                  </legend>
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
        <div class="prod-body">
          <Show when={worldProducts().length}>
            <div class="prod-group">
              <div class="prod-kind-bar">
                <h4 class="prod-kind">{t("writing.kindWorld")}</h4>
              </div>
              <div class="prod-grid">
                <For each={worldProducts()} keyed={(p) => p.id}>
                  {(p) => <ProductCard item={p()} />}
                </For>
              </div>
            </div>
          </Show>
          <Show when={contextProducts().length}>
            <div class="prod-group">
              <div class="prod-kind-bar">
                <h4 class="prod-kind">{t("writing.kindContext")}</h4>
              </div>
              <div class="prod-grid">
                <For each={contextProducts()} keyed={(p) => p.id}>
                  {(p) => <ProductCard item={p()} />}
                </For>
              </div>
            </div>
          </Show>
          <Show when={theaters().length}>
            <div class="prod-group">
              <div class="prod-kind-bar">
                <h4 class="prod-kind">{t("writing.kindTheater")}</h4>
                <Show when={thPages() > 1}>
                  <div class="theater-pager">
                    <button
                      type="button"
                      class="icon sm"
                      disabled={curThPage() <= 0}
                      onClick={() => setThPage(curThPage() - 1)}
                    >
                      <Prev />
                    </button>
                    <span class="mono">
                      {curThPage() + 1} / {thPages()}
                    </span>
                    <button
                      type="button"
                      class="icon sm"
                      disabled={curThPage() >= thPages() - 1}
                      onClick={() => setThPage(curThPage() + 1)}
                    >
                      <Next />
                    </button>
                  </div>
                </Show>
              </div>
              <div class="theater-grid" data-paged={thPages() > 1 ? "true" : "false"} onWheel={stepTheaterWheel}>
                <For each={pagedTheaters()} keyed={(p) => p.id}>
                  {(p) => <ProductCard item={p()} />}
                </For>
              </div>
            </div>
          </Show>
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
                <Show when={canTrigger(d())}>
                  <div class="mfield">
                    <span>{t("packs.trigger")}</span>
                    <div class="at-toggle" role="group" aria-label={t("packs.trigger")}>
                      <button
                        type="button"
                        aria-pressed={d().trigger === "demand" ? "true" : "false"}
                        onClick={() => setEditingProd({ ...d(), trigger: "demand" })}
                      >
                        {t("packs.onDemand")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={d().trigger === "turn" ? "true" : "false"}
                        onClick={() => setEditingProd({ ...d(), trigger: "turn" })}
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
                  disabled={d().isNew && !d().text.trim()}
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
