// The card page, as the new-story page (design/new-story-and-tags.md §3, #120): the whole stage card. Left, the name,
// the introduction, one row of chips (manifest.ts) and the prompt's size; with two openings or more, their list; then
// the opening in the reader's measure, its size and the one action. Landed on when the story is empty, and from the
// sidebar's new story; Escape or Back returns (the empty reader is a valid place to be: its composer waits for an
// opening while the card has any).
// Browsing openings writes nothing: Begin greets the one shown, and it lands as the story's root; mid-story the same
// pick starts a new story beside the old one. A card with no opening begins on an empty line,
// the player's first words start it.
import { tokens } from "@effect-tavern/runtime/src/tokens.ts"
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Back, Change, Clue, Next, Prev, Up } from "./icons.tsx"
import { admitsOpening, chips, firstLine, openingTags } from "./manifest.ts"
import { Prose } from "./prose.tsx"
import { openSettings } from "./settings.tsx"
import { backOf, close, newStory, open } from "./pages.ts"
import { activeOf, card, log, routing, stories, tabs, working } from "./store.ts"
import type { Greeting } from "@effect-tavern/runtime/src/card.ts"
import type { CardView } from "./store.ts"
import { turn } from "./turn.ts"
import { t } from "./i18n.ts"

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
export const openCard = () => open("card")

/** A size readout: the word, then `~N tokens`. */
const Size = (props: { label: string; n: number }) => (
  <span class="size">
    {props.label}
    <span class="mono">
      ~{compact.format(props.n)} {t("card.tokens")}
    </span>
  </span>
)

/** One opening in a list (the desktop column, the phone's sheet): its index, what it sets and its size on the top
 *  row, and its opening lines below. */
const Line = (props: { c: CardView; g: Greeting; i: number }) => (
  <>
    <span class="vhead">
      <span class="below">{String(props.i + 1).padStart(2, "0")}</span>
      <span class="vmeta">
        <For each={openingTags(props.c, props.g)} keyed={false}>
          {(tag) => <span class="tag">{tag()}</span>}
        </For>
        <span class="est mono">~{compact.format(tokens(props.g.text))}</span>
      </span>
    </span>
    <span class="first">{firstLine(props.g.text)}</span>
  </>
)

