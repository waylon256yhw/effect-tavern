// Tests for bin/unroll.ts: a tiny ST card as PNG and as JSON, unrolled in ST's assembly order.
import assert from "node:assert/strict"
import { examples, markdown, parseCard, unroll } from "../bin/unroll.ts"

const card = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Ann",
    description: "{{char}} keeps the lighthouse.\n\nShe talks to {{user}} in {{random::short::long}} bursts.",
    personality: "dry",
    scenario: "",
    first_mes: "*{{char}} looks up.*",
    alternate_greetings: ["Hello, {{user}}."],
    mes_example: "This line rides along.\n{{user}}: hi\n{{char}}: hey\nsecond line\n<START>\n{{char}}: alone",
    extensions: { depth_prompt: {}, talkativeness: "0.5" },
    character_book: {
      entries: [
        {
          keys: ["storm"],
          secondary_keys: ["night"],
          selective: true,
          content: "Storm lore.",
          insertion_order: 50,
          comment: "storm",
          extensions: { position: 1, selectiveLogic: 3 },
        },
        {
          keys: [],
          content: "World frame.",
          constant: true,
          insertion_order: 100,
          comment: "frame",
          position: "before_char",
        },
        {
          keys: ["{{char}}"],
          content: "Low order first.",
          constant: true,
          insertion_order: 10,
          comment: "early",
          position: "before_char",
        },
        {
          keys: ["ship"],
          content: "At depth.",
          insertion_order: 5,
          comment: "ship",
          extensions: { position: 4, depth: 2, role: 1 },
        },
        { keys: ["old"], content: "Off.", enabled: false, insertion_order: 1, comment: "old" },
      ],
    },
  },
}

// A minimal PNG: signature, IHDR, one tEXt chunk keyed `chara` (base64 JSON), IEND. CRCs are zero: the tool does not
// validate them.
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  return out
}
const png = Buffer.concat([
  Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", new Uint8Array(13)),
  chunk("tEXt", Buffer.from(`chara\0${Buffer.from(JSON.stringify(card)).toString("base64")}`, "latin1")),
  chunk("IEND", new Uint8Array(0)),
])

const fromPng = unroll(parseCard(png), "Bo")
assert.deepEqual(fromPng, unroll(parseCard(Buffer.from(JSON.stringify(card))), "Bo"))
const u = fromPng

// Assembly order: before_char by insertion_order, card fields, after_char, examples, greetings, depth entries.
assert.deepEqual(
  u.blocks.map((b) => b.heading),
  [
    "before_char · early (constant, order 10)",
    "before_char · frame (constant, order 100)",
    "description",
    "personality",
    "after_char · storm (selective, order 50)",
    "mes_example 1",
    "mes_example 2",
    "first_mes",
    "alternate_greetings[0]",
    "at_depth 2 user · ship (selective, order 5)",
  ],
)
assert.equal(u.blocks.find((b) => b.kind === "first_mes")!.text, "*Ann looks up.*")
assert.equal(u.blocks.find((b) => b.kind === "alternate_greetings[0]")!.text, "Hello, Bo.")

// mes_example: forced <START>, speakers by `name:`, the pre-speaker line rides into the first message.
assert.equal(u.blocks[5]!.text, "example_user: This line rides along.\n hi\nexample_assistant: hey\nsecond line")
assert.equal(u.blocks[6]!.text, "example_assistant: alone")
assert.deepEqual(examples("no speakers here", "U", "C"), [[]])

// Triggers: selective entries only, in insertion_order; logic shown when secondary keys apply.
assert.deepEqual(u.triggers, [
  { name: "ship", order: 5, keys: ["ship"], secondary: [] },
  { name: "storm", order: 50, keys: ["storm"], secondary: ["night"], logic: "AND_ALL" },
])
assert.deepEqual(
  u.disabled.map((b) => b.heading),
  ["before_char · old (selective, order 1)"],
)
assert.deepEqual(u.macros, ["{{random::short::long}}"])
assert.deepEqual(u.extensions, ["depth_prompt", "talkativeness"])

// Markdown: every block is one paragraph (the sort hand-off splits on blank lines).
const md = markdown(u)
const paragraphs = md.split(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/)
assert.ok(
  paragraphs.includes("## description\nAnn keeps the lighthouse.\nShe talks to Bo in {{random::short::long}} bursts."),
)
assert.ok(
  paragraphs.includes("## triggers\n- ship (order 5): ship\n- storm (order 50): storm; secondary night (AND_ALL)"),
)
assert.equal(paragraphs.at(-1), "not expanded: {{random::short::long}}")
assert.throws(() => unroll({ name: "v1" }), /V1/)
console.log("unroll ok")
