// The composer: the one raised object under the column. The box, the format keys, the snippets menu (+, or / on an
// empty box), the note box a note snippet opens under the line (a word to the narrator that goes with the line, or
// alone), Send / Stop. The session's own actions live beside the reading (side.tsx).
import type { Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import { For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Check, Close, Edit, Insert, PinFill, Send, Snippets, Stop } from "./icons.tsx"
import { imeController } from "./ime.ts"
import { roam } from "./side.tsx"
import { aside, card, compose, noted, path, pin, registry, revising, turnOf } from "./store.ts"

export const Composer = (props: {
  busy: boolean
  stoppable: boolean // the prose can still be halted: before and during narrate, not while the turn settles
  onSend: (text: string, note: string) => void // the main box and the note box (empty when closed or in author mode)
  onKeep: (text: string, note: string) => void // revising: the input sent as a sibling that keeps the prose
  onCancel: () => void // revising: the line put back, the displaced draft restored
  onStop: () => void
}) => {
  const text = read(compose)
  const noteText = read(noted)
  const pinned = read(pin)
  const view = read(card)
  // The card's default channel is the mode for the whole session (GET /card `input`): in participant mode the box is the
  // character's line, a thought is this turn's deviation inside it, and a note to the narrator is a second box under it
  // that goes with the line or alone; in author mode every input is direction and neither exists.
  const acting = () => view()?.input === "act"
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
  const TO_NARRATOR = "To the narrator, not in the story…"
  // An empty line on a card with openings: the story starts from one of them (the card page), not from a typed root.
  const waiting = () => line().length === 0 && (view()?.greetings.length ?? 0) > 0
  // The placeholder is one line of invitation; the keys live on the buttons' tooltips, not in the writing space.
  const prompt = () => (waiting() ? "Pick an opening on the card page…" : acting() ? "Your line…" : TO_NARRATOR)
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
    if (!filled() || props.busy || waiting()) return false
    const t = text().trim()
    const n = acting() ? noteText().trim() : ""
    if (keep) props.onKeep(t, n)
    else props.onSend(t, n)
    registry.set(compose, "")
    registry.set(noted, "")
    registry.set(aside, false)
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
        // The whole box is the input: a press on its padding or the keys row lands in the text, never blurs it.
        onPointerDown={(e) => {
          const t = e.target as HTMLElement
          if (t.closest("button, textarea, [popover]")) return
          e.preventDefault()
          ;(t.closest(".tray") ? noteBox : box)?.focus()
        }}
      >
        <Show when={keys().length > 0}>
          <div class="format" aria-label="Format keys">
            <For each={keys()} keyed={(k) => k.label}>
              {(k) => (
                <button type="button" class="chip" onPointerDown={keep} onClick={() => insert(k())}>
                  {k().label}
                </button>
              )}
            </For>
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
            } else if (e.key === "Escape" && revise()) props.onCancel()
            else ime.keyDown(e)
          }}
        />
        {/* the note's tray: an inset block under the line, the marginal line's mark at its left (the reader's), its ×
            at its right; Escape on an empty box closes it too */}
        <Show when={acting() && toNarratorOn()}>
          <div class="tray">
            <textarea
              ref={(el) => (noteBox = el)}
              class="note"
              value={noteText()}
              placeholder={TO_NARRATOR}
              enterkeyhint="enter"
              aria-label="Note to the narrator"
              onInput={(e) => registry.set(noted, e.currentTarget.value)}
              onCompositionStart={noteIme.compositionStart}
              onCompositionEnd={noteIme.compositionEnd}
              onKeyDown={(e) => {
                if (e.key === "Escape" && revise()) props.onCancel()
                else if (e.key === "Escape" && !noteText()) {
                  registry.set(aside, false)
                  box?.focus()
                } else noteIme.keyDown(e)
              }}
            />
            <button
              type="button"
              class="icon"
              aria-label="Close the note"
              onPointerDown={keep}
              onClick={() => (registry.set(aside, false), registry.set(noted, ""), box?.focus())}
            >
              <Close />
            </button>
          </div>
        </Show>
        <div class="row">
          <Show when={quick().length > 0}>
            <button
              type="button"
              class="icon"
              aria-label="Snippets"
              data-hint="Snippets /"
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
          <Show when={revise()}>
            {(r) => (
              <span class="chip state">
                <button type="button" class="bare" aria-label="Show the turn" onPointerDown={keep} onClick={locate}>
                  <Edit aria-hidden="true" />
                  Revising {turnOf(line(), r().node)}
                </button>
                <button type="button" class="bare" aria-label="Cancel" onPointerDown={keep} onClick={props.onCancel}>
                  <Close />
                </button>
              </span>
            )}
          </Show>
          <Show when={pinned()}>
            <button type="button" class="icon" aria-label="Unpin" onClick={() => registry.set(pin, null)}>
              <PinFill />
            </button>
          </Show>
          <span class="spacer" />
          <Show when={revise()}>
            <button
              type="button"
              class="icon"
              aria-label="Keep the prose"
              data-hint="Keep the prose, redo the record"
              disabled={!filled() || props.busy}
              onPointerDown={keep}
              onClick={() => submit(true)}
            >
              <Check />
            </button>
          </Show>
          <Show
            when={props.busy && props.stoppable}
            fallback={
              <button
                type="submit"
                class="send"
                aria-label="Send"
                data-hint="Send ⌘↵"
                disabled={!filled() || props.busy || waiting()}
                onPointerDown={keep}
              >
                <Send />
              </button>
            }
          >
            <button type="button" class="send" aria-label="Stop" onPointerDown={keep} onClick={() => props.onStop()}>
              <Stop />
            </button>
          </Show>
        </div>
      </div>
    </form>
  )
}
