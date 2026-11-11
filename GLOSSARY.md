# Glossary

Canonical naming primitives (ubiquitous language) for Effect Tavern. Developers, coding agents, skills, and internal specifications must use these exact terms without substituting synonyms. Every entry binds a domain concept directly to its code identifier.

## Naming Principles

1. **Substance over ornament.** Dramaturgical and narratological terms (`diegetic`, `dramatic irony`, `has no agency`, `metagaming`, `bleedthrough`) are borrowed strictly for their orthogonal conceptual boundaries—disentangling mechanisms that legacy tavern ecosystems conflate—never as decorative literary jargon.
2. **Internal precision, surface plainness.**
   - **Internal (`packages/*/src`, prompts in `request.ts`, skills, specs):** Use exact, boundary-tight primitives (`diegetic`, `readout`, `chronicle`, `disclosure`, `slot`).
   - **Player & author UI (`locales/`):** Use plain, zero-friction words where everyday vocabulary is already unambiguous (`opening`, `prompt`, `tokens`, `persona`, `status`, `roll`, `tag`).

---

## 1. Fiction & Dramaturgy

- **`diegetic` / `non-diegetic`** — Whether content exists inside the story world, split three ways after film sound:
  - **`external diegetic`** — Inside the story world and perceptible to everyone in the scene (speech, visible action).
  - **`internal diegetic` (`thought`)** — Inside the story world, private to one mind. The reader sees it; other characters in the scene do not. Exists only when `persona` is present.
  - **`non-diegetic` (`note`)** — Outside the story world: out-of-character direction to the narrator or director on this turn.
- **`mark`** — Surface notation marking `thought` inside player text (such as `⦅⦆`, italics, or parentheses). A player-layer convention paired with the `input.thought` ask; the wire protocol never hardcodes mark parsing.
- **`dramatic irony`** — An asymmetry between what the reader knows and what a character knows. `thought` asks the narrator for dramatic irony: counterparts remain ignorant of the thought, while narration may write around that gap.
- **`metagaming`** — A character acting on knowledge they cannot possess in-world (for example, an NPC replying to the player's unspoken `thought` or citing unrevealed lore).
- **`bleedthrough`** — The narrator speaking, acting, or deciding on the player's behalf (often called _impersonation_ or _godmodding_, split into _narrative impersonation_—describing what the player perceives—and _user impersonation_—writing the player's dialogue or choices).
  - _Contrast:_ Legacy tavern communities often lump both under "OOC / breaking character". `metagaming` is an in-world knowledge boundary violation; `bleedthrough` is a player-agency boundary violation.
- **`has no agency`** — A thought is not a move. The `decide` stage ignores `thought` when selecting mechanical actions.
- **`participant mode` / `author mode`** — Two positions on a coordinate pair rather than separate "character card" vs. "world simulator card" formats, determined by `persona` presence and default `input` channel:
  - **`participant mode`** (homodiegetic): `persona` is filled; the player inhabits a character and the model plays counterparts (`thought` applies).
  - **`author mode`** (heterodiegetic): `persona` is empty and `input` defaults to `"note"`; the player directs from outside the story while the model writes everyone.
- **`persona`** — Who the player is in the fiction. Both a `frame` slot (`persona`, filled by card default or left empty) and a named player library asset (`/personas`). A story binds an active persona (`story.persona`, defaulting to `local.persona`); resolution places its prose into the `persona` slot and its name into `names.user` on the next request without restarting the story.
- **`hat`** — A named protocol shell (`/hats`, referenced by `Connection.hat`) that primes a model family into continuation mode for a specific provider or endpoint—extracting the legitimate wire handshake that legacy tavern "jailbreak / prefill presets" buried inside style prompts. `narrate` wears `narrate.head` (placed after `frame` and `fiction`, before `transcript`) and `narrate.tail` (at the very end of the request); prose-reading stages (`check`, `polish`, `record`) wear `review.head`; `lookup`, `decide`, and `direct` wear nothing. Empty by default.
- **`slop` (`claudeism`)** — Over-repeated modelisms—stock words, formulaic antitheses (`not X, but Y`), melodrama, or clichés—that self-reinforce once admitted into openings, examples, or history.

