// The settings page (issue #33; docs/settings-prototype.html and its brief): the player's assets that hold across cards
// and stories, in four sections: the model providers (模型服务, providers.tsx), which model runs each stage (默认模型),
// the hats (提示词模板 in the UI) and the personas (玩家人设). Desktop: three cards on the canvas (nav, list, detail),
// two for the routing; a phone shows the list or the detail under a bar of four icons. Opened from the session's
// tools, Escape or Back returns to the story. The page holds only the nav, which section is open, which record each
// section has picked, and the phone's pane; every edit is one write the server answers with the list it changed
// (wire.ts), text committing on change (blur or Enter). The shared controls and shells are controls.tsx.
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import type { Phase } from "@effect-tavern/runtime/src/session.ts"
import { Dynamic, type JSX } from "@solidjs/web"
import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { ask, Avatar, Confirm, Menu, Name, newId, Switch, ToList, type Pane } from "./controls.tsx"
import { Back, Close, Plugs, Sliders, Snippets as Plus, Template, Trash, User } from "./icons.tsx"
import { Providers } from "./providers.tsx"
import { cards, hats, page, personas, player, providers, registry, routing, type Pair } from "./store.ts"
import {
  deleteHat,
  deletePersona,
  fetchCards,
  fetchHats,
  fetchNames,
  fetchProviders,
  fetchRouting,
  fetchSecrets,
  putHat,
  putPersona,
  putRouting,
} from "./wire.ts"

export type Section = "providers" | "routing" | "templates" | "personas"
let opening: Section = "providers"
let backTo: "reader" | "card" = "reader" // Back returns to where Settings was opened from: the card page keeps its Begin
/** The page on a section, 模型服务 when none is named: a missing model opens it on 默认模型 (the draft's error, the card page). */
export const openSettings = (at: Section = "providers") => {
  opening = at
  backTo = registry.get(page) === "card" ? "card" : "reader"
  registry.set(page, "settings")
}
const close = () => registry.set(page, backTo)

