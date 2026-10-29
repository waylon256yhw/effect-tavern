// The prose drawn: each block of src/markdown.ts as the reader's DOM. A block parses under a memo keyed by its
// text, so a landed turn never re-renders and the draft re-renders only the block being written, per frame; a
// block that stops being the last one, or a draft that stops streaming, keeps its DOM (its text is the same
// string). `tail` is what rides after the last glyph (the draft's cursor): a reactive slot inside the last
// block's last text holder (the paragraph, the heading, the quote's last paragraph, the list's last item, the
// fence, the table's last cell), so moving on to a new block only moves the cursor and never rebuilds a <p>.
// A link is a link only on http(s) or mailto; raw HTML and an image are text, as markdown.ts says.
import { type JSX } from "@solidjs/web"
import { createMemo, For } from "solid-js"
import { blocks, mend, parse, type PhrasingContent, type RootContent } from "./markdown.ts"

export { plain } from "./markdown.ts"

const SAFE = /^(https?:|mailto:)/i
/** The slot after the last glyph: read inside JSX, so it is reactive where it lands. */
type Tail = () => JSX.Element

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

/** Blocks in a row, the tail in the last one. */
const run = (ns: readonly RootContent[], tail?: Tail): JSX.Element =>
  ns.length ? ns.map((c, k) => block(c, k === ns.length - 1 ? tail : undefined)) : tail?.()

const block = (n: RootContent, tail?: Tail): JSX.Element => {
  switch (n.type) {
    case "paragraph":
      return (
        <p>
          {n.children.map(inline)}
          {tail?.()}
        </p>
      )
    case "heading": {
      const kids = (
        <>
          {n.children.map(inline)}
          {tail?.()}
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
      return [<hr />, tail?.()] // nothing to ride on: the cursor waits under the rule
    case "blockquote":
      return <blockquote>{run(n.children, tail)}</blockquote>
    case "list":
      return n.ordered ? (
        <ol start={n.start ?? undefined}>{run(n.children, tail)}</ol>
      ) : (
        <ul>{run(n.children, tail)}</ul>
      )
    case "listItem":
      return (
        <li>
          {n.checked === true ? "☑ " : n.checked === false ? "☐ " : ""}
          {run(n.children, tail)}
        </li>
      )
    case "code":
      return (
        <pre>
          <code data-lang={n.lang ?? undefined}>
            {n.value}
            {tail?.()}
          </code>
        </pre>
      )
    case "table": {
      const [head, ...rows] = n.children
      const cells = (r: (typeof n.children)[number], th: boolean, last: boolean) =>
        r.children.map((c, i) => {
          const kids = (
            <>
              {c.children.map(inline)}
              {last && i === r.children.length - 1 && tail?.()}
            </>
          )
          const align = n.align?.[i] ?? undefined
          return th ? <th style={{ "text-align": align }}>{kids}</th> : <td style={{ "text-align": align }}>{kids}</td>
        })
      const body = rows.map((r, k) => <tr>{cells(r, false, k === rows.length - 1)}</tr>) // the tree is static: parsed once per text
      return (
        <table>
          {head && (
            <thead>
              <tr>{cells(head, true, !rows.length)}</tr>
            </thead>
          )}
          <tbody>{body}</tbody>
        </table>
      )
    }
    case "html":
      return (
        <p>
          {n.value}
          {tail?.()}
        </p>
      )
    case "footnoteDefinition":
      return (
        <div class="footnote">
          [{n.label ?? n.identifier}] {run(n.children, tail)}
        </div>
      )
    default:
      return tail?.()
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
  // `.md` scopes reader.css's block styles; display: contents, so the blocks stay the host's own flex children
  return (
    <div class="md">
      <For each={bs()} keyed={false}>
        {(b, i) => {
          const isLast = createMemo(() => i === last())
          // the same string in → the same nodes: a block that is no longer last, or no longer streaming, holds its DOM
          const text = createMemo(() => (props.open && isLast() ? mend(b()) : b()))
          const nodes = createMemo(() => parse(text()))
          const tail: Tail = () => (isLast() ? props.tail : undefined)
          return <>{nodes().length ? run(nodes(), tail) : block({ type: "paragraph", children: [] }, tail)}</>
        }}
      </For>
    </div>
  )
}