---

## 2. Runtime, Turn & State

### Turn Spine & Execution

- **`Turn`** — One complete execution pass triggered by player input, running a fixed stage pipeline rather than a single monolithic chat completion:
  `lookup → (decide → settle)* → gate → direct → narrate → check → polish → record`.
  Structured stages (`lookup`, `decide`, `direct`, `check`, `polish`) are opt-in and activate automatically from what the card declares; a pure chat card runs only `narrate` and `record`.
  - _Contrast:_ Legacy tavern clients force one completion to simultaneously roleplay, track variables in `<status>` XML/JSON blocks, and propose options—degrading prose quality and coupling state to fragile regex scraping.
- **`Stage` (`Phase`)** — A bounded harness invocation with its own assembled request (`request.ts`) and tool/schema contract. The model never owns the outer loop.
  - **`lookup`** — Pre-narration context retrieval. Queries unlocked `lore` entries, lore `sections`, and `recall` product rows via `search_context` (directory mode on large indexes) and `read_context`, freezing this turn's `deliveries`.
  - **`decide`** — Action selection against `rules.actions`. The model outputs an action ID (plus a probability when `roll` is `{ judge }` and `again` for multi-beat input); dice and outcomes are computed by code.
  - **`settle`** — Deterministic rule evaluation (`card.ts`). Applies `hit`, `miss`, and `do` effects using seeded RNG, clamping scalar fields to bounds.
  - **`gate`** — Evaluates `lore` `unlock` floors and `offer` windows against post-settlement `WorldState` and turn events.
  - **`direct`** — Opt-in (`card.director: true`) stage that runs when `gate` opens windows, reading the factual ledger to partition open lore into `must` vs. `may` and emit a one-line scene `tone` (`Brief`).
  - **`narrate`** — Streaming prose generation. The only stage that reads `fiction` and the `transcript`. Prose is non-authoritative over mechanical state, and `narrate` never sees raw scalar numbers.
  - **`check`** — Post-narration verification of `guard` prohibitions and `must` disclosures. On violation or missed `must`, triggers at most one correction rewrite.
  - **`polish`** — Post-check prose pass triggered only when `lexicon` patterns match narration outside dialogue; rewrites only matched sentences (`switches.polish: false` disables it).
  - **`record`** — Post-prose structured extraction. Answers active `readouts`, emits `chronicle` and `record`-stage `theater` products, and commits sparse `world` `DomainChange` operations.

### Tree, Projections & Compression

- **`Log`** (`log.ts`) — Generic immutable append/amend tree shared across `runtime`, `server`, and `client`. Every write (`add`, `amend`, `checkout`, `drop`) produces a `Change` value applied via `apply`. **`head`** is the single active cursor (a leaf node ID, or `null` on an empty thread); the active reading path is the root-to-`head` chain.
  - _Contrast:_ Replaces flat chat arrays with per-message `swipes[]` and duplicated "branch checkpoint" chat files. Branching at any historical turn is a zero-copy tree operation.
- **`Node` (`Turn<Beat>`)** (`journal.ts`, `derived.ts`) — One node in the `Log`: player `input` (`{ text, note?, invoke? }`) plus recorded model outputs, RNG seeds (`beats`), `deliveries`, `answers`, `products`, `changes`, `adjust`, and `settlementStatus`. Derived state snapshots are never stored on nodes.
- **`sibling`** — Nodes sharing the same `parent`, split into three exact stage restarts rather than a single ambiguous "swipe / reroll":
  - **`swipe`** — Re-runs the turn from `lookup` (new retrieval, new roll, new prose).
  - **`reword`** — Re-runs from `narrate` (preserving frozen `deliveries` and settled `beats`), optionally appending a one-turn `note`.
  - **`edit`** — Replaces prose (`text`), revises `input` while keeping prose, or both, re-running only `check` and `record` so state re-settles cleanly.
