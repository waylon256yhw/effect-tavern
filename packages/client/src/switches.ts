// The writing switches as the client draws them (the Writing page, the session's summary chips): each switch is a key
// of `Writing`, the values named in the language of the sentences they compile to (layer.ts `harness`, shown on the
// switch card). A value not set leaves the card's or lower rank's text in force, and pressing the set one again unsets
// it. Pure data and helpers, so a test and the side panel read them without the page.
import type { Writing } from "@effect-tavern/runtime/src/fragment.ts"
import { harness, type From } from "@effect-tavern/runtime/src/layer.ts"
import { type Key, t } from "./i18n.ts"

export type SwitchKey = "pov" | "echo" | "agency" | "verbosity"
export interface Switch {
  key: SwitchKey
  label: Key
  values: [string | boolean, Key][]
}
export const SWITCHES: Switch[] = [
  {
    key: "pov",
    label: "switches.pov",
    values: [
      ["second", "switches.povSecond"],
      ["third", "switches.povThird"],
      ["none", "switches.povNone"],
    ],
  },
  {
    key: "echo",
    label: "switches.echo",
    values: [
      [true, "switches.echoOn"],
      [false, "switches.echoOff"],
    ],
  },
  {
    key: "agency",
    label: "switches.agency",
    values: [
      ["strict", "switches.agencyStrict"],
      ["free", "switches.agencyFree"],
    ],
  },
  {
    key: "verbosity",
    label: "switches.verbosity",
    values: [
      ["concise", "switches.verbosityConcise"],
      ["medium", "switches.verbosityMedium"],
      ["detailed", "switches.verbosityDetailed"],
    ],
  },
]
const defaults = new Map((harness("act").asks ?? []).map((a) => [a.id, a.text]))

/** The sentence a value compiles to: from the resolved `sentences` map when given, else the code's default. */
export const sentence = (
  key: SwitchKey,
  value: string | boolean,
  sentences?: Readonly<Record<string, string>>,
): string => {
  const id = `switch.${key}.${String(value)}`
  return sentences?.[id] ?? defaults.get(id) ?? ""
}
/** Which frame slot a switch compiles into (`pov` holds pov, echo, agency; `verbosity` holds verbosity). */
const slotOfSwitch = (key: SwitchKey): "pov" | "verbosity" => (key === "verbosity" ? "verbosity" : "pov")
/** Who took over the switch's slot with free text (card or a fragment that is not `compiled: true`), or null when the
 *  switches remain in control. */
export const takenBy = (
  key: SwitchKey,
  layer:
    | {
        frame: readonly { id: string; compiled?: boolean; [k: string]: unknown }[]
        tail: readonly { id: string; compiled?: boolean; [k: string]: unknown }[]
        switches: { taken: { pov: From | null; verbosity: From | null } }
      }
    | undefined,
): From | null => {
  if (!layer) return null
  const slot = slotOfSwitch(key)
  const who = layer.switches.taken[slot]
  if (!who) return null
  const compiled = [...layer.frame, ...layer.tail].some((f) => f.id === slot && f.compiled)
  return compiled ? null : who
}
/** Whether a switch is moot: with no player in the fiction (`pov: none`), echo and agency drop (layer.ts `compile`). */
export const moot = (key: SwitchKey, w: Writing | undefined): boolean =>
  (key === "echo" || key === "agency") && w?.pov === "none"
/** The value a press leaves: pressing the set value unsets it. */
export const pressing = (key: SwitchKey, w: Writing | undefined, v: string | boolean): string | boolean | undefined =>
  v === w?.[key] ? undefined : v
/** The switches in force, by name (moot ones left out); none set, "跟随卡片". `extra` adds the chip for a per-card
 *  supplement in force, named as the Writing page names it. */
export const chosen = (w: Writing | undefined, extra = false): string[] => {
  const on = SWITCHES.filter((s) => !moot(s.key, w)).flatMap((s) =>
    s.values.filter(([v]) => w?.[s.key] === v).map(([, l]) => t(l)),
  )
  const chips = on.length ? on : [t("switches.followCard")]
  return extra ? [...chips, t("switches.cardExtra")] : chips
}
