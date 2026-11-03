// The sidebar (#117, docs/sidebar-brief-1.md): the install's navigation, cards → stories, and nothing of one story's
// (that is the reader's strip, shell.tsx). Two layers, one shown at a time, sliding sideways: the shelf (every card,
// with a search; a card's row has a dot while a turn runs on any of its stories) and the workspace (one card: its
// head, which opens its page; the player's filing words on it (`Player.tags`, #133) as wrapping chips right under the
// head (click a word to filter the shelf by `#word`, × to remove, + to add or open the tag manager); two rows under it,
// the persona in force (the open story's when it is of this card, else the card's default) and the writing in force on this card; a search; its stories, starred first then newest, the open one on a tint, a dot on one
// with a turn in flight; "新建故事" at the foot, which opens the card's page and makes no story: a story begins at
// Begin). The top strip (the way back to the shelf, with a dot when another card is busy) and the foot (this card's
// story manager at the right end) are one DOM for both layers: only the middle moves. Settings, theme and language
// are the install's (`InstallKeys`): the canvas's top strip holds them, the phone's drawer its foot. On the desktop
// it stands in the canvas's left space; under 72rem the same component is the phone's drawer. A row only switches
// the story: the rename, star, export and delete live in the manager (manager.tsx, dialogs.tsx).
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { openManager, openPicker, openTagManager } from "./dialogs.tsx"
import { Archive, Clue, Close, Next, Prev, Settings, Shade, Snippets, Tag, Translate, User, Write } from "./icons.tsx"
import { openSettings } from "./settings.tsx"
import { browse, close, open, openStory, showCard, toHome } from "./pages.ts"
import { admits, facetCounts, facetsWanted, MAX_TAGS, parse, plain, retag, spare } from "./query.ts"
import {
  arranged,
  busyElsewhere,
  busyOn,
  fold,
  type Hit,
  kindLabel,
  matches,
  personaOn,
  pieces,
  turnLabel,
} from "./stories.ts"
import { cards, focus, layer, page, personas, player, registry, stories, type StoryRow } from "./store.ts"
import { chosen } from "./switches.ts"
import { flip, theme } from "./theme.ts"
import { fetchStories, putPlayer, searchStories } from "./wire.ts"
import { openWriting } from "./writing.tsx"
import { flip as flipLocale, locale, t } from "./i18n.ts"

/** The install's keys: settings, the theme (a flip, pressed while the dark side holds) and the interface's language
 *  (a flip, pressed while English holds). `onLeave` is the drawer's, closed before settings opens. */