- **`Derived`** (`derived.ts`) — All state computed purely by folding a root-to-node path: scalar `fields`, `world` entities/records, `lore` floors and counters (`since`, `shown`), compression boundaries, `Known:` / `Current:` lines, and client projections (`TimelineNode`, `TurnDetail`, `ActiveContextView`). Rewinding or switching branches never desynchronizes state.
- **`WorldState` & `DomainChange`** (`world.ts`) — Unified state object `{ fields, world, lore }` read by `Cond`, `heading`, and prompt assembly. `world` products mutate exclusively through recorded `DomainChange` operations (`insert_entity`, `patch_entity`, `remove_entity`, `patch_record`, `replace`) under two-phase settlement (`settlementStatus`: `pending` | `committed` | `failed` | `skipped`, recoverable via `retryRecord` / `skipRecord`).
- **`Fold`** — Two pure path reductions:
  1. **Product `fold`** (`product.ts`): how `chronicle` and `theater` values accumulate along a path—`"latest"`, `"append"`, or `{ key }` (table row merge by key column).
  2. **Context compression** (`history.ts`): folding older turns' `notes` and disclosed lore over fixed node intervals into a cached prefix block. Unlike rolling chat-summarizer plugins that rewrite a depth-injected summary block and invalidate KV cache, interval folds keep prompt breakpoints byte-identical across turns and branches.
- **`Transcript`** — The chronological dialogue view rendered from path nodes for `narrate` only: past `act` inputs, assistant `prose`, and disclosed lore. Never stored, and never spliced with out-of-band system prompts.
- **`Head` / `Tail`** — The only two prompt assembly zones (`request.ts`). **`head`** holds resolved player/card `frame` and `fiction` as a stable cache prefix; **`tail`** sits after `transcript` and current input, carrying per-turn disclosures, beat outcomes, `Current:`, `Brief`, `note`, `input.thought`, and tail fragments. Cache breakpoints sit at the end of `head`, the folded prefix, and the last prior history turn.
  - _Negative constraint:_ Numeric chat-depth injection (`@D0`, `@D4`, `Author's Note`, `post_history_instructions`) does not exist. Splicing dynamic text `N` messages from the end of history mutates the message prefix on every turn, destroying provider KV prefix caching. Placing turn-level guidance in `tail` achieves end-of-context recency weight with 100% prefix cache preservation.

### Input, Layers & Customization

- **`Channel`** — Which route player input takes: `"act"` (enters the `transcript`) or `"note"` (feeds `direct` and `narrate` on this turn only, never entering history). Cards declare default `input: "act" | "note"`, and `Input.invoke` (`string[]`) pins player-accessible context resources for the turn.
  - _Negative constraint:_ Never embed `[OOC: ...]` brackets in `act` messages or maintain sticky `Author's Note` depth prompts; non-diegetic direction belongs on `note`.
- **`<<aside>>`** — Line-start stream delimiter (`<<aside>> <id>`) opening an inline `stage: "narrate"` `theater` product block (`journal.ts` `splitter`). Stripped from `prose(t)` during streaming, invisible to `transcript`, `check`, `polish`, and `record`.
- **`Fragment`**, **`Slot`** & **`Band`** (`fragment.ts`) — Unit of prompt assembly (`{ id, text?, label?, role?, enabled?, when?, mode?, at? }`).
  - **`Slot`**: A `frame` fragment ID where player layers and the card meet. Known slots (`SLOTS`): `persona`, `pov`, `voice`, `style`, `setting`, `language`, `verbosity`.
  - **`Band`**: A `fiction` fragment gated by `when` over a field or state threshold; bands on one axis represent mutually exclusive narrative postures.
