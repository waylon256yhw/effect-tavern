# Remastering, Workshop Pipeline & Scenario Testing

## 1. Porting / Remastering SillyTavern Cards (`unroll` → `sort`)

`unroll` (`packages/runtime/bin/unroll.ts`) is a read-only inspection instrument—not an unattended converter. It expands a SillyTavern PNG (`ccv3` / `chara` chunk) or V2/V3 JSON card in ST's exact prompt assembly order so you and the author can see what the original card actually sent to the model.

```sh
bun packages/runtime/bin/unroll.ts source-card.png --user 李 > unrolled.md
bun packages/runtime/bin/unroll.ts source-card.json --json
```

Remastering workflow:

1. **Unroll & audit:** Read the unrolled blocks (`before_char`, `description`, `personality`, `scenario`, `after_char`, split `mes_example`, `first_mes` + `alternate_greetings`, depth entries, and selective trigger table) plus any unexpanded macros at the bottom.
2. **Translate legacy tavern constructs by intent—strip scaffolding, keep the art:**

| SillyTavern V2/V3 Construct                                            | Effect Tavern Target (or Discard)                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` / `personality` (character/cast prose)                   | `fiction` fragments (`when`-gated `Band`s when posture shifts across state)                                                                                                                             |
| `scenario` (premise vs. scene setup)                                   | Global premise in `frame` (`setting`); counterpart scene posture in `fiction`                                                                                                                           |
| `mes_example` (`<START>` dialogue samples)                             | Unlabelled voice-sample fragment in `fiction` (never `frame`)                                                                                                                                           |
| `first_mes` + `alternate_greetings`                                    | `greetings[n].text`, with route-specific initial deltas moved into `greetings[n].do`                                                                                                                    |
| `character_book` `constant` ("blue light") entries                     | Always-on `fiction` fragment, or `lore` with `activation: "always"` when gated by `unlock`                                                                                                              |
| `character_book` `selective` ("green light" keywords)                  | `lore` entry (`layers` for progressive plot secrets, `sections` for horizontal appendices; rewrite first sentence as a natural `lookup` hook, discard regex keys)                                       |
| `at_depth` (`@D0`–`@D4`), `Author's Note`, `post_history_instructions` | **Never recreate depth injection.** Map voice/register rules to `frame` slots, prohibitions to `guard`, slop lists to `lexicon`, and state-dependent reminders to `fiction` bands                       |
| Inline `<status>` bars, MVU JSON patches & regex scripts               | **Discard prompt instructions & regexes.** Model scalar axes in `rules.fields` (`actions` / `readouts`), structured state in `world` `products`, and side blocks in `theater` (`record` or `<<aside>>`) |
| Anti-impersonation / jailbreak / CoT `<thinking>` walls                | **Discard.** Handled by `switches.agency` (`pov`), provider `Hat` (`/hats`), and stage separation                                                                                                       |
| `{{user}}` / `{{char}}` vs. `{{setvar}}` / `{{roll}}`                  | Keep proper-noun holes in `names`; replace stateful/random macros with `rules.fields`, `Cond`, `Effect`, and `Action.roll`                                                                              |

3. **Architect first (Hat 1):** Scaffold target coordinates with `card init`, design `rules` / `lore` gates / `products` / `greetings[].do`, and verify with `card check`.
4. **Sort & wire:** Place verbatim source paragraphs into `frame.<slot>`, `fiction.<id>`, `greetings[n]`, or `lore.<id>.layers[n]` (manually or via `tavern card sort <card.yaml> unrolled.md -o candidate.yaml`, skipping `##` header paragraphs). Preserve the original author's character and world prose verbatim unless the user explicitly asks to rewrite.

---

## 2. Workshop CLI (`compile` / `sort` / `review`)

Contract implementation: `packages/runtime/src/workshop.ts` and `packages/server/bin/tavern.ts`.
Uses model route `routing.stages.author` (falling back to `routing.default` / env `MODEL`). Connect to a running dev/headless server with `--url http://127.0.0.1:7777` when the local SQLite library is open.

```sh
# 1. Compile mechanism increments & bindings from selected prose + intent (leaves new prose slots empty)
bun run tavern card compile my-card.yaml \
  --select fiction.setting \
  --select 'lore.letter.layers[1]' \
  --intent 'Open letter layer 2 when bond reaches 8' \
  -o candidate.yaml

# 2. Place verbatim paragraphs from markdown notes into card slots
bun run tavern card sort my-card.yaml notes.md -o candidate.yaml

# 3. Read-only semantic consistency check (emits review:consistency warnings)
bun run tavern card review my-card.yaml --json

# 4. Validate & install into library (rejects any lint error including empty-text)
bun run tavern card install my-card.yaml
```

Key invariants:

- `compile` output schemas carry **no prose fields**: existing prose stays untouched, and new slots/rubrics remain empty (`empty-text`) for the author to fill.
- If `<card>.scenario.yaml` sits next to `<card>.yaml` and `compile` alters `rules`, `compile` automatically runs the zero-token scenario regression and prints `PASS` / `FAIL` on `stderr`.

---

## 3. Deterministic Zero-Token Testing (`scenario.yaml`)

`bun packages/runtime/bin/card.ts test <card> [scenario.yaml]` runs the full `Session` pipeline under the `plain` player layer (`zh`, `options` on) with zero online LLM calls. Omitting `scenario.yaml` runs a 1-turn smoke test.

```yaml
seed: 42 # first die uses seed + 1, incrementing by 1 per roll (default 0)
greeting: 0 # optional 0-based greeting index; omit to start from raw field initials
steps:
  - text: 向前走
    # note: 推进剧情
    # invoke: [card:secret]   # respects actual player access policy
    replies:
      decide:
        - { next: win, again: false } # include chance: 0.6 when roll uses { judge }
      narrate:
        - "你走到了门口。"
      check:
        - { fired: [secret], violated: [] }
      record:
        - notes: 已到门口
          options: []
          answers: { warmth: close } # readout_id: option_id
          # world products use DomainChange ops or product schema values per stage contract
    expect:
      state: { hp: 2 } # partial key deep-equal against post-turn scalar fields
      events: [won] # exact ordered match
      windows: ["secret#2"] # exact ordered match of open lore windows this turn
      lore: ["secret#1", "secret#2"] # exact ordered match of confirmed disclosures
      end: end # end | over | cap | stopped
      products: { notes: 已到门口 } # partial key deep-equal
```

Scenario rules:

- Unknown keys fail strict schema decoding.
- Omitted stage queues fall back to deterministic fake answers; any **supplied** stage queue that runs dry early or leaves unconsumed items at the end fails the test.
- Every step automatically asserts scalar field bounds and `settlementStatus === "committed"`.
