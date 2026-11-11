# Card Schema & Placement Reference

Source of truth: `packages/runtime/src/card.ts`, `fragment.ts`, `cond.ts`, `lore.ts`, `context.ts`, `product.ts`, `world.ts`, and `lint.ts`.

## Stage Visibility Matrix

| Card Field                              | Stages That Read It                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `frame`                                 | **Every stage** (assembled at the top of `head` in every request)                                     |
| `fiction` + `transcript`                | `narrate` only                                                                                        |
| `lore` (`layers`, `sections`)           | `lookup` (`search_context` / `read_context`), `gate` / `direct` (windows), `narrate` (delivered text) |
| `rules.actions`                         | `decide` (action menu + `{ judge }` chance), `settle` (deterministic code)                            |
| `rules.readouts`                        | `record` (post-prose multiple choice), settled by code                                                |
| `products` + `catalogs`                 | `record` (default), or inline in `narrate` (`<<aside>> <id>`) when `stage: "narrate"`                 |
| `guard`                                 | `check` only (never shown to `narrate`)                                                               |
| `lexicon`                               | `polish` only (rewrites matched sentences outside dialogue)                                           |
| `greetings`                             | Node `0` (`do` settles initial state/events; `note` triggers dynamic narration)                       |
| `title`, `summary`, `version`, `source` | Card page / metadata only (never sent to any model)                                                   |

---

## Field-by-Field Placement

### 1. `frame`: Voice, Register & Slots

- Array of `Fragment`: `{ id, text?, role?, enabled?, when? }`. (`role` defaults to `"system"`; order is preserved.)
- `id` names a **slot**. Known slots (`SLOTS` in `fragment.ts`): `persona`, `pov`, `voice`, `style`, `setting`, `language`, `verbosity`.
  - Leaving `text` absent opens an empty slot for the player to fill.
  - `pov` and `verbosity` are compiled from player `switches` unless the card fills the slot itself (e.g. `yandao.yaml` fills `pov` for protagonist-free narration).
  - Any other `id` triggers lint `unknown-frame-slot` (warn): intentional custom slots are allowed, but never put a character sheet in `frame`—every stage including `direct` reads `frame`.

### 2. `fiction`: Characters, Cast & World Bands

- Array of `Fragment`: `{ id, label?, text, role?, enabled?, when? }`.
- `label` names the module on the Card Page without exposing `text`.
- `when` turns a fragment into a state-gated **band**. Bands gating on the same scalar field represent mutually exclusive narrative stages: at most one should hold at any value within `[min, max]` (checked by lint `band-gap`).

### 3. `greetings`: Static & Dynamic Openings

- `greetings: [{ text?, do?, note? }]`.
- `do`: array of `Effect_` applied on node `0` before turn 1; emitted events reach turn 1's `gate`.
- **Static opening:** `text` alone (no `note` and no player `--note`) commits `text` verbatim at zero token cost.
- **Dynamic opening:** when `note` is set on the greeting (or the player passes `--note` / `Field.start` overrides on `greet`), node `0` runs `narrate` over the settled opening state using `note` as direction (`swipe` and `reword` work on node `0`).

### 4. `rules`: Fields, Actions, Readouts & Termination

- **`fields`**: `{ path, type: "int" | "number" | "boolean" | "enum", initial, min?, max?, options?, label?, group?, hidden?, start?, view? }`.
  - Flat paths; strings exist **only** inside `enum` (`options` required).
  - `hidden: true` hides internal switches from the UI while keeping them active in `settle` and `Cond`.
  - `start: true` lets the player set the field when starting a story (`greet` opening / `tavern play --set`); never combine with `hidden: true`.
  - **UI Meter Derivation (`drawn` in `card.ts`):**
    - `enum` → `steps` track.
    - Bounded `int` (`min` and `max` present) → `scale` if `min < 0` or `fiction` bands cut ≥ 2 thresholds on that field; otherwise `gauge` (`now / max` stock, e.g. HP `0..100`).
    - Override with `view: "gauge" | "scale"` when a stock also has multiple injury/resource bands.
    - Everything else → `value` row.
- **`actions`**: `{ id, text, when?, roll?, hit?, miss?, do? }`.
  - `when` gates availability (unavailable actions cannot be decoded).
  - `roll`: number (`0..1`), `{ path }`, or `{ judge: "<rubric>" }` (model estimates probability in `decide`, RNG seed rolls the die).
  - `Effect_`: `{ path, set }`, `{ path, add }` (number or `{ path }`, clamped to `[min, max]`), or `{ event }` (`{path}` interpolates post-effect state).
- **`readouts`**: `{ id, text, when?, options: [{ id, text, do }] }`.
  - Asked in `record` when `when` holds on post-settlement state; chosen option's `do` effects apply deterministically.
- **`over`** (`Cond`, code-decided ending) and **`cap`** (max beats per turn).

### 5. `lore`: Progressive Layers, Sections & `ContextPolicy`