export const InstallKeys = (props: { onLeave?: () => void }) => {
  const pg = read(page)
  const inSettings = () => pg() === "settings"
  return (
    <>
      <button
        type="button"
        class="icon sm"
        aria-label={t("common.settings")}
        aria-pressed={inSettings() ? "true" : "false"}
        onClick={() => (props.onLeave?.(), inSettings() ? close() : openSettings())}
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
}

/** `text` with every `q` in a `<mark>`. */
const Mark = (props: { text: string; q: string | readonly string[] }) => (
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
  // who the player is here (the open story's persona, else the card's default), and the writing in force: a change rewrites the cached prefix, no new story
  const me = read(player)
  const people = read(personas)
  const persona = () =>
    people().find((p) => p.id === personaOn(lib(), me()?.persona, at(), pg()))?.name ?? t("side.cardDefault")
  const writing = createMemo(
    () =>
      chosen(me()?.writing, !!me()?.forCard[at() ?? ""]?.some((f) => f.text?.trim()))[0] ?? t("switches.followCard"),
  )
  // the player's filing words on this card: wrapping chips under the head (click a word to filter the shelf by `#word`,
  // × to remove, + to open the popover); each change is one PUT /player over the last acknowledged layer (query.ts `retag`)
  const words = createMemo(() => me()?.tags?.[at() ?? ""] ?? [])
  const [tq, setTq] = createSignal("")
  const offered = createMemo(() => spare(me()?.tags, at() ?? "", tq()))
  const tagsOf = (f: (ws: readonly string[]) => readonly string[]) => {
    const c = at()
    if (me() && c !== null) void putPlayer((p) => retag(p, c, f))
  }
  const attach = (w: string) => tagsOf((ws) => [...ws, w])
  let tagBox: HTMLInputElement | undefined
  let shelfSearch: HTMLInputElement | undefined
  // after a word lands (Enter or a tap on an offered chip) the box empties and keeps the focus: the next word follows
  const clear = () => {
    if (tagBox) tagBox.value = ""
    setTq("")
    tagBox?.focus()
  }
  const tagPop = () => (props.inDrawer ? "tags-drawer" : "tags-side") // the drawer and the desktop sidebar may both be mounted
  const leaveFor = (go: () => void) => {
    props.onLeave?.()
    go()
  }
  // the shelf's search (query.ts): plain words over title, summary and the player's words on the card, `#` on one of
  // those words or a facet, `-` negates; the plain words are what the rows mark
  const [cq, setCq] = createSignal("")
  const setQuery = (q: string) => {
    setCq(q)
    if (shelfSearch) shelfSearch.value = q
  }
  const filterByTag = (w: string) => {
    setQuery(`#${w}`)
    toShelf()
  }
  const wordsOn = (id: string) => me()?.tags?.[id] ?? []
  const terms = createMemo(() => parse(cq()))
  const marked = createMemo(() => plain(terms()))
  const shown = createMemo(() => shelf().filter((c) => admits(c, terms(), wordsOn(c.id))))
  // the facet panel (#130): a popover under the box while it holds the focus and the query is only `#` terms or ends
  // in a `#…` being typed (query.ts `facetsWanted`; a plain word closes it, freeing the list under it), the `#` words on the cards the query admits, each with its count; a click adds `#word`, or removes it when it is
  // on. A trailing `#…` still being typed narrows the words and is what a click completes: counted without it
  const draft = createMemo(() => /(?:^|\s)#(\S*)$/.exec(cq())?.[1])
  const capsules = createMemo(() => {
    const d = draft()
    const base = d === undefined ? terms() : parse(cq().slice(0, -d.length - 1))
    const rows = shelf().filter((c) => admits(c, base, wordsOn(c.id)))
    return facetCounts(rows, wordsOn).filter(([w]) => fold(w).includes(fold(d ?? "")))
  })
  const isOn = (w: string) => terms().some((x) => x.tag && !x.not && x.word === fold(w))
  const pick = (w: string) => {
    const toks = cq().split(/\s+/).filter(Boolean)
    if (draft() !== undefined) toks.pop()
    const kept = toks.filter((r) => !parse(r).some((x) => x.tag && !x.not && x.word === fold(w)))
    const q = [...kept, ...(isOn(w) ? [] : [`#${w}`])].join(" ")
    setQuery(q && `${q} `)
    peek(facetsWanted(q))
  }
  let facetPop: HTMLDivElement | undefined
  const peek = (on: boolean) => void facetPop?.togglePopover(on)
  const facetId = () => (props.inDrawer ? "facets-drawer" : "facets-side") // as `tagPop`: both may be mounted
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
  const toShelf = () => void toHome()
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
  const toWorkshop = () => {
    if (at() === null) return
    props.onLeave?.()
    open("workshop")
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
        <span class="side-top-end">
          <Show when={which() === "workspace"}>
            <button
              type="button"
              class="icon sm"
              aria-label={t("side.manager")}
              disabled={!card()}
              onClick={openManager}
            >
              <Archive />
            </button>
          </Show>
          <Show when={props.inDrawer}>
            <button type="button" class="icon sm" aria-label={t("common.close")} onClick={() => props.onLeave?.()}>
              <Close />
            </button>
          </Show>
        </span>
      </div>
      <div class="side-mid">
        <div class="side-track">
          {/* layer A, the shelf: every card of the install */}
          <section class="pane shelf" aria-label={t("side.allCards")} inert={which() !== "shelf"}>
            <div
              class="input-box sm shelf-search"
              onFocusOut={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) peek(false)
              }}
            >
              <Clue aria-hidden="true" />
              <input
                type="search"
                ref={(el) => (shelfSearch = el)}
                placeholder={t("side.searchCards")}
                aria-label={t("side.searchCards")}
                onFocus={(e) => peek(facetsWanted(e.currentTarget.value))}
                onInput={(e) => {
                  setCq(e.currentTarget.value)
                  peek(facetsWanted(e.currentTarget.value))
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") peek(false)
                }}
              />
              {/* a press keeps the focus in the box, so a capsule's click lands and the panel stays open */}
              <div
                id={facetId()}
                ref={(el) => (facetPop = el)}
                class={{ "facet-pop": true, none: !capsules().length }}
                popover="manual"
                onMouseDown={(e) => e.preventDefault()}
              >
                <For each={capsules()} keyed={false}>
                  {(c) => (
                    <button
                      type="button"
                      class="chip"
                      aria-pressed={isOn(c()[0]) ? "true" : "false"}
                      onClick={() => pick(c()[0])}
                    >
                      <span>{c()[0]}</span>
                      <span class="count">{c()[1]}</span>
                    </button>
                  )}
                </For>
              </div>
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
                          <Mark text={c().title} q={marked()} />
                        </span>
                        <Show when={busyOn(rows(), c().id)}>
                          <i class="busy-dot" role="status" aria-label={t("side.cardBusy")} />
                        </Show>
                      </span>
                      <Show when={c().summary}>
                        {(s) => (
                          <span class="summary">
                            <Mark text={s()} q={marked()} />
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
            <button type="button" class="cardhead" disabled={!card()} onClick={toWorkshop}>
              <h1>{card()?.title ?? at() ?? ""}</h1>
              <span class="enter" aria-hidden="true">
                <Next />
              </span>
            </button>
            <div class="workspace-tags scroller">
              <For each={words()} keyed={false}>
                {(w) => (
                  <span class="chip">
                    <button type="button" class="word" onClick={() => filterByTag(w())}>
                      {w()}
                    </button>
                    <button
                      type="button"
                      class="del"
                      aria-label={`${w()} · ${t("side.removeTag")}`}
                      onClick={() => tagsOf((ws) => ws.filter((x) => x !== w()))}
                    >
                      <Close aria-hidden="true" />
                    </button>
                  </span>
                )}
              </For>
              <button
                type="button"
                class={{ chip: true, add: true, empty: !words().length }}
                disabled={!me() || at() === null}
                aria-label={t("side.addTag")}
                popovertarget={tagPop()}
              >
                <Show
                  when={words().length}
                  fallback={
                    <>
                      <Tag aria-hidden="true" />
                      <span>{t("side.addTag")}</span>
                    </>
                  }
                >
                  <Snippets aria-hidden="true" />
                </Show>
              </button>
              <div
                id={tagPop()}
                class="tag-pop"
                popover
                onToggle={(e) => {
                  if (e.newState === "open") return tagBox?.focus()
                  setTq("")
                  if (tagBox) tagBox.value = ""
                }}
              >
                <div class="input-box sm">
                  <input
                    type="text"
                    ref={(el) => (tagBox = el)}
                    disabled={words().length >= MAX_TAGS}
                    placeholder={t("side.addTag")}
                    aria-label={t("side.addTag")}
                    onInput={(e) => setTq(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return // an IME's confirming Enter is not a tag
                      e.preventDefault()
                      const w = e.currentTarget.value.trim()
                      if (w && !words().includes(w)) attach(w)
                      clear()
                    }}
                  />
                </div>
                <Show when={offered().length}>
                  <div class="tag-chips scroller">
                    <For each={offered()} keyed={false}>
                      {(w) => (
                        <button
                          type="button"
                          class="chip"
                          onClick={() => {
                            attach(w())
                            clear()
                          }}
                        >
                          {w()}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <button
                  type="button"
                  class="btn sm ghost manage"
                  popovertarget={tagPop()}
                  popovertargetaction="hide"
                  onClick={() => leaveFor(openTagManager)}
                >
                  {t("tags.manage")}
                </button>
              </div>
            </div>
            <div class="workspace-tools">
              <button type="button" class="row" disabled={!me()} onClick={() => leaveFor(openPicker)}>
                <span class="lbl">
                  <User aria-hidden="true" />
                  <span>{t("common.persona")}</span>
                </span>
                <span class="val">{persona()}</span>
              </button>
              <button type="button" class="row" disabled={!me()} onClick={() => leaveFor(openWriting)}>
                <span class="lbl">
                  <Write aria-hidden="true" />
                  <span>{t("side.writing")}</span>
                </span>
                <span class="val">{writing()}</span>
              </button>
            </div>
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
                          <Show
                            when={s().busy}
                            fallback={<span class={{ turns: true, zero: s().turns === 0 }}>#{s().turns}</span>}
                          >
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
      <Show when={props.inDrawer}>
        <footer class="side-foot">
          {/* the phone has no top strip: the install's keys stay at the drawer's foot */}
          <span class="left">
            <InstallKeys onLeave={props.onLeave} />
          </span>
        </footer>
      </Show>
    </div>
  )
}
