// One screen: the reading line as sections, the draft growing at its end, a composer at the bottom. A turn's actions
// sit under what they act on (#101): a row under the player's bubble (revise, copy), a row under the prose (the
// Record pill, which opens a full-page sheet of that turn's readings, src/record.ts projecting them, 小剧场 at its
// foot; the version count; Swipe / Reword / Edit); the last section carries the Options container, whose rows fill
// the composer and never send. The frame around it is the shell's (shell.tsx, #117): the sidebar of cards and
// stories with the persona and writing rows, the reader's keys (Timeline, Inspector, 读数), and under 72rem the
// phone's drawer and sheets. The pages (home, card, Timeline, Settings, Writing, 读数: Status, this turn's Record, 小剧场;
// Inspect) fill the stage card over the reader, which stays mounted under them so
// a turn in flight keeps streaming. Shapes follow docs/client-design-brief-3.md, docs/sidebar-brief-1.md and the
// canvas in docs/client-canvas/. The sheets are native <dialog>s, the snippet menu a popover anchored to its button:
// the platform is the component library. This file is the reader: the flow and the column; readings.tsx draws the
// Record's pieces, composer.tsx the box, inspector.tsx the Inspect page, bridge.ts the atom → accessor read they all use.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Node, Phase } from "@effect-tavern/runtime/src/session.ts"
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { CardPage } from "./card.tsx"
import { Composer } from "./composer.tsx"
import { dust } from "./dust.ts"
import { Home, Workshop } from "./home.tsx"
import { imeController } from "./ime.ts"
import { Check, Close, Copy, DieFill, Down, Edit, Insert, Next, Prev, Record, Warning } from "./icons.tsx"
import { Inspect } from "./inspector.tsx"
import { plain, Prose } from "./prose.tsx"
import { openSettings, Settings } from "./settings.tsx"
import { Timeline } from "./timeline.tsx"
import { WritingPage } from "./writing.tsx"
import { RecordSheet, Rewrite, SiblingKind, StatusPage } from "./readings.tsx"
import { lineOf, versions } from "./record.ts"
import { Shell } from "./shell.tsx"
import { shrinkwrap } from "./shrinkwrap.ts"
import {
  compose,
  dismiss,
  draft,
  editing,
  error,
  log,
  page,
  path,
  prose,
  registry,
  stories,
  revise,
  revising,
  settling,
  stage,
  type Draft,
  type Failure,
  type Id,
  working,
} from "./store.ts"
import { turn } from "./turn.ts"
import { boot, onKey } from "./pages.ts"
import { scroll } from "./tabs.ts"
import { type Key, t } from "./i18n.ts"

const waiting: Record<string, Key> = {
  lookup: "app.phaseLookup",
  decide: "app.phaseDecide",
  direct: "app.phaseDirect",
  narrate: "app.phaseNarrate",
  check: "app.phaseCheck",
  polish: "app.phasePolish",
  record: "app.phaseRecord",
}

const paragraphs = (text: string) => text.split(/\n{2,}/).filter((p) => p.trim())

/** The prose in place, editable (Edit): the same paragraphs made contenteditable, so not a glyph moves when the editor
 *  opens (a textarea re-flowed the whole turn: its own padding, and a blank line where the paragraph gap was). The
 *  host is a rich one, so Enter is a paragraph as the browser makes it (a <p>, with the reader's gap) and ⇧↵ a line
 *  break, both what innerText reads back and `paragraphs` splits; formatting and pasted markup are refused, text is
 *  text. ⌘↵ sends it as an `edit` sibling (check and record run over the player's text, nothing is narrated), Escape
 *  cancels, and so does sending it unchanged or empty. Two keys under it do the same for a touch screen, which has
 *  neither. The paragraphs are plain DOM the editor fills once: the player's typing mutates them, and nothing reactive
 *  must own what it did not write. */
