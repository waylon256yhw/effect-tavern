// Home (the 10-31 decision that reverses sidebar-brief-1's "no home page"): where a fresh start lands, a home tab's
// stage with no story and no card, the sidebar beside it on the shelf. What it holds is not settled yet: for now a
// placeholder, a mark and a title in the middle of the stage card, nothing to click. It fills the stage card over the
// reader like any page, with no head (nothing is under it to go back to); on a phone it leaves the strip above it in
// view, the drawer's key with it.
import { read } from "./bridge.ts"
import { Back, Home as Mark, Sliders } from "./icons.tsx"
import { close } from "./pages.ts"
import { cards, focus } from "./store.ts"
import { t } from "./i18n.ts"

export const Home = () => (
  <div class="home-page">
    <div class="home-mark">
      <Mark aria-hidden="true" />
      <h1>{t("home.title")}</h1>
    </div>
  </div>
)

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
