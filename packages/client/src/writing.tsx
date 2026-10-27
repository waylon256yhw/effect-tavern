// The Writing page (issue #69): the player's writing workbench, in play. One rule puts the player layer's fields here
// and its entities in Settings: Persona, Hat and Provider are library rows with ids, so they get the settings page's
// list and detail; `Player.writing`, `products`, `global`, `forCard`, `snippets` and `format` are fields of one
// document, so they get this page, over the reader like the card page (`page === "writing"`: the reader stays mounted,
// a turn in flight keeps streaming, Escape or Back returns to the line being read). The side panel's Writing chips
// open it. Tabs: the switches and the record products (this file), the lexicon the polish stage scans (this file);
// the prose requirements and the quick inputs follow. Every edit is one `PUT /player` on change (blur or Enter), as
// the settings commit; nothing is optimistic. switches.ts and lexicon.ts hold the pure parts (tested).
import type { Writing } from "@effect-tavern/runtime/src/fragment.ts"
import type { Entry } from "@effect-tavern/runtime/src/polish.ts"
import { createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Switch } from "./controls.tsx"
import { Back, Clue, Close, Export, Import, Snippets as Plus } from "./icons.tsx"
import { FILE, mergeLexicon, parseLexicon, serializeLexicon } from "./lexicon.ts"
import { card, page, player, registry } from "./store.ts"
import { moot, pressing, sentence, SWITCHES, type SwitchKey } from "./switches.ts"
import { putPlayer } from "./wire.ts"

export const openWriting = () => registry.set(page, "writing")
const close = () => registry.set(page, "reader")

type Tab = "switches" | "polish"
const TABS: [Tab, string][] = [
  ["switches", "开关与记录"],
  ["polish", "润色与禁词"],
]

export const WritingPage = () => {
  const view = read(card)
  const [tab, setTab] = createSignal<Tab>("switches")
  onSettled(() => {
    // a field that prevents it keeps its Escape (a search, a row being typed); so does an open popover or dialog
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (document.querySelector(":popover-open, dialog[open]")) return
      close()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })
  return (
    <div class="inspect wpage">
      <article class="wsheet" aria-label="写作">
        <header class="whead">
          <button type="button" class="icon" aria-label="返回故事" onClick={close}>
            <Back />
          </button>
          <h1>写作</h1>
          <Show when={view()?.title}>{(t) => <span class="tag">{t()}</span>}</Show>
          <span class="spacer" />
          <nav class="wtabs" role="tablist" aria-label="写作分区">
            <For each={TABS} keyed={(t) => t[0]}>
              {(t) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === t()[0] ? "true" : "false"}
                  onClick={() => setTab(t()[0])}
                >
                  {t()[1]}
                </button>
              )}
            </For>
          </nav>
        </header>
        <div class="wbody">
          <Show when={tab() === "switches"}>
            <Switches />
          </Show>
          <Show when={tab() === "polish"}>
            <Polish />
          </Show>
        </div>
      </article>
    </div>
  )
}

/** The player layer's `writing` rewritten by `f`; nothing until the layer has arrived. */
const useWriting = () => {
  const me = read(player)
  const write = (f: (w: Writing) => Writing) => {
    const p = me()
    if (p) void putPlayer({ ...p, writing: f(p.writing ?? {}) })
  }
  return { me, write }
}