const Editor = (props: { text: string; onDone: (text?: string) => void }) => {
  let box!: HTMLDivElement
  const submit = () => {
    const t = paragraphs(box.innerText).join("\n\n")
    props.onDone(t && t !== paragraphs(props.text).join("\n\n") ? t : undefined)
    return true
  }
  // oxlint-disable-next-line solid/reactivity -- submit runs inside the keydown handler, where its reads are current
  const ime = imeController(submit)
  onSettled(() => {
    for (const p of paragraphs(props.text)) box.append(Object.assign(document.createElement("p"), { textContent: p }))
    document.execCommand("defaultParagraphSeparator", false, "p")
    box.focus()
    const end = box.lastChild?.lastChild ?? box // the caret inside the last paragraph's text, after its last character
    getSelection()?.collapse(end, end.textContent?.length ?? 0)
  })
  return (
    <>
      <div
        class="editor"
        contenteditable="true"
        aria-label={t("app.editProse")}
        ref={(el) => (box = el)}
        onBeforeInput={(e) => e.inputType.startsWith("format") && e.preventDefault()}
        onPaste={(e) => {
          e.preventDefault()
          const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r?\n{2,}/g, "\n")
          document.execCommand("insertText", false, text)
        }}
        onCompositionStart={ime.compositionStart}
        onCompositionEnd={ime.compositionEnd}
        onKeyDown={(e) => (e.key === "Escape" ? props.onDone() : ime.keyDown(e))}
      />
      <div class="editkeys">
        <button type="button" class="icon" aria-label={t("common.cancel")} onClick={() => props.onDone()}>
          <Close />
        </button>
        <button type="button" class="icon" aria-label={t("common.save")} onClick={submit}>
          <Check />
        </button>
      </div>
    </>
  )
}

/** Following the live edge the way every chat reader does (Cherry Studio's state, open-claude-ui's constants): one
 *  state that only the user's intent flips. A scroll event the program did not cause is the user's (content growing
 *  under the viewport fires none): past 40px from the bottom they are reading, back within it they follow again;
 *  growth while following sticks to the bottom unless their hand was on the column within 150ms (wheel, touch or
 *  pointer inside it, or a key outside a field; anchoring a turn clears it); the way back shows past 120px. The one
 *  deviation is the anchor: a new turn lands at its own top, where the last section's min-height puts the column's
 *  end at the scroller's bottom, so following holds from there. Programmatic scrolls are instant: a smooth one fires
 *  many events no one could attribute. The scroller is the column (.scroll), never the page. */
const follow = {
  on: true,
  ours: null as number | null,
  touched: -Infinity,
  landing: false,
  checkout: null as { index: number; top: number | "start" } | null,
}
const scroller = () => document.querySelector(".scroll")!
const gap = () => scroller().scrollHeight - scroller().clientHeight - scroller().scrollTop
/** How much of the latest turn's content is below the viewport. The last section is at least a screen tall so a
 *  turn can land at its top; that filler is not something to jump to, so the way-back button reads the content's end. */
