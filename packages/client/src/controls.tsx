// The settings page's shared pieces (settings.tsx, providers.tsx and its parts): the controls the prototype draws (a
// menu instead of <select>, a switch, a letter avatar, a name edited in place), the shells (a side drawer over the
// detail card, a modal, the one delete confirm), and the small pure helpers the sections share. No state of a section
// lives here.
import { lookup } from "@effect-tavern/provider/src/names.ts"
import { normalize, plan, type Format } from "@effect-tavern/provider/src/url.ts"
import type { JSX } from "@solidjs/web"
import { createSignal, For, onSettled, Show } from "solid-js"
import { Family } from "./family.tsx"
import { Back, Caret, Check, Close } from "./icons.tsx"
import { roam } from "./side.tsx"
import { names } from "./store.ts"
import { t } from "./i18n.ts"

export const FORMATS: Format[] = ["openai-compatible", "anthropic", "gemini"]
export const FORMAT: Record<Format, string> = {
  "openai-compatible": "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
}
// an id the player never sees; not crypto.randomUUID, which a phone on plain http (no secure context) lacks
let made = 0
export const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${(made++).toString(36)}`
/** A model's group: its owner when the name table knows it (`meta`, `anthropic`), else its id up to the first `-`, `/`
 *  or `_` (the prototype's grouping). Tracked: the table arrives after the lists. */
const groupOf = (id: string) =>
  lookup(names(), id)?.owner ?? (id.split(/[-/_]/)[0]!.toLowerCase() || t("common.default"))
export const grouped = (ids: readonly string[]): [string, string[]][] => {
  const by = new Map<string, string[]>()
  for (const id of ids) by.set(groupOf(id), [...(by.get(groupOf(id)) ?? []), id])
  return [...by]
}
/** The URL a format's endpoint will hit, or why the input is refused (url.ts's own message). */
export const preview = (format: Format, url: string, exact: boolean | undefined, model = "{model}") => {
  try {
    return { ok: true, text: plan(format, normalize(format, url, exact ? "exact-prefix" : "infer"), model).stream }
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) }
  }
}
export const hide = (el: HTMLElement) => el.closest<HTMLElement>("[popover]")?.hidePopover()
/** A value (a key, an error) onto the clipboard, then `flash` for a moment. A plain-http page off localhost (a phone
 *  on the LAN) has no clipboard: the button then does nothing. */
export const copyKey = async (value: string | Promise<string>, flash: (on: boolean) => void) => {
  const v = await value
  if (!v || !navigator.clipboard) return
  await navigator.clipboard.writeText(v)
  flash(true)
  setTimeout(() => flash(false), 1200)
}

// ───────── Controls ─────────
let menus = 0
export interface Option<T extends string> {
  value: T
  label: string
  glyph?: string // a model id: its family glyph leads the row
}
/** A select without <select>: a trigger and a popover menu anchored under it, the pick checked. With `action`, the
 *  trigger is a button by that name and a pick runs it (检测: the model to test on). With nothing to pick, the
 *  trigger is disabled and still names the pick it holds (a stale one too). */
export const Menu = <T extends string>(props: {
  value: T | undefined
  options: readonly Option<T>[]
  onPick: (v: T) => void
  placeholder?: string
  stale?: Option<T> // what the trigger shows when the value is set but not among the options (a dangling pick)
  label?: string
  small?: boolean
  action?: string
}) => {
  const id = `menu-${menus++}`
  const current = () => props.options.find((o) => o.value === props.value) ?? props.stale
  return (
    <>
      <Show
        when={props.action}
        fallback={
          <button
            type="button"
            class={{ select: true, sm: !!props.small }}
            popovertarget={id}
            aria-label={props.label}
            disabled={props.options.length === 0}
          >
            <Show when={current()?.glyph}>{(g) => <Family id={g()} />}</Show>
            <span class="label">{current()?.label ?? props.placeholder ?? ""}</span>
            <Caret class="caret" />
          </button>
        }
      >
        {(a) => (
          <button
            type="button"
            class="btn"
            popovertarget={id}
            aria-label={props.label}
            disabled={props.options.length === 0}
          >
            {a()}
          </button>
        )}
      </Show>
      <div id={id} class="snippets menu scroller" popover role="menu" onKeyDown={roam}>
        <For each={props.options} keyed={(o) => o.value}>
          {(o) => (
            <button
              type="button"
              role="menuitemradio"
              class="item"
              tabindex="-1"
              aria-checked={o().value === props.value ? "true" : "false"}
              onClick={(e) => (hide(e.currentTarget), props.onPick(o().value))}
            >
              <span class="name">
                <Show when={o().glyph}>{(g) => <Family id={g()} />}</Show>
                <span class="text">{o().label}</span>
              </span>
              <Show when={o().value === props.value}>
                <Check />
              </Show>
            </button>
          )}
        </For>
      </div>
    </>
  )
}
export const Switch = (props: { on: boolean; label: string; onFlip: () => void }) => (
  <button
    type="button"
    class="switch"
    role="switch"
    aria-checked={props.on ? "true" : "false"}
    aria-label={props.label}
    onClick={() => props.onFlip()}
  >
    <span class="thumb" />
  </button>
)
export const Avatar = (props: { name: string }) => <span class="avatar">{props.name.slice(0, 1).toUpperCase()}</span>
/** A record's name edited in place in the detail header; an empty edit is not written. */
export const Name = (props: { value: string; label: string; onCommit: (v: string) => void }) => (
  <div class="input-box name">
    <input
      type="text"
      value={props.value}
      aria-label={props.label}
      onChange={(e) => e.currentTarget.value.trim() && props.onCommit(e.currentTarget.value.trim())}
    />
  </div>
)
/** The phone's way from a detail back to its list (hidden on desktop, where both show). */
export const ToList = (props: { onBack: () => void }) => (
  <button type="button" class="icon back-pane" aria-label={t("controls.backToList")} onClick={() => props.onBack()}>
    <Back />
  </button>
)

/** A section's list/detail wiring from the page: which record is picked, and the phone's pane moves. */
export interface Pane {
  picked: string | undefined
  onPick: (id: string) => void
  onBack: () => void
}

// ───────── Shells ─────────
/** A card sliding in over the detail card's right side, its scrim and Escape closing it; the content is the caller's.
 *  A popover or a dialog over it takes the Escape instead, and the page's Escape (settings.tsx) leaves an open
 *  drawer to this. */
export const Drawer = (props: { open: boolean; label: string; onClose: () => void; children: JSX.Element }) => {
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.open && !document.querySelector(":popover-open, dialog[open]")) props.onClose()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })
  return (
    <>
      <div class="drawer-scrim" data-open={props.open ? "true" : "false"} onClick={() => props.onClose()} />
      <aside class="side-drawer" data-open={props.open ? "true" : "false"} aria-label={props.label}>
        {props.children}
      </aside>
    </>
  )
}
/** Opens a dialog component from its parent: the dialog hands its open function up through `opener`. */
export type Opener<A> = (open: (a: A) => void) => void
/** A modal: the head with its close, then the caller's body and foot. Scrim click and Escape close it too. */
export const Modal = (props: {
  title: string
  narrow?: boolean
  dialog: (el: HTMLDialogElement) => void
  onClose?: () => void
  children: JSX.Element
}) => {
  let el!: HTMLDialogElement
  return (
    <dialog
      class={{ modal: true, narrow: !!props.narrow }}
      ref={(d) => {
        el = d
        props.dialog(d)
      }}
      closedby="any"
      onClose={() => props.onClose?.()}
    >
      <div class="modal-head">
        <h3>{props.title}</h3>
        <button type="button" class="icon sm" aria-label={t("common.close")} onClick={() => el.close()}>
          <Close />
        </button>
      </div>
      {props.children}
    </dialog>
  )
}

// The one delete confirm on the page: `ask` opens it with the question and what Delete then does.
let asker: (text: string, run: () => void) => void = () => {}
export const ask = (text: string, run: () => void) => asker(text, run)
export const Confirm = () => {
  let el!: HTMLDialogElement
  const [asking, setAsking] = createSignal<{ text: string; run: () => void } | null>(null)
  return (
    <dialog
      class="confirm"
      ref={(d) => {
        el = d
        asker = (text, run) => (setAsking({ text, run }), d.showModal())
      }}
      closedby="any"
    >
      <p>{asking()?.text}</p>
      <div class="row">
        <button type="button" class="chip state" onClick={() => el.close()}>
          {t("common.cancel")}
        </button>
        <button type="button" class="chip danger" onClick={() => (el.close(), asking()?.run())}>
          {t("common.delete")}
        </button>
      </div>
    </dialog>
  )
}
