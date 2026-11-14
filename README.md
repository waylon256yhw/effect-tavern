# Effect Tavern

**English** | [简体中文](README.zh-CN.md)

A ground-up full-stack harness for AI roleplay and interactive fiction, built on **Effect v4**, **Solid 2.0**, **UI SDK (`@ui-sdk`)**, and **Bun**.

Effect Tavern treats a card as declarative data plus deterministic rules rather than a bundle of prompt incantations and regex scripts. Code owns the control loop, state settlement, seeded dice, and prompt cache boundaries; the LLM is invoked only at typed stage seams to judge, narrate prose, and extract structured facts.

---

## Core Architecture

### 1. Multi-Stage Turn Spine

A player turn is a typed pipeline rather than a single chat completion:

```text
lookup → (decide → settle)* → gate → direct → narrate → check → polish → record
```

- **Opt-in structured stages & fast decision passes:** Pure chat cards run only `narrate` and `record`; `lookup`, `decide`, `direct`, `check`, and `polish` activate automatically from what the card declares. An optional install-wide **Decision Model** (`/decision`) settles complete-catalog `lookup` and clear-cut `check` passes via probability scoring before falling back to language-model calls.
- **Non-authoritative prose & off-stage isolation:** Only `narrate` reads `fiction`, writing directives, and the dialogue `transcript`, and it never sees raw numbers—state reaches narration strictly as `when`-gated prose bands, while off-stage passes read only `<world>` context and XML-tagged material.
- **Deterministic state, two-phase world settlement & epoch `passages`:** Scalar `fields` settle via seeded RNG (`actions`) and post-prose multiple-choice `readouts`; mutable `world` tables/records update via sparse `DomainChange` transactions (`record`), separate from append-only `chronicle` memory (`notes`) and player-facing `theater` blocks (`inner`, `options`, `<<aside>>`). Post-record `passages` support chapter/time-loop transitions (`digest` epoch boundaries) and terminal endings (`over`).

### 2. Immutable Log Tree & Derived Views

- Every turn is a node in an append/amend tree (`Log`), recording only player inputs, seeds, and model outputs.
- Branching (`checkout`), retries (`swipe`, `reword`), inline prose/input revisions (`edit`), and manual state adjustments (`setField`) are tree operations—state, transcripts, ledgers, and prefix-compressed summaries are pure path folds (`Derived`) with stable prompt-cache breakpoints across Anthropic, OpenAI-compatible, and Gemini endpoints.

### 3. Layered Assembly Without Presets

- Legacy monolithic presets are replaced by a uniform `Layer` resolution order:
  `harness → card → mounted packs → local card settings → persona`
- Players customize voice, writing switches (`pov`, `echo`, `agency`, `verbosity`, `polish`), enhancers (`Pack`), continuation shells (`Hat`), snippets, and provider routing without touching card internals.

### 4. Departures from Legacy Tavern Clients

| Legacy Tavern Habit                       | Effect Tavern Replacement                                                      | Why                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Monolithic `preset`**                   | `request.ts` + `Layer` / `Pack` / `switches` + `Hat` + `Connection`            | Separates wire roles, player prose preferences, provider continuation handshakes, and endpoint parameters by owner.        |
| **`character card` (`V2` / `V3`)**        | Unified `Card` (`frame` + `fiction` + `participant` / `author` coordinates)    | Covers 1-on-1 roleplay, ensemble casts, RPGs, and protagonist-free worlds without shoehorning world logic into NPC fields. |
| **Chat `depth` (`@D`) & `Author's Note`** | Strict two-zone assembly (`head` + `tail`) & non-persisted `note` channel      | Never splices prompts into mid-history, preserving 100% KV prefix-cache stability and a clean dialogue `transcript`.       |
| **`worldbook` keyword scanning**          | State-gated `Lore` (`unlock` floor, `offer` window, `sections`) + `lookup`     | Replaces brittle substring/regex triggers with monotone plot progression, semantic lookup over hooks, and `ContextPolicy`. |
| **Inline `<status>` / MVU + Regex**       | `decide` / `settle` + `record` (`Readout`, `Product`, `DomainChange`)          | Keeps `narrate` focused purely on prose while code and structured `record` calls own state and side blocks.                |
| **Flat `swipes[]` & branch file copies**  | Immutable `Log` tree (`checkout`, `swipe`, `reword`, `edit`) + `Derived` folds | Zero-copy branching at any turn; state, floors, and interval summaries never desynchronize across branches.                |