const hidden = () => {
  let last = document.querySelector("main > section:last-of-type")?.lastElementChild
  if (last && !last.getClientRects().length) last = last.previousElementSibling // .actions is display: none while editing
  return last ? last.getBoundingClientRect().bottom - scroller().getBoundingClientRect().bottom : gap()
}
const anchor = () => {
  follow.on = true
  follow.touched = -Infinity
  document.querySelector("main > section:last-of-type")?.scrollIntoView({ block: "start", behavior: "instant" })
  follow.ours = scroller().scrollTop
}
const stick = () => {
  scroller().scrollTo({ top: scroller().scrollHeight, behavior: "instant" })
  follow.ours = scroller().scrollTop
}
const Latest = () => {
  const [away, setAway] = createSignal(false)
  const lib = read(stories)
  const all = read(log)
  // another story opened: the reader lands at its live edge whatever the hand was doing (the row was just clicked):
  // following is on when its nodes arrive, and that arrival sticks by itself (two stories of one opening are the same
  // height, so the growth the observer would see may never come)
  createEffect(
    () => lib()?.current,
    (cur, prev) => {
      if (prev !== undefined && cur !== prev) {
        follow.on = true
        follow.touched = -Infinity
        follow.landing = true
        follow.checkout = null
      }
    },
  )
  createEffect(
    () => all(),
    () => {
      if (follow.landing) {
        follow.landing = false
        stick()
        return
      }
      if (!follow.checkout) return
      const { index, top } = follow.checkout
      follow.checkout = null
      follow.touched = performance.now()
      const sec = document.querySelectorAll("main > section")[index]
      if (!sec) return
      if (top === "start") sec.scrollIntoView({ block: "start", behavior: "instant" })
      else scroller().scrollTop += sec.getBoundingClientRect().top - scroller().getBoundingClientRect().top - top
      follow.ours = scroller().scrollTop
      follow.on = gap() <= 2
      setAway(!follow.on && hidden() > 120)
    },
  )
  onSettled(() => {
    const onScroll = () => {
      const g = gap()
      setAway(hidden() > 120)
      const t = follow.ours
      follow.ours = null
      if (t === null || Math.abs(scroller().scrollTop - t) > 2) follow.on = g <= 40
    }
    const onInput = (e: Event) => {
      const t = e.target as HTMLElement
      const field = t.isContentEditable || t.matches?.("input, textarea")
      if (e.type === "keydown" ? !field : t.closest?.(".scroll")) follow.touched = performance.now()
    }
    // opening included: the first growth is the story loading, and following from the start lands at its live edge;
    // the scroller shrinking (the composer growing under it) is the same event from the other side
    const ro = new ResizeObserver(() => {
      if (follow.on && performance.now() - follow.touched >= 150) stick()
      setAway(!follow.on && hidden() > 120)
    })
    ro.observe(document.querySelector("main")!)
    ro.observe(scroller())
    // a tab's scroll (tabs.ts): read when it is left; put back on the way in once the story has rendered (after the
    // landing's stick), where following holds only when that is within reach of the end
    scroll.get = () => scroller().scrollTop
    scroll.set = (top) =>
      void requestAnimationFrame(() => {
        follow.landing = false
        follow.checkout = null
        scroller().scrollTop = top
        follow.ours = scroller().scrollTop
        follow.on = gap() <= 40
        setAway(!follow.on && hidden() > 120)
      })
    const inputs = ["wheel", "touchmove", "keydown", "pointerdown"] as const
    scroller().addEventListener("scroll", onScroll, { passive: true })
    for (const e of inputs) addEventListener(e, onInput, { passive: true })
    return () => {
      ro.disconnect()
      scroller().removeEventListener("scroll", onScroll)
      for (const e of inputs) removeEventListener(e, onInput)
    }
  })
  return (
    <Show when={away()}>
      <button
        type="button"
        class="icon latest"
        aria-label={t("app.jumpToLatest")}
        onClick={() => {
          follow.on = true
          stick()
        }}
      >
        <Down />
      </button>
    </Show>
  )
}

/** The node being written: anchored at the top of the screen when it starts, a blinking cursor where the next
 *  character lands, the die while the beat is judged. A rewrite (check failed) blows the first draft away as dust
 *  (Telegram's) and writes the second from the top; the dead draft keeps its place, so the column holds still. Once the
 *  prose is done (check, polish, record) the cursor goes and the Record slot waits with three dots. A failed turn stays as a
 *  grey ghost with the error under it; its line is back in the box. No model to run it on: the error opens Settings on
 *  默认模型. */
