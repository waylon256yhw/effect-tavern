// The session beside the reading: what holds for the whole story and is byte-stable in the request head: the card,
// this card's stories (which one is open), the persona the player is on this card, the writing in force (chips that
// open the Writing page, writing.tsx), the armed pin, the two pages that look at the story (Timeline, Inspector), the theme and the settings. The left card on desktop; on a phone, the sheet
// the title opens. Both can be mounted, so the popovers and dialogs take an id prefix. Stories are the library's: a
// story is one root's tree. The persona is a player asset, a sibling of the card, not a step of a story: the pick is
// `Player.persona[card]`, changeable any time (one head rewrite, like a writing switch); this card only picks one.
import { createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { openCard } from "./card.tsx"
import { Edit, Pin, Probe, Settings, Shade, Snippets, Trash, Tree } from "./icons.tsx"
import { openInspector } from "./inspector.tsx"
import { openSettings } from "./settings.tsx"
import { card, path, personas, pin, player, stories, working } from "./store.ts"
import { chosen } from "./switches.ts"
import { flip, theme } from "./theme.ts"
import { openTimeline } from "./timeline.tsx"
import { deleteStory, nameStory, newStory, openStory, putPlayer } from "./wire.ts"
import { openWriting } from "./writing.tsx"

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
]
const rel = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
/** "2 hours ago", "yesterday", "now". */
const ago = (at: number): string => {
  const d = at - Date.now()
  const u = units.find(([, ms]) => Math.abs(d) >= ms)
  return u ? rel.format(Math.round(d / u[1]), u[0]) : "now"
}

/** The menu's keyboard: arrows move focus among the items and wrap, Home/End jump; Escape and outside clicks are the popover's. */
export const roam = (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role^=menuitem]")]
  const i = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
  const d = { ArrowDown: 1, ArrowUp: -1, Home: -i, End: items.length - 1 - i }[e.key]
  if (d === undefined) return
  e.preventDefault()
  items.at((i + d) % items.length)?.focus()
}
const closeUp = (el: HTMLElement) => {
  el.closest<HTMLElement>("[popover]")?.hidePopover()
  el.closest("dialog")?.close() // the phone's sheet: a pick is the end of the visit
}