- **`Layer`, `Local` & `Pack`** (`layer.ts`) — Uniform customization row resolved in one strict rank order:
  `harness` (code defaults + global player overlay) → `card` → mounted `packs` (`local.mounts` order) → `local` (`/cards/<id>/local`) → `persona`.
  Higher rank wins by `id`, except `mode: "yield"` (defers if already filled) and `mode: "both"` (concatenates). Player rows are locked at decode (`locked`): they cannot carry `when` or `role` on fragments or alter a product's `shape`/`role`; invalid items land in `Resolved.dropped` without throwing. A **`Pack`** (`/packs`, ecosystem _enhancer_ / _text LoRA_) bundles fragments, `switches`, `asks`, product patches, single-layer `entries` (`<pack>/<entry>`), `lexicon`, `snippets`, `format`, and `names`.
  - _Negative constraint:_ Monolithic **presets** do not exist; prompt assembly, style layers, continuation hats, and endpoint connections are strictly separated by owner.
- **`Writing` (`switches`)** — Bounded player controls (`pov`, `echo`, `agency`, `verbosity`, `polish`) compiled into `pov` and `verbosity` frame slots via `switch.<key>.<value>` asks. Compiled switches always yield to explicit card or free-text slot fragments.
- **`Names`** (`names.ts`) — Single-pass proper-noun dictionary replacing `{{key}}` holes (`user`, `char`, or custom keys) across fragments, asks, and greetings. Values are single-line strings containing no `{{` (ruling out recursion by construction). Unfilled holes drop optional fragments and reject greetings/demands.
  - _Negative constraint:_ No imperative template macros (`{{setvar}}`, `{{getvar}}`, `{{roll}}`, `{{random}}`, EJS, or STscript).
- **`Ask`** — Named harness prompt templates (`lookup`, `direct`, `decide.first`, `decide.again`, `narrate.correction`, `record.readout`, `input.thought`, `switch.*`, `product.<id>`), overridable across `Layer` ranks.
- **`Snippet` vs. `Format`** — **`Snippet`** (`{ name, text, after?, hint?, note? }`) inserts play-meaningful templates (`thought` marks, `note` toggles, narrator directions) from the `/` or `+` menu without auto-sending. **`Format`** (`{ label, text, after? }`) provides pure punctuation/bracket keys (`「」`, `『』`) above a focused input.

### Card Mechanics, Lore & Products

- **`Card`** (`card.ts`) — Single declarative schema (`decodeCard`) encompassing metadata, `frame`, `fiction`, `greetings`, `rules`, `lore`, `products`, `catalogs`, `guard`, `lexicon`, `names`, `director`, `input`, `heading`, and optional `view`.
  - _Negative constraint:_ Not a "character card". Fixed single-NPC schemas (`description`, `personality`, `scenario`, `mes_example`, `post_history_instructions`) force cast, RPG, and world-simulation authors to abuse character fields as prompt scripts; in `Card`, whether `fiction` depicts one character, an ensemble, or an entire world is content, not schema.