const Draft = (props: { d: Draft; phase: Phase | null; error: Failure | null }) => {
  onSettled(anchor)
  const done = () => settling(props.phase)
  const writing = () => !done() && !props.error
  return (
    <section class={{ draft: true, dead: props.error !== null }}>
      <Said input={props.d.input} />
      <div class="drafts">
        <Show when={props.d.prev}>
          {(p) => (
            <div class="prev" aria-hidden="true" ref={(el: HTMLElement) => void dust(el)}>
              <Prose text={p()} />
            </div>
          )}
        </Show>
        <div class="now">
          <Prose
            text={props.d.text}
            open={writing()}
            tail={
              <Show when={writing()}>
                <span
                  class="cursor"
                  role="status"
                  aria-label={props.phase ? t(waiting[props.phase]!) : t("app.waiting")}
                >
                  <Show when={props.phase === "decide"}>
                    <DieFill />
                  </Show>
                </span>
              </Show>
            }
          />
        </div>
      </div>
      <Show when={done()}>
        <footer class="actions">
          <span class="record-pill" role="status" aria-label={t(waiting[props.phase!]!)}>
            <Record aria-hidden="true" />
            <span class="dots">
              <span />
              <span />
              <span />
            </span>
          </span>
        </footer>
      </Show>
      <Show when={props.error}>
        {(e) => (
          <p class="error" role="alert">
            <Warning aria-hidden="true" />
            <span>
              {e().message}
              <Show when={e().code === "no-model"}>
                {" "}
                <button type="button" class="go" onClick={() => openSettings("routing")}>
                  {t("app.goDefaultModel")}
                </button>
              </Show>
            </span>
            <button type="button" class="icon" aria-label={t("common.dismiss")} onClick={dismiss}>
              <Close />
            </button>
          </p>
        )}
      </Show>
    </section>
  )
}

/** The player's line, and the word to the narrator when one rides with it (a note-only turn is that word alone). */
const Said = (props: {
  input: { text: string; note?: string }
  node?: Node // a landed turn's: its line can be revised; the draft's keys are disabled
  revising?: "text" | "note" // the field of this line that is in the composer now: that bubble is marked
}) => {
  // The bubble is text, selectable like any, nothing in it to click (#101). What can be done with it is a row of two
  // small keys under the block, each a click of its own (shown while the pointer is on the block, always on touch):
  // revise puts the turn's input back in the composer (Cherry Studio's edit), line and note together, copy copies the
  // line. The draft has the same row with the keys disabled, so nothing moves when the node lands.
  const Bubble = (p: { field: "text" | "note"; text: string }) => (
    <div class={{ said: true, note: p.field === "note", revising: props.revising === p.field }}>{p.text}</div>
  )
  // the field the row speaks of: the line, or the note when the turn is that word alone
  const field = () => (props.input.text ? "text" : "note")
  const busy = read(working)
  const [copied, setCopied] = createSignal(false)
  const copy = () =>
    // a plain-http page off localhost (a phone on the LAN) has no clipboard: the key then does nothing
    void navigator.clipboard?.writeText(props.input[field()] ?? "").then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  // one block at the column's right: the line's bubble, close under it the note as a marginal line (a word on the
  // side, not a second speech), then the row; the block keeps the turn's gap to the prose. An opening has no input: no
  // block at all, so no row of keys hangs over prose the player never wrote. Each piece is shrink-wrapped
  // (shrinkwrap.ts): as wide as the tightest wrap that keeps its rows, so a line that spills two characters onto a
  // second row is two even rows, not a bubble wide open at one side, and a short line is not widened by a long note
  let block: HTMLDivElement | undefined
  onSettled(() => (block ? shrinkwrap(block) : undefined))
  return (
    <Show when={props.input.text || props.input.note}>
      <div class="spoke" ref={(el) => (block = el)}>
        <Show when={props.input.text}>
          <Bubble field="text" text={props.input.text} />
        </Show>
        <Show when={props.input.note}>
          <Bubble field="note" text={props.input.note!} />
        </Show>
        <div class="acts" role="toolbar" aria-label={t("app.lineActions")}>
          <button
            type="button"
            class="icon"
            aria-label={field() === "note" ? t("app.reviseNote") : t("app.reviseLine")}
            disabled={!props.node || busy()}
            onClick={() => {
              revise(props.node!, field())
              // the note's box opens with the revision: focus it once it is there
              const box = field() === "note" ? ".composer textarea.note" : ".composer textarea:not(.note)"
              requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(box)?.focus())
            }}
          >
            <Edit />
          </button>
          <button type="button" class="icon" aria-label={t("common.copy")} disabled={!props.node} onClick={copy}>
            <Show when={copied()} fallback={<Copy />}>
              <Check />
            </Show>
          </button>
        </div>
      </div>
    </Show>
  )
}

