// The writing switches as the client draws them (the Writing page's first tab, the session's summary chips): each
// switch is a key of `Writing`, the values named in the language of the sentences they compile to (fragment.ts
// `SENTENCES`, shown as each value's title). A value not set leaves the card's own text in force, and pressing the
// set one again unsets it. Pure data and helpers, so a test and the side panel read them without the page.
import { SENTENCES, type Writing } from "@effect-tavern/runtime/src/fragment.ts"

export type SwitchKey = keyof typeof SENTENCES
export interface Switch {
  key: SwitchKey
  label: string
  values: [string | boolean, string][]
}
export const SWITCHES: Switch[] = [
  {
    key: "pov",
    label: "视角",
    values: [
      ["second", "第二人称"],
      ["third", "第三人称"],
      ["none", "无主角"],
    ],
  },
  {
    key: "echo",
    label: "引言",
    values: [
      [true, "转述言行"],
      [false, "直接反应"],
    ],
  },
  {
    key: "agency",
    label: "主导",
    values: [
      ["strict", "仅限输入"],
      ["free", "允许续写"],
    ],
  },
  {
    key: "verbosity",
    label: "篇幅",
    values: [
      ["concise", "简短"],
      ["medium", "适中"],
      ["detailed", "详尽"],
    ],
  },
]
/** The sentence a value compiles to: the title on its button. */
export const sentence = (key: SwitchKey, value: string | boolean): string => SENTENCES[key][String(value)] ?? ""
/** Whether a switch is moot: with no player in the fiction (`pov: none`), echo and agency drop (fragment.ts `writing`). */
export const moot = (key: SwitchKey, w: Writing | undefined): boolean =>
  (key === "echo" || key === "agency") && w?.pov === "none"
/** The value a press leaves: pressing the set value unsets it. */
export const pressing = (key: SwitchKey, w: Writing | undefined, v: string | boolean): string | boolean | undefined =>
  v === w?.[key] ? undefined : v
/** The switches in force, by name (moot ones left out); none set, "跟随卡片". `extra` adds the chip for a per-card
 *  supplement in force, named as the Writing page names it (本卡补充: four characters, so three chips fit the
 *  session card's row). */
export const chosen = (w: Writing | undefined, extra = false): string[] => {
  const on = SWITCHES.filter((s) => !moot(s.key, w)).flatMap((s) =>
    s.values.filter(([v]) => w?.[s.key] === v).map(([, l]) => l),
  )
  const chips = on.length ? on : ["跟随卡片"]
  return extra ? [...chips, "本卡补充"] : chips
}