- **`Greeting`** — Root opening (`greetings[n]: { text?, do?, note? }`). `do` settles initial branch effects before turn 1; `note` (or a player `--note` / `Field.start` override on `greet`) triggers a dynamic narrated opening on node 0.
- **`Field` & `Drawn`** (`card.ts`) — Typed scalar state (`int`, `number`, `boolean`, `enum`) with `initial`, optional `min`/`max`/`options`, `hidden` (omitted from UI), `start` (configurable at story start), and `view` override (`"gauge" | "scale"`). `drawn()` derives UI presentation from field shape and band thresholds (`steps`, `gauge`, `scale`, or `value`).
- **`Cond`** (`cond.ts`) — Closed boolean expression tree (`is`, `lt | lte | gt | gte`, `all`, `any`, `not`, `{ event }`) over `fields.<path>` (or bare `<path>`), `world.<product>.<key>`, and `lore.<id>.since | shown`. The only logic available to card authors.
- **`Effect`** (`Effect_`) — Closed mutation vocabulary: `{ path, set }`, `{ path, add }`, and `{ event }` (with `{path}` post-effect interpolation).
- **`Action`, `Chance` & `Beat`** — Mechanical move in `rules.actions` gated by `when`, with optional `roll` (`Chance`: fixed number, `{ path }`, or `{ judge }` answered in `decide`) and `hit` / `miss` / `do` effects. Each resolved roll records a **`Beat`** (`action`, `seed`, `chance?`) on the node.
- **`Readout`** — Post-prose multiple-choice judgement in `rules.readouts` asked during `record` when `when` holds. The model chooses an option ID; code applies its `do` effects. Fields writable only by `actions` are purely mechanical; fields that prose may move must attach a `Readout`.
- **`Lore`, `Hook`, `Lore Layer`, `Section` & `ContextPolicy`** (`lore.ts`, `context.ts`):
  - **`Lore`**: Progressive knowledge entry (`{ id, layers, sections?, unlock, offer, ...ContextPolicy }`).
  - **`Hook`**: The first sentence of `layers[0]` (or of a `section`'s text), shown in the `lookup` index.
  - **`Lore Layer`**: Cumulative depth (`1..n`) gated by **`unlock`** (monotone floor along the path) and **`offer`** (per-turn window condition reading state, events, and `lore.<id>.since | shown`).
  - **`Section`**: Ungated on-demand appendix under an entry (`sections: [{ id, text }]`, addressed as `card:<entry>#<section>`), readable by `lookup` while the parent entry is visible without altering layer progression.
  - **`ContextPolicy`**: `{ access?: { model, player }, activation?: "always" | "on_demand", residency?: "permanent" | "window" | "turn" }` governing who can invoke an unlocked resource, whether it auto-injects or waits for lookup/pin, and how long a **`Disclosure`** stays resident.
  - _Negative constraint:_ Replaces legacy **worldbooks / lorebooks** and substring/regex **keyword triggers** (`constant` blue-light vs. `selective` green-light, `scan_depth`, `insertion_order`, recursive keyword chains), which misfire on passing mentions, miss synonyms, and cannot model monotone plot progression.
- **`Product` & `Role`** (`product.ts`) — Typed data (`text`, `list`, `record`, `table`) produced per turn and declared with an explicit `role`:
  - **`world`** — Mutable current-state records/tables (`scene`, `people`, `bag`) living in `WorldState.world` and updated via sparse `DomainChange` ops during `record`. Supports `feed: true` (`Current:` line) and `recall` (lookup index).
  - **`chronicle`** — Append/folded narrative memory along the path (such as default `notes`, whose `feed` supplies `Known:` and prefix compression). Shown in Inspector.
  - **`theater`** — Player-only side content (`inner`, `options`, commentary), never fed back or recalled (`feed` and `recall` forbidden). Written in `record` or inline in `narrate` (`<<aside>>`), triggered every `turn` or on player `demand`.
- **`Ledger`** — Per-turn delta summary shown under a turn's prose pill: field deltas, beats/rolls, disclosures, and `world` product changes.
- **`Catalog`** (`product.ts`) — Static attachment registry on a card (`catalogs: [{ id, baseUrl?, items: [{ id, when?, variants? }] }]`) referenced by an `enum` column (`catalog: "<id>"`) on `chronicle` or `theater` products. Each `record` call restricts valid enum options to items whose `when` holds; readers resolve `variants` deterministically from the node's seed.
- **`Guard` & `Lexicon`** — **`Guard`**: post-prose prohibitions (`guard: string[]`) verified in `check` and never placed in `narrate` prompts. **`Lexicon`**: wildcard prose patterns (`{ pattern, hint? }`) rewritten outside dialogue in `polish`.
  - _Negative constraint:_ Never stuff negative prohibition walls ("DO NOT act for `{{user}}`", "NEVER write phrase X") into `narrate` prompts; negative imperatives degrade voice and induce ironic-process violations.

### Session & Host Boundary

- **`Session`** (`session.ts`) — In-memory runtime binding one `Card`, resolved `Layer` rows, stage `Connection` bindings, and a `Log` `Store`.
- **`Action` (Session Wire Protocol)** — Closed union accepted by `perform`: `act`, `greet`, `checkout`, `swipe`, `reword`, `edit`, `setField`, `demand`, `retryRecord`, `skipRecord`.
- **`Event`** — Streamed items emitted by `perform`: `stage` (phase started), `delta` (streaming `narrate` prose/reasoning or `product-delta`), `call` (completed LLM call metadata/trace), and `change` (committed `Log` mutation + projected node).
- **`Stop`** — Stream cancellation split by progress: before the first prose character, aborts cleanly leaving no node; after the first prose character, halts `narrate`, skips `check`, runs `record`, and commits the partial node with `end: "stopped"`.
- **`Connection`** (`provider`) — Provider endpoint configuration (`anthropic`, `openai-compatible`, `gemini`), model ID, capabilities (`prefill`, `reasoningBack`), cache TTL, token limits, proxy setting, and optional `hat` ID.

---

## 3. Legacy Tavern Concepts & Negative Constraints

When reading external cards, writing prompts, or designing features, map legacy tavern concepts onto Effect Tavern's orthogonal primitives and enforce their negative constraints:

| Legacy Tavern Concept                              | Effect Tavern Primitive(s)                                                             | Architectural Reason & Negative Constraint                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`preset`** (monolithic prompt + sampler bundle)  | `request.ts` + `Layer` / `Pack` / `switches` + `Hat` + `Connection`                    | Presets conflate wire roles, jailbreaks/prefills, player prose style, status-bar prompts, and endpoint parameters into one brittle file.                        |
| **`character card`** (`chara_card_v2` / `ccv3`)    | `Card` (`frame` + `fiction` + `participant` / `author` coordinates)                    | Fixed single-NPC fields (`description`, `personality`, `mes_example`, `post_history_instructions`) distort cast, RPG, and protagonist-free world cards.         |
| **`depth` / `@D` injection & `Author's Note`**     | `at: "head" \| "tail"` + `note` (`Channel`)                                            | Splicing prompts `N` messages from the end of chat mutates the historical prefix every turn, invalidating KV prefix cache and polluting `transcript`.           |
| **`worldbook` / `lorebook` & keyword triggers**    | `Lore` (`unlock`, `offer`, `sections`) + `lookup` (`hook`) + `ContextPolicy`           | Substring/regex chat scanning (`constant` blue-light vs. `selective` green-light, `scan_depth`) misfires on passing mentions and lacks monotone plot staging.   |
| **Inline status bars, MVU blocks & regex scripts** | `decide` / `settle` + `record` (`Readout`, `Product`, `DomainChange`) + `<<aside>>`    | Asking `narrate` to emit `<status>` XML/JSON or variable patches and scraping them with regex corrupts prose voice and desynchronizes state (`inline-product`). |
| **`[OOC: ...]` inline chat brackets**              | `note` (`Channel`) vs. `thought` (`internal diegetic` `mark`)                          | Inline `[OOC]` pollutes permanent `transcript` history and conflates non-diegetic direction with private character monologue.                                   |
| **Negative prompt walls ("DO NOT...")**            | `switches.agency` (`pov` slot) + `Guard` (`check`) + `Lexicon` (`polish`)              | Narrator-facing prohibition lists bloat prompts and trigger ironic-process violations; verification and slop rewriting belong post-prose.                       |
| **Stateful macros (`{{setvar}}`, `{{roll}}`)**     | `Cond` + `Effect` + `Action.roll` + single-pass `Names` (`{{key}}`)                    | Imperative template scripting hides untestable state inside prose strings (`unsupported-macro`).                                                                |
| **Flat chat `swipes[]` & branch checkpoint files** | `Log` (`Node`, `head`, `checkout`) + `sibling` (`swipe`, `reword`, `edit`) + `Derived` | Linear chat arrays duplicate files on mid-thread branches and desynchronize external variable stores; tree path folding keeps state exact everywhere.           |