/** The raised container of this turn's options: a row fills the composer, never sends. No head: the one raised card
 *  at the flow's end, numbered rows with the insert glyph, says what it is; the name is for the screen reader. */
const Options = (props: { items: readonly string[] }) => (
  <div class="options" role="group" aria-label={t("app.options")}>
    <For each={props.items} keyed={false}>
      {(t, i) => (
        <button class="option" onClick={() => registry.set(compose, t())}>
          <span class="n">{i + 1}</span>
          <span>{t()}</span>
          <Insert aria-hidden="true" />
        </button>
      )}
    </For>
  </div>
)

const Section = (props: { node: Node; n: number; last: boolean }) => {
  const busy = read(working)
  const all = read(log)
  const edited = read(editing)
  const revised = read(revising)
  // versions that differ in the player's line are told apart by it; otherwise by the prose
  const vs = createMemo(() => versions(all(), props.node))
  const siblings = () => vs().list
  let list: HTMLDivElement | undefined
  const at = () => vs().index
  // the version's whole follow-up comes back: the server moves head to its newest leaf; the turn's top stays put when
  // already in view, or lands at the column's top when a long version had scrolled it past the head
  const go = (i: number) => {
    const sec = document.getElementById(`node-${props.node.turn.id}`)
    if (sec) {
      const head = parseFloat(getComputedStyle(sec).scrollMarginTop) || 0
      const top = sec.getBoundingClientRect().top - scroller().getBoundingClientRect().top
      follow.checkout = { index: props.n - 1, top: top < head - 2 ? "start" : top }
    }
    turn.checkout(siblings()[i]!.id)
  }
  const options = () => props.node.turn.products.options as readonly string[] | undefined
  // the editor's close: with text, the edit is sent; without (Escape, unchanged, empty), it is only closed
  const done = (text?: string) => {
    registry.set(editing, null)
    if (text !== undefined) turn.edit(props.node.id, text)
  }
  return (
    <section id={`node-${props.node.turn.id}`}>
      <Said
        input={props.node.turn.input}
        node={props.node}
        revising={revised()?.node === props.node.id ? revised()!.field : undefined}
      />
      <Show when={edited() === props.node.turn.id} fallback={<Prose text={prose(props.node)} />}>
        <Editor text={prose(props.node)} onDone={done} />
      </Show>
      {/* the turn's row (#101): the Record pill, the version count, "stopped"; then, at the right end, this turn's
          actions (readings.tsx `Rewrite`), which a pointer sees on the latest turn always and on a past one while it
          is over the section, a touch screen always (reader.css) */}
      <footer class="actions">
        <RecordSheet node={props.node} n={props.n} />
        <Show when={siblings().length > 1}>
          <span class="siblings">
            <button
              class="icon"
              aria-label={t("app.prevVersion")}
              disabled={busy() || at() === 0}
              onClick={() => go(at() - 1)}
            >
              <Prev />
            </button>
            {/* the counter opens the list: which action made each version, its opening, how many nodes follow it */}
            <button
              class="count"
              aria-haspopup="menu"
              disabled={busy()}
              popovertarget={`versions-${props.node.turn.id}`}
            >
              {at() + 1}/{siblings().length}
            </button>
            <div
              id={`versions-${props.node.turn.id}`}
              class="versions"
              popover
              role="menu"
              ref={(el) => (list = el)}
              onFocusOut={(e) => !list?.contains(e.relatedTarget as HTMLElement | null) && list?.hidePopover()}
            >
              <For each={siblings()} keyed={(s) => s.turn.id}>
                {(s, i) => (
                  <button
                    role="menuitem"
                    class="version"
                    disabled={busy()}
                    aria-current={s().turn.id === props.node.turn.id ? "true" : undefined}
                    onClick={() => (list?.hidePopover(), go(i()))}
                  >
                    <SiblingKind of={s().turn.sibling} class="kind" fallback={<span class="kind" />} />
                    <span class="first">
                      {vs().varied ? `${lineOf(s())} · ${plain(prose(s()))}` : plain(prose(s()))}
                    </span>
                    <Show when={L.below(all(), s().id)}>{(n) => <span class="below">{n()}</span>}</Show>
                  </button>
                )}
              </For>
            </div>
            <button
              class="icon"
              aria-label={t("app.nextVersion")}
              disabled={busy() || at() === siblings().length - 1}
              onClick={() => go(at() + 1)}
            >
              <Next />
            </button>
          </span>
        </Show>
        <Show when={props.node.turn.end === "stopped"}>
          <span class="end">{t("app.stopped")}</span>
        </Show>
        <Rewrite rerun={!!lineOf(props.node)} node={props.node.id} />
      </footer>
      <Show when={props.last && options()?.length}>
        <Options items={options()!} />
      </Show>
    </section>
  )
}

