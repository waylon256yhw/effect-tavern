// What a text costs the model, estimated from its characters: a readout a card page or a composer can show with no
// tokenizer in the loop. The weights are Claude's, measured once with Anthropic's count_tokens on the template cards
// (Haiku 5.5, 2026-10-24): Chinese prose 1.21 tokens per character (理's opening 1129 for 932, 盐道's fiction 339 for
// 280, 伴星's opening 692 for 580), English prose 0.30 (390 for 1284); so a Han character or CJK punctuation counts
// 1.25 and anything else, spaces included, 0.3 (理's half-YAML fragment, 1154 Han and 693 other: 1650 estimated,
// 1616 counted). An exact count is a connection's capability (Anthropic and Gemini have an endpoint), to stand in for
// this where it exists.
const CJK = /\p{Script=Han}|[　-〿＀-￯]/u
export const tokens = (text: string): number => {
  let n = 0
  for (const ch of text) n += CJK.test(ch) ? 1.25 : 0.3
  return Math.round(n)
}
