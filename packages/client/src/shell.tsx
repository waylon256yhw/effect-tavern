// The shell (#117, docs/sidebar-brief-1.md, the 10-31 spatial decision): three layers on the canvas. The ground is
// the install's chrome: a thin top strip (the sidebar's fold key at the far left, the tabs (tabs.ts), each naming its
// card › story, with a dot while its story runs or after it landed unseen, and "+"; at the right end settings, theme
// and language) and
// the sidebar (side.tsx) in the left space. On it stands one entity, the stage card, which holds whatever the stage
// shows: the reader (no strip: three keys, Timeline, Inspector and 读数, float at its top right), or a page that fills
// it (the card page, Timeline, Inspector, Writing, Settings, 读数; each with its own head, pages.ts). The sidebar
// folds to nothing (no icon rail): the key, a click on the stage's left edge, or a pull past the threshold; folded,
// the pointer at the screen's left edge floats it over the stage (ground turned figure), and the key docks it in
// place. The stage's edge drags the width inside a band with a detent under its floor (shell.ts); a fold forgets the
// width. The device remembers the fold and the width. Under 72rem there is no canvas: the stage card is the screen,
// the reader's strip is ☰ (the sidebar as a drawer, whose workspace holds the persona and writing), `card › story`
// as plain text, and the same three keys.
import { type JSX } from "@solidjs/web"
import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { StoryDialogs } from "./dialogs.tsx"
import {
  Back,
  Card as CardGlyph,
  Chat,
  Close,
  Edit,
  Home,
  List,
  Probe,
  Settings,
  Sidebar as SidebarGlyph,
  Snippets as Plus,
  Status,
  Tree,
} from "./icons.tsx"
import { openInspector } from "./inspector.tsx"
import { drag, remembered, SIDE } from "./fold.ts"
import { InstallKeys, Sidebar } from "./side.tsx"
import { card, cards, isHome, page, type Page, path, stories, tabs } from "./store.ts"
import { add, remove, unread } from "./tabs.ts"
import { openTimeline } from "./timeline.tsx"
import { close, open, pick } from "./pages.ts"
import { t } from "./i18n.ts"

const FOLDED = "side-folded"
const WIDTH = "side-w"
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // a browser without storage keeps the state for the page's life
  }
}
const media = typeof window === "undefined" ? undefined : window.matchMedia("(min-width: 72rem)")