export const Session = (props: { at: string }) => {
  const id = (s: string) => `${props.at}-${s}`
  const view = read(card)
  const lib = read(stories)
  const people = read(personas)
  const me = read(player)
  const pinned = read(pin)
  const line = read(path)
  const busy = read(working) // the story stays put while a turn is in flight
  /** A pinned entry by its hook: on the node it was armed from, or an earlier one (a told entry leaves `readable`). */
  const hookOf = (id: string) =>
    line()
      .flatMap((n) => n.readable)
      .find((e) => e.id === id)?.hook ?? id
  // The persona in force on this card, and the pick: a change of the player's own layer, nothing of the story's.
  const cardId = () => view()?.id ?? ""
  const current = () => people().find((p) => p.id === me()?.persona?.[cardId()])
  const pick = (id: string | undefined) => {
    const p = me()
    if (!p) return
    const { [cardId()]: _, ...rest } = p.persona ?? {}
    const next = id === undefined ? rest : { ...rest, [cardId()]: id }
    void putPlayer({ ...p, persona: Object.keys(next).length ? next : undefined }) // an empty map leaves the JSON like any unset key
  }
  const [renaming, setRenaming] = createSignal(false) // the open story's row is a name field (the header's pencil)
  let confirm!: HTMLDialogElement
  return (
    <div class="session">
      <button type="button" class="cardhead" onClick={openCard} aria-label="The card">
        <h1>{view()?.title}</h1>
        <Show when={view()?.summary}>{(s) => <p>{s()}</p>}</Show>
      </button>
      <section class="stories" aria-label="Stories">
        <h2>
          Stories
          <button
            type="button"
            class="icon"
            aria-label="New story"
            disabled={busy()}
            onClick={(e) => (closeUp(e.currentTarget), void newStory())}
          >
            <Snippets />
          </button>
          <button
            type="button"
            class="icon"
            aria-label="Rename story"
            disabled={busy() || renaming()}
            onClick={() => setRenaming(true)}
          >
            <Edit />
          </button>
          <button
            type="button"
            class="icon"
            aria-label="Delete story"
            disabled={busy()}
            onClick={() => confirm.showModal()}
          >
            <Trash />
          </button>
        </h2>
        <ul>
          <For each={lib()?.stories ?? []} keyed={(s) => s.id}>
            {(s) => (
              <li>
                <Show
                  when={renaming() && s().id === lib()?.current}
                  fallback={
                    <button
                      type="button"
                      class="story"
                      aria-current={s().id === lib()?.current ? "true" : undefined}
                      disabled={busy()}
                      onClick={(e) => {
                        closeUp(e.currentTarget) // the open one too: on a phone, back to the reader
                        if (s().id !== lib()?.current) void openStory(s().id)
                      }}
                    >
                      <span class="first">{s().title ?? s().opening ?? "Empty"}</span>
                      <span class="meta">
                        <span class="last">{s().last}</span>
                        <span class="ago">{ago(s().updated)}</span>
                      </span>
                    </button>
                  }
                >
                  <div class="story" aria-current="true">
                    {/* Enter or leaving the field names it, Escape keeps the name; blank brings the opening back */}
                    <input
                      class="first"
                      aria-label="Story name"
                      value={s().title ?? ""}
                      placeholder={s().opening ?? "Empty"}
                      ref={(el) => queueMicrotask(() => el.select())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur()
                        if (e.key !== "Escape") return
                        e.preventDefault() // the phone's sheet stays open
                        setRenaming(false)
                      }}
                      onBlur={(e) => {
                        if (!renaming()) return // Escape already closed it
                        setRenaming(false)
                        const t = e.currentTarget.value.trim()
                        if (t !== (s().title ?? "")) void nameStory(s().id, t)
                      }}
                    />
                    <span class="meta">
                      <span class="last">{s().last}</span>
                      <span class="ago">{ago(s().updated)}</span>
                    </span>
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <dialog class="confirm" ref={(el) => (confirm = el)} closedby="any">
          <p>Delete this story? Every turn in it is gone for good.</p>
          <div class="row">
            <button type="button" class="chip state" onClick={() => confirm.close()}>
              Cancel
            </button>
            <button
              type="button"
              class="chip danger"
              onClick={() => (confirm.close(), void deleteStory(lib()!.current))}
            >
              Delete
            </button>
          </div>
        </dialog>
      </section>
      {/* who the player is on this card: one chip, the persona in force (the card's own when none is picked); the menu
          only picks among the player's personas by name (making and editing them is another place's job). Head text
          like the switches: a change rewrites the cached prefix, no new story */}
      <section class="persona" aria-label="Persona">
        <h2>Persona</h2>
        <button type="button" class="chosen" popovertarget={id("persona")} disabled={!me() || !people().length}>
          <span class="chip">{current()?.name ?? "跟随卡片"}</span>
        </button>
        <div id={id("persona")} class="snippets" popover role="menu" onKeyDown={roam}>
          <For each={people()} keyed={(p) => p.id}>
            {(p) => (
              <button
                type="button"
                role="menuitemradio"
                class="item"
                tabindex="-1"
                aria-checked={p().id === current()?.id ? "true" : "false"}
                onClick={(e) => (e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover(), pick(p().id))}
              >
                <span class="name">{p().name}</span>
              </button>
            )}
          </For>
          <hr />
          <button
            type="button"
            role="menuitemradio"
            class="item"
            tabindex="-1"
            aria-checked={current() ? "false" : "true"}
            onClick={(e) => (e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover(), pick(undefined))}
          >
            <span class="name">As the card has it</span>
          </button>
        </div>
      </section>
      {/* the writing in force, as chips: the switches set (the card's own text holds for the rest) and a per-card
          supplement; one button, the Writing page (a change there is a head rewrite, so it reads as a preference) */}
      <section class="writing" aria-label="Writing">
        <h2>Writing</h2>
        <button
          type="button"
          class="chosen"
          disabled={!me()}
          onClick={(e) => (closeUp(e.currentTarget), openWriting())}
        >
          <For each={chosen(me()?.writing, !!me()?.forCard[cardId()]?.some((f) => f.text?.trim()))} keyed={(l) => l}>
            {(l) => <span class="chip">{l()}</span>}
          </For>
        </button>
      </section>
      <Show when={pinned()}>
        {(p) => (
          <section class="pinned">
            <h2>Pinned</h2>
            <p>
              <Pin aria-hidden="true" />
              <span>{hookOf(p())}</span>
            </p>
          </section>
        )}
      </Show>
      <nav class="tools" aria-label="Pages">
        <button
          type="button"
          class="icon"
          aria-label="Timeline"
          onClick={(e) => (closeUp(e.currentTarget), openTimeline())}
        >
          <Tree />
        </button>
        <button
          type="button"
          class="icon"
          aria-label="Inspector"
          disabled={line().length === 0}
          onClick={(e) => (closeUp(e.currentTarget), openInspector())}
        >
          <Probe />
        </button>
        {/* the theme (theme.ts): a flip, not a page, so the phone's sheet stays; pressed while the dark side holds */}
        <button
          type="button"
          class="icon theme"
          aria-label="Dark theme"
          aria-pressed={theme() === "dark" ? "true" : "false"}
          onClick={flip}
        >
          <Shade />
        </button>
        <button
          type="button"
          class="icon"
          aria-label="Settings"
          onClick={(e) => (closeUp(e.currentTarget), openSettings())}
        >
          <Settings />
        </button>
      </nav>
    </div>
  )
}

/** Desktop's left card. */
export const Side = () => (
  <aside class="side">
    <Session at="side" />
  </aside>
)