// ───────── 开关与记录: the four switches, then the record products ─────────
const Switches = () => {
  const { me, write } = useWriting()
  const view = read(card)
  const w = () => me()?.writing
  const set = (key: SwitchKey, value: string | boolean | undefined) => write((x) => ({ ...x, [key]: value })) // an undefined value leaves the JSON: unset
  const reset = () => write(({ pov: _p, echo: _e, agency: _a, verbosity: _v, ...rest }) => rest)
  const products = () => view()?.products ?? []
  const onOf = (p: { id: string; on: boolean }) => me()?.products?.[p.id] ?? p.on
  /** The toggle back to the declared default leaves the JSON (the player's map holds only what differs). */
  const flip = (prod: { id: string; on: boolean }) => {
    const p = me()
    if (!p) return
    const want = !onOf(prod)
    const { [prod.id]: _, ...rest } = p.products ?? {}
    const next = want === prod.on ? rest : { ...rest, [prod.id]: want }
    void putPlayer({ ...p, products: Object.keys(next).length ? next : undefined })
  }
  const lit = () => products().filter((p) => onOf(p)).length
  return (
    <section class="wpanel" role="tabpanel" aria-label="开关与记录">
      <div class="wsec">
        <div class="block-title">
          <h3>叙事开关</h3>
          <div class="right">
            <button type="button" class="btn sm ghost" disabled={!me()} onClick={reset}>
              全部跟随卡片
            </button>
          </div>
        </div>
        {/* a switch is a slot: unset, the card's own text holds; a value's title is the sentence it compiles to */}
        <div class="sw-grid">
          <For each={SWITCHES} keyed={(s) => s.key}>
            {(s) => (
              <fieldset class="sw-card" disabled={moot(s().key, w())}>
                <legend>{s().label}</legend>
                <div class="seg">
                  <For each={s().values} keyed={(v) => String(v[0])}>
                    {(v) => (
                      <button
                        type="button"
                        aria-pressed={w()?.[s().key] === v()[0] ? "true" : "false"}
                        title={sentence(s().key, v()[0])}
                        disabled={!me()}
                        onClick={() => set(s().key, pressing(s().key, w(), v()[0]))}
                      >
                        {v()[1]}
                      </button>
                    )}
                  </For>
                </div>
              </fieldset>
            )}
          </For>
        </div>
      </div>
      {/* the record products: the harness's and the card's, by shown name; notes is the chronicle every fold reads
          and stays on; the rest are the player's toggles over the declared default */}
      <div class="wsec grow">
        <div class="block-title">
          <h3>每轮记录</h3>
          <div class="right">
            <span class="tag mono">
              {lit()} / {products().length}
            </span>
          </div>
        </div>
        <div class="prod-list scroller fade">
          <For each={products()} keyed={(p) => p.id}>
            {(p) => (
              <div class="prod-item">
                <span class={{ pname: true, pid: !p().label }}>{p().label ?? p().id}</span>
                <Show when={p().id !== "notes"} fallback={<span class="tag">常开</span>}>
                  <Switch on={onOf(p())} label={p().label ?? p().id} onFlip={() => flip(p())} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  )
}

// ───────── 润色与禁词: the polish switch and the lexicon it scans by ─────────
const clean = (e: { pattern: string; hint?: string }): Entry =>
  e.hint?.trim() ? { pattern: e.pattern.trim(), hint: e.hint.trim() } : { pattern: e.pattern.trim() }
/** Enter commits (the change fires on blur); Escape leaves the field and keeps the page (the page's Escape defers). */
const leave = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
  if (e.isComposing || (e.key !== "Enter" && e.key !== "Escape")) return
  e.preventDefault()
  e.currentTarget.blur()
}

const Polish = () => {
  const { me, write } = useWriting()
  const lex = (): readonly Entry[] => me()?.writing?.lexicon ?? []
  const on = () => me()?.writing?.polish !== false
  const setLex = (entries: readonly Entry[]) =>
    write(({ lexicon: _lexicon, ...w }) => (entries.length ? { ...w, lexicon: entries } : w))
  const flip = () => write(({ polish: _polish, ...w }) => (on() ? { ...w, polish: false } : w)) // on is the default: unset
  const edit = (i: number, patch: Partial<Entry>) => {
    const next = lex().map((e, j) => (j === i ? clean({ ...e, ...patch }) : e))
    setLex(next.filter((e) => e.pattern)) // a pattern cleared is the row removed
  }
  const remove = (i: number) => setLex(lex().filter((_, j) => j !== i))
  // the search: a glass that opens to a field in the title row, filtering by pattern or hint
  const [q, setQ] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const shown = () => {
    const s = q().trim()
    return lex()
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !s || e.pattern.includes(s) || (e.hint ?? "").includes(s))
  }
  // a new entry: a row at the top of the list, kept here until it is left with a pattern (then it is the player's)
  const [draft, setDraft] = createSignal<{ pattern: string; hint: string } | null>(null)
  const commitDraft = () => {
    const d = draft()
    if (!d) return
    setDraft(null)
    if (d.pattern.trim()) setLex([clean(d), ...lex()])
  }
  // the file: 导入 adds a file's entries after the player's, 导出 downloads the list (lexicon.ts)
  let file!: HTMLInputElement
  const [notice, setNotice] = createSignal<string | null>(null)
  const onFile = async (f: File) => {
    const r = parseLexicon(await f.text())
    if ("error" in r) return setNotice(r.error)
    const merged = mergeLexicon(lex(), r.entries)
    setNotice(`导入 ${merged.length - lex().length} 条`)
    setLex(merged)
  }
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([serializeLexicon(lex())], { type: "application/json" }))
    const a = Object.assign(document.createElement("a"), { href: url, download: FILE })
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section class="wpanel" role="tabpanel" aria-label="润色与禁词">
      <div class="block-title lex-title">
        <h3>禁词表</h3>
        <span class="tag mono">{lex().length} 条</span>
        <label class="inline-search" data-open={searching() || !!q() ? "true" : "false"}>
          <Clue aria-hidden="true" />
          <input
            type="search"
            placeholder="搜索词条..."
            aria-label="搜索词条"
            value={q()}
            onFocus={() => setSearching(true)}
            onBlur={() => setSearching(false)}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return
              e.preventDefault() // the search's Escape: the page stays
              setQ("")
              e.currentTarget.blur()
            }}
          />
        </label>
        <div class="right">
          <Show when={notice()}>{(n) => <span class="tag">{n()}</span>}</Show>
          <button type="button" class="btn sm ghost" disabled={!me()} onClick={() => file.click()}>
            <Import /> <span>导入</span>
          </button>
          <button type="button" class="btn sm ghost" disabled={!lex().length} onClick={exportFile}>
            <Export /> <span>导出</span>
          </button>
          <button
            type="button"
            class="btn sm"
            disabled={!me() || !!draft()}
            onClick={() => (setNotice(null), setDraft({ pattern: "", hint: "" }))}
          >
            <Plus /> <span>添加禁词</span>
          </button>
          <label class="polish-switch">
            <span>润色</span>
            <Switch on={on()} label="润色" onFlip={flip} />
          </label>
        </div>
      </div>
      <input
        type="file"
        accept=".json,application/json"
        hidden
        ref={(el) => (file = el)}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          e.currentTarget.value = "" // the same file again is a new pick
          if (f) void onFile(f)
        }}
      />
      {/* the list dims while polish is off: the entries stay, nothing scans */}
      <Show
        when={lex().length || draft()}
        fallback={
          <div class="lex-empty">
            <div class="empty-card">
              <p>词表为空，润色阶段不扫描任何句子</p>
              <button type="button" class="btn" disabled={!me()} onClick={() => file.click()}>
                <Import /> <span>导入词表文件</span>
              </button>
            </div>
          </div>
        }
      >
        <div class="lex-wrap" data-off={on() ? "false" : "true"}>
          <div class="lex-head">
            <span>匹配词条（* 为通配）</span>
            <span>替代写法</span>
            <span />
          </div>
          <div class="lex-list scroller fade">
            <Show when={draft()}>
              {(d) => (
                <div
                  class="lex-row"
                  onFocusOut={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitDraft()
                  }}
                >
                  <input
                    class="field"
                    placeholder="禁词，或带 * 的句式"
                    aria-label="匹配词条"
                    value={d().pattern}
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    onInput={(e) => setDraft({ ...d(), pattern: e.currentTarget.value })}
                    onKeyDown={leave}
                  />
                  <input
                    class="field"
                    placeholder="怎么改写（选填）"
                    aria-label="替代写法"
                    value={d().hint}
                    onInput={(e) => setDraft({ ...d(), hint: e.currentTarget.value })}
                    onKeyDown={leave}
                  />
                  <button type="button" class="icon sm" aria-label="放弃" onClick={() => setDraft(null)}>
                    <Close />
                  </button>
                </div>
              )}
            </Show>
            <For each={shown()} keyed={(x) => x.i}>
              {(x) => (
                <div class="lex-row">
                  <input
                    class="field"
                    aria-label="匹配词条"
                    value={x().e.pattern}
                    onChange={(e) => edit(x().i, { pattern: e.currentTarget.value })}
                    onKeyDown={leave}
                  />
                  <input
                    class="field"
                    placeholder="怎么改写（选填）"
                    aria-label="替代写法"
                    value={x().e.hint ?? ""}
                    onChange={(e) => edit(x().i, { hint: e.currentTarget.value })}
                    onKeyDown={leave}
                  />
                  <button type="button" class="icon sm" aria-label="删除词条" onClick={() => remove(x().i)}>
                    <Close />
                  </button>
                </div>
              )}
            </For>
            <Show when={q().trim() && !shown().length}>
              <p class="none">没有匹配的词条</p>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  )
}
