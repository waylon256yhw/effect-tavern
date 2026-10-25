import type { Shape, TableShape } from "@effect-tavern/runtime/src/product.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js"
import { read } from "./bridge.ts"
import { Back, Clue, Next, Prev, Record } from "./icons.tsx"
import { groups, isTray, missing, regions, rows, textOf, totals, type Row, type Tray } from "./inspect.ts"
import { PinButton, Reading } from "./readings.tsx"
import { record } from "./record.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { calls, card, log, page, path, pin, registry, turnOf, type Id } from "./store.ts"
import { fetchCalls } from "./wire.ts"

// ───────── The Inspect page: one turn from the harness's view ─────────
// A full page over the reader (the reader stays mounted, so a turn in flight keeps streaming under it), shaped by
// docs/inspector-prototype.html: two cards on the canvas. Left, the pipeline: only the calls that ran, each row's
// head carrying what the stage decided (the beat and its roll, the brief's must, the prose's first line, what check
// fired or missed, the readout answers), its time and tokens at the end; a two-draft turn folds each draft into a tray.
// A row opens into the request by cache region (tabs over one bounded scroller, so a long head never pushes the
// pipeline apart) and the answer. Right, the node: the input, the untold hooks (pinned from here: this is the only
// place the list shows), the state against the parent, the products by their declared shape. Without `inspect` on the
// server no call carries a request body: the rows keep their heads, time and tokens, open to their answers (the brief
// stays closed), and the right card is what the player came for. Opens on the path's last node; prev / next walk the
// path, `[` `]` too, Escape returns to the story. src/inspect.ts projects; this draws.
export const openInspector = () => {
  const id = registry.get(path).at(-1)?.turn.id
  registry.set(page, id === undefined ? "reader" : { inspect: id })
  void fetchCalls()
}
const fmt = (n: number) => n.toLocaleString("en-US")
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const count = (text: string, q: string) => (q ? (text.match(new RegExp(escapeRe(q), "gi")) ?? []).length : 0)
/** Text with every match of the (literal) query marked. */
const Marked = (props: { text: string; q: string }) => {
  const pieces = createMemo(() =>
    props.q ? props.text.split(new RegExp(`(${escapeRe(props.q)})`, "gi")) : [props.text],
  )
  return (
    <For each={pieces()} keyed={false}>
      {(p, i) => (
        <Show when={i % 2} fallback={p()}>
          <mark>{p()}</mark>
        </Show>
      )}
    </For>
  )
}
/** A structured answer as key → value rows; nested values as JSON. */
const KeyValues = (props: { of: Record<string, unknown> }) => (
  <dl class="kv">
    <For each={Object.entries(props.of)} keyed={([k]) => k}>
      {(e) => (
        <>
          <dt>{e()[0]}</dt>
          <dd>{typeof e()[1] === "string" ? (e()[1] as string) : JSON.stringify(e()[1], null, 2)}</dd>
        </>
      )}
    </For>
  </dl>
)
/** A product's value by its declared shape (src/product.ts): a list as items, a table as rows, a record as key →
 *  value with its nested shapes, text as a line. */
