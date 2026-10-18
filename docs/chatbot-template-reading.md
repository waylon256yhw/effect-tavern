# 读 shadcn 的 chatbot-template：作为玩家客户端的骨架

读的是 `shadcn-ui/chatbot-template`（2026-10-15，4226 行，Next.js + AI SDK `useChat` + shadcn/ui、`@shadcn/react` 的 message-scroller、shadcn/typeset）。与 `docs/deckled-workbench-reading.md` 对照：Deckled 是我们自己做的、为 agent 工作面高度风格化的解；这份是这个门类最通用的最小实现。Deckled 在 2026-08 读过它的前一版（`frontend-phase1-scope-research.md` §7），那次读出的"三处独立收敛"（工具文案是进行时 / 完成时一对；本条消息的附件是输入框内一排 chip；工具调用不是盒子）在这一版里都还成立。

## 0. 高度

**它是对的骨架，不是对的皮。** 页面是一根竖列：顶栏、`flex-1` 的滚动区、底部 composer 坞。滚动区是 message-scroller（用户轮作锚点、不默认跟随、回到最新按钮），每条消息一个 `Message` 槽（content 加 footer），assistant 消息按 `part.type` 派发到组件，composer 是 `InputGroup`（textarea 加一行底部控件，发送 / 停止同槽）。这一层是聊天机器人这个门类被反复验证过的产品形状，由做产品的人维护，取它意味着第一页带着门类惯例而不是检查器惯例。

**砍掉 agent 能力后剩下约六百行**：`chat.tsx`、`chat-message.tsx`、`prompt-form.tsx`、`message-actions.tsx`、`ui/message*`、`ui/trace`、`ui/input-group`、`ui/bubble`、`typeset.css`。砍的是 `tools/`、`parts/` 里除 text 以外的、问卷卡、来源抽屉、模型选择、`api/route.ts`、Next 本身（`layout` / `page` / 字体 / `next-themes`，都很薄；组件层是纯 React 加 Tailwind，`shadcn` CLI 在 Vite 上照样用）。

**砍完仍然错位的四处，每处是一个设计决定，不是机械删除：**

1. **用户气泡。** `Bubble align="end" variant="muted"`，右对齐、80% 宽、灰底。act 回合或许可以是一个安静的块，但 aside 回合（对叙事者的指示，不进历史）和没有 persona 的大世界卡，气泡的"两个说话者"预设就是错的。
2. **渲染模型。** `useChat` 的 `UIMessage[]` 不是我们的。事件是 `stage` / `delta` / `call` / `node`，store 按 Deckled 那份 reducer 的形状自己写（seq、不可变替换、按动画帧合并）。模板里值得留的是 `chat-message.tsx` 那个 `switch (part.type)`：它就是 Deckled 当年说的"派发接缝决定所有卡片的签名"，我们用它派发节点的两张脸：正文、状态、揭示、产物、选项。
3. **兄弟节点。** 模板只有"对最后一条重试"，没有兄弟导航。要在 `MessageFooter` 加 `2/3` 与左右切换，切换的是从这里往下的整条阅读线。
4. **状态面板。** 没有。卡声明了字段才出现，归我们。

## 1. 直接能用的

| 东西 | 在哪 | 为什么对 |
| --- | --- | --- |
| 页面骨架 | `app/layout.tsx` 的 `h-svh` 竖列，`chat.tsx` 的 scroller `flex-1` 加 composer 坞 | 手机上就是这个形状 |
| message-scroller | `ui/message-scroller.tsx`，`@shadcn/react` | 锚点、跟随、回到最新一套；`Item` 自带 `content-visibility: auto` 加 `contain-intrinsic-size: auto 10rem`，这是 Deckled 没做的长会话缓解，五百节点的起点 |
| 等待的样子 | `chat.tsx` 在 `submitted` 态挂一个 "Thinking" 的 `Trace` 行 | 我们的 lookup / decide 几秒空白正好填这个位：每个 `stage` 事件一行进行时文案，`call` 到了换完成时 |
| Trace 原语 | `ui/trace.tsx`：一行图标加标题加说明，可折叠，running 态 shimmer | "一个容器容纳多种行"；节点的第二张脸（读了什么、结算了什么、揭示了什么、记了几条）天然是这种行 |
| 操作条 | `message-actions.tsx`：footer 里 copy / retry，流式中不显示 | 对应 copy / reword / swipe，常驻在脚，不靠 hover |
| composer 壳 | `ui/input-group.tsx` 加 `prompt-form.tsx` | textarea 在上、控件行在下、发送 / 停止同槽；通道切换与选项 chip 放控件行 |
| 空态建议 | `suggestions.tsx`：一排按钮，点了就发 | 就是选项 chip 的形状；开局时放开场，之后放节点的 `options` |
| typeset | `app/typeset.css`，shadcn/typeset | 正文 15px、行高 1.75、48rem 以下字号自动放大；手机优先 |
| 主题 | `globals.css` 的 shadcn 中性 oklch 词表 | 零决定的起点，品牌色以后再上 |

## 2. 要换的

- **键盘。** `prompt-form.tsx` 只看 `nativeEvent.isComposing`，没有 `keyCode 229`、没有 WebKit 在确认候选的 Enter 之前就发 compositionend 的处理。换成 Deckled 的 72 行控制器。
- **markdown。** `react-markdown` 加 `remark-gfm`，没有 CJK 插件，每个 delta 整段重解析。换成自家的子集渲染器（段落、动作斜体、对白引号），`TextPart` 一个文件的事；CJK 标点紧贴强调的用例表当测试。
- **`useChat`** 换自家 store；`regenerate` 换 swipe；`QuestionCard` 的"钉在滚动区底部"这个位置留给将来的读数问题或 demand 结果，组件本身不要。

## 3. 对客户端设计的要求

模板给了骨架，要设计的是三个增量：用户回合的形状（act 块、aside 行、无 persona 时的指示）；第二张脸住在哪（Trace 行内联在正文下，还是侧栏，还是点开）；兄弟节点的切换。Deckled 的教训是骨架级的决定在真页面上定，mock 上的 A/B 误导过一次。所以顺序是：模板骨架加我们的数据先立起来，三个增量在真页面上做 bake-off。

依赖面：React 19、Tailwind v4 加 `shadcn/tailwind.css`、`@base-ui/react`、`cva`、`@shadcn/react`、lucide。全 MIT。采用它等于定下 React 加 Vite，与 Deckled 那份读出的结论一致。
