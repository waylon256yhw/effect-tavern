---
name: card-author
description: Author, revise, test, or remaster cards for Effect Tavern. Trigger whenever a task touches a card YAML (`packages/runtime/cards/*.yaml` or user cards), asks how a card expresses state/lore/products/openings, unrolls a SillyTavern card, or runs `card` / `tavern card` workshop tools.
---

# Card Author

Use canonical naming from `GLOSSARY.md` (`stage`, `turn`, `slot`, `band`, `readout`, `lore`, `section`, `ContextPolicy`, `product`, `role`, `fold`, `catalog`). Never substitute legacy tavern terms (`worldbook`, `keyword trigger`, `preset`, `character card`, `depth`, `author's note`, `memory system`).

## 1. Core Model

A card is pure declarative data (`Card` in `packages/runtime/src/card.ts`, decoded by `decodeCard`). Runtime stages are derived from what the card declares: no `rules.actions` means no `decide`, no `lore` or `recall` means no `lookup`, no `director: true` means no `direct`.

Two orthogonal coordinates place any card—not separate card formats:

- **Player presence (`persona` frame slot):** Filled → `participant mode` (player inhabits a character; `thought` applies). Empty → `author mode` (player directs from outside; model writes everyone).
- **Default input channel (`input`):** `"act"` (enters `transcript`) or `"note"` (feeds `direct` and `narrate` this turn only).

Turn spine assembled in `packages/runtime/src/request.ts`:
`lookup → (decide → settle)* → gate → direct → narrate → check → polish → record`

- The narrator (`narrate`) is the **only** stage that reads `fiction` and `transcript`, and **never** sees raw field numbers—state reaches narration strictly through `when`-gated `fiction` bands.
- **Negative constraints against legacy tavern patterns:**
  - **No preset / protocol instructions inside cards:** Never explain turn stages, XML/JSON output formats, CoT `<thinking>` tags, or continuation prefills inside card prose (`request.ts` and `Hat` own protocol framing).
  - **No chat-depth (`@D`) or sticky `Author's Note` thinking:** Prompt assembly has only `head` (`frame` + `fiction`) and `tail` (turn context). Never write prompts expecting mid-transcript injection.
  - **No inline status bars, MVU blocks, or option footers in prose:** Never ask `narrate` to print stats, inventories, or choice lists (`inline-product` and `field-in-prose` lints); declare `rules.fields`, `products` (`world` / `chronicle` / `theater`), or `<<aside>>` (`stage: "narrate"` `theater`) instead.
  - **No keyword-trigger worldbooks or stateful macros:** Gate `lore` via `Cond` (`unlock` floors + `offer` windows) and concise first-sentence `hooks` for `lookup`; never use `{{setvar}}` / `{{roll}}` macros (`unsupported-macro` lint).
  - **No negative prohibition walls in `narrate`:** Put post-prose rules in `guard` (`check`), slop patterns in `lexicon` (`polish`), and agency boundaries on `switches.agency` / `pov`.

## 2. Two-Hat Workflow (Strict Order)

1. **Hat 1 — Architect (Mechanism & Skeleton Only)**
   - Keep prose to one-line placeholders.
   - Choose the two coordinates (`persona` slot + `input`).
   - Declare `rules.fields` (bounds, `initial`, `start`, `hidden`, `view`), decide which fields move via `actions` (mechanical) vs. `readouts` (prose-driven), and wire `effects` / `events` / `over` / `cap`.
   - Lay out `lore` (`unlock` floors, `offer` windows, `sections`, `ContextPolicy`), `fiction` band `when` conditions, `greetings` (`do` effects, optional dynamic `note`), `products`, and `catalogs`.
   - Validate with `card check <card> --json` until zero errors and expected field/greeting lines, then lock behavior with `card test <card> [scenario.yaml]`.
2. **Hat 2 — Novelist (Prose & Voice)**
   - Freeze the mechanism. Write `frame` slots, `fiction` bands, `lore` layers/sections, `greetings`, `guard`, and `lexicon`.
   - Re-run `card check` (catches `field-in-prose`, `inline-product`, `hook-length`, `unfilled-name`, `empty-text`).
   - Inspect exact prompt assembly across states and stages via `card view <card> --stage narrate|record|lookup|direct --state k=v --greeting n`.

## 3. Author Prose Boundaries

Whether invoking Workshop tools (`tavern card compile|sort|review`) or editing YAML directly:

- **Preserve author prose verbatim.** Never paraphrase existing `frame`, `fiction`, `lore`, `greetings`, `Action.text`, `Readout.text`, option `text`, or `Chance.judge` unless the author explicitly asks to rewrite prose.
- **Leave new slots empty when compiling mechanics.** Newly created prose or rubric slots stay empty (`empty-text` diagnostic blocks installation until filled with the author's words).
- **`sort` only moves whole source paragraphs** in source order without rewriting sentences.

## 4. Self-Describing CLI Toolchain

All CLIs expose full flag documentation via `--help` and machine-readable output via `--json` / `--jsonl`. Inspect `--help` rather than guessing flags:

| Task                 | Command (from repo root)                                                                                    | Notes                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Scaffold new card    | `bun packages/runtime/bin/card.ts init <id> --template chat\|readout\|rpg\|world`                           | Offline; writes `<id>.yaml` exclusively                        |
| Validate & lint      | `bun packages/runtime/bin/card.ts check <card> [--json]`                                                    | Schema, lint, `drawn` meters, openings, token budget           |
| Preview stage prompt | `bun packages/runtime/bin/card.ts view <card> [--stage ...] [--state k=v] [--greeting n] [--lore] [--json]` | Offline; prints exact sections, cache breakpoints & conditions |
| Zero-token test      | `bun packages/runtime/bin/card.ts test <card> [scenario.yaml]`                                              | Offline deterministic run on scripted fake model               |
| Unroll ST V2/V3 card | `bun packages/runtime/bin/unroll.ts <card.png\|card.json> [--user name] [--json]`                           | Read-only inspection in ST assembly order; feeds `sort`        |
| Workshop operations  | `bun run tavern card compile\|sort\|review ...`                                                             | Uses `author` model route (`--url` for running server)         |
| Install & live play  | `bun run tavern card install <file>` / `bun run tavern play <card-or-story>`                                | Pass `MODEL=fake` or `--model fake` for zero-token host runs   |

## 5. Progressive Disclosure — Read On Demand

Load **only** the reference file required by your current task:

- **[references/schema.md](references/schema.md)** — Read when mapping concepts to `Card` fields (`frame` slots, `fiction` bands, `greetings`, `rules`, `drawn` gauge/scale heuristics, `lore` + `sections` + `ContextPolicy`, `products` `world`/`chronicle`/`theater`, `catalogs`, `Cond`, `names`, and static `lint` codes).
- **[references/pitfalls.md](references/pitfalls.md)** — Read before designing `readouts`, multi-opening state, `frame` vs. `fiction` placement, or inspecting the four canonical cards (`packages/runtime/cards/*.yaml`).
- **[references/workshop-and-testing.md](references/workshop-and-testing.md)** — Read when porting/remastering SillyTavern cards with `unroll`, running `tavern card compile|sort|review`, or writing `scenario.yaml` assertions.
