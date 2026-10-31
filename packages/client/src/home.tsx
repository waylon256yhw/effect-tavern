// Home (the 10-31 decision that reverses sidebar-brief-1's "no home page"): where a fresh start lands, a home tab's
// stage with no story and no card, the sidebar beside it on the shelf. What it holds is not settled yet: for now a
// placeholder, a mark and a title in the middle of the stage card, nothing to click. It fills the stage card over the
// reader like any page, with no head (nothing is under it to go back to); on a phone it leaves the strip above it in
// view, the drawer's key with it.
import { Home as Mark } from "./icons.tsx"
import { t } from "./i18n.ts"

export const Home = () => (
  <div class="home-page">
    <div class="home-mark">
      <Mark aria-hidden="true" />
      <h1>{t("home.title")}</h1>
    </div>
  </div>
)