const SECTIONS: [Section, string, (p: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element][] = [
  ["providers", "模型服务", Plugs],
  ["routing", "默认模型", Sliders],
  ["templates", "提示词模板", Template],
  ["personas", "玩家人设", User],
]

export const Settings = () => {
  const [section, setSection] = createSignal<Section>(opening)
  const [pane, setPane] = createSignal<"list" | "detail">("list")
  const [picked, setPicked] = createSignal<Partial<Record<Section, string>>>({})
  const paneOf = (s: Section): Pane => ({
    get picked() {
      return picked()[s]
    },
    onPick: (id) => (setPicked((p) => ({ ...p, [s]: id })), setPane("detail")),
    onBack: () => setPane("list"),
  })
  const switchTo = (s: Section) => (setSection(s), setPane("list"))
  const title = () => SECTIONS.find(([s]) => s === section())![1]

  onSettled(() => {
    void Promise.all([fetchProviders(), fetchSecrets(), fetchRouting(), fetchHats(), fetchCards(), fetchNames()])
    // a popover, a dialog or an open drawer takes its own Escape (the drawer's is providers.tsx's); so does a field
    // that prevents it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (document.querySelector(":popover-open, dialog[open], .side-drawer[data-open='true']")) return
      close()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })

  return (
    <div class="settings" data-section={section()} data-pane={section() === "routing" ? "detail" : pane()}>
      <nav class="nav-card" aria-label="设置">
        <div class="nav-head">
          <button type="button" class="icon" aria-label="返回故事" onClick={close}>
            <Back />
          </button>
          <h1>设置</h1>
        </div>
        <div class="nav-list">
          <For each={SECTIONS} keyed={(s) => s[0]}>
            {(s) => (
              <button
                type="button"
                class="nav-item"
                aria-current={section() === s()[0] ? "page" : undefined}
                onClick={() => switchTo(s()[0])}
              >
                <Dynamic component={s()[2]} aria-hidden="true" />
                <span>{s()[1]}</span>
              </button>
            )}
          </For>
        </div>
      </nav>
      <header class="phone-bar">
        <button type="button" class="icon" aria-label="返回故事" onClick={close}>
          <Back />
        </button>
        <span class="title">{title()}</span>
        <div class="tabs" role="tablist" aria-label="设置">
          <For each={SECTIONS} keyed={(s) => s[0]}>
            {(s) => (
              <button
                type="button"
                role="tab"
                aria-label={s()[1]}
                aria-selected={section() === s()[0] ? "true" : "false"}
                onClick={() => switchTo(s()[0])}
              >
                <Dynamic component={s()[2]} aria-hidden="true" />
              </button>
            )}
          </For>
        </div>
      </header>
      <Show when={section() === "providers"}>
        <Providers {...paneOf("providers")} />
      </Show>
      <Show when={section() === "routing"}>
        <Routing />
      </Show>
      <Show when={section() === "templates"}>
        <Templates {...paneOf("templates")} />
      </Show>
      <Show when={section() === "personas"}>
        <Personas {...paneOf("personas")} />
      </Show>
      <Confirm />
    </div>
  )
}

// ───────── 默认模型 ─────────
const STAGES: [Phase, string][] = [
  ["narrate", "正文叙事"],
  ["record", "状态与记录结算"],
  ["decide", "行动判定"],
  ["direct", "导演规划"],
  ["lookup", "设定检出"],
  ["check", "护栏检查"],
  ["polish", "文风润色"],
]
const key = (p: Pair) => `${p.provider}\u0000${p.model}`
const pairOf = (k: string): Pair => {
  const [provider, model] = k.split("\u0000") as [string, string]
  return { provider, model }
}

const Routing = () => {
  const list = read(providers)
  const route = read(routing)
  const pairs = createMemo(() =>
    list()
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.models.map((m) => ({
          value: key({ provider: p.id, model: m.id }),
          label: `${p.name} · ${m.id}`,
          glyph: m.id,
        })),
      ),
  )
  /** A pair the menus cannot offer (its provider off, or it or its model gone) still shows what the row holds, marked;
   *  the next turn on it fails naming the provider, so the trigger must not look unset. */
  const stale = (pair: Pair | undefined) => {
    if (!pair) return undefined
    const p = list().find((x) => x.id === pair.provider)
    const gone = !p || !p.models.some((m) => m.id === pair.model)
    return {
      value: key(pair),
      label: `${p?.name ?? pair.provider} · ${pair.model}（${gone ? "已移除" : "已禁用"}）`,
      glyph: pair.model,
    }
  }
  const setStage = (s: Phase, k: string) => {
    const { [s]: _, ...rest } = route().stages ?? {}
    void putRouting({ ...route(), stages: k ? { ...rest, [s]: pairOf(k) } : rest })
  }
  const flipStages = () => {
    const { stages, ...rest } = route()
    void putRouting(stages ? rest : { ...rest, stages: {} })
  }
  return (
    <section class="detail-card" aria-label="默认模型">
      <header class="detail-header">
        <h2>默认模型</h2>
      </header>
      <div class="detail-scroll scroller">
        <div class="setting-card hero">
          <h3>主默认模型</h3>
          <div class="hero-pick">
            <Menu
              label="主默认模型"
              placeholder="未选择"
              value={route().default && key(route().default!)}
              options={pairs()}
              stale={stale(route().default)}
              onPick={(k) => void putRouting({ ...route(), default: pairOf(k) })}
            />
          </div>
        </div>
        <div class="block">
          <div class="block-title">
            <h3>按阶段指定模型</h3>
            <div class="right">
              <Switch on={!!route().stages} label="按阶段指定模型" onFlip={flipStages} />
            </div>
          </div>
          <Show when={route().stages}>
            <div class="cards-grid">
              <For each={STAGES} keyed={(s) => s[0]}>
                {(s) => (
                  <div class="setting-card">
                    <div class="stage-head">
                      <span>{s()[1]}</span>
                      <span class="tag mono">{s()[0]}</span>
                    </div>
                    <Menu
                      label={s()[1]}
                      value={route().stages?.[s()[0]] ? key(route().stages![s()[0]]!) : ""}
                      placeholder="跟随主默认模型"
                      options={[{ value: "", label: "跟随主默认模型" }, ...pairs()]}
                      stale={stale(route().stages?.[s()[0]])}
                      onPick={(k) => setStage(s()[0], k)}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </section>
  )
}

// ───────── 提示词模板 ─────────
type Role = "system" | "user" | "assistant"
type Slot = "head" | "tail" | "review"
type Said = { role: Role; text: string }
const ROLES: { value: Role; label: string }[] = [
  { value: "system", label: "System" },
  { value: "user", label: "User" },
  { value: "assistant", label: "Assistant" },
]
const SLOTS: [Slot, string][] = [
  ["head", "前置引导消息 (Head)"],
  ["tail", "尾部续写预填 (Tail)"],
  ["review", "审阅阶段引导 (Review)"],
]
const slotOf = (h: Hat, s: Slot): readonly Said[] =>
  (s === "review" ? h.review?.head : s === "head" ? h.narrate?.head : h.narrate?.tail) ?? []
const withSlot = (h: Hat, s: Slot, said: Said[]): Hat =>
  s === "review" ? { ...h, review: { ...h.review, head: said } } : { ...h, narrate: { ...h.narrate, [s]: said } }

const Templates = (props: Pane) => {
  const list = read(hats)
  const hat = () => list().find((h) => h.id === props.picked) ?? list()[0]
  const editSlot = (s: Slot, f: (said: Said[]) => Said[]) => {
    const h = hat()
    if (h) void putHat(withSlot(h, s, f([...slotOf(h, s)])))
  }
  const create = async () => {
    const id = newId("hat")
    await putHat({ id, name: "新建提示词模板", narrate: { head: [{ role: "system", text: "" }] } })
    props.onPick(id)
  }
  return (
    <>
      <aside class="master-card" aria-label="提示词模板">
        <div class="master-list scroller top">
          <For each={list()} keyed={(h) => h.id}>
            {(h) => (
              <button
                type="button"
                class="p-row"
                aria-selected={h().id === hat()?.id ? "true" : "false"}
                onClick={() => props.onPick(h().id)}
              >
                <span class="p-name">{h().name}</span>
                <span class="tag mono">{SLOTS.reduce((n, [s]) => n + slotOf(h(), s).length, 0)}</span>
              </button>
            )}
          </For>
        </div>
        <div class="master-foot">
          <button type="button" class="btn" onClick={() => void create()}>
            <Plus /> <span>新建模板</span>
          </button>
        </div>
      </aside>
      <section class="detail-card" aria-label="模板详情">
        <Show when={hat()} fallback={<div class="empty">尚未创建模板</div>}>
          {(h) => (
            <>
              <header class="detail-header">
                <ToList onBack={props.onBack} />
                <Name value={h().name} label="模板名称" onCommit={(name) => void putHat({ ...h(), name })} />
                <span class="spacer" />
                <button
                  type="button"
                  class="icon sm"
                  aria-label="删除模板"
                  onClick={() => ask(`删除模板「${h().name}」？`, () => void deleteHat(h().id))}
                >
                  <Trash />
                </button>
              </header>
              <div class="detail-scroll scroller">
                <For each={SLOTS} keyed={(s) => s[0]}>
                  {(s) => (
                    <SlotEditor
                      label={s()[1]}
                      said={slotOf(h(), s()[0])}
                      tail={s()[0] === "tail"}
                      onEdit={(f) => editSlot(s()[0], f)}
                    />
                  )}
                </For>
              </div>
            </>
          )}
        </Show>
      </section>
    </>
  )
}

/** One slot of a template: its messages, each a role, a text and a remove; 添加消息 appends one. */
const SlotEditor = (props: {
  label: string
  said: readonly Said[]
  tail: boolean
  onEdit: (f: (said: Said[]) => Said[]) => void
}) => (
  <div class="block">
    <div class="block-title">
      <h3>{props.label}</h3>
      <div class="right">
        <button
          type="button"
          class="btn sm"
          onClick={() => {
            const role: Role = props.tail ? "assistant" : "user"
            props.onEdit((l) => [...l, { role, text: "" }])
          }}
        >
          <Plus /> <span>添加消息</span>
        </button>
      </div>
    </div>
    <Show when={props.said.length} fallback={<div class="setting-card none">未配置消息</div>}>
      <div class="msgs">
        <For each={props.said} keyed={false}>
          {(m, i) => (
            <div class="msg-card">
              <Menu
                small
                label="角色"
                value={m().role}
                options={ROLES}
                onPick={(role) => props.onEdit((l) => l.map((x, j) => (j === i ? { ...x, role } : x)))}
              />
              <textarea
                class="field"
                rows="2"
                placeholder="输入消息内容..."
                aria-label="消息内容"
                value={m().text}
                onChange={(e) => {
                  const text = e.currentTarget.value
                  props.onEdit((l) => l.map((x, j) => (j === i ? { ...x, text } : x)))
                }}
              />
              <button
                type="button"
                class="icon sm"
                aria-label="移除消息"
                onClick={() => props.onEdit((l) => l.filter((_, j) => j !== i))}
              >
                <Close />
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  </div>
)

// ───────── 玩家人设 ─────────
const Personas = (props: Pane) => {
  const people = read(personas)
  const me = read(player)
  const known = read(cards)
  const persona = () => people().find((p) => p.id === props.picked) ?? people()[0]
  /** Player.persona read backwards: each persona's cards by title (the id when the card is not listed). */
  const picks = createMemo(() => {
    const by = new Map<string, string[]>()
    for (const [c, p] of Object.entries(me()?.persona ?? {}))
      by.set(p, [...(by.get(p) ?? []), known().find((x) => x.id === c)?.title ?? c])
    return by
  })
  const onCards = (id: string) => picks().get(id) ?? []
  const create = async () => {
    const id = newId("persona")
    await putPersona({ id, name: "新建人设", text: "" })
    props.onPick(id)
  }
  return (
    <>
      <aside class="master-card" aria-label="玩家人设">
        <div class="master-list scroller top">
          <For each={people()} keyed={(x) => x.id}>
            {(x) => (
              <button
                type="button"
                class="p-row"
                aria-selected={x().id === persona()?.id ? "true" : "false"}
                onClick={() => props.onPick(x().id)}
              >
                <Avatar name={x().name} />
                <span class="p-name">{x().name}</span>
                <For each={onCards(x().id)}>{(t) => <span class="tag">{t}</span>}</For>
              </button>
            )}
          </For>
        </div>
        <div class="master-foot">
          <button type="button" class="btn" onClick={() => void create()}>
            <Plus /> <span>新建人设</span>
          </button>
        </div>
      </aside>
      <section class="detail-card" aria-label="人设详情">
        <Show when={persona()} fallback={<div class="empty">尚未创建人设</div>}>
          {(x) => (
            <>
              <header class="detail-header">
                <ToList onBack={props.onBack} />
                <Name value={x().name} label="人设名称" onCommit={(name) => void putPersona({ ...x(), name })} />
                <For each={onCards(x().id)}>{(t) => <span class="tag">{t}</span>}</For>
                <span class="spacer" />
                <button
                  type="button"
                  class="icon sm"
                  aria-label="删除人设"
                  onClick={() => ask(`删除人设「${x().name}」？`, () => void deletePersona(x().id))}
                >
                  <Trash />
                </button>
              </header>
              <div class="detail-scroll scroller">
                <div class="block grow">
                  <div class="block-title">
                    <h3>人设描述</h3>
                    <div class="right">
                      <span class="tag mono">{x().text.length} 字</span>
                    </div>
                  </div>
                  <textarea
                    class="field persona-text"
                    placeholder="描述玩家角色的外貌、身份与性格特征..."
                    aria-label="人设描述"
                    value={x().text}
                    onChange={(e) => void putPersona({ ...x(), text: e.currentTarget.value })}
                  />
                </div>
              </div>
            </>
          )}
        </Show>
      </section>
    </>
  )
}
