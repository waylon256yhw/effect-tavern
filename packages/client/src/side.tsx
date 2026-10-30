// The sidebar (#117, docs/sidebar-brief-1.md): the install's navigation, cards → stories, and nothing of one story's
// (that is the reader's strip, shell.tsx). Two layers, one shown at a time, sliding sideways: the shelf (every card,
// with a search; a card's row has a dot while a turn runs on any of its stories) and the workspace (one card: its
// head, which opens its page; two rows under it, the persona and the writing in force on this card (both are the
// card's, not a story's); a search; its stories, starred first then newest, the open one on a tint, a dot on one
// with a turn in flight; "新建故事" at the foot, which opens the card's page and makes no story: a story begins at
// Begin). The top strip (the way back to the shelf, with a dot when another card is busy) and the foot (this card's
// story manager at the right end) are one DOM for both layers: only the middle moves. Settings, theme and language
// are the install's (`InstallKeys`): the canvas's top strip holds them, the phone's drawer its foot. On the desktop
// it stands in the canvas's left space; under 72rem the same component is the phone's drawer. A row only switches
// the story: the rename, star, export and delete live in the manager (manager.tsx, dialogs.tsx).
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { openManager, openPicker } from "./dialogs.tsx"
import { Archive, Clue, Close, Edit, Next, Prev, Settings, Shade, Snippets, Translate, User } from "./icons.tsx"
import { openSettings } from "./settings.tsx"
import { browse, openStory, showCard } from "./pages.ts"
import { arranged, busyElsewhere, busyOn, fold, type Hit, kindLabel, matches, pieces, turnLabel } from "./stories.ts"
import { cards, focus, layer, page, personas, player, registry, stories, type StoryRow } from "./store.ts"
import { chosen } from "./switches.ts"
import { flip, theme } from "./theme.ts"
import { fetchStories, searchStories } from "./wire.ts"
import { openWriting } from "./writing.tsx"
import { flip as flipLocale, locale, t } from "./i18n.ts"

/** The install's keys: settings, the theme (a flip, pressed while the dark side holds) and the interface's language
 *  (a flip, pressed while English holds). `onLeave` is the drawer's, closed before settings opens. */
export const InstallKeys = (props: { onLeave?: () => void }) => (
  <>
    <button
      type="button"
      class="icon sm"
      aria-label={t("common.settings")}
      onClick={() => (props.onLeave?.(), openSettings())}
    >
      <Settings />
    </button>
    <button
      type="button"
      class="icon sm"
      aria-label={t("side.darkTheme")}
      aria-pressed={theme() === "dark" ? "true" : "false"}
      onClick={flip}
    >
      <Shade />
    </button>
    <button
      type="button"
      class="icon sm"
      aria-label={t("side.language")}
      aria-pressed={locale() === "en" ? "true" : "false"}
      onClick={flipLocale}
    >
      <Translate />
    </button>
  </>
)

/** `text` with every `q` in a `<mark>`. */
const Mark = (props: { text: string; q: string }) => (
  <For each={pieces(props.text, props.q)} keyed={false}>
    {(p) => (
      <Show when={p().hit} fallback={p().text}>
        <mark>{p().text}</mark>
      </Show>
    )}
  </For>
)

