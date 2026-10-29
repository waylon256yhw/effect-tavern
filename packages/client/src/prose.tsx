// The prose drawn: each block of src/markdown.ts as the reader's DOM. Blocks parse under a memo keyed by their
// text, so a landed turn never re-renders and the draft re-renders only its last block per frame. `tail` is what
// rides after the last glyph (the draft's cursor): inside the last paragraph or heading, after any other block.
// A link is a link only on http(s) or mailto; raw HTML and an image are text, as markdown.ts says.
import { type JSX } from "@solidjs/web"
import { createMemo, For } from "solid-js"
import { blocks, parse, type PhrasingContent, type RootContent } from "./markdown.ts"

export { plain } from "./markdown.ts"

const SAFE = /^(https?:|mailto:)/i

const inline = (n: PhrasingContent): JSX.Element => {
  switch (n.type) {
    case "text":
      return n.value
    case "strong":
      return <strong>{n.children.map(inline)}</strong>
    case "emphasis":
      return <em>{n.children.map(inline)}</em>
    case "delete":
      return <del>{n.children.map(inline)}</del>
    case "inlineCode":
      return <code>{n.value}</code>
    case "break":
      return <br />
    case "link":
      return SAFE.test(n.url) ? (
        <a href={n.url} target="_blank" rel="noopener noreferrer">
          {n.children.map(inline)}
        </a>
      ) : (
        n.children.map(inline)
      )
    case "linkReference":
      return n.children.map(inline)
    case "image":
    case "imageReference":
      return n.alt ?? ""
    case "html":
      return n.value
    case "footnoteReference":
      return <sup>[{n.label ?? n.identifier}]</sup>
    default:
      return ""
  }
}

const block = (n: RootContent, tail?: JSX.Element): JSX.Element => {
  switch (n.type) {
    case "paragraph":
      return (
        <p>
          {n.children.map(inline)}
          {tail}
        </p>
      )
    case "heading": {
      const kids = (
        <>
          {n.children.map(inline)}
          {tail}
        </>
      )
      switch (n.depth) {
        case 1:
          return <h1>{kids}</h1>
        case 2:
          return <h2>{kids}</h2>
        case 3:
          return <h3>{kids}</h3>
        case 4:
          return <h4>{kids}</h4>
        case 5:
          return <h5>{kids}</h5>
        default:
          return <h6>{kids}</h6>
      }
    }
    case "thematicBreak":
      return [<hr />, tail]
    case "blockquote":
      return [
        <blockquote>
          <For each={n.children}>{(c) => block(c)}</For>
        </blockquote>,
        tail,
      ]
    case "list":
      return [
        n.ordered ? (
          <ol start={n.start ?? undefined}>
            <For each={n.children}>{(c) => block(c)}</For>
          </ol>
        ) : (
          <ul>
            <For each={n.children}>{(c) => block(c)}</For>
          </ul>
        ),
        tail,
      ]
    case "listItem":
      return (
        <li>
          {n.checked === true ? "☑ " : n.checked === false ? "☐ " : ""}
          <For each={n.children}>{(c) => block(c)}</For>
        </li>
      )
    case "code":
      return [
        <pre>
          <code data-lang={n.lang ?? undefined}>{n.value}</code>
        </pre>,
        tail,
      ]
    case "table": {
      const [head, ...rows] = n.children
      const cell = (r: (typeof n.children)[number], th: boolean) =>
        r.children.map((c, i) =>
          th ? (
            <th style={{ "text-align": n.align?.[i] ?? undefined }}>{c.children.map(inline)}</th>
          ) : (
            <td style={{ "text-align": n.align?.[i] ?? undefined }}>{c.children.map(inline)}</td>
          ),
        )
      return [
        <table>
          {head && (
            <thead>
              <tr>{cell(head, true)}</tr>
            </thead>
          )}
          <tbody>
            <For each={rows}>{(r) => <tr>{cell(r, false)}</tr>}</For>
          </tbody>
        </table>,
        tail,
      ]
    }
    case "html":
      return (
        <p>
          {n.value}
          {tail}
        </p>
      )
    case "footnoteDefinition":
      return [
        <div class="footnote">
          [{n.label ?? n.identifier}] <For each={n.children}>{(c) => block(c)}</For>
        </div>,
        tail,
      ]
    case "definition":
      return tail
    default:
      return tail
  }
}

/** The prose as blocks. `open`: the last block is still being written (its marks are mended for display); `tail`
 *  rides after the last glyph, and an empty text with a tail is one empty paragraph holding it. */
export const Prose = (props: { text: string; open?: boolean; tail?: JSX.Element }) => {
  const bs = createMemo(() => {
    const bs = blocks(props.text)
    return bs.length || !("tail" in props) ? bs : [""]
  })
  const last = createMemo(() => bs().length - 1)
  return (
    <For each={bs()} keyed={false}>
      {(b, i) => {
        const nodes = createMemo(() => parse(b(), !!props.open && i === last()))
        return (
          <>
            {nodes().length
              ? nodes().map((n, k) => block(n, k === nodes().length - 1 && i === last() ? props.tail : undefined))
              : block({ type: "paragraph", children: [] }, i === last() ? props.tail : undefined)}
          </>
        )
      }}
    </For>
  )
}