const Shaped = (props: { shape: Shape; value: unknown }) => {
  const table = () => (props.shape.kind === "table" ? (props.shape as TableShape) : undefined)
  const rec = () => (props.shape.kind === "record" ? (props.shape as Extract<Shape, { kind: "record" }>) : undefined)
  const cell = (v: unknown) =>
    v === undefined || v === null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v as string | number | boolean)
  return (
    <Switch fallback={<p class="val">{cell(props.value)}</p>}>
      <Match when={props.shape.kind === "list"}>
        <Show when={((props.value as unknown[] | undefined) ?? []).length} fallback={<p class="dim">none</p>}>
          <ul class="items">
            <For each={props.value as unknown[]} keyed={false}>
              {(v) => <li>{cell(v())}</li>}
            </For>
          </ul>
        </Show>
      </Match>
      <Match when={table()}>
        {(t) => (
          <Show when={((props.value as unknown[] | undefined) ?? []).length} fallback={<p class="dim">none</p>}>
            <table class="rows">
              <thead>
                <tr>
                  <For each={t().columns} keyed={(c) => c.key}>
                    {(c) => <th>{c().key}</th>}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={(props.value as Record<string, unknown>[] | undefined) ?? []} keyed={false}>
                  {(r) => (
                    <tr>
                      <For each={t().columns} keyed={(c) => c.key}>
                        {(c) => <td>{cell(r()[c().key])}</td>}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        )}
      </Match>
      <Match when={rec()}>
        {(r) => (
          <dl class="kv">
            <For each={r().keys} keyed={(k) => k.key}>
              {(k) => (
                <>
                  <dt>{k().key}</dt>
                  <dd>
                    <Show
                      when={"shape" in k() ? (k() as { shape: Shape }).shape : undefined}
                      fallback={cell((props.value as Record<string, unknown> | undefined)?.[k().key])}
                    >
                      {(sh) => (
                        <Shaped shape={sh()} value={(props.value as Record<string, unknown> | undefined)?.[k().key]} />
                      )}
                    </Show>
                  </dd>
                </>
              )}
            </For>
          </dl>
        )}
      </Match>
    </Switch>
  )
}

/** A row's head: what the stage decided, from the call's answer and the node's facts (never a written summary). */
const Digest = (props: { row: Row; node: Node; nth: number; dev: boolean }) => {
  const out = () => props.row.call.out as Record<string, unknown>
  const ids = (v: unknown) => (Array.isArray(v) ? (v as string[]).join(", ") : "")
  // decide: the nth beat of the turn; its judged check is the one among the beats with a chance up to it
  const beats = () => props.node.turn.beats
  const check = () =>
    beats()[props.nth]?.chance === undefined
      ? undefined
      : props.node.checks[
          beats()
            .slice(0, props.nth + 1)
            .filter((x) => x.chance !== undefined).length - 1
        ]
  const fired = () => (out().fired as string[] | undefined) ?? []
  const missed = () => props.node.turn.brief.must.filter((id) => !fired().includes(id))
  const violated = () => (out().violated as string[] | undefined) ?? []
  const products = () =>
    Object.entries(out())
      .filter(([k]) => k !== "answers")
      .map(([k, v]) => (Array.isArray(v) ? `${k} (${v.length})` : k))
      .join(" · ")
  // polish: the sentences sent (the marks in the request, when the trace carries it) against the ones that came back changed
  const sent = () =>
    new Map(
      props.row.call.msgs.flatMap((m) =>
        [...textOf(m).matchAll(/<target id="(hit-\d+)"[^>]*>(.*?)<\/target>/g)].map(([, id, s]) => [id!, s!] as const),
      ),
    )
  const changed = () => Object.entries(out()).filter(([k, v]) => sent().has(k) && sent().get(k) !== v).length
  const answers = () =>
    Object.entries((out().answers as Record<string, string> | undefined) ?? {}).map(([k, v]) => `${k}=${v}`)
  return (
    <Switch>
      <Match when={props.row.phase === "lookup"}>
        <Show when={ids(out().read)} fallback={<span class="pill">nothing read</span>}>
          {(r) => <span class="pill">read: {r()}</span>}
        </Show>
      </Match>
      <Match when={props.row.phase === "decide"}>
        <Show when={check()} fallback={<span class="pill">{beats()[props.nth]?.next ?? "end"}</span>}>
          {(c) => (
            <>
              <span class={{ pill: true, ok: c().hit, bad: !c().hit }}>
                {c().action} · {c().hit ? "Hit" : "Miss"}
              </span>
              <span class="dtext">
                roll {c().roll.toFixed(2)} vs {Math.round(c().chance * 100)}%
              </span>
            </>
          )}
        </Show>
      </Match>
      <Match when={props.row.phase === "direct"}>
        <Show when={ids(out().must)} fallback={<span class="pill">no must</span>}>
          {(m) => <span class="pill">must: {m()}</span>}
        </Show>
        <Show when={props.dev}>
          <span class="dtext">
            {[ids(out().may) && `may: ${ids(out().may)}`, out().tone && `tone: ${String(out().tone)}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Show>
      </Match>
      <Match when={props.row.phase === "narrate"}>
        <Show when={props.row.status === "stopped"}>
          <span class="pill bad">stopped</span>
        </Show>
        <span class="dprose">{(typeof props.row.call.out === "string" ? props.row.call.out : "").split("\n")[0]}</span>
      </Match>
      <Match when={props.row.phase === "check"}>
        <Show
          when={props.dev}
          fallback={
            <span class={{ pill: true, bad: props.row.status === "failed", ok: props.row.status !== "failed" }}>
              {props.row.status === "failed" ? "failed → second draft" : "ok"}
            </span>
          }
        >
          <Show
            when={missed().length || violated().length}
            fallback={<span class="pill ok">{fired().length ? `met: ${fired().join(", ")}` : "ok"}</span>}
          >
            <span class="pill bad">
              {[...missed().map((m) => `missed: ${m}`), ...violated().map((v) => `rule: ${v}`)].join(" · ")}
            </span>
            <span class="dtext">fired: {fired().join(", ") || "none"}</span>
          </Show>
        </Show>
      </Match>
      <Match when={props.row.phase === "polish"}>
        <span class="pill">{Object.keys(out()).length} targets</span>
        <Show when={sent().size}>
          <span class="dtext">{changed()} changed</span>
        </Show>
      </Match>
      <Match when={props.row.phase === "record"}>
        <For each={answers()} keyed={false}>
          {(a) => <span class="pill">{a()}</span>}
        </For>
        <span class="dtext">{products()}</span>
      </Match>
    </Switch>
  )
}

/** One call: the head (stage, digest, time and tokens), opening to the request by region and the answer. */
const Step = (props: { row: Row; node: Node; nth: number; dev: boolean; q: string; open: boolean }) => {
  const c = () => props.row.call
  const regs = createMemo(() => regions(c().msgs))
  const hits = createMemo(() => {
    const q = props.q
    return c().msgs.reduce((n, m) => n + count(textOf(m), q), 0)
  })
  // the brief is the one answer that stays closed without `inspect`; a stage without a body or an answer has nothing to open
  const opens = () => (props.dev && c().msgs.length > 0) || props.row.phase !== "direct"
  const [tab, setTab] = createSignal<number | null>(null) // a region, or null for all
  const shownTab = () => (props.q ? null : (tab() ?? Math.max(0, regs().length - 1)))
  const prefix = () =>
    regs()
      .filter((r) => r.breakpoint)
      .reduce((n, r) => n + r.chars, 0)
  const [copied, setCopied] = createSignal(false)
  const copy = () => {
    const out = { regions: regs().map(({ msgs, ...r }) => ({ ...r, messages: msgs })), answer: c().out }
    void navigator.clipboard?.writeText(JSON.stringify(out, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const u = () => c().usage
  // the call's numbers in one line: tokens, and the chars before the last breakpoint beside cache read to compare
  const bar = () =>
    [
      `tokens · in ${fmt(u().input)} · out ${fmt(u().output)} · cache read ${fmt(u().cacheRead)}`,
      u().cacheWrite && `cache write ${fmt(u().cacheWrite)}`,
      props.dev && prefix() && `prefix to the last breakpoint ${fmt(prefix())} chars`,
    ]
      .filter(Boolean)
      .join(" · ")
  return (
    <details
      class={{ step: true, flat: !opens(), bad: props.row.status !== "ok" }}
      open={(opens() && (props.open || hits() > 0)) || undefined}
    >
      <summary onClick={(e) => !opens() && e.preventDefault()}>
        <span class="stage">
          <Next class="chev" aria-hidden="true" />
          <span class="nm">{props.row.phase}</span>
          <Show when={hits()}>{(h) => <span class="hits">{h()}</span>}</Show>
        </span>
        <span class="digest">
          <Digest row={props.row} node={props.node} nth={props.nth} dev={props.dev} />
        </span>
        <span class="metrics">
          <span class="ms">{secs(c().ms)}</span> · {fmt(u().input)} in → {fmt(u().output)} out
        </span>
      </summary>
      <Show when={opens()}>
        <div class="body">
          <div class="bar">
            <span>{bar()}</span>
            <Show when={props.dev && c().msgs.length > 0}>
              <button class="cp" onClick={copy}>
                {copied() ? "Copied" : "Copy JSON"}
              </button>
            </Show>
          </div>
          <div class="well">
            <Show when={props.dev && regs().length > 0}>
              <div class="rtabs" role="tablist">
                <For each={regs()} keyed={false}>
                  {(r, i) => (
                    <button role="tab" aria-selected={shownTab() === i ? "true" : "false"} onClick={() => setTab(i)}>
                      <Show when={r().breakpoint}>
                        <i class="bp" aria-label="breakpoint" />
                      </Show>
                      {r().name} <span class="chars">{fmt(r().chars)}c</span>
                    </button>
                  )}
                </For>
                <button role="tab" aria-selected={shownTab() === null ? "true" : "false"} onClick={() => setTab(null)}>
                  All
                </button>
              </div>
            </Show>
            <div class="wscroll">
              <Show when={props.dev}>
                <For each={regs()} keyed={false}>
                  {(r, i) => (
                    <Show when={shownTab() === null || shownTab() === i}>
                      <For each={r().msgs} keyed={false}>
                        {(m, j) => (
                          <div class="msg" data-role={m().role}>
                            <span class="role">
                              {r().name} · {m().role}
                              <Show when={r().breakpoint && j === r().msgs.length - 1}>
                                <span class="bptag">breakpoint</span>
                              </Show>
                            </span>
                            <div class="txt">
                              <Marked text={textOf(m())} q={props.q} />
                            </div>
                          </div>
                        )}
                      </For>
                    </Show>
                  )}
                </For>
              </Show>
              <div class="answer">
                <span class="role">
                  answer <span class="chars">{fmt(u().output)} out</span>
                </span>
                <Show
                  when={typeof c().out === "string"}
                  fallback={<KeyValues of={c().out as Record<string, unknown>} />}
                >
                  <p class="prose">
                    <Marked text={c().out as string} q={props.q} />
                  </p>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </details>
  )
}

export const Inspect = (props: { id: Id }) => {
  const all = read(log)
  const line = read(path)
  const trace = read(calls)
  const view = read(card)
  const pinned = read(pin)
  const node = () => all().nodes.get(props.id)
  const at = () => line().findIndex((x) => x.turn.id === props.id) // -1: a sibling off the reading line
  const parent = () => {
    const p = node()?.turn.parent
    return p === null || p === undefined ? undefined : all().nodes.get(p)
  }
  const siblings = createMemo(() => (node() ? L.children(all(), node()!.parent) : []))
  const version = () => siblings().findIndex((s) => s.turn.id === props.id) + 1
  const go = (d: number) => {
    const x = line()[at() + d]
    if (x) registry.set(page, { inspect: x.turn.id })
  }
  const mine = () => trace().get(props.id) ?? []
  // the server's gate: without `inspect` no call carries a request body
  const dev = createMemo(() => [...trace().values()].some((l) => l.some((c) => c.msgs.length > 0)))
  const [pane, setPane] = createSignal<"pipeline" | "node">("pipeline")
  const [q, setQ] = createSignal("")
  const trows = createMemo(() => (node() ? rows(mine(), node()!.turn) : []))
  const grouped = createMemo(() => groups(trows()))
  const absent = () => missing(mine())
  const sums = createMemo(() => totals(mine()))
  const nth = (r: Row) =>
    trows()
      .slice(0, trows().indexOf(r))
      .filter((x) => x.phase === r.phase).length
  const lastNarrate = () => trows().findLast((r) => r.phase === "narrate")
  // the node's readings, drawn by the Record's own elements; only the fields here (checks and clues sit in the pipeline)
  const fields = createMemo(() => {
    const r = view()?.rules
    const x = node()
    return r && x ? record(r, x, parent()).filter((e) => "path" in e) : []
  })
  const shapeOf = (id: string) => view()?.products.find((p) => p.id === id)?.shape
  const One = (p: { row: Row }) => (
    <Step row={p.row} node={node()!} nth={nth(p.row)} dev={dev()} q={q()} open={p.row === lastNarrate()} />
  )
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "[") go(-1)
      else if (e.key === "]") go(1)
      else if (e.key === "Escape") registry.set(page, "reader")
      else return
      e.preventDefault()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })
  return (
    <div class="inspect" data-pane={pane()}>
      <header class="top">
        <button class="icon" aria-label="Back to story" onClick={() => registry.set(page, "reader")}>
          <Back />
        </button>
        <h1>{view()?.title}</h1>
        <span class="nodenav">
          <button class="icon" aria-label="Previous node" disabled={at() <= 0} onClick={() => go(-1)}>
            <Prev />
          </button>
          <span class="n">
            <b>{at() >= 0 ? `Turn ${at() + 1}` : `#${props.id}`}</b>
            <Show when={siblings().length > 1}>
              <span class="v">
                {version()}/{siblings().length}
              </span>
            </Show>
          </span>
          <button
            class="icon"
            aria-label="Next node"
            disabled={at() < 0 || at() === line().length - 1}
            onClick={() => go(1)}
          >
            <Next />
          </button>
        </span>
        <span class="spacer" />
        <Show when={sums().calls}>
          <span class="sums">
            {sums().calls} calls · {secs(sums().ms)} · {compact.format(sums().input)} in
            <Show when={sums().cacheRead}> · {compact.format(sums().cacheRead)} cached</Show> ·{" "}
            {compact.format(sums().output)} out
          </span>
        </Show>
        <span class="seg" role="tablist" aria-label="View">
          <button
            role="tab"
            aria-selected={pane() === "pipeline" ? "true" : "false"}
            onClick={() => setPane("pipeline")}
          >
            Pipeline
          </button>
          <button role="tab" aria-selected={pane() === "node" ? "true" : "false"} onClick={() => setPane("node")}>
            Node
            <Show when={node()?.readable.length}>{(n) => <span class="v">{n()}</span>}</Show>
          </button>
        </span>
      </header>
      <Show when={node()} fallback={<p class="dim">No such node</p>}>
        {(x) => (
          <div class="cols">
            <section class="pane pipeline" aria-label="Pipeline">
              <div class="sechead">
                <span class="lbl">Pipeline</span>
                <Show when={absent().length}>
                  <span class="meta">no {absent().join(", ")}</span>
                </Show>
                <Show when={dev()}>
                  <label class="search">
                    <Clue aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="Search request text"
                      placeholder="Search prompts…"
                      autocomplete="off"
                      value={q()}
                      onInput={(e) => setQ(e.currentTarget.value.trim())}
                    />
                  </label>
                </Show>
              </div>
              <Show when={mine().length} fallback={<p class="dim">No calls kept for this node</p>}>
                <div class="spine">
                  <For each={grouped()} keyed={false}>
                    {(g) => (
                      <Show
                        when={isTray(g()) ? (g() as Tray) : undefined}
                        fallback={
                          <div class={{ knot: true, bad: (g() as Row).status !== "ok" }}>
                            <One row={g() as Row} />
                          </div>
                        }
                      >
                        {(t) => (
                          <div class={{ knot: true, tray: true, bad: t().failed, discarded: t().failed }}>
                            <div class="thead">
                              <span>
                                Draft {t().draft} · {t().failed ? "Discarded" : "Final"}
                              </span>
                              <span class="meta">
                                {secs(t().rows.reduce((n, r) => n + r.call.ms, 0))} ·{" "}
                                {t().rows.some((r) => r.status === "stopped")
                                  ? "stopped"
                                  : t().failed
                                    ? "check failed"
                                    : "check passed"}
                              </span>
                            </div>
                            <For each={t().rows} keyed={false}>
                              {(r) => <One row={r()} />}
                            </For>
                          </div>
                        )}
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
            </section>
            <aside class="pane node" aria-label="Node">
              <div class="sechead">
                <span class="lbl">Input</span>
                <span class="meta">
                  {[x().turn.input.text ? "act" : "", x().turn.input.note ? "note" : ""].filter(Boolean).join(" + ") ||
                    "greeting"}
                </span>
              </div>
              <div class="inwell">
                <p class="line">{x().turn.input.text || x().turn.input.note}</p>
                <Show when={(x().turn.input.text && x().turn.input.note) || x().turn.input.pin}>
                  <div class="pills">
                    <Show when={x().turn.input.text && x().turn.input.note}>
                      <span class="pill">note: {x().turn.input.note}</span>
                    </Show>
                    <Show when={x().turn.input.pin}>
                      {(p) => (
                        <span class={{ pill: true, ok: x().turn.fired.some((d) => d.id === p()) }}>
                          pin: {p()} ({x().turn.fired.some((d) => d.id === p()) ? "told" : "untold"})
                        </span>
                      )}
                    </Show>
                  </div>
                </Show>
              </div>
              <div class="sechead">
                <span class="lbl">Untold</span>
                <span class="meta">
                  {x().readable.length ? `${x().readable.length} readable · pin for next turn` : "nothing left to tell"}
                </span>
              </div>
              <div class="hooks">
                <For each={x().readable} keyed={(r) => r.id}>
                  {(r) => (
                    <div class={{ hook: true, armed: pinned() === r().id }}>
                      <span class="hb">
                        <span class="hid">
                          {r().id}
                          {pinned() === r().id ? " · armed for the next send" : ""}
                        </span>
                        <span class="ht">{r().hook}</span>
                      </span>
                      <PinButton id={r().id} />
                    </div>
                  )}
                </For>
              </div>
              <div class="sechead">
                <span class="lbl">State</span>
                <span class="meta">
                  <Show when={parent()} fallback="after this node">
                    {(p) => <>vs {turnOf(line(), p().turn.id)}</>}
                  </Show>
                  <Show when={x().events.length}> · {x().events.join(", ")}</Show>
                </span>
              </div>
              <Show when={fields().length} fallback={<p class="dim">No field changed</p>}>
                <div class="record">
                  <For each={fields()} keyed={false}>
                    {(el) => <Reading el={el()} />}
                  </For>
                </div>
              </Show>
              <div class="sechead">
                <span class="lbl">Products</span>
                <span class="meta">record</span>
              </div>
              <For each={Object.entries(x().turn.products)} keyed={([k]) => k}>
                {(e) => (
                  <div class="prod">
                    <span class="pid">{e()[0]}</span>
                    <Show when={shapeOf(e()[0])} fallback={<KeyValues of={{ [e()[0]]: e()[1] }} />}>
                      {(sh) => <Shaped shape={sh()} value={e()[1]} />}
                    </Show>
                  </div>
                )}
              </For>
              <Show when={Object.keys(x().turn.answers).length}>
                <div class="prod">
                  <span class="pid">answers</span>
                  <KeyValues of={x().turn.answers} />
                </div>
              </Show>
            </aside>
          </div>
        )}
      </Show>
    </div>
  )
}
