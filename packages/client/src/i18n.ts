// The interface's words (#67), in the locale in force. The dictionary is src/locales/zh-CN.ts (the source: every key
// and its Chinese), src/locales/en.ts the English under the same keys; TypeScript holds the two to one shape and
// `x18n check` (x18n.config.ts, in `verify`) reports a key used but not declared, declared but unused, or missing in
// a locale. `t("side.stories")` is a dotted path into the dictionary, checked at the type level; a message with
// `{name}` holes takes its values as the second argument. `t` reads the `locale` signal, so a word read in JSX, a
// memo or an effect follows a switch; a module-level constant does not, so tables of words are functions. The pick
// is the device's, like the theme (theme.ts): localStorage, before the player's data arrives; without one, the
// browser's language (any Chinese is zh-CN, else en); under Bun (tests) zh-CN, so the Chinese assertions hold.
import { createSignal } from "solid-js"
import en from "./locales/en.ts"
import zh from "./locales/zh-CN.ts"

/** The dictionary's shape with string leaves: what every locale file holds. */
type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> }
export type Dict = Shape<typeof zh>
export type Locale = "zh-CN" | "en"
export const LOCALES: readonly Locale[] = ["zh-CN", "en"]
const DICTS: Record<Locale, Dict> = { "zh-CN": zh, en }

/** Every dotted path to a leaf string of the dictionary. */
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>
}[keyof T & string]
export type Key = Paths<Dict>

const KEY = "locale"
const stored = (): Locale | undefined => {
  try {
    const v = localStorage.getItem(KEY)
    return v === "zh-CN" || v === "en" ? v : undefined
  } catch {
    return undefined
  }
}
const system = (): Locale => {
  if (typeof document === "undefined") return "zh-CN" // no browser (Bun's tests): the source
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  return langs.some((l) => /^zh/i.test(l ?? "")) ? "zh-CN" : "en"
}

const initial = stored() ?? system()
const [locale, setLocale] = createSignal<Locale>(initial)
/** The locale in force. */
export { locale }
const mark = (l: Locale) => {
  if (typeof document !== "undefined") document.documentElement.lang = l
}
/** The toggle: the other locale, kept on the device. */
export const flip = () => {
  const next: Locale = locale() === "en" ? "zh-CN" : "en"
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // a browser without storage keeps the pick for the page's life
  }
  mark(next)
  setLocale(next)
}
mark(initial)

const leaf = (dict: Dict, key: string): string | undefined => {
  let v: unknown = dict
  for (const part of key.split(".")) {
    if (typeof v !== "object" || v === null) return undefined
    v = (v as Record<string, unknown>)[part]
  }
  return typeof v === "string" ? v : undefined
}
/** The word under `key` in the locale in force (the source's when the locale lacks it), its `{holes}` filled. */
export const t = (key: Key, params?: Record<string, string | number>): string => {
  const s = leaf(DICTS[locale()], key) ?? leaf(zh, key) ?? key
  return params ? s.replace(/\{(\w+)\}/g, (hole, name: string) => (name in params ? String(params[name]) : hole)) : s
}
