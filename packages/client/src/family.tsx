// A model's family glyph, from its id: Deckled's pattern (apps/website/src/view/family-glyph.tsx, one owner table, mono
// at the secondary ink, no brand colour, a cube for the unknown), on LobeHub's mono SVGs (MIT, @lobehub/icons-static-svg,
// `~icons/lobe/<slug>` in vite.config.ts). Matched against the whole lowercased id, so an owner prefix
// ("deepseek-ai/DeepSeek-V3", "anthropic/claude-3.7-sonnet") counts; the first match wins. Only the slugs named here
// are read into the bundle.
import Baichuan from "~icons/lobe/baichuan"
import Claude from "~icons/lobe/claude"
import Cohere from "~icons/lobe/cohere"
import Deepseek from "~icons/lobe/deepseek"
import Doubao from "~icons/lobe/doubao"
import Gemini from "~icons/lobe/gemini"
import Grok from "~icons/lobe/grok"
import Hunyuan from "~icons/lobe/hunyuan"
import Internlm from "~icons/lobe/internlm"
import Kimi from "~icons/lobe/kimi"
import Meta from "~icons/lobe/meta"
import Microsoft from "~icons/lobe/microsoft"
import Minimax from "~icons/lobe/minimax"
import Mistral from "~icons/lobe/mistral"
import Nova from "~icons/lobe/nova"
import Nvidia from "~icons/lobe/nvidia"
import Openai from "~icons/lobe/openai"
import Qwen from "~icons/lobe/qwen"
import Rwkv from "~icons/lobe/rwkv"
import Sensenova from "~icons/lobe/sensenova"
import Spark from "~icons/lobe/spark"
import Stepfun from "~icons/lobe/stepfun"
import Wenxin from "~icons/lobe/wenxin"
import Xiaomimimo from "~icons/lobe/xiaomimimo"
import Yi from "~icons/lobe/yi"
import Zhipu from "~icons/lobe/zhipu"
import Cube from "~icons/ph/cube"
import { Dynamic } from "@solidjs/web"

type Glyph = typeof Cube
const FAMILIES: [RegExp, Glyph][] = [
  [/claude/, Claude],
  [/gpt|chatgpt|^o[1-9]|\/o[1-9]|davinci|codex/, Openai],
  [/gemini|gemma/, Gemini],
  [/deepseek/, Deepseek],
  [/qwen|qwq|qvq/, Qwen],
  [/llama/, Meta],
  [/mistral|mixtral|codestral|magistral|ministral|pixtral/, Mistral],
  [/grok/, Grok],
  [/kimi|moonshot/, Kimi],
  [/glm|zhipu|z-ai|zai/, Zhipu],
  [/minimax/, Minimax],
  [/doubao/, Doubao],
  [/hunyuan/, Hunyuan],
  [/^yi-|\/yi-/, Yi],
  [/step-/, Stepfun],
  [/baichuan/, Baichuan],
  [/command/, Cohere],
  [/spark/, Spark],
  [/ernie|wenxin/, Wenxin],
  [/nemotron/, Nvidia],
  [/phi-/, Microsoft],
  [/internlm/, Internlm],
  [/sensechat/, Sensenova],
  [/mimo/, Xiaomimimo],
  [/nova/, Nova],
  [/rwkv/, Rwkv],
]
export const familyGlyph = (id: string): Glyph => {
  const s = id.toLowerCase()
  return FAMILIES.find(([re]) => re.test(s))?.[1] ?? Cube
}
/** The glyph in its slot: decorative, the id beside it says the same. */
export const Family = (props: { id: string }) => (
  <span class="family" aria-hidden="true">
    <Dynamic component={familyGlyph(props.id)} />
  </span>
)
