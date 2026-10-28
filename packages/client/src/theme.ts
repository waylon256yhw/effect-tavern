// The theme (#70). tokens.css paints with light-dark(): :root follows the system until it carries `data-theme`, which
// pins one side. A manual pick is the device's, not the player's: it is about this screen and this room, and it has to
// hold before the first paint, which localStorage can and a fetch cannot. The key holds only a pick that differs from
// the system's side: flipping back to what the system shows clears it, and the page follows the system again from
// there (so a system that changes later, day to night, is followed unless the player has gone against it).
import { createSignal } from "solid-js"

export type Theme = "light" | "dark"
const KEY = "theme"
const dark = typeof window === "undefined" ? undefined : window.matchMedia("(prefers-color-scheme: dark)")
const system = (): Theme => (dark?.matches ? "dark" : "light")
const stored = (): Theme | undefined => {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : undefined
  } catch {
    return undefined
  }
}
/** The pick a flip leaves: the other side, or nothing when that is the system's own side. */
export const flipped = (current: Theme, system: Theme): Theme | undefined => {
  const next: Theme = current === "dark" ? "light" : "dark"
  return next === system ? undefined : next
}

const pin = (pick: Theme | undefined) => {
  if (pick) document.documentElement.dataset["theme"] = pick
  else delete document.documentElement.dataset["theme"]
  try {
    if (pick) localStorage.setItem(KEY, pick)
    else localStorage.removeItem(KEY)
  } catch {
    // a browser without storage keeps the pick for the page's life
  }
}

const [theme, setTheme] = createSignal<Theme>(stored() ?? system())
/** The side in force: the pick, or the system's. */
export { theme }
/** The theme button: the other side, pinned unless it is the system's own. */
export const flip = () => {
  const pick = flipped(theme(), system())
  pin(pick)
  setTheme(pick ?? system())
}

// at load, before the first paint (main.tsx imports this first): the pick, if any, on :root; a system that changes
// while nothing is pinned is followed by the CSS, the signal only keeps the button honest
if (dark) {
  const pick = stored()
  if (pick) document.documentElement.dataset["theme"] = pick
  dark.addEventListener("change", () => {
    if (!stored()) setTheme(system())
  })
}