export const Sidebar = (props: {
  /** The sidebar is leaving the eye: a pick was made (the phone's drawer closes, the desktop's peek folds). */
  onLeave?: () => void
  /** In the phone's drawer: a close key on the top strip. */
  inDrawer?: boolean
}) => {
  const shelf = read(cards)
  const lib = read(stories)
  const at = read(focus)
  const which = read(layer)
  const pg = read(page)
  const rows = () => lib()?.stories ?? []
  const card = createMemo(() => shelf().find((c) => c.id === at()))
  // who the player is on this card, and the writing in force: a change rewrites the cached prefix, no new story
  const me = read(player)
  const people = read(personas)
  const persona = () => people().find((p) => p.id === me()?.persona?.[at() ?? ""])?.name ?? t("side.cardDefault")
  const writing = createMemo(
    () =>
      chosen(me()?.writing, !!me()?.forCard[at() ?? ""]?.some((f) => f.text?.trim()))[0] ?? t("switches.followCard"),
  )
  const leaveFor = (go: () => void) => {
    props.onLeave?.()
    go()
  }
  // the shelf's search: title and summary, here
  const [cq, setCq] = createSignal("")
  const shown = createMemo(() => {
    const q = fold(cq().trim())
    return q ? shelf().filter((c) => fold(c.title).includes(q) || fold(c.summary ?? "").includes(q)) : shelf()
  })
  // the workspace's search: the title here, the turns on the server after a pause in the typing (the manager's
  // way: an answer to an older query than the one typed is dropped); a hit shows its line under the row
  const [sq, setSq] = createSignal("")
  const [hits, setHits] = createSignal<ReadonlyMap<number, Hit>>(new Map())
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  const ask = (text: string) => {
    setSq(text)
    setHits(new Map())
    clearTimeout(timer)
    const n = ++seq
    const q = text.trim()
    if (!q) return
    timer = setTimeout(() => {
      void searchStories(q).then((found) => {
        if (n === seq) setHits(new Map(found.filter((h) => rows().some((s) => s.id === h.id)).map((h) => [h.id, h])))
      })
    }, 200)
  }
  const mine = createMemo(() => arranged(rows().filter((s) => s.card === at())).filter((s) => matches(s, sq(), hits())))
  // another card's workspace: its search starts over
  let storySearch: HTMLInputElement | undefined
  createEffect(
    () => at(),
    (now, before) => {
      if (before !== undefined && now !== before) {
        ask("")
        if (storySearch) storySearch.value = ""
      }
    },
  )
  // a turn in flight anywhere on the shelf: the listing is read again every few seconds while a dot shows, so the
  // dots go out when the turns land (the open story's own stream refreshes it on its own)
  onSettled(() => {
    const id = setInterval(() => {
      if (registry.get(stories)?.stories.some((s) => s.busy !== null)) fetchStories().catch(() => {}) // the dots stay until a read succeeds
    }, 5000)
    return () => clearInterval(id)
  })
  const toShelf = () => registry.set(layer, "shelf")
  const pickCard = (id: string) => {
    props.onLeave?.()
    void browse(id)
  }
  const pickStory = (s: StoryRow) => {
    props.onLeave?.()
    if (s.id !== lib()?.current || pg() !== "reader") void openStory(s.id)
  }
  const toCard = () => {
    const id = at()
    if (id === null) return
    props.onLeave?.()
    void showCard(id)
  }
  return (
    <div class="sidebar" data-layer={which()}>
      <div class="side-top">
        <Show when={which() === "workspace"} fallback={<span class="layer-label">{t("side.allCards")}</span>}>
          <button type="button" class="back-shelf" onClick={toShelf}>
            <Prev aria-hidden="true" />
            <span>{t("side.allCards")}</span>
            <Show when={at() !== null && busyElsewhere(rows(), at()!)}>
              <i class="busy-dot" role="status" aria-label={t("side.otherBusy")} />
            </Show>
          </button>
        </Show>
        <Show when={props.inDrawer}>
          <button type="button" class="icon sm" aria-label={t("common.close")} onClick={() => props.onLeave?.()}>
            <Close />
          </button>
        </Show>
      </div>
      <div class="side-mid">
        <div class="side-track">
          {/* layer A, the shelf: every card of the install */}
          <section class="pane shelf" aria-label={t("side.allCards")} inert={which() !== "shelf"}>
            <div class="input-box sm">
              <Clue aria-hidden="true" />
              <input
                type="search"
                placeholder={t("side.searchCards")}
                aria-label={t("side.searchCards")}
                onInput={(e) => setCq(e.currentTarget.value)}
              />
            </div>
            <ul class="shelf-list scroller">
              <For each={shown()} keyed={(c) => c.id}>
                {(c) => (
                  <li>
                    <button
                      type="button"
                      class="shelf-item"
                      aria-current={c().id === at() ? "true" : undefined}
                      onClick={() => pickCard(c().id)}
                    >
                      <span class="head">
                        <span class="title">
                          <Mark text={c().title} q={cq()} />
                        </span>
                        <Show when={busyOn(rows(), c().id)}>
                          <i class="busy-dot" role="status" aria-label={t("side.cardBusy")} />
                        </Show>
                      </span>
                      <Show when={c().summary}>
                        {(s) => (
                          <span class="summary">
                            <Mark text={s()} q={cq()} />
                          </span>
                        )}
                      </Show>
                    </button>
                  </li>
                )}
              </For>
              <Show when={!shown().length}>
                <li class="none">{cq().trim() ? t("side.noCardMatch") : t("side.noCards")}</li>
              </Show>
            </ul>
          </section>
          {/* layer B, the workspace: one card's stories */}
          <section class="pane workspace" aria-label={t("side.workspace")} inert={which() !== "workspace"}>
            <button
              type="button"
              class="cardhead"
              aria-current={pg() === "card" ? "page" : undefined}
              disabled={!card()}
              onClick={toCard}
            >
              <h1>{card()?.title ?? at() ?? ""}</h1>
              <span class="enter" aria-hidden="true">
                <Next />
              </span>
            </button>
            <button type="button" class="row" disabled={!me()} onClick={() => leaveFor(openPicker)}>
              <span class="lbl">
                <User aria-hidden="true" />
                <span>{t("common.persona")}</span>
              </span>
              <span class="val">{persona()}</span>
            </button>
            <button type="button" class="row" disabled={!me()} onClick={() => leaveFor(openWriting)}>
              <span class="lbl">
                <Edit aria-hidden="true" />
                <span>{t("side.writing")}</span>
              </span>
              <span class="val">{writing()}</span>
            </button>
            <div class="input-box sm">
              <Clue aria-hidden="true" />
              <input
                type="search"
                ref={(el) => (storySearch = el)}
                placeholder={t("side.searchStories")}
                aria-label={t("side.searchStories")}
                onInput={(e) => ask(e.currentTarget.value)}
              />
            </div>
            <ul class="story-list scroller">
              <For each={mine()} keyed={(s) => s.id}>
                {(s) => {
                  const hit = () => hits().get(s().id)
                  return (
                    <li>
                      <button
                        type="button"
                        class="story-row"
                        aria-current={pg() === "reader" && s().id === lib()?.current ? "true" : undefined}
                        onClick={() => pickStory(s())}
                      >
                        <span class="line">
                          <span class={{ name: true, unnamed: s().title === null }}>
                            <Mark text={s().title ?? t("stories.newStory")} q={sq()} />
                          </span>
                          <Show when={s().busy}>
                            <i class="busy-dot" role="status" aria-label={t("side.storyBusy")} />
                          </Show>
                        </span>
                        <Show when={hit()}>
                          {(h) => (
                            <span class="hit">
                              <span class="where">
                                {turnLabel(h())} · {kindLabel(h().kind)}
                              </span>
                              <Mark text={h().text} q={sq()} />
                            </span>
                          )}
                        </Show>
                      </button>
                    </li>
                  )
                }}
              </For>
              <Show when={!mine().length}>
                <li class="none">{sq().trim() ? t("side.noStoryMatch") : t("side.noStories")}</li>
              </Show>
            </ul>
            <button
              type="button"
              class="new-story"
              aria-current={pg() === "card" ? "page" : undefined}
              disabled={at() === null}
              onClick={toCard}
            >
              <Snippets aria-hidden="true" />
              <span>{t("side.newStory")}</span>
            </button>
          </section>
        </div>
      </div>
      <footer class="side-foot">
        {/* the phone has no top strip: the install's keys stay at the drawer's foot */}
        <span class="left">
          <Show when={props.inDrawer}>
            <InstallKeys onLeave={props.onLeave} />
          </Show>
        </span>
        <Show when={which() === "workspace"}>
          <button type="button" class="icon sm" aria-label={t("side.manager")} disabled={!card()} onClick={openManager}>
            <Archive />
          </button>
        </Show>
      </footer>
    </div>
  )
}
