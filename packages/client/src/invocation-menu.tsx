// The composer's menu (#181): one search field over what can go into the turn. The first page holds the card's
// snippets (the composer's `quick` rows) and a way into the player's and the card's tools; a tool page lists its
// groups or its entries. The snippets are there at once; the tools join them when the catalog answers (the menu
// never waits on it), and a failed read says so in the menu with a retry. Typing narrows the page, and on the first page (or the player's) it reaches every entry
// under it, so nothing has to be drilled to be found. @ui-sdk's Command keeps the focus in the field while the
// arrows move the highlight; Enter runs or opens, Backspace on an empty field and Escape go back.
import { matchingInvocations } from "./composition.ts"
import type { InvocationToken, PlayerCatalogItem } from "@effect-tavern/runtime/src/projection.ts"
import type { JSX } from "@solidjs/web"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPage,
  createCommandController,
} from "@ui-sdk/solid/command"
import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { card, composition, path, registry } from "./store.ts"
import { fetchContext } from "./wire.ts"
import { t } from "./i18n.ts"

const keep = (e: Event) => e.preventDefault() // a press on a row must not take the focus from the box

/** The only source is the authorized player catalog. Model lore and memory indexes never reach this menu. */
export const InvocationMenu = (props: {
  /** The card's snippets as rows, each valued `snippet/<name>`; `insert` gets the name of the one that ran. */
  quick: JSX.Element
  insert: (name: string) => void
  /** Opened from the keyboard: the field takes the focus, so the arrows and typing work at once. */
  keyboard?: boolean
  choose: (item: InvocationToken) => void
}) => {
  const [catalog, setCatalog] = createSignal<readonly PlayerCatalogItem[]>([])
  const [failed, setFailed] = createSignal<string | null>(null)
  /** The catalog at the line's last turn, as the menu opens (wire.ts caches the read per turn). */
  const load = () => {
    setFailed(null)
    fetchContext(registry.get(path).at(-1)?.id ?? null).then(
      (c) => setCatalog(c.playerCatalog),
      (e) => setFailed(e instanceof Error ? e.message : String(e)),
    )
  }
  const command = createCommandController()
  const [pages, setPages] = createSignal<string[]>([])
  const [query, setQuery] = createSignal("")
  const available = createMemo(() => matchingInvocations(catalog(), composition().invocations, ""))
  const from = (source: "pack" | "card") => available().filter((i) => i.source === source)
  const groups = () => [...new Set(from("pack").map((i) => i.category))]
  const label = (name: string) =>
    card()?.mounts.find((m) => m.id === name)?.name ??
    (name === "local" ? t("composer.localTools") : t("composer.playerTools"))
  const page = () => pages().at(-1)
  let field: HTMLInputElement | undefined
  onSettled(() => {
    load()
    if (props.keyboard) field?.focus()
  })
  const title = () => {
    const p = page()
    return p === "pack"
      ? t("composer.playerTools")
      : p === "card"
        ? t("composer.cardTools")
        : p
          ? label(p.slice(5))
          : ""
  }
  const Entry = (p: { item: PlayerCatalogItem }) => (
    <CommandItem
      class="item asset"
      value={p.item.resourceId}
      label={p.item.title}
      keywords={[p.item.summary]}
      onPointerDown={keep}
    >
      <span class="name">{p.item.title}</span>
      <Show when={p.item.summary !== p.item.title}>
        <span class="hint">{p.item.summary}</span>
      </Show>
    </CommandItem>
  )
  return (
    <Command
      class="invocation-menu"
      filter="contains"
      // nothing is lit until the hand asks: an arrow lights a row, and typing lights the best match so Enter runs it
      autoHighlight={query() !== ""}
      controller={command}
      pages={pages()}
      onPagesChange={setPages}
      query={query()}
      onQueryChange={setQuery}
      // a row that opens a page runs nothing: its value names no snippet and no entry
      onAction={(value) => {
        if (value.startsWith("snippet/")) return props.insert(value.slice(8))
        const item = available().find((i) => i.resourceId === value)
        if (item) props.choose(item)
      }}
    >
      <Show when={page()}>
        <div class="menu-heading">
          <button type="button" aria-label={t("common.back")} onPointerDown={keep} onClick={() => command.pop()}>
            ‹
          </button>
          <strong>{title()}</strong>
        </div>
      </Show>
      <CommandInput
        aria-label={t("writing.searchEntriesLabel")}
        placeholder={t("writing.searchEntries")}
        ref={(el) => (field = el)}
      />
      <CommandEmpty class="dim">{t("composer.noMatches")}</CommandEmpty>
      <Show when={failed()}>
        {(why) => (
          <div role="alert" class="error">
            <p>{why()}</p>
            <button type="button" onPointerDown={keep} onClick={load}>
              {t("common.retry")}
            </button>
          </div>
        )}
      </Show>
      <CommandList>
        <CommandPage>
          {props.quick}
          <For each={["pack", "card"] as const}>
            {(s) => (
              <Show when={from(s).length}>
                <CommandItem class="item" value={s} page={s} onPointerDown={keep}>
                  <span class="name">{s === "pack" ? t("composer.playerTools") : t("composer.cardTools")}</span>
                  <span class="hint" />
                  <span aria-hidden="true">›</span>
                </CommandItem>
              </Show>
            )}
          </For>
          {/* a search from the first page reaches every entry, wherever it is filed */}
          <Show when={query()}>
            <For each={available()} keyed={(i) => i.resourceId}>
              {(item) => <Entry item={item()} />}
            </For>
          </Show>
        </CommandPage>
        <CommandPage value="pack">
          <Show
            when={!query()}
            fallback={
              <For each={from("pack")} keyed={(i) => i.resourceId}>
                {(item) => <Entry item={item()} />}
              </For>
            }
          >
            <For each={groups()}>
              {(g) => (
                <CommandItem class="item" value={`pack/${g}`} page={`pack/${g}`} onPointerDown={keep}>
                  <span class="name">{label(g)}</span>
                  <span class="hint" />
                  <span aria-hidden="true">›</span>
                </CommandItem>
              )}
            </For>
          </Show>
        </CommandPage>
        <For each={groups()}>
          {(g) => (
            <CommandPage value={`pack/${g}`}>
              <For each={from("pack").filter((i) => i.category === g)} keyed={(i) => i.resourceId}>
                {(item) => <Entry item={item()} />}
              </For>
            </CommandPage>
          )}
        </For>
        <CommandPage value="card">
          <For each={from("card")} keyed={(i) => i.resourceId}>
            {(item) => <Entry item={item()} />}
          </For>
        </CommandPage>
      </CommandList>
    </Command>
  )
}
