// The card page: the card on the player's side (docs/card-page-brief.md, docs/card-page-prototype.html). One bounded
// sheet: the name and the introduction, three derived rows (manifest.ts), the openings in a well that scrolls, and one
// action. Landed on when the story is empty; opened from the session's card head any time, Escape or Back returns
// (the empty reader is a valid place to be: its composer waits for an opening while the card has any).
// Browsing openings writes nothing: Begin greets the one shown, and it lands as the story's root; mid-story the same
// pick starts a new story beside the old one. A card with no opening begins on an empty line,
// the player's first words start it.
import { tokens } from "@effect-tavern/runtime/src/tokens.ts"
import { createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Back, Change, Next, Prev, Up } from "./icons.tsx"
import { firstLine, openingTag, SHOWN, specs } from "./manifest.ts"
import { Prose } from "./prose.tsx"
import { openSettings } from "./settings.tsx"
import { close, newStory, open } from "./pages.ts"
import { card, log, personas, player, routing, working } from "./store.ts"
import { turn } from "./turn.ts"
import { t } from "./i18n.ts"

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
export const openCard = () => open("card")

/** A list of names, the first few inline and the rest behind "and N more" (a popover, since a phone cannot hover). */
let lists = 0
const Bounded = (props: { items: readonly string[] }) => {
  const id = `names-${lists++}`
  return (
    <>
      {props.items.slice(0, SHOWN).join(" · ")}
      <Show when={props.items.length > SHOWN}>
        <button type="button" class="more" popovertarget={id}>
          {t("card.andMore", { n: props.items.length - SHOWN })}
        </button>
        <div id={id} class="versions names" popover>
          {props.items.join(" · ")}
        </div>
      </Show>
    </>
  )
}

export const CardPage = () => {
  const view = read(card)
  const all = read(log)
  const busy = read(working) // no new root under a turn in flight
  const me = read(player)
  const people = read(personas)
  const route = read(routing)
  /** The persona the player is on this card: the player's pick by name, none when the card's own holds. */
  const persona = () => {
    const id = me()?.persona?.[view()?.id ?? ""]
    return id === undefined ? undefined : people().find((p) => p.id === id)?.name
  }
  const [at, setAt] = createSignal(0)
  const inStory = () => all().nodes.size > 0
  const openings = () => view()?.greetings ?? []
  const opening = () => openings()[at()]
  const begin = async () => {
    if (inStory()) await newStory() // lands on the new, empty story: the card page, nothing under it
    turn.greet(at())
    open("reader") // a draft is a reason to be in the reader, whatever the log holds yet and whatever was browsed before
  }
  return (
    <div class="inspect manifest">
      <Show when={view()}>
        {(c) => (
          <article class="cardsheet">
            <section class="about" aria-label={t("card.card")}>
              <div class="head">
                <div class="title">
                  <button type="button" class="icon" aria-label={t("common.backToStory")} onClick={close}>
                    <Back />
                  </button>
                  <h1>{c().title}</h1>
                </div>
                <Show when={c().summary}>
                  {(s) => (
                    <div class="intro wscroll">
                      <p>{s()}</p>
                    </div>
                  )}
                </Show>
              </div>
              <dl class="specs">
                <For each={specs(c())} keyed={(r) => r.key}>
                  {(r) => (
                    <div class="row">
                      <dt>{t(r().key)}</dt>
                      <dd>
                        <Bounded items={r().items} />
                      </dd>
                    </div>
                  )}
                </For>
                <Show when={persona()}>
                  {(name) => (
                    <div class="row">
                      <dt>{t("common.persona")}</dt>
                      <dd>{name()}</dd>
                    </div>
                  )}
                </Show>
                {/* said up front: Begin works without one (an opening calls no model), the first line sent does not */}
                <Show when={!route().default}>
                  <div class="row">
                    <dt>{t("card.model")}</dt>
                    <dd>
                      {t("card.noDefault")}
                      <button type="button" class="more" onClick={() => openSettings("routing")}>
                        {t("app.goDefaultModel")}
                      </button>
                    </dd>
                  </div>
                </Show>
                <div class="row">
                  <dt>{t("card.prompt")}</dt>
                  <dd class="mono">
                    ~{compact.format(c().tokens.head)} {t("card.tokens")}
                  </dd>
                </div>
              </dl>
            </section>
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
                      <For each={openings()} keyed={false}>
                        {(g, i) => (
                          <button
                            type="button"
                            role="menuitem"
                            class="version"
                            aria-current={i === at() ? "true" : undefined}
                            onClick={(e) => {
                              setAt(i)
                              e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
                            }}
                          >
                            <span class="below">{String(i + 1).padStart(2, "0")}</span>
                            <span class="first">{firstLine(g().text)}</span>
                            <Show when={openingTag(c(), g())}>{(t) => <span class="tag">{t()}</span>}</Show>
                          </button>
                        )}
                      </For>
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
                <Show when={opening()}>
                  {(g) => (
                    <span class="est mono">
                      ~{compact.format(tokens(g().text))} {t("card.tokens")}
                    </span>
                  )}
                </Show>
                <button
                  type="button"
                  class={{ begin: true, primary: !inStory() }}
                  disabled={busy()}
                  onClick={() => void begin()}
                >
                  {inStory() ? t("stories.newStory") : t("card.begin")}
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