export const CardPage = () => {
  const view = read(card)
  const all = read(log)
  const busy = read(working) // no new root under a turn in flight
  const route = read(routing)
  const lib = read(stories)
  const strip = read(tabs)
  const back = () => backOf(activeOf(strip()))
  const id = createMemo(() => view()?.id)
  const [at, setAt] = createSignal(() => (id(), 0))
  const [oq, setOq] = createSignal(() => (id(), ""))
  const [searching, setSearching] = createSignal(false)
  const [starting, setStarting] = createSignal(false)
  const inStory = () => all().nodes.size > 0
  /** Begin lands in the open story: it is empty and of this card. Otherwise (a story in progress, none yet, an empty
   *  story of another card: this one was browsed from the shelf) Begin makes a new story of this card first. */
  const fresh = () => {
    const l = lib()
    const cur = l?.stories.find((s) => s.id === l.current)
    return !inStory() && cur !== undefined && cur.card === view()?.id
  }
  const openings = () => view()?.greetings ?? []
  const opening = () => openings()[at()]
  const listed = createMemo(() => {
    const c = view()
    const q = oq()
    if (!c) return []
    return openings()
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => admitsOpening(c, g, q))
  })
  const begin = async () => {
    if (starting()) return
    setStarting(true)
    // a story in progress, none yet (an empty library), or an empty story of another card (this one was browsed from
    // the shelf): a new, empty one of this card, landing on the card page
    try {
      if (!fresh() && !(await newStory(view()!.id))) return
      turn.greet(at())
      open("reader") // a draft is a reason to be in the reader, whatever the log holds yet and whatever was browsed before
    } finally {
      setStarting(false)
    }
  }
  /** The list column's keys: ↑ ↓ move the selection across the listed openings (Home / End to the ends), the prose follows. */
  const onKey = (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const items = listed()
    if (!items.length) return
    const cur = items.findIndex((x) => x.i === at())
    const pos =
      e.key === "ArrowDown"
        ? Math.min((cur < 0 ? -1 : cur) + 1, items.length - 1)
        : e.key === "ArrowUp"
          ? Math.max((cur < 0 ? items.length : cur) - 1, 0)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : undefined
    if (pos === undefined) return
    e.preventDefault()
    setAt(items[pos]!.i)
    e.currentTarget.children[pos]?.scrollIntoView({ block: "nearest" })
  }
  return (
    <div class="inspect manifest">
      <Show when={view()}>
        {(c) => (
          <article class={{ cardsheet: true, many: openings().length > 1 }}>
            <section class="about" aria-label={t("card.card")}>
              <div class="title">
                {/* Back only where there is somewhere to go: the story, or home under a card entered from it */}
                <Show when={back()}>
                  {(to) => (
                    <button
                      type="button"
                      class="icon"
                      aria-label={to() === "home" ? t("common.backToHome") : t("common.backToStory")}
                      onClick={close}
                    >
                      <Back />
                    </button>
                  )}
                </Show>
                <h1>{c().title}</h1>
              </div>
              <Show when={c().summary}>
                {(s) => (
                  <div class="intro wscroll">
                    <p>{s()}</p>
                  </div>
                )}
              </Show>
              {/* what the card is, in the harness's words */}
              <ul class="chips">
                <For each={chips(c())} keyed={false}>
                  {(chip, i) => (
                    <li>
                      {/* a tap lists what the chip stands for (a phone has no hover title) */}
                      <Show when={chip().items} fallback={chip().label}>
                        {(items) => (
                          <>
                            <button type="button" popovertarget={`spec-${i}`}>
                              {chip().label}
                            </button>
                            <div id={`spec-${i}`} class="spec-pop" popover>
                              <ul>
                                <For each={items()} keyed={false}>
                                  {(x) => <li>{x()}</li>}
                                </For>
                              </ul>
                            </div>
                          </>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              {/* said up front: Begin works without one (an opening calls no model), the first line sent does not */}
              <Show when={!route().default}>
                <p class="nomodel">
                  {t("card.model")} · {t("card.noDefault")}
                  <button type="button" class="more" onClick={() => openSettings("routing")}>
                    {t("app.goDefaultModel")}
                  </button>
                </p>
              </Show>
              <Size label={t("card.prompt")} n={c().tokens.head} />
            </section>
            <Show when={openings().length > 1}>
              <div class="openings-wrap">
                <div class="openings-head">
                  <span>{t("card.opening")}</span>
                  <label class="inline-search" data-open={searching() || !!oq() ? "true" : "false"}>
                    <Clue aria-hidden="true" />
                    <input
                      type="search"
                      placeholder={t("card.searchOpenings")}
                      aria-label={t("card.searchOpenings")}
                      value={oq()}
                      onFocus={() => setSearching(true)}
                      onBlur={() => setSearching(false)}
                      onInput={(e) => setOq(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Escape") return
                        e.preventDefault() // the search's Escape: the page stays
                        setOq("")
                        e.currentTarget.blur()
                      }}
                    />
                  </label>
                  <span class="mono">
                    {at() + 1} / {openings().length}
                  </span>
                </div>
                <ul
                  class="openings"
                  role="listbox"
                  tabindex="0"
                  aria-label={t("card.pickOpening")}
                  aria-activedescendant={`opening-${at()}`}
                  onKeyDown={onKey}
                >
                  <For each={listed()} keyed={(x) => x.i}>
                    {(x) => (
                      <li
                        id={`opening-${x().i}`}
                        role="option"
                        class="version"
                        aria-selected={x().i === at() ? "true" : "false"}
                        onClick={() => setAt(x().i)}
                      >
                        <Line c={c()} g={x().g} i={x().i} />
                      </li>
                    )}
                  </For>
                  <Show when={!listed().length}>
                    <li class="none">{t("card.noOpeningMatch")}</li>
                  </Show>
                </ul>
              </div>
            </Show>
            <section class="opening" aria-label={t("card.opening")}>
              <Show
                when={opening()}
                fallback={
                  <div class="well empty">
                    <p>{t("card.noOpening")}</p>
                  </div>
                }
              >
                {(g) => (
                  <div class="well">
                    <div class="wscroll">
                      <Prose text={g().text.trim()} />
                    </div>
                  </div>
                )}
              </Show>
              <footer class="foot">
                {/* the phone's stepper and its sheet; the desktop has the list column instead (card.css) */}
                <Show when={openings().length > 1}>
                  <span class="siblings">
                    <button
                      class="icon"
                      aria-label={t("card.prevOpening")}
                      disabled={at() === 0}
                      onClick={() => setAt(at() - 1)}
                    >
                      <Prev />
                    </button>
                    <button class="count" popovertarget="openings" aria-label={t("card.pickOpening")}>
                      {at() + 1} / {openings().length}
                      <Up />
                    </button>
                    <div
                      id="openings"
                      class="versions"
                      popover
                      role="menu"
                      onFocusOut={(e) =>
                        !e.currentTarget.contains(e.relatedTarget as HTMLElement | null) &&
                        e.currentTarget.hidePopover()
                      }
                    >
                      <div class="openings-head">
                        <span>{t("card.opening")}</span>
                        <label class="inline-search" data-open={searching() || !!oq() ? "true" : "false"}>
                          <Clue aria-hidden="true" />
                          <input
                            type="search"
                            placeholder={t("card.searchOpenings")}
                            aria-label={t("card.searchOpenings")}
                            value={oq()}
                            onFocus={() => setSearching(true)}
                            onBlur={() => setSearching(false)}
                            onInput={(e) => setOq(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Escape") return
                              e.preventDefault()
                              setOq("")
                              e.currentTarget.blur()
                            }}
                          />
                        </label>
                        <span class="mono">
                          {at() + 1} / {openings().length}
                        </span>
                      </div>
                      <For each={listed()} keyed={(x) => x.i}>
                        {(x) => (
                          <button
                            type="button"
                            role="menuitem"
                            class="version"
                            aria-current={x().i === at() ? "true" : undefined}
                            onClick={(e) => {
                              setAt(x().i)
                              e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
                            }}
                          >
                            <Line c={c()} g={x().g} i={x().i} />
                          </button>
                        )}
                      </For>
                      <Show when={!listed().length}>
                        <div class="none">{t("card.noOpeningMatch")}</div>
                      </Show>
                    </div>
                    <button
                      class="icon"
                      aria-label={t("card.nextOpening")}
                      disabled={at() === openings().length - 1}
                      onClick={() => setAt(at() + 1)}
                    >
                      <Next />
                    </button>
                  </span>
                </Show>
                <Show when={opening()}>{(g) => <Size label={t("card.opening")} n={tokens(g().text)} />}</Show>
                <button
                  type="button"
                  class={{ begin: true, primary: fresh() }}
                  disabled={busy() || starting()}
                  onClick={() => void begin()}
                >
                  {fresh() ? t("card.begin") : t("stories.newStory")}
                  <Change />
                </button>
              </footer>
            </section>
          </article>
        )}
      </Show>
    </div>
  )
}