export const Shell = (props: { children: JSX.Element }) => {
  const pg = read(page)
  const view = read(card)
  const shelf = read(cards)
  const lib = read(stories)
  const line = read(path)
  const strip = read(tabs)
  const marked = read(unread)
  // ── the width class: the canvas with its sidebar, or the phone ──
  const [wide, setWide] = createSignal(media?.matches ?? true)
  onSettled(() => {
    const on = (e: MediaQueryListEvent) => setWide(e.matches)
    media?.addEventListener("change", on)
    return () => media?.removeEventListener("change", on)
  })
  // ── the sidebar's fold, float and width (fold.ts for the arithmetic) ──
  const wasFolded = stored(FOLDED) === "true"
  const [folded, setFolded] = createSignal(wasFolded)
  const [peek, setPeek] = createSignal(false)
  const [width, setWidth] = createSignal(wasFolded ? SIDE.default : remembered(stored(WIDTH)))
  const [shown, setShown] = createSignal<number | null>(null) // the track under the hand, while dragging
  const [resizing, setResizing] = createSignal(false)
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  /** Folds and forgets the width: the track keeps its width through the slide out, then returns to the default. */
  const fold = () => {
    setFolded(true)
    setPeek(false)
    store(FOLDED, "true")
    store(WIDTH, String(SIDE.default))
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => setWidth(SIDE.default), 180)
  }
  /** Docks at `w` (the default unless the pull set one): folded or floating, it stands in the left space again. */
  const dock = (w: number = SIDE.default) => {
    clearTimeout(resetTimer)
    setFolded(false)
    setPeek(false)
    setWidth(w)
    store(FOLDED, "false")
    store(WIDTH, String(w))
  }
  const toggle = () => (folded() ? dock() : fold())
  // the float: the pointer at the screen's left edge brings the folded sidebar over the stage; leaving it (not onto
  // the key, which docks it) lets it go after a moment
  let peekTimer: ReturnType<typeof setTimeout> | undefined
  const openPeek = () => {
    clearTimeout(peekTimer)
    if (!folded()) return
    clearTimeout(resetTimer)
    setWidth(SIDE.default)
    setPeek(true)
  }
  const closePeek = (delay = 90) => {
    clearTimeout(peekTimer)
    peekTimer = setTimeout(() => setPeek(false), delay)
  }
  const holdPeek = () => clearTimeout(peekTimer)
  let key: HTMLButtonElement | undefined
  let space: HTMLElement | undefined
  const leaving = (e: PointerEvent, other: HTMLElement | undefined) => {
    if (!folded() || !peek()) return
    if (other && e.relatedTarget instanceof Node && other.contains(e.relatedTarget)) return
    closePeek()
  }
  // the stage's left edge: a press without a move folds; a pull sets the width, with the detent and the spring, and
  // past the thresholds folds or docks. `pressed` is the hand on the edge (one drag may fold and dock again);
  // `resizing` is only the frames the track follows the hand, when the stage must not ease after it
  let canvas: HTMLDivElement | undefined
  let pressed = false
  let moved = false
  let downX = 0
  let keep: number = SIDE.default
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    clearTimeout(resetTimer)
    pressed = true
    moved = false
    downX = e.clientX
    keep = width()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setResizing(true)
  }
  const onMove = (e: PointerEvent) => {
    if (!pressed) return
    if (!moved && Math.abs(e.clientX - downX) < 4) return
    moved = true
    const x = e.clientX - (canvas?.getBoundingClientRect().left ?? 0)
    const d = drag(x, folded())
    switch (d.kind) {
      case "close":
        // the fold eases from where the track stands (not a jump back to the width before the pull), and the
        // stage eases shut with it: the hand is still down, but it no longer leads
        setWidth(Math.round(shown() ?? width()))
        setShown(null)
        setResizing(false)
        fold()
        return
      case "open":
        setShown(null)
        setResizing(false) // the stage eases out to the width; the next move takes the lead again
        dock(d.width)
        keep = d.width
        return
      case "width":
        if (!resizing()) setResizing(true)
        setShown(d.shown)
        keep = d.keep
        return
      case "none":
        return
    }
  }
  const onUp = () => {
    if (!pressed) return
    pressed = false
    setResizing(false)
    setShown(null)
    if (!moved) return fold() // a click on the edge folds
    if (!folded()) {
      setWidth(keep)
      store(WIDTH, String(keep))
    }
  }
  // ── what the strips name ──
  const current = createMemo(() => lib()?.stories.find((s) => s.id === lib()?.current))
  const storyCard = () => {
    const c = current()
    return (c && shelf().find((x) => x.id === c.card)?.title) ?? view()?.title ?? ""
  }
  const storyTitle = () => {
    const c = current()
    return c ? (c.title ?? t("stories.newStory")) : ""
  }
  // ── the phone's drawer ──
  let drawer: HTMLDialogElement | undefined
  const leaveDrawer = () => drawer?.close()
  /** The reader's three keys: Timeline, Inspector, 读数, one behaviour (a page in place, Escape and Back to return);
   *  small on the canvas, the strip's size on the phone. They are the reader's, so no page they open is ever under
   *  them: no key of the three has a pressed state. */
  const Keys = () => (
    <>
      <button type="button" class={{ icon: true, sm: wide() }} aria-label={t("common.timeline")} onClick={openTimeline}>
        <Tree />
      </button>
      <button
        type="button"
        class={{ icon: true, sm: wide() }}
        aria-label={t("side.inspector")}
        disabled={line().length === 0}
        onClick={openInspector}
      >
        <Probe />
      </button>
      <button
        type="button"
        class={{ icon: true, sm: wide() }}
        aria-label={t("side.readings")}
        disabled={line().length === 0}
        onClick={() => open("status")}
      >
        <Status />
      </button>
    </>
  )
  return (
    <>
      <Show when={wide()}>
        <header class="shell-top">
          <Show
            when={pg() !== "settings"}
            fallback={
              <button type="button" class="shell-back" onClick={close}>
                <Back />
                <span>{t("common.back")}</span>
              </button>
            }
          >
            <button
              type="button"
              class="icon sm"
              ref={(el) => (key = el)}
              aria-label={folded() ? t("side.expand") : t("side.collapse")}
              aria-expanded={folded() ? "false" : "true"}
              onClick={toggle}
              onPointerEnter={holdPeek}
              onPointerLeave={(e) => leaving(e, space)}
            >
              <SidebarGlyph />
            </button>
            {/* the tabs (tabs.ts): equal-width; the icon is the route (the page on the stage), the text is where the tab
              is (card › story, card, or 主页); another tab clicked switches to it, the active one does nothing */}
            <For each={strip().list} keyed={(x) => x.id}>
              {(x) => {
                const row = () => lib()?.stories.find((s) => s.id === x().story)
                const on = () => x().id === strip().active
                // the story is named only while the tab is on its card: another card browsed names that card alone
                const named = () => (row()?.card === x().card ? row() : undefined)
                const glyph = (): JSX.Element => {
                  const p: Page = x().page
                  if (typeof p === "object") return <Probe />
                  switch (p) {
                    case "home":
                      return <Home />
                    case "card":
                      return <CardGlyph />
                    case "reader":
                      return <Chat />
                    case "timeline":
                      return <Tree />
                    case "status":
                      return <Status />
                    case "writing":
                      return <Edit />
                    case "settings":
                      return <Settings />
                  }
                }
                return (
                  <div class="shell-tab" aria-current={on() ? "page" : undefined}>
                    <button type="button" class="name" onClick={() => pick(x().id)}>
                      {glyph()}
                      <span class="c">
                        {isHome(x())
                          ? t("home.tab")
                          : (shelf().find((c) => c.id === x().card)?.title ?? x().card ?? "")}
                      </span>
                      <Show when={named()}>
                        {(r) => (
                          <>
                            <span class="sep" aria-hidden="true">
                              ›
                            </span>
                            <span class={{ s: true, unnamed: r().title === null }}>
                              {r().title ?? t("stories.newStory")}
                            </span>
                          </>
                        )}
                      </Show>
                    </button>
                    <Show
                      when={row()?.busy}
                      fallback={
                        <Show when={x().story !== null && marked().has(x().story!)}>
                          <i class="busy-dot still" role="status" aria-label={t("side.unread")} />
                        </Show>
                      }
                    >
                      <i class="busy-dot" role="status" aria-label={t("side.storyBusy")} />
                    </Show>
                    <button type="button" class="x" aria-label={t("side.closeTab")} onClick={() => void remove(x().id)}>
                      <Close />
                    </button>
                  </div>
                )
              }}
            </For>
            <button type="button" class="icon sm" aria-label={t("side.newTab")} onClick={() => void add()}>
              <Plus />
            </button>
          </Show>
          <span class="top-end">
            <InstallKeys />
          </span>
        </header>
      </Show>
      <div
        ref={(el) => (canvas = el)}
        class="canvas"
        data-folded={folded() ? "true" : "false"}
        data-peek={folded() && peek() ? "true" : "false"}
        data-resizing={resizing() ? "true" : undefined}
        style={{ "--side-w": `${shown() ?? width()}px` }}
      >
        <Show when={wide()}>
          {/* the screen's left edge, live while folded: the pointer there floats the sidebar */}
          <div class="edge" onPointerEnter={openPeek} />
          <aside
            class="side"
            ref={(el) => (space = el)}
            aria-label={t("side.navigation")}
            onPointerEnter={holdPeek}
            onPointerLeave={(e) => leaving(e, key)}
          >
            <Sidebar onLeave={() => setPeek(false)} />
          </aside>
        </Show>
        <div class="stage" data-stage={typeof pg() === "object" ? "inspect" : pg()}>
          <Show when={wide()}>
            <div
              class="resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("side.resize")}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
          </Show>
          <section class="stage-card" aria-label={t("side.stage")}>
            <Show
              when={wide()}
              fallback={
                /* the phone's strip: the drawer, what is read (a name, not a key), the reader's keys; a page covers it
                  with its own head */
                <header class="strip">
                  <button
                    type="button"
                    class="icon"
                    aria-label={t("side.navigation")}
                    onClick={() => drawer?.showModal()}
                  >
                    <List />
                  </button>
                  <div class="crumb">
                    <Show when={pg() !== "home"} fallback={<span class="s">{t("home.tab")}</span>}>
                      <span class="c">{storyCard()}</span>
                      <span class="sep" aria-hidden="true">
                        ›
                      </span>
                      <span class={{ s: true, unnamed: current()?.title === null }}>{storyTitle()}</span>
                    </Show>
                  </div>
                  <Show when={pg() !== "home"}>
                    <Keys />
                  </Show>
                </header>
              }
            >
              {/* no strip: the reader's three keys float in the stage card's top right corner, over the blank beside
                the prose column, and go with the reader when a page covers it. Their footprint is bounded: at 72rem
                with the sidebar dragged to its 320px ceiling the stage card is about 824px, `main` clamps to 672px,
                76px of blank plus main's own inline padding is about 100px a side; so three 26px keys, two 4px gaps
                and the 12px right inset are 98px, the ceiling. They sit on the centre line of the sidebar's top row,
                their right edge under the install keys' on the strip above (shell.css); the column's head (reader.css
                `--head`) is that row's height, so the first line starts under them and the prose passes under them in
                the top fade */}
              <Show when={pg() === "reader"}>
                <div class="stage-keys">
                  <Keys />
                </div>
              </Show>
            </Show>
            {props.children}
            <div class="peek-scrim" aria-hidden="true" />
          </section>
        </div>
      </div>
      <Show when={!wide()}>
        {/* the phone: the sidebar as a drawer from the left */}
        <dialog class="drawer" ref={(el) => (drawer = el)} closedby="any" aria-label={t("side.navigation")}>
          <Sidebar inDrawer onLeave={leaveDrawer} />
        </dialog>
      </Show>
      <StoryDialogs />
    </>
  )
}