const Reader = () => {
  const line = read(path)
  const d = read(draft)
  const phase = read(stage)
  const err = read(error)
  const busy = read(working)
  // the draft hangs under its parent: a sibling of a past turn cuts the line there while it is written
  // equal by its nodes: the draft changes every frame while prose streams, and a fresh but same slice must not
  // re-run every section ([UNSTABLE_MEMO_OUTPUT] under the diagnostics)
  const shown = createMemo(
    () => {
      const dr = d()
      return dr ? line().slice(0, line().findIndex((n) => n.id === dr.parent) + 1) : line() // a root's draft: nothing above
    },
    { equals: (a, b) => a.length === b.length && a.every((n, i) => n === b[i]) },
  )
  return (
    <div class="panel">
      <div class="scroll">
        <main>
          {/* keyed by id: a snapshot read back (after a stop) refreshes each section in place instead of rebuilding them */}
          <For each={shown()} keyed={(n) => n.turn.id}>
            {(n, i) => <Section node={n()} n={i() + 1} last={!busy() && i() === shown().length - 1} />}
          </For>
          <Show when={d()}>{(dr) => <Draft d={dr()} phase={phase()} error={err()} />}</Show>
        </main>
      </div>
      <Composer />
      <Latest />
    </div>
  )
}

export const App = () => {
  const pg = read(page)
  // the first load lands on home, or on the tab a reload left (pages.ts); one Escape rule for every page over the reader
  onSettled(() => {
    void boot()
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })
  return (
    <>
      <Shell>
        <Reader />
        {/* the pages fill the stage card over the reader (shell.css), each with its own head and Back; home has none */}
        <Show when={pg() === "home"}>
          <Home />
        </Show>
        <Show when={pg() === "card"}>
          <CardPage />
        </Show>
        <Show when={pg() === "workshop"}>
          <Workshop />
        </Show>
        <Show when={pg() === "timeline"}>
          <Timeline />
        </Show>
        <Show when={pg() === "writing"}>
          <WritingPage />
        </Show>
        <Show when={pg() === "status"}>
          <StatusPage />
        </Show>
        <Show when={typeof pg() === "object"}>
          <Inspect id={(pg() as { inspect: Id }).inspect} />
        </Show>
      </Shell>
      {/* the settings stand on their own three-column skeleton over the canvas, under .shell-top */}
      <Show when={pg() === "settings"}>
        <Settings />
      </Show>
      {/* an agent's tab (a driven browser) told apart from the player's at a glance */}
      <Show when={navigator.webdriver}>
        <div class="automation" aria-hidden="true">
          automation
        </div>
      </Show>
    </>
  )
}