- Entry shape: `{ id, layers: string[], sections?: [{ id, text }], unlock, offer?, access?, activation?, residency? }`.
- **Hook:** First sentence of `layers[0]` (keep concise; lint `hook-length`).
- **`unlock` (monotone floor):** Single `Cond` (for 1-layer entries) or array of `Cond` (one per layer). `{ all: [] }` = always unlocked; `{ any: [] }` = never unlocked. Once satisfied along a path, a layer stays unlocked.
- **`offer` (turn window):** `Cond` over state, turn events (`{ event }`), and `lore.<id>.since | shown` counters (`since` = `Infinity` if never shown, `0` this turn). Opens `current + 1` for this turn (`may`, or `must`/`may` when `director: true`). Delivering a deeper layer also delivers unread lower layers.
- **`sections` (on-demand appendices):** `sections: [{ id, text }]` (max 8, unique IDs without `#`, lint `bad-section`). Ungated horizontal detail (`card:<entry>#<section>`) whose first sentence serves as its lookup hook. Available to `lookup` whenever the parent entry is visible; never shown in the player `/` menu and never `always` injected.
- **`ContextPolicy`** (leave omitted unless overriding defaults):
  - `access: { model: boolean, player: boolean }` (card default: `{ model: true, player: false }`; set `player: true` to expose in player `/` pin menu).
  - `activation: "on_demand" | "always"` (default `"on_demand"`).
  - `residency: "window" | "permanent" | "turn"` (default `"window"`—remains until compressed out of the active window).

### 6. `products` & `catalogs`: World State, Chronicle & Theater

- **`products`**: `{ id, label?, text, shape, role, initial?, stage?, fold?, when?, on?, trigger?, feed?, recall? }`.
  - Patches harness defaults by `id` (`notes` on, `options` and `inner` off) or defines new products.
  - **Shapes:** `text` (`max?`), `list` (`max?`), `record` (`keys`, max 1 nested list/table/record), `table` (`columns` of `text | int | boolean | enum`, `max?`, row `filter?` `Cond`).
  - **Explicit `role` (required on new products):**
    1. `world`: Current mutable world state (`scene`, `people`, `bag`). Lives in `WorldState.world`; updated via sparse `DomainChange` ops (`insert_entity`, `patch_entity`, `remove_entity`, `patch_record`, `replace`) in `record`. No `fold`, never `stage: "narrate"`, identifier `id`, no column named `entityId` (assigned by host; `initial` for tables is `{ entityId: row }`). Supports `feed: true` (`Current:` line) and `recall: "<col>"` (lookup index). Readable in `Cond` as `world.<id>.<key>`.
    2. `chronicle`: Path-accumulated memory (`notes`). Uses `fold` (`"append"`, `"latest"`, or `{ key }`). `feed: true` feeds `Known:`; `recall` feeds lookup.
    3. `theater`: Player-only output (`inner`, `options`, commentary). Never `feed` or `recall`. `trigger: "turn"` (default) or `"demand"`. `stage: "narrate"` writes `text` inline via `<<aside>> <id>` with zero extra LLM calls.
- **`catalogs`**: `[{ id, baseUrl?, items: [{ id, when?, variants? }] }]`.
  - Referenced by an `enum` column (`catalog: "<id>"` instead of `options`) on `chronicle` or `theater` products (never `world`).
  - At `record`, pickable enum values are dynamically restricted to items whose `when` holds (if none hold, that table/key is omitted for the turn; zero prompt bloat). Readers resolve `variants` under `baseUrl` by node seed.

### 7. `Cond`, `names`, `guard`, `lexicon` & `heading`

- **`Cond` grammar:** `{ path, is }`, `{ path, op: "lt" | "lte" | "gt" | "gte", value }`, `{ all: Cond[] }`, `{ any: Cond[] }`, `{ not: Cond }`, `{ event: string }`.
  - Paths: `<field>` (or `fields.<field>`), `world.<product>.<key>`, `lore.<id>.since | shown`. Field names `fields`, `world`, `lore` are reserved (`reserved-path`).
- **`names`:** `{ user?, char?, [key]: string }` single-pass `{{key}}` dictionary (`unfilled-name`, `unsupported-macro`).
- **`guard`:** `string[]` checked post-prose in `check`.
- **`lexicon`:** `[{ pattern, hint? }]` (`*` intra-sentence wildcard) rewritten in `polish`.
- **`heading`:** `<field>` or `<worldOrRecordProduct>.<key>` displayed as the turn's scene heading.

---

## Static Checks (`card check`) — Do Not Hand-Verify

Schema & decode enforce structural invariants automatically. Static `lint` (`packages/runtime/src/lint.ts`) checks:
`unknown-frame-slot`, `unknown-path`, `reserved-path`, `orphan-event`, `dead-field`, `prose-cannot-move`, `band-gap`, `unreachable-layer`, `hook-length`, `field-in-prose`, `inline-product`, `unfilled-name`, `unsupported-macro`, `unknown-catalog`, `duplicate-catalog-item`, `bad-section`, `bad-identifier`, and `empty-text` (error—blocks install).
