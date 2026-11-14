// The settings page's shared pieces (settings.tsx, providers.tsx and its parts): the controls the prototype draws (a
// menu instead of <select>, a switch, a letter avatar, a name edited in place), the shells (a side drawer over the
// detail card, a modal, the one delete confirm), and the small pure helpers the sections share. No state of a section
// lives here.
import { lookup } from "@effect-tavern/provider/src/names.ts"
import { normalize, plan, type Format } from "@effect-tavern/provider/src/url.ts"
import type { JSX } from "@solidjs/web"
import { For, onSettled, Show } from "solid-js"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogTitle,
  createConfirm,
} from "@ui-sdk/solid/alert-dialog"
import { createDialogController, Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/solid/dialog"
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectTrigger } from "@ui-sdk/solid/select"
import { Switch as Toggle, SwitchThumb } from "@ui-sdk/solid/switch"
import { Family } from "./family.tsx"
import { Back, Caret, Check, Close } from "./icons.tsx"
import { names } from "./store.ts"
import { t } from "./i18n.ts"

/** The menu's keyboard: arrows move focus among the items and wrap, Home/End jump; Escape and outside clicks are the popover's. */
export const roam = (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role^=menuitem]")]
  const i = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
  const d = { ArrowDown: 1, ArrowUp: -1, Home: -i, End: items.length - 1 - i }[e.key]
  if (d === undefined) return
  e.preventDefault()
  items.at((i + d) % items.length)?.focus()
}

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
export interface Option<T extends string> {
  value: T
  label: string
  glyph?: string // a model id: its family glyph leads the row
}
/** A select without <select>, on @ui-sdk/solid/select: a trigger and its list, the pick checked, a bottom sheet on a
 *  small touch screen. With nothing to pick, the trigger is disabled and still names the pick it holds (a stale one
 *  too). */
export const Menu = <T extends string>(props: {
  value: T | undefined
  options: readonly Option<T>[]
  onPick: (v: T) => void
  placeholder?: string
  stale?: Option<T> // what the trigger shows when the value is set but not among the options (a dangling pick)
  label?: string
  small?: boolean
}) => {
  const current = () => props.options.find((o) => o.value === props.value) ?? props.stale
  return (
    <Select
      value={props.value ?? null}
      items={props.options.map((o) => ({ value: o.value, label: o.label }))}
      onValueChange={(v) => v !== null && props.onPick(v as T)}
      disabled={props.options.length === 0}
      presentation="auto"
    >
      <SelectTrigger class={{ select: true, sm: !!props.small }} aria-label={props.label}>
        <Show when={current()?.glyph}>{(g) => <Family id={g()} />}</Show>
        <span class="label">{current()?.label ?? props.placeholder ?? ""}</span>
        <Caret class="caret" />
      </SelectTrigger>
      <SelectContent class="popup-list scroller" sideOffset={4} align="start">
        <For each={props.options} keyed={(o) => o.value}>
          {(o) => (
            <SelectItem value={o().value} class="item">
              <span class="name">
                <Show when={o().glyph}>{(g) => <Family id={g()} />}</Show>
                <span class="text">{o().label}</span>
              </span>
              <SelectItemIndicator>
                <Check />
              </SelectItemIndicator>
            </SelectItem>
          )}
        </For>
      </SelectContent>
    </Select>
  )
}
export const Switch = (props: { on: boolean; label: string; onFlip: () => void; disabled?: boolean }) => (
  <Toggle
    class="switch"
    checked={props.on}
    disabled={props.disabled}
    aria-label={props.label}
    onCheckedChange={() => props.onFlip()}
  >
    <SwitchThumb class="thumb" />
  </Toggle>
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
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        props.open &&
        !document.querySelector(":popover-open, dialog[open]")
      )
        props.onClose()
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
/** What an opener keeps of a dialog, in place of its element: `open()` and `close()`. The owner makes one and passes
 *  it to the shell (`Modal`, readings.tsx `Sheet`) as `controller`. */
export const dialogHandle = () => createDialogController()
export type DialogHandle = ReturnType<typeof dialogHandle>
/** A modal: the head with its close, then the caller's body and foot, drawn only while it is open. Scrim click and
 *  Escape close it too; `onClose` runs once it has left. */
export const Modal = (props: {
  title: string
  narrow?: boolean
  controller: DialogHandle
  onClose?: () => void
  children: JSX.Element
}) => (
  <Dialog controller={props.controller} onOpenChangeComplete={(open) => !open && props.onClose?.()}>
    <DialogContent class={{ modal: true, narrow: !!props.narrow }}>
      <div class="modal-head">
        <DialogTitle render={(part) => <h3 {...part} />}>{props.title}</DialogTitle>
        <DialogClose class="icon sm" aria-label={t("common.close")}>
          <Close />
        </DialogClose>
      </div>
      {props.children}
    </DialogContent>
  </Dialog>
)
/** A small centred dialog on the confirm's surface: the question, which names it, then the caller's fields and
 *  buttons. Scrim click and Escape close it. */
export const Prompt = (props: { controller: DialogHandle; title: JSX.Element; children: JSX.Element }) => (
  <Dialog controller={props.controller}>
    <DialogContent class="confirm">
      <DialogTitle render={(part) => <p {...part} />}>{props.title}</DialogTitle>
      {props.children}
    </DialogContent>
  </Dialog>
)

// The one delete confirm on the page: `ask` opens it with the question and what Delete then does. Escape and Cancel
// keep the record; a press outside leaves the question open (an alert dialog wants an answer).
const confirm = createConfirm<string>()
export const ask = (text: string, run: () => void) => void confirm(text).then((yes) => yes && run())
export const Confirm = () => (
  <AlertDialog controller={confirm.controller}>
    <AlertDialogContent<string> class="confirm">
      {(state) => (
        <>
          <AlertDialogTitle render={(part) => <p {...part} />}>{state.payload}</AlertDialogTitle>
          <div class="row">
            <AlertDialogClose class="chip state">{t("common.cancel")}</AlertDialogClose>
            <AlertDialogClose class="chip danger" value="confirm" data-agent-confirm={state.payload}>
              {t("common.delete")}
            </AlertDialogClose>
          </div>
        </>
      )}
    </AlertDialogContent>
  </AlertDialog>
)
