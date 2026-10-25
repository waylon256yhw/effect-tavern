// The settings page's shared pieces (settings.tsx, providers.tsx): the controls the prototype draws (a menu instead of
// <select>, a switch, a letter avatar, a name edited in place), the shells (a side drawer over the detail card, a
// modal, the one delete confirm), and the small pure helpers the sections share. No state of a section lives here.
import type { Capabilities } from "@effect-tavern/provider/src/connection.ts"
import { normalize, plan, type Format } from "@effect-tavern/provider/src/url.ts"
import type { JSX } from "@solidjs/web"
import { createSignal, For, Show } from "solid-js"
import { Family } from "./family.tsx"
import { Back, Caret, Check, Close } from "./icons.tsx"
import { roam } from "./side.tsx"

export const FORMATS: Format[] = ["openai-compatible", "anthropic", "gemini"]
export const FORMAT: Record<Format, string> = {
  "openai-compatible": "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
}
// provider connection.ts DEFAULTS, copied: importing it would pull ai-sdk into the client
export const DEFAULTS: Record<Format, Capabilities> = {
  anthropic: { prefill: false, structured: "schema", reasoningBack: false },
  "openai-compatible": { prefill: true, structured: "schema", reasoningBack: true },
  gemini: { prefill: true, structured: "schema", reasoningBack: true },
}
// an id the player never sees; not crypto.randomUUID, which a phone on plain http (no secure context) lacks
let made = 0
export const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${(made++).toString(36)}`
/** A model's group: its id up to the first `-`, `/` or `_` (the prototype's grouping). */
const groupOf = (id: string) => id.split(/[-/_]/)[0] || "默认"
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

// ───────── Controls ─────────
let menus = 0
export interface Option<T extends string> {
  value: T
  label: string
  glyph?: string // a model id: its family glyph leads the row
}
/** A select without <select>: a trigger and a popover menu anchored under it, the pick checked. */
export const Menu = <T extends string>(props: {
  value: T | undefined
  options: readonly Option<T>[]
  onPick: (v: T) => void
  placeholder?: string
  label?: string
  small?: boolean
}) => {
  const id = `menu-${menus++}`
  const current = () => props.options.find((o) => o.value === props.value)
  return (
    <>
      <button type="button" class={{ select: true, sm: !!props.small }} popovertarget={id} aria-label={props.label}>
        <Show when={current()?.glyph}>{(g) => <Family id={g()} />}</Show>
        <span class="label">{current()?.label ?? props.placeholder ?? ""}</span>
        <Caret class="caret" />
      </button>
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
  <button type="button" class="icon back-pane" aria-label="返回列表" onClick={() => props.onBack()}>
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
/** A card sliding in over the detail card's right side, its scrim closing it; the content is the caller's. */
export const Drawer = (props: { open: boolean; label: string; onClose: () => void; children: JSX.Element }) => (
  <>
    <div class="drawer-scrim" data-open={props.open ? "true" : "false"} onClick={() => props.onClose()} />
    <aside class="side-drawer" data-open={props.open ? "true" : "false"} aria-label={props.label}>
      {props.children}
    </aside>
  </>
)
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
        <button type="button" class="icon sm" aria-label="关闭" onClick={() => el.close()}>
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
          取消
        </button>
        <button type="button" class="chip danger" onClick={() => (el.close(), asking()?.run())}>
          删除
        </button>
      </div>
    </dialog>
  )
}
