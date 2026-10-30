// The composer: the one raised object under the column, one line at rest (#117): `+` (the snippets menu, or / on an
// empty box), the box, Send / Stop. What serves the typing hangs on the box's top edge only while it is in use: the
// format keys, a row of glyph chips over the text while the hand is in the box or words are; the note to the
// narrator a note snippet opens (a word that goes with the line, or alone), its own box in a thin strip; the line
// being revised, a strip naming its turn. The pin is not here: armed and shown in the Record (and the session's
// pinned row), it rides on the next send (turn.ts). The session's own actions live beside the reading (side.tsx).
import type { Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import { For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Check, Close, Edit, Insert, Send, Snippets, Stop } from "./icons.tsx"
import { imeController } from "./ime.ts"
import { roam } from "./controls.tsx"
import {
  acting,
  aside,
  cancelRevise,
  card,
  compose,
  noted,
  path,
  registry,
  revising,
  setBoxes,
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
  // the prose can still be halted: before and during narrate, not while the turn settles
  const stoppable = () => !settling(phase())
  const text = read(compose)
  const noteText = read(noted)
  const view = read(card)
  // The card's default channel is the mode for the whole session (GET /card `input`): in participant mode the box is the
  // character's line, a thought is this turn's deviation inside it, and a note to the narrator is a second box under it
  // that goes with the line or alone; in author mode every input is direction and neither exists (store.ts `acting`).
  const quick = () => view()?.snippets ?? []
  // The snippets menu groups by meaning: a note snippet is a word to the narrator, the rest stay in the story.
  const inStory = () => quick().filter((s) => !s.note)
  const toNarrator = () => quick().filter((s) => s.note)
  const keys = () => view()?.format ?? []
  // The note box is open (participant mode only). It is one state, not a tag per snippet: any number of note snippets
  // may go into that box; it clears after the send.
  const toNarratorOn = read(aside)
  // Revising a landed line: the chip names the turn (a tap scrolls to it) and cancels; Keep sits beside Send.
  const revise = read(revising)
  const line = read(path)
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
  /** What a send carries: the main box, and the note box when it is there. */
  const filled = () => !!(text().trim() || (acting() && noteText().trim()))
  // The caret lands after what went in. A note with words leaves the hand in the line's box (the line is what is being
  // written, the note a word on the side); the bare one only opens the note box, so the hand goes there to write it.
  const put = (value: string, caret: number, note = false, there = false) => {
    registry.set(note ? noted : compose, value)
    requestAnimationFrame(() => {
      ;(note ? noteBox : box)?.setSelectionRange(caret, caret)
      ;(there ? noteBox : box)?.focus()
    })
  }
  // An Insert (a format key or a snippet) goes in at the caret and never sends: `text` before the caret, `after`
  // behind it, the selection between them. A note snippet opens the note box and goes in there (the line's box keeps
  // the focus); an empty one only opens it.
  const insert = (s: { text: string; after?: string; note?: boolean }) => {
    // a popover closing with the focus inside it gives the focus back to where it was before it opened, after this
    // frame; the blur keeps that from undoing the focus `put` sets
    ;(document.activeElement as HTMLElement | null)?.blur()
    menu?.hidePopover()
    const note = !!s.note && acting()
    if (note) registry.set(aside, true)
    const el = note ? noteBox : box
    const v = note ? noteText() : text()
    const a = el?.selectionStart ?? v.length
    const b = el?.selectionEnd ?? a
    const inner = v.slice(a, b)
    put(
      v.slice(0, a) + s.text + inner + (s.after ?? "") + v.slice(b),
      a + s.text.length + inner.length,
      note,
      note && !s.text,
    )
  }
  const Items = (p: { of: readonly Snippet[] }) => (
    <For each={p.of} keyed={(s) => s.name}>
      {(s) => (
        <button type="button" role="menuitem" class="item" tabindex="-1" onClick={() => insert(s())}>
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
    if (!filled() || busy() || waiting()) return false
    const t = text().trim()
    const n = acting() ? noteText().trim() : ""
    if (keep) turn.keep(t, n)
    else turn.act(t, n)
    setBoxes({ text: "", note: "", aside: false })
    return true
  }
  // oxlint-disable-next-line solid/reactivity -- submit runs inside the keydown handler, where its reads are current
  const ime = imeController(submit)
  // oxlint-disable-next-line solid/reactivity -- the note box's own composition state, the same submit
  const noteIme = imeController(submit)
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
        <Show when={acting() && toNarratorOn()}>
          <div class="attach note">
            <span class="tag">{t("composer.noteTag")}</span>
            <textarea
              ref={(el) => (noteBox = el)}
              class="note"
              value={noteText()}
              enterkeyhint="enter"
              aria-label={t("composer.noteToNarrator")}
              onInput={(e) => registry.set(noted, e.currentTarget.value)}
              onCompositionStart={noteIme.compositionStart}
              onCompositionEnd={noteIme.compositionEnd}
              onKeyDown={(e) => {
                if (e.key === "Escape" && revise()) cancelRevise()
                else if (e.key === "Escape" && !noteText()) {
                  registry.set(aside, false)
                  box?.focus()
                } else noteIme.keyDown(e)
              }}
            />
            <button
              type="button"
              class="icon"
              aria-label={t("composer.closeNote")}
              onPointerDown={keep}
              onClick={() => (registry.set(aside, false), registry.set(noted, ""), box?.focus())}
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
          <Show when={quick().length > 0}>
            <button
              type="button"
              class="icon"
              aria-label={t("composer.snippets")}
              aria-haspopup="menu"
              popovertarget="snippets"
            >
              <Snippets />
            </button>
            <div
              id="snippets"
              class="snippets"
              popover
              role="menu"
              ref={(el) => (menu = el)}
              onKeyDown={roam}
              onFocusOut={(e) => !menu?.contains(e.relatedTarget as HTMLElement | null) && menu?.hidePopover()}
              onToggle={(e) =>
                e.newState === "open" &&
                e.currentTarget.matches(":popover-open") && // the event is queued: a pick may already have closed it
                e.currentTarget.querySelector<HTMLElement>("[role=menuitem]")?.focus()
              }
            >
              {/* two groups, in the story and to the narrator, parted by a line: the items are the card's language, the chrome adds no words */}
              <Items of={inStory()} />
              <hr />
              <Items of={toNarrator()} />
            </div>
          </Show>
          <textarea
            ref={(el) => (box = el)}
            value={text()}
            placeholder={prompt()}
            enterkeyhint="enter"
            onInput={(e) => registry.set(compose, e.currentTarget.value)}
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
              if (e.key === "/" && !e.isComposing && text() === "" && menu) {
                e.preventDefault()
                menu.showPopover()
              } else if (e.key === "Escape" && revise()) cancelRevise()
              else ime.keyDown(e)
            }}
          />
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
                disabled={!filled() || busy() || waiting()}
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
