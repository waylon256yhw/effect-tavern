import { AsyncView } from "./async-view.tsx"
import { InvocationMenu } from "./invocation-menu.tsx"
import { addInvocation, backspaceInvocation, removeInvocation } from "./composition.ts"
// The composer: the one raised object under the column, one line at rest (#117): `+` (the snippets menu, or / on an
// empty box), the box, Send / Stop. What serves the typing hangs on the box's top edge only while it is in use: the
// format keys, a row of glyph chips over the text while the hand is in the box or words are; the note to the
// narrator a note snippet opens (a word that goes with the line, or alone), its own box in a thin strip; the line
// being revised, a strip naming its turn; entry chips carry this turn's invocations.
import type { Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import { createSignal, onSettled, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Check, Close, Edit, Insert, Send, Snippets, Stop } from "./icons.tsx"
import { imeController } from "./ime.ts"
import { roam } from "./controls.tsx"
import { fillKnown } from "./pack.ts"
import {
  acting,
  composition,
  updateComposition,
  cancelRevise,
  card,
  path,
  registry,
  revising,
  settling,
  stage,
  turnOf,
  working,
} from "./store.ts"
import { turn } from "./turn.ts"
import { t } from "./i18n.ts"

export const Composer = () => {
  const busy = read(working)
  const phase = read(stage)
  // Narrate halts the prose; record cancellation preserves the already saved node.
  const stoppable = () => phase() === "record" || !settling(phase())
  const model = read(composition)
  const text = () => model().text
  const noteText = () => model().note
  const view = read(card)
  // The card's default channel is the mode for the whole session (GET /card `input`): in participant mode the box is the
  // character's line, a thought is this turn's deviation inside it, and a note to the narrator is a second box under it
  // that goes with the line or alone; in author mode every input is direction and neither exists (store.ts `acting`).
  const quick = () => view()?.layer?.snippets ?? []
  // The snippets menu groups by meaning: a note snippet is a word to the narrator, the rest stay in the story.
  const inStory = () => quick().filter((s) => !s.note)
  const toNarrator = () => quick().filter((s) => s.note)
  const keys = () => view()?.layer?.format ?? []
  // The note box is open (participant mode only). It is one state, not a tag per snippet: any number of note snippets
  // may go into that box; it clears after the send.
  const toNarratorOn = () => model().noteOpen
  // Revising a landed line: the chip names the turn (a tap scrolls to it) and cancels; Keep sits beside Send.
  const revise = read(revising)
  const selected = () => model().invocations
  const [menuOpen, setMenuOpen] = createSignal(false)
  const line = read(path)
  const blocked = () =>
    !revise() && line().some((n) => n.settlementStatus === "pending" || n.settlementStatus === "failed")
  const locate = () =>
    document.getElementById(`node-${revise()!.node}`)?.scrollIntoView({ block: "start", behavior: "instant" })
  // An empty line on a card with openings: the story starts from one of them (the card page), not from a typed root.
  const waiting = () => line().length === 0 && (view()?.greetings.length ?? 0) > 0
  // The placeholder is one line of invitation; the keys live on the buttons' tooltips, not in the writing space.
  const prompt = () =>
    waiting() ? t("composer.pickOpening") : acting() ? t("composer.yourLine") : t("composer.toNarrator")
  let box: HTMLTextAreaElement | undefined
  let noteBox: HTMLTextAreaElement | undefined
  let menu: HTMLDivElement | undefined
  let menuKeyboard = false
  /** What a send carries: the main box, and the note box when it is there. */
  const filled = () => selected().length > 0 || !!(text().trim() || (acting() && noteText().trim()))
  // The caret lands after what went in, and the hand with it: a note snippet puts the hand in the note's box, where
  // its words are (sent as they stand, or finished there), and the line's box, with the keys that serve it, waits for
  // a tap of its own.
  const put = (value: string, caret: number, note = false) => {
    updateComposition(note ? { note: value } : { text: value })
    requestAnimationFrame(() => {
      const el = note ? noteBox : box
      el?.setSelectionRange(caret, caret)
      el?.focus()
    })
  }
  // An Insert (a format key or a snippet) goes in at the caret and never sends: `text` before the caret, `after`
  // behind it, the selection between them. A note snippet opens the note box and goes in there; an empty one only
  // opens it.
  const insert = (s: { text: string; after?: string; note?: boolean }) => {
    // a popover closing with the focus inside it gives the focus back to where it was before it opened, after this
    // frame; the blur keeps that from undoing the focus `put` sets
    ;(document.activeElement as HTMLElement | null)?.blur()
    menu?.hidePopover()
    const note = !!s.note && acting()
    if (note) updateComposition({ noteOpen: true })
    const el = note ? noteBox : box
    const v = note ? noteText() : text()
    const a = el?.selectionStart ?? v.length
    const b = el?.selectionEnd ?? a
    const inner = v.slice(a, b)
    const before = fillKnown(s.text, view()?.layer?.names)
    const after = s.after ? fillKnown(s.after, view()?.layer?.names) : ""
    put(v.slice(0, a) + before + inner + after + v.slice(b), a + before.length + inner.length, note)
  }
  const Items = (p: { of: readonly Snippet[] }) => (
    <For each={p.of} keyed={(s) => s.name}>
      {(s) => (
        <button
          type="button"
          role="menuitem"
          class="item"
          tabindex="-1"
          onPointerDown={keep} // a press does not focus the item: the keys row that follows a focused item would move the menu under the pointer
          onClick={() => insert(s())}
        >
          <span class="name">{s().name}</span>
          <span class="hint">{s().hint}</span>
          {/* a snippet with words fills the box, like an Options row; a mark or the bare channel switch does not */}
          <Show when={s().text && !s().after}>
            <Insert aria-hidden="true" />
          </Show>
        </button>
      )}
    </For>
  )
  const submit = (keep = false) => {
    if (!filled() || busy() || waiting() || blocked()) return false
    if (keep) turn.keep()
    else turn.act()
    return true
  }
  // oxlint-disable-next-line solid/reactivity -- submit runs inside the keydown handler, where its reads are current
  const ime = imeController(submit)
  // oxlint-disable-next-line solid/reactivity -- the note box's own composition state, the same submit
  const noteIme = imeController(submit)
  onSettled(() => () => {
    ime.dispose()
    noteIme.dispose()
  })
  const keep = (e: Event) => e.preventDefault() // a tap on a control must not take focus (and the phone's keyboard) from the box
  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div
        class="box"
        // The whole box is the input: a press on its padding, an attachment's strip or the keys row lands in the
        // text, never blurs it.
        onPointerDown={(e) => {
          const t = e.target as HTMLElement
          if (t.closest("button, textarea, [popover]")) return
          e.preventDefault()
          ;(t.closest(".attach.note") ? noteBox : box)?.focus()
        }}
      >
        {/* the attachments on the box's top edge, each a thin strip that is there only while it is in use (#117): the
            line being revised (a tap scrolls to its turn, × cancels), and the note to the narrator (its own box, on
            the line's text axis, × closes it; Escape on an empty one closes it too) */}
        <Show when={revise()}>
          {(r) => (
            <div class="attach revise">
              <button
                type="button"
                class="bare"
                aria-label={t("composer.showTurn")}
                onPointerDown={keep}
                onClick={locate}
              >
                <Edit aria-hidden="true" />
                {t("composer.revising")} {turnOf(line(), r().node)}
              </button>
              <span class="spacer" />
              <button
                type="button"
                class="icon"
                aria-label={t("common.cancel")}
                onPointerDown={keep}
                onClick={cancelRevise}
              >
                <Close />
              </button>
            </div>
          )}
        </Show>
        <Show when={acting()}>
          <div class={{ attach: true, note: true, closed: !toNarratorOn() }} inert={!toNarratorOn()}>
            <span class="tag">{t("composer.noteTag")}</span>
            <textarea
              ref={(el) => (noteBox = el)}
              class="note"
              value={noteText()}
              enterkeyhint="enter"
              aria-label={t("composer.noteToNarrator")}
              onInput={(e) => updateComposition({ note: e.currentTarget.value })}
              onCompositionStart={noteIme.compositionStart}
              onCompositionEnd={noteIme.compositionEnd}
              onKeyDown={(e) => {
                if (e.key === "Escape" && revise()) cancelRevise()
                else if (e.key === "Escape" && !noteText()) {
                  updateComposition({ noteOpen: false }) // the strip goes inert: the hand leaves it, and returns to the line only if words wait there (as ×)
                  if (text()) box?.focus()
                } else noteIme.keyDown(e)
              }}
            />
            <button
              type="button"
              class="icon"
              aria-label={t("composer.closeNote")}
              onPointerDown={keep}
              onClick={() => (
                updateComposition({ noteOpen: false }),
                updateComposition({ note: "" }),
                text() && box?.focus()
              )}
            >
              <Close />
            </button>
          </div>
        </Show>
        {/* the format keys: a row of glyph chips right over the text, there while the hand is in the box or words are
            (reader.css); at rest the box is one line */}
        <Show when={keys().length > 0}>
          <div class="format" aria-label={t("composer.formatKeys")}>
            <For each={keys()} keyed={(k) => k.label}>
              {(k) => (
                <button type="button" class="chip" onPointerDown={keep} onClick={() => insert(k())}>
                  {k().label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="row">
          <button
            type="button"
            class="icon"
            aria-label={t("composer.snippets")}
            aria-haspopup="menu"
            popovertarget="snippets"
            onPointerDown={(e) => {
              menuKeyboard = false
              keep(e)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") menuKeyboard = true
            }}
          >
            <Snippets />
          </button>
          <div
            id="snippets"
            class="snippets"
            popover
            role="menu"
            ref={(el) => (menu = el)}
            onKeyDown={(e) => {
              if (!(e.target instanceof HTMLInputElement)) roam(e)
            }}
            onToggle={(e) => {
              setMenuOpen(e.newState === "open")
              if (e.newState === "open" && document.activeElement?.matches("[popovertarget=snippets]"))
                requestAnimationFrame(() => menu?.querySelector<HTMLElement>("[role=menuitem]")?.focus())
            }}
          >
            <Show when={menuOpen()}>
              <AsyncView>
                <InvocationMenu
                  keyboard={menuKeyboard}
                  quick={
                    <div class="quick">
                      <Items of={inStory()} />
                      <hr />
                      <Items of={toNarrator()} />
                    </div>
                  }
                  choose={(item) => {
                    registry.update(composition, (d) => addInvocation(d, item))
                    menu?.hidePopover()
                    requestAnimationFrame(() => box?.focus())
                  }}
                />
              </AsyncView>
            </Show>
          </div>
          <div class="compose-input">
            <For each={selected()} keyed={(i) => i.resourceId}>
              {(item) => (
                <button
                  type="button"
                  class="chip invocation"
                  aria-label={t("composer.removeInvocation", { title: item().title })}
                  onPointerDown={keep}
                  onClick={() => {
                    const id = item().resourceId
                    registry.update(composition, (d) => removeInvocation(d, id))
                  }}
                >
                  {item().title}
                  <Close />
                </button>
              )}
            </For>
            <textarea
              ref={(el) => (box = el)}
              value={text()}
              placeholder={selected().length ? "" : prompt()}
              aria-label={prompt()}
              enterkeyhint="enter"
              onInput={(e) => updateComposition({ text: e.currentTarget.value })}
              // a thought's open bracket brings its close: half a pair would leave the model guessing where the thought ends
              onBeforeInput={(e) => {
                if (e.inputType !== "insertText" || e.data !== "⦅") return
                e.preventDefault()
                const { selectionStart: a, selectionEnd: b, value } = e.currentTarget
                put(`${value.slice(0, a)}⦅${value.slice(a, b)}⦆${value.slice(b)}`, a + 1)
              }}
              onCompositionStart={ime.compositionStart}
              onCompositionEnd={ime.compositionEnd}
              onKeyDown={(e) => {
                // "/" on an empty box opens the snippets menu: the keyboard's way to the same menu, no command grammar.
                if (e.key === "Backspace") {
                  const before = registry.get(composition)
                  const after = backspaceInvocation(
                    before,
                    e.currentTarget.selectionStart,
                    e.currentTarget.selectionEnd,
                    e.isComposing || ime.compositionActive() || e.keyCode === 229,
                  )
                  if (before !== after) {
                    e.preventDefault()
                    registry.set(composition, after)
                    return
                  }
                }
                if (e.key === "/" && !e.isComposing && !ime.compositionActive() && text() === "" && menu) {
                  e.preventDefault()
                  menuKeyboard = true
                  menu.showPopover()
                  menu.querySelector<HTMLElement>("[role=menuitem]")?.focus()
                } else if (e.key === "Escape" && revise()) cancelRevise()
                else ime.keyDown(e, selected().length > 0 && !text().trim() && !noteText().trim())
              }}
            />
          </div>
          <Show when={revise()}>
            <button
              type="button"
              class="icon"
              aria-label={t("composer.keepProse")}
              disabled={!filled() || busy()}
              onPointerDown={keep}
              onClick={() => submit(true)}
            >
              <Check />
            </button>
          </Show>
          <Show
            when={busy() && stoppable()}
            fallback={
              <button
                type="submit"
                class="send"
                aria-label={t("composer.send")}
                disabled={!filled() || busy() || waiting() || blocked()}
                onPointerDown={keep}
              >
                <Send />
              </button>
            }
          >
            <button
              type="button"
              class="send"
              aria-label={t("composer.stop")}
              onPointerDown={keep}
              onClick={() => void turn.stop()}
            >
              <Stop />
            </button>
          </Show>
        </div>
      </div>
    </form>
  )
}