---

## Workspace Layout

```text
packages/
  runtime/    Turn pipeline, Card/Layer/Product schemas, decision passes, log tree, derived folds, lint & offline card CLI
  provider/   Language & decision model connections, AI SDK compilation (Anthropic / OpenAI / Gemini), cache & stream primitives
  server/     SQLite library, HTTP + SSE host, Workshop endpoints (compile / sort / review), and `tavern` CLI
  client/     Solid 2.0 + @ui-sdk web client: spatial Shell, Reader, Card Page, Readings, Inspector, Timeline, Packs & Settings
skills/
  card-author/  Progressive-disclosure agent skill for authoring, testing, and remastering cards
samples/        Full remastered exemplar cards (e.g. `life-of-pi` with multi-day `passages` and `digest` boundaries)
site/           Cloudflare Nimbus (Astro) documentation site (HTML + clean Markdown + llms.txt)
docs/           Internal engineering research and design briefs
```

---

## Quick Start

### Prerequisites

- **Bun** `>= 1.4.4` and **Node.js** `>= 24`
- **Vite+** (`vp` CLI, `pnpm@12.11.1`)

```sh
vp install
```

### Web Stack (Development & Single-Port Server)

```sh
# Full-stack dev server (Vite HMR client + in-process /api session on .dev/tavern.db)
bun --bun vp run dev

# Use scripted zero-token model or a custom directory of YAML cards
MODEL=fake CARDS=./my-cards bun --bun vp run dev

# Build client & run single-port server (serves /api + built client on :7777)
cd packages/client && bun --bun vp build
bun run tavern serve --port 7777
```

### CLI Host & Headless Play (`tavern`)

```sh
# Terminal play (pass MODEL=fake or --model fake for zero-token runs)
MODEL=fake bun run tavern play wuxia --greeting 0 --input "走进竹林"

# Manage stories & headless server (defaults to .tavern/tavern.db; pass --url to attach to a running server)
bun run tavern story list
bun run tavern serve --headless --port 7777
```

### Card Authoring & Workshop Toolchain (`card`, `unroll`, `tavern card`)

```sh
# Offline zero-token authoring loop (init, static lint, prompt preview, scenario assertions)
bun packages/runtime/bin/card.ts init my-card --template readout
bun packages/runtime/bin/card.ts check wuxia
bun packages/runtime/bin/card.ts view ri --stage record --state affection=60
bun packages/runtime/bin/card.ts test wuxia

# Inspect a legacy SillyTavern V2/V3 PNG or JSON card in assembly order
bun packages/runtime/bin/unroll.ts path/to/card.png

# AI-assisted Workshop (compile rules/bindings, sort verbatim prose, semantic review, install)
bun run tavern card compile my-card.yaml --select fiction.setting --intent "Add a trust readout" -o candidate.yaml
bun run tavern card install my-card.yaml
```

### Verification & Documentation Site

```sh
vp check            # oxfmt + oxlint (with Solid 2.0 rules) + type-aware tsc
vp run verify       # Full assertion suite across runtime, provider, server, and client (including x18n & import-boundary checks)
cd packages/client && vp run verify:ui # Headless Chrome control & Solid diagnostics check via @ui-sdk agent bridge

pnpm run docs:dev   # Start the Nimbus documentation site locally
pnpm run docs:check # Run Nimbus structural/MDX/link checks and static build
```

---

## Documentation

- **Documentation Site (`site/`):** Full guides in English and Chinese for core concepts, card authoring, CLI & headless hosting, layers/packs, and web client architecture (also emits `/llms.txt` and `.md` endpoints for coding agents).
- **[GLOSSARY.md](GLOSSARY.md):** Canonical English naming primitives mapping domain concepts directly to code identifiers.
- **[skills/card-author/SKILL.md](skills/card-author/SKILL.md):** Agent skill for designing, linting, testing, and remastering cards.
- **[CLAUDE.md](CLAUDE.md):** Workspace toolchain (`vp`), Solid 2.0 rules, UI SDK (`@ui-sdk`) conventions, i18n (`x18n`), and dev workflow.
