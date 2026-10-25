// The Timeline: the session's log tree as a page over the reader, the Inspector's sibling (ported from
// docs/timeline-prototype.html against docs/timeline-prototype-brief.md). Every branch and version as a
// station on a rail: a knot on the line, two lines of text beside it; src/lanes.ts places them and never reads head,
// so head, the reading line and the draft are highlights over a picture that holds still. Two steps: a tap selects a
// station and the right pane shows it (where a checkout would land, what is below it, its versions); the pane's
// actions are Checkout, Open in reader, Inspect and Drop subtree. The phone shows one pane at a time (Timeline |
// Node); Escape returns to the story. The page reuses the Inspect page's chrome (.inspect: top bar, panes, section
// heads, pills); timeline.css adds the rail and the node pane's own pieces. No boxes: the rail, the knots and the
// weight of the ink say what is where; only the selected station sits on a surface.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js"
import { read } from "./bridge.ts"
import { Back, Checkout, Clue, Edit, Notes, Reword, Swipe, Trash } from "./icons.tsx"
import { type Cell, DRAFT, layout } from "./lanes.ts"
import { heading } from "./record.ts"
import { card, draft, type Id, log, page, path, prose, registry } from "./store.ts"
import { dropNodes, fetchCalls, send } from "./wire.ts"

// px: a station's width (its height is the CSS's), the gap between lanes, the row step, the turn ruler, the padding, a thread's
// band, and where the knot sits in the station
const LANE = 136
const GAP = 10
const STEP = 70
const RULER = 40
const PAD = 10
const BAND = 32
const THREAD_GAP = 14
const KNOT = { x: 7, y: 14 }

export const openTimeline = () => registry.set(page, "timeline")
const lineOf = (n: Node) => n.turn.input.text || n.turn.input.note || ""
const textOf = (n: Node) => lineOf(n) || prose(n)

const Kind = (props: { of: Node["turn"]["sibling"] }) => (
  <Switch>
    <Match when={props.of === "swipe"}>
      <Swipe aria-label="Swipe" />
    </Match>
    <Match when={props.of === "reword"}>
      <Reword aria-label="Reword" />
    </Match>
    <Match when={props.of === "edit"}>
      <Edit aria-label="Edit" />
    </Match>
  </Switch>
)

