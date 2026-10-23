// The composer: the one raised object under the column. The box, the format keys, the snippets menu (+, or / on an
// empty box), the ⋯ Session menu (the Inspector, Start over, Delete story), the channel chip, Send / Stop.
import type { Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import { For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Check, Close, Edit, Insert, More, PinFill, Send, Snippets, Stop } from "./icons.tsx"
import { imeController } from "./ime.ts"
import { openInspector } from "./inspector.tsx"
import { aside, card, compose, error, log, path, pin, registry, revising, started, turnOf } from "./store.ts"
import { dropNodes, send } from "./wire.ts"

export const Composer = (props: {
  busy: boolean
  stoppable: boolean // the prose can still be halted: before and during narrate, not while the turn settles
  onSend: (text: string, note: boolean) => void
  onKeep: (text: string) => void // revising: the line sent as a sibling that keeps the prose
  onCancel: () => void // revising: the line put back, the displaced draft restored
  onStop: () => void
}) => {
  const text = read(compose)
  const pinned = read(pin)
  const view = read(card)
  // The card's default channel is the mode for the whole session (GET /card `input`): in participant mode the box is the
  // character's line and a note to the narrator or a thought is this turn's deviation; in author mode every input is
  // direction and neither exists.
  const acting = () => view()?.input === "act"
  const quick = () => view()?.snippets ?? []
  // The snippets menu groups by meaning: a note snippet is a word to the narrator, the rest stay in the story.
  const inStory = () => quick().filter((s) => !s.note)
  const toNarrator = () => quick().filter((s) => s.note)
  const keys = () => view()?.format ?? []
  // This one send is a note (participant mode only). It is one state, not a tag per snippet: any number of note snippets
  // may go into the box, the chip says only where the send goes; it clears after the send.
  const toNarratorOn = read(aside)
  // Revising a landed line: the chip names the turn (a tap scrolls to it) and cancels; Keep sits beside Send.
  const revise = read(revising)
  const line = read(path)
  const locate = () =>
    document.getElementById(`node-${revise()!.node}`)?.scrollIntoView({ block: "start", behavior: "instant" })
  // A thread is a root's subtree, so starting over is a new root: the card's opening when it has one, else the
  // player's next line (the reading line empties until it lands). The old thread stays as the first turn's version.
  // Deleting a thread drops its root; an empty journal on a card with an opening greets again. Neither acts on a
  // thread with no player turn yet: there is nothing to leave behind or take.
  const begun = read(started)
  const open = () => (view()?.greetings ?? 0) > 0
  const clean = () => {
    registry.set(pin, null)
    registry.set(error, null)
  }
  const startOver = () => {
    clean()
    send(open() ? { kind: "greet" } : { kind: "checkout", node: null })
  }
  let confirmDrop!: HTMLDialogElement
  const deleteStory = async () => {
    clean()
    await dropNodes(registry.get(path)[0]!.turn.id) // the item is disabled while the line is empty
    if (registry.get(log).nodes.size === 0 && open()) send({ kind: "greet" })
  }
  const isNote = () => !acting() || toNarratorOn()
  // The placeholder is one line of invitation; the keys live on the buttons' tooltips, not in the writing space.
  const prompt = () => (isNote() ? "To the narrator, not in the story…" : "Your line…")
  let box: HTMLTextAreaElement | undefined
  let menu: HTMLDivElement | undefined
  const put = (value: string, caret: number) => {
    registry.set(compose, value)
    requestAnimationFrame(() => {
      box?.focus()
      box?.setSelectionRange(caret, caret)
    })
  }
  // An Insert (a format key or a snippet) goes in at the caret and never sends: `text` before the caret, `after`
  // behind it, the selection between them. A note snippet also switches this send's channel; an empty one does only that.
  const insert = (s: { text: string; after?: string; note?: boolean }) => {
    menu?.hidePopover()
    if (s.note) registry.set(aside, true)
    const v = text()
    const a = box?.selectionStart ?? v.length
    const b = box?.selectionEnd ?? a
    const inner = v.slice(a, b)
    put(v.slice(0, a) + s.text + inner + (s.after ?? "") + v.slice(b), a + s.text.length + inner.length)
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
    const t = text().trim()
    if (!t || props.busy) return false
    if (keep) props.onKeep(t)
    else props.onSend(t, isNote())
    registry.set(compose, "")
    registry.set(aside, false)
    return true
  }
  // oxlint-disable-next-line solid/reactivity -- submit runs inside the keydown handler, where its reads are current
  const ime = imeController(submit)
  const keep = (e: Event) => e.preventDefault() // a tap on a control must not take focus (and the phone's keyboard) from the box
  // The menu's keyboard: arrows move focus among the items and wrap, Home/End jump; Tab leaves the menu and closes it;
  // Escape and outside clicks are the popover's.
  const roam = (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")]
    const i = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
    const d = { ArrowDown: 1, ArrowUp: -1, Home: -i, End: items.length - 1 - i }[e.key]
    if (d === undefined) return
    e.preventDefault()
    items.at((i + d) % items.length)?.focus()
  }
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
          if ((e.target as HTMLElement).closest("button, textarea, [popover]")) return
          e.preventDefault()
          box?.focus()
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
                e.newState === "open" && e.currentTarget.querySelector<HTMLElement>("[role=menuitem]")?.focus()
              }
            >
              {/* two groups, in the story and to the narrator, parted by a line: the items are the card's language, the chrome adds no words */}
              <Items of={inStory()} />
              <hr />
              <Items of={toNarrator()} />
            </div>
          </Show>
          {/* the session's own menu, apart from the card's language in Snippets: what to look at (the Inspector) */}
          <button
            type="button"
            class="icon"
            aria-label="Session"
            aria-haspopup="menu"
            popovertarget="session"
            onPointerDown={keep}
          >
            <More />
          </button>
          <div
            id="session"
            class="snippets"
            popover
            role="menu"
            onKeyDown={roam}
            onToggle={(e) =>
              e.newState === "open" && e.currentTarget.querySelector<HTMLElement>("[role=menuitem]")?.focus()
            }
          >
            <For
              each={[
                { name: "Inspector", hint: "What the engine did this turn", go: openInspector },
                { name: "Start over", hint: "A new story; this one stays as a version", go: startOver, off: true },
                {
                  name: "Delete story",
                  hint: "Every turn of this story, for good",
                  go: () => confirmDrop.showModal(),
                  off: true,
                },
              ]}
              keyed={(i) => i.name}
            >
              {(i) => (
                <button
                  type="button"
                  role="menuitem"
                  class="item"
                  tabindex="-1"
                  disabled={i().off && (props.busy || !begun())}
                  onClick={(e) => {
                    e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
                    i().go()
                  }}
                >
                  <span class="name">{i().name}</span>
                  <span class="hint">{i().hint}</span>
                </button>
              )}
            </For>
          </div>
          {/* the one destructive action asks once, in the app's own dialog: Cancel on the left, the deed in red */}
          <dialog class="confirm" ref={(el) => (confirmDrop = el)} closedby="any">
            <p>Delete this story? Every turn in it is gone for good.</p>
            <div class="row">
              <button type="button" class="chip state" onClick={() => confirmDrop.close()}>
                Cancel
              </button>
              <button type="button" class="chip danger" onClick={() => (confirmDrop.close(), void deleteStory())}>
                Delete
              </button>
            </div>
          </dialog>
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
          <Show when={acting() && toNarratorOn() && !revise()}>
            <button
              type="button"
              class="chip state"
              aria-label="Back to your line"
              onPointerDown={keep}
              onClick={() => registry.set(aside, false)}
            >
              To the narrator
              <Close />
            </button>
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
              disabled={!text().trim() || props.busy}
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
                disabled={!text().trim() || props.busy}
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
