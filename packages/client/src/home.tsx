// Home (the 10-31 decision that reverses sidebar-brief-1's "no home page"): where a fresh start lands, a home tab's
// stage with no story and no card, the sidebar beside it on the shelf. What it holds is not settled yet: for now a
// placeholder, a mark and a title in the middle of the stage card, nothing to click. It fills the stage card over the
// reader like any page, with no head (nothing is under it to go back to); on a phone it leaves the strip above it in
// view, the drawer's key with it.
import { createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Back, Sliders } from "./icons.tsx"
import { close } from "./pages.ts"
import { cards, focus } from "./store.ts"
import { theme } from "./theme.ts"
import { t } from "./i18n.ts"

export type BrandId =
  | "rosette-04"
  | "astrolabe-04"
  | "rosette-03"
  | "astrolabe-03"
  | "rosette-01"
  | "rosette-02"
  | "astrolabe-01"
  | "key-visual"

export const BRAND_OPTIONS: readonly {
  id: BrandId
  code: string
  src: string
  iconSrc: string
  tall?: boolean
  kind: "svg" | "img"
}[] = [
  {
    id: "rosette-04",
    code: "04 · Twin-Reel",
    src: "/brand/projector-rosette-04.svg",
    iconSrc: "/brand/projector-rosette-04.svg",
    tall: true,
    kind: "svg",
  },
  {
    id: "astrolabe-04",
    code: "04 · Bayonet",
    src: "/brand/cinema-astrolabe-04.svg",
    iconSrc: "/brand/cinema-astrolabe-04.svg",
    kind: "svg",
  },
  {
    id: "rosette-03",
    code: "03 · Crescent",
    src: "/brand/projector-rosette-03.svg",
    iconSrc: "/brand/projector-rosette-03.svg",
    kind: "svg",
  },
  {
    id: "astrolabe-03",
    code: "03 · Art Deco",
    src: "/brand/cinema-astrolabe-03.svg",
    iconSrc: "/brand/cinema-astrolabe-03.svg",
    tall: true,
    kind: "svg",
  },
  {
    id: "rosette-01",
    code: "01 · Maltese",
    src: "/brand/projector-rosette-01.svg",
    iconSrc: "/brand/projector-rosette-01.svg",
    kind: "svg",
  },
  {
    id: "rosette-02",
    code: "02 · Oblique",
    src: "/brand/projector-rosette-02.svg",
    iconSrc: "/brand/projector-rosette-02.svg",
    kind: "svg",
  },
  {
    id: "astrolabe-01",
    code: "01 · Round",
    src: "/brand/cinema-astrolabe-01.svg",
    iconSrc: "/brand/cinema-astrolabe-01.svg",
    kind: "svg",
  },
  {
    id: "key-visual",
    code: "GPT · Frame",
    src: "/brand/key-visual.jpg",
    iconSrc: "/brand/cinema-astrolabe-04.svg",
    kind: "img",
  },
]

const [activeBrand, setActiveBrand] = createSignal<BrandId>("rosette-04")

export const BrandGlyph = () => {
  const cur = () => BRAND_OPTIONS.find((o) => o.id === activeBrand()) ?? BRAND_OPTIONS[0]!
  return (
    <img
      class="brand-glyph"
      data-dark={theme() === "dark" ? "true" : "false"}
      src={cur().iconSrc}
      alt=""
      aria-hidden="true"
    />
  )
}

export const Home = () => {
  const cur = () => BRAND_OPTIONS.find((o) => o.id === activeBrand()) ?? BRAND_OPTIONS[0]!
  return (
    <div class="home-page" data-dark={theme() === "dark" ? "true" : "false"}>
      <div class="home-mark" data-kind={cur().kind}>
        <Show
          when={cur().kind === "svg"}
          fallback={
            <figure class="home-still">
              <img src={cur().src} alt="" aria-hidden="true" />
            </figure>
          }
        >
          <img class={{ "home-emblem": true, tall: Boolean(cur().tall) }} src={cur().src} alt="" aria-hidden="true" />
        </Show>
        <h1>{t("home.title")}</h1>
      </div>
      <nav class="home-Direction-picker" aria-label={t("home.title")}>
        <For each={BRAND_OPTIONS} keyed={(o) => o.id}>
          {(o) => (
            <button
              type="button"
              class="chip"
              aria-pressed={activeBrand() === o().id ? "true" : "false"}
              onClick={() => setActiveBrand(o().id)}
            >
              {o().code}
            </button>
          )}
        </For>
      </nav>
    </div>
  )
}

/** The card workshop placeholder: opened from the workspace's card head, never a second entry to New story. */
export const Workshop = () => {
  const shelf = read(cards)
  const at = read(focus)
  const title = () => shelf().find((c) => c.id === at())?.title ?? at() ?? ""
  return (
    <div class="status-page workshop-page">
      <header>
        <button type="button" class="icon" aria-label={t("common.back")} onClick={close}>
          <Back />
        </button>
        <h1>{t("side.workshop")}</h1>
      </header>
      <div class="workshop-body">
        <div class="home-mark">
          <Sliders aria-hidden="true" />
          <h1>{title()}</h1>
          <p>{t("side.workshopPending")}</p>
        </div>
      </div>
    </div>
  )
}
