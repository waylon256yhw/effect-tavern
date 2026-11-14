# Design Rules, Live-Play Pitfalls & Canonical Cards

Every rule below comes from a failure observed in live multi-turn runs and locked in regression tests. Check these whenever designing mechanics (Hat 1) or reviewing prose/rubrics (Hat 2).

## 1. Readout & Band Invariants

1. **Options must name observable deeds, never internal psychology.**
   - _Failure mode:_ In a restrained literary register, internal feelings stay subtextual; the `record` model conservatively picks the neutral option every turn and the field freezes.
   - _Rule:_ Phrase readout options around concrete scene actions (`accepts the token`, `presses for details`, `changes the subject`).
2. **A `fiction` band gated on field `X` must never prescribe the trajectory that `X`'s readout measures.**
   - _Failure mode:_ If a low-`bond` band instructs the character to "deflect every approach and keep distance", the narrator obeys, the readout sees distance, and `bond` stays trapped in that band forever.
   - _Rule:_ Describe present posture and tension in the band while leaving scene outcomes open to how the player acts.
3. **Latching readouts must include an "open / raised, not yet answered" no-change option.**
   - _Failure mode:_ When a readout shares its `when` threshold with a `lore` `offer` (e.g. a confession at `bond >= 60`), `record` evaluates the readout **on the very turn the NPC raises the confession**, before the player has replied. With only `did not happen / accepted / refused`, the model rules out `did not happen` and `accepted`, falsely latching `refused` (observed on `ri.yaml`).
   - _Rule:_ Always cover the in-flight state in the neutral option (`raised this turn, awaiting player's answer`). Verify how `record` sees it via:
     `bun packages/runtime/bin/card.ts view <card> --stage record --state <field>=<threshold>`
4. **Write authority determines whether prose can move a field.**
   - Fields modified only by `rules.actions` are purely mechanical (e.g. `gold` stays unchanged even if improvised prose says "the innkeeper hands you three coins"). If narrative events should move a field, attach a `Readout` (`prose-cannot-move` lint).

## 2. Openings & `frame` Isolation

1. **Set `Field.initial` to the lowest shared baseline across all greetings; put per-opening deltas in `greetings[n].do`.**
   - _Failure mode:_ Baking one route's elevated state (e.g. `bond: 60`) into `Field.initial` causes every other greeting to start past mid-game thresholds and fire late-game windows on turn 1.
   - _Rule:_ Always inspect the per-greeting state, active bands, open windows, and active readouts printed by `card check`.
2. **Never place character sheets inside `frame`.**
   - _Failure mode:_ `frame` is prepended to **every** stage, including `lookup`, `decide`, and `direct`. Putting an NPC profile in `frame` caused `direct` to confuse background figures with scene leads (`ri.yaml`).
   - _Rule:_ Put characters, casts, and world prose in `fiction` (`narrate` only); keep `frame` strictly for narrator voice, style, setting premise, language, and `persona` / `pov`.
3. **Write lore hooks as the player refers to the topic, not as encyclopedic labels or keywords.**
   - `layers[0]`'s first sentence (and each `section`'s first sentence) is what `lookup` scans. Keep it natural and specific.

## 3. Canonical Template & Sample Cards (`packages/runtime/cards/`, `samples/`)

Inspect these live-verified cards directly when looking for concrete YAML idioms:

- **`packages/runtime/cards/banxing.yaml` (伴星)** — Pure chat (`participant mode` without rules or lore). Demonstrates porting V3 `mes_example` dialogue into an unlabelled `fiction` voice-sample fragment.
- **`packages/runtime/cards/ri.yaml` (理)** — `participant mode` affection progression remastered from MVU: multi-stage `scale` bands on one field, `hidden: true` route switches, three greetings with distinct `do` states (`15`, `0`, `60`), and a latching confession readout.
- **`packages/runtime/cards/wuxia.yaml` (竹林)** — Full RPG + memory showcase: `actions` with rolls, readout-driven `bond` bands, 3-layer `lore` with floor + event windows, `director: true`, `world` record (`scene`, `feed: true`, `heading: "scene.place"`) + `world` table (`people`, `recall: "who"`), and `guard`.
- **`packages/runtime/cards/yandao.yaml` (盐道)** — `author mode` (`input: "note"`, no `persona`, card-supplied `pov` slot): protagonist-free world narration with readout-driven state and a turn-1 window triggered by `greetings[0].do`.
- **`samples/life-of-pi/life-of-pi.yaml` (Life of Pi)** — Multi-day time-loop remastered from V3: post-record `passages` resetting daily clocks while carrying cross-loop fields, epoch `digest` carryover (`boundary: true`), one-turn cooldown band, and `end: true` terminal ending.