export const Timeline = () => {
  const all = read(log)
  const line = read(path)
  const d = read(draft)
  const view = read(card)
  const [selected, setSelected] = createSignal<Id | null>(registry.get(log).head)
  const [pane, setPane] = createSignal<"pipeline" | "node">("pipeline") // the inspector's names: its pane switch is inherited
  const onLine = createMemo(() => new Set(line().map((n) => n.id)))
  const laid = createMemo(() => {
    const dr = d()
    return layout(all(), lineOf, dr ? dr.parent : undefined)
  })
  // pixel geometry: threads stacked, each under its band with its own rows
  const geo = createMemo(() => {
    let y = PAD
    const threads = laid().threads.map((t) => {
      const top = y
      y = top + BAND + t.rows * STEP + THREAD_GAP
      return { top, rows: top + BAND, lanes: t.lanes }
    })
    const lanes = Math.max(1, ...threads.map((t) => t.lanes))
    return { threads, width: RULER + PAD * 2 + lanes * (LANE + GAP) - GAP, height: y }
  })
  const xy = (c: Cell) => ({ x: RULER + PAD + c.lane * (LANE + GAP), y: geo().threads[c.thread]!.rows + c.row * STEP })
  const knot = (c: Cell) => ({ x: xy(c).x + KNOT.x, y: xy(c).y + KNOT.y })
  const node = (id: Id) => all().nodes.get(id)
  const sel = () => (selected() === null ? undefined : node(selected()!))
  // where checkout(selected) lands: the newest leaf under it
  const target = createMemo(() => (sel() ? L.leaf(all(), sel()!.id) : null)) // read by every station: once per change
  const scene = (n: Node) => {
    const h = heading(view()?.heading, n)
    const p = n.parent === null ? undefined : node(n.parent)
    return h !== undefined && (!p || heading(view()?.heading, p) !== h) ? h : undefined
  }
  const depth = (id: Id) => L.chain(all(), id).length
  const siblings = createMemo(() => (sel() ? L.children(all(), sel()!.parent) : []))
  const version = () => siblings().findIndex((s) => s.id === sel()!.id) + 1
  const isHead = (id: Id) => all().head === id
  const isTarget = (id: Id) => target() === id && selected() !== id && !isHead(id)
  const lit = (c: Cell) => c.ids[0] !== DRAFT && c.ids.some((i) => onLine().has(i))

  const close = () => registry.set(page, "reader")
  const scrollTo = (id: Id) => document.getElementById(`node-${id}`)?.scrollIntoView({ block: "start" })
  const checkout = (id: Id) => {
    setSelected(L.leaf(all(), id))
    send({ kind: "checkout", node: id })
  }
  // in the reader: a node on the line is scrolled to; one off it is checked out first, scrolled to once it is there
  const openInReader = (id: Id) => {
    close()
    if (onLine().has(id)) return requestAnimationFrame(() => scrollTo(id))
    const unsub = registry.subscribe(path, (l) => {
      if (!l.some((n) => n.id === id)) return
      unsub()
      requestAnimationFrame(() => scrollTo(id))
    })
    send({ kind: "checkout", node: id })
  }
  const inspect = (id: Id) => {
    close()
    registry.set(page, { inspect: id })
    void fetchCalls()
  }
  let confirm!: HTMLDialogElement
  const drop = async () => {
    const id = sel()!.id
    confirm.close()
    await dropNodes(id)
    setSelected(registry.get(log).head)
  }
  onSettled(() => {
    document
      .querySelector(".timeline .cell[aria-current='true']")
      ?.scrollIntoView({ block: "center", inline: "nearest" })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirm.open) close()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })

  const Single = (p: { c: Cell; id: Id }) => {
    const n = () => node(p.id)!
    return (
      <button
        type="button"
        class={{ cell: true, line: onLine().has(p.id), selected: selected() === p.id }}
        style={{ left: `${xy(p.c).x}px`, top: `${xy(p.c).y}px`, width: `${LANE}px` }}
        aria-current={isHead(p.id) ? "true" : undefined}
        aria-label={`Turn ${p.c.row + 1}, node ${p.id}`}
        onClick={() => setSelected(p.id)}
      >
        <div class="row1">
          <span class="nid">#{p.id}</span>
          <Show when={n().turn.sibling}>
            <span class="how">
              <Kind of={n().turn.sibling} />
            </span>
          </Show>
          <span class="where">{scene(n()) ?? ""}</span>
          <Switch>
            <Match when={isHead(p.id)}>
              <span class="badge head">HEAD</span>
            </Match>
            <Match when={isTarget(p.id)}>
              <span class="badge target">→leaf</span>
            </Match>
            <Match when={n().turn.end === "stopped"}>
              <span class="badge stop">stop</span>
            </Match>
          </Switch>
        </div>
        <div class="row2">
          <Show when={n().turn.input.note && n().turn.input.text}>
            <span class="pill">note</span>
          </Show>
          {textOf(n())}
        </div>
      </button>
    )
  }
  const Cluster = (p: { c: Cell }) => {
    const shown = () =>
      node(p.c.ids.find((i) => i === selected()) ?? p.c.ids.find((i) => i === all().head) ?? p.c.ids[0]!)!
    return (
      <div
        class={{ cell: true, cluster: true, line: lit(p.c), selected: p.c.ids.includes(selected()!) }}
        style={{ left: `${xy(p.c).x}px`, top: `${xy(p.c).y}px`, width: `${LANE}px` }}
        role="group"
        aria-label={`Turn ${p.c.row + 1}, ${p.c.ids.length} versions`}
      >
        <div class="row1 pills">
          <span class="tag">{p.c.ids.length}v</span>
          <For each={p.c.ids} keyed={false}>
            {(id) => (
              <button
                type="button"
                class={{ vpill: true, selected: selected() === id(), head: isHead(id()) }}
                aria-current={isHead(id()) ? "true" : undefined}
                aria-label={`Node ${id()}`}
                onClick={() => setSelected(id())}
              >
                <Kind of={node(id())!.turn.sibling} />#{id()}
                <Show when={node(id())!.turn.input.note}>✦</Show>
                <Show when={node(id())!.turn.end === "stopped"}>
                  <i class="stopdot" />
                </Show>
              </button>
            )}
          </For>
        </div>
        <div class="row2">{textOf(shown())}</div>
      </div>
    )
  }
  const DraftCell = (p: { c: Cell }) => (
    <div
      class="cell draft"
      style={{ left: `${xy(p.c).x}px`, top: `${xy(p.c).y}px`, width: `${LANE}px` }}
      aria-label="The turn being written"
    >
      <div class="row1">
        <span class="nid">Draft</span>
        <span class="where">{p.c.parent === null ? "root" : `#${p.c.parent}`}</span>
      </div>
      <div class="row2">{d()?.input.text || d()?.input.note || d()?.text || "Writing…"}</div>
    </div>
  )

  return (
    <div class="inspect timeline" data-pane={pane()}>
      <header class="top">
        <button class="icon" aria-label="Back to story" onClick={close}>
          <Back />
        </button>
        <h1>{view()?.title}</h1>
        <span class="spacer" />
        <span class="sums">
          {all().nodes.size} nodes · head {all().head === null ? "null" : `#${all().head}`}
        </span>
        <span class="seg" role="tablist" aria-label="View">
          <button
            role="tab"
            aria-selected={pane() === "pipeline" ? "true" : "false"}
            onClick={() => setPane("pipeline")}
          >
            Timeline
          </button>
          <button role="tab" aria-selected={pane() === "node" ? "true" : "false"} onClick={() => setPane("node")}>
            Node <span class="v">{selected() === null ? "—" : `#${selected()}`}</span>
          </button>
        </span>
      </header>
      <div class="cols">
        <section class="pane pipeline graph" aria-label="Timeline">
          <div class="stage" style={{ width: `${geo().width}px`, height: `${geo().height}px` }}>
            <svg width={geo().width} height={geo().height} aria-hidden="true">
              {/* each station: the rail up to its parent's knot (an elbow into a new lane just above the child), then its knot */}
              <For each={laid().cells} keyed={(c) => c.ids.join()}>
                {(c) => {
                  const b = () => knot(c())
                  const d = () => {
                    const a = knot(laid().at.get(c().parent!)!)
                    if (a.x === b().x) return `M${a.x} ${a.y}V${b().y}`
                    const e = b().y - 26
                    return `M${a.x} ${a.y}V${e - 8}C${a.x} ${e + 4} ${b().x} ${e - 4} ${b().x} ${e + 8}V${b().y}`
                  }
                  return (
                    <>
                      <Show when={c().parent !== null}>
                        <path
                          class={{ line: lit(c()) && lit(laid().at.get(c().parent!)!), draft: c().ids[0] === DRAFT }}
                          d={d()}
                        />
                      </Show>
                      <g transform={`translate(${b().x} ${b().y})`}>
                        <Switch fallback={<circle class={{ knot: true, line: lit(c()) }} r={lit(c()) ? 3.5 : 3} />}>
                          <Match when={c().ids[0] === DRAFT}>
                            <circle class="knot draft" r={3.5} />
                          </Match>
                          <Match when={c().ids.some(isHead)}>
                            <circle class="ring" r={6.5} />
                            <circle class="knot line" r={3.5} />
                          </Match>
                          <Match when={c().ids.some(isTarget)}>
                            <circle class="ring target" r={6} />
                            <circle class="knot target" r={3} />
                          </Match>
                        </Switch>
                      </g>
                    </>
                  )
                }}
              </For>
            </svg>
            <For each={laid().threads} keyed={(t) => t.root ?? DRAFT}>
              {(t, i) => (
                <>
                  <div
                    class={{ band: true, active: t().root !== null && onLine().has(t().root!) }}
                    style={{
                      left: `${RULER + PAD}px`,
                      top: `${geo().threads[i()]!.top}px`,
                      width: `${Math.max(260, t().lanes * (LANE + GAP) - GAP)}px`,
                    }}
                  >
                    <span>Root {t().root === null ? "draft" : `#${t().root}`}</span>
                    <span class="dim">
                      {t().root === null ? 1 : L.below(all(), t().root!) + 1} nodes
                      <Show when={t().root !== null && heading(view()?.heading, node(t().root!)!)}>
                        {(h) => <> · {h()}</>}
                      </Show>
                    </span>
                  </div>
                  <For each={Array.from({ length: t().rows }, (_, r) => r)} keyed={false}>
                    {(r) => (
                      <span
                        class={{ tick: true, line: line()[0]?.id === t().root && r() < line().length }}
                        style={{ top: `${geo().threads[i()]!.rows + r() * STEP}px` }}
                      >
                        T{r() + 1}
                      </span>
                    )}
                  </For>
                </>
              )}
            </For>
            <For each={laid().cells} keyed={(c) => c.ids.join()}>
              {(c) => (
                <Switch fallback={<Single c={c()} id={c().ids[0]!} />}>
                  <Match when={c().ids[0] === DRAFT}>
                    <DraftCell c={c()} />
                  </Match>
                  <Match when={c().ids.length > 1}>
                    <Cluster c={c()} />
                  </Match>
                </Switch>
              )}
            </For>
          </div>
        </section>
        <section class="pane node" aria-label="Node">
          <Show when={sel()} fallback={<p class="dim">No node selected.</p>}>
            {(n) => (
              <>
                <div class="nodehead">
                  <div class="bar">
                    <h2>
                      Turn {depth(n().id)} <span class="v">· #{n().id}</span>
                      <Show when={isHead(n().id)}>
                        <span class="pill solid">HEAD</span>
                      </Show>
                      <Show when={!isHead(n().id) && onLine().has(n().id)}>
                        <span class="pill ok">on line</span>
                      </Show>
                      <Show when={n().turn.end === "stopped"}>
                        <span class="pill bad">stopped</span>
                      </Show>
                    </h2>
                    <span class="acts">
                      <Show when={all().head !== target()} fallback={<span class="at">at #{target()}</span>}>
                        <button
                          type="button"
                          class="checkout"
                          data-hint={`Move head to #${target()}`}
                          onClick={() => checkout(n().id)}
                        >
                          <Checkout aria-hidden="true" />
                          Checkout #{target()}
                        </button>
                      </Show>
                      <button
                        type="button"
                        class="icon"
                        aria-label="Open in reader"
                        data-hint="Open in reader"
                        onClick={() => openInReader(n().id)}
                      >
                        <Notes />
                      </button>
                      <button
                        type="button"
                        class="icon"
                        aria-label="Inspect"
                        data-hint="Inspect this turn"
                        onClick={() => inspect(n().id)}
                      >
                        <Clue />
                      </button>
                      <button
                        type="button"
                        class="icon danger"
                        aria-label="Drop subtree"
                        data-hint={`Drop #${n().id} and everything under it`}
                        onClick={() => confirm.showModal()}
                      >
                        <Trash />
                      </button>
                    </span>
                  </div>
                  <div class="facts">
                    <span>
                      parent <b>{n().parent === null ? "none" : `#${n().parent}`}</b>
                    </span>
                    <span>
                      <b>{n().turn.sibling ?? (n().parent === null ? "root" : "act")}</b>
                      <Show when={siblings().length > 1}>
                        {" "}
                        {version()}/{siblings().length}
                      </Show>
                    </span>
                    <Show when={heading(view()?.heading, n())}>{(h) => <span>{h()}</span>}</Show>
                    <span>
                      <b>{L.below(all(), n().id)}</b> below
                      <Show when={target() !== n().id}>
                        {" "}
                        (leaf <b>#{target()}</b>)
                      </Show>
                    </span>
                  </div>
                </div>
                <blockquote class="quote">
                  <Show when={n().turn.input.text || n().turn.input.note} fallback={<span class="dim">(opening)</span>}>
                    {n().turn.input.text || n().turn.input.note}
                  </Show>
                  <Show when={n().turn.input.text && n().turn.input.note}>
                    <span class="aside">note: {n().turn.input.note}</span>
                  </Show>
                </blockquote>
                <div class="prose">{prose(n())}</div>
                <Show when={siblings().length > 1}>
                  <div class="vlist">
                    <div class="sechead">
                      <span class="lbl">Versions under #{n().parent}</span>
                      <span class="meta">
                        {version()}/{siblings().length}
                      </span>
                    </div>
                    <For each={siblings()} keyed={(s) => s.id}>
                      {(s, i) => (
                        <button
                          type="button"
                          class="vrow"
                          aria-current={s().id === n().id ? "true" : undefined}
                          onClick={() => setSelected(s().id)}
                        >
                          <span class="v">
                            {i() + 1}/{siblings().length} · #{s().id}
                          </span>
                          <Kind of={s().turn.sibling} />
                          <span class="text">{textOf(s())}</span>
                          <span class="meta">{L.below(all(), s().id) ? `+${L.below(all(), s().id)}` : "leaf"}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </section>
      </div>
      <dialog class="confirm" ref={(el) => (confirm = el)} closedby="any">
        <Show when={sel()}>
          {(n) => (
            <p>
              Drop #{n().id} and the {L.below(all(), n().id)} nodes under it? Every turn in this subtree is gone for
              good;{" "}
              {L.chain(all(), all().head).some((x) => x.id === n().id)
                ? "head falls to the newest surviving node"
                : "head stays"}
              .
            </p>
          )}
        </Show>
        <div class="row">
          <button type="button" class="chip state" onClick={() => confirm.close()}>
            Cancel
          </button>
          <button type="button" class="chip danger" onClick={() => void drop()}>
            Delete
          </button>
        </div>
      </dialog>
    </div>
  )
}
