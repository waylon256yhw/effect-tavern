# 读 RisuAI：跳出酒馆生态的同类，前后端一起看

2026-10-19。读的是 `kwaroran/RisuAI`，`main` e773240（2026-10-17），版本号 2026.8.250。Svelte 5.56 + Vite 8 + Tailwind 4 + Tauri 2，`src/` 12.3 万行（`ts/` 7.4 万行逻辑，`lib/` 3.7 万行组件），30 个测试文件。作者是 CCv3 卡规范的起草人，韩语社区出身，2023 年起做到现在。方法同前几份：四个 agent 分片读源码（回合管线、数据模型与存储、聊天界面、扩展面），我读 README / AGENTS.md / server 并抽查四条最重的结论（swipe 不落库、流式传累计全文、消息列表手工挂载、输入法只看 `isComposing`），都成立。它是这个门类里**唯一一个带着现代栈、手机优先、不在 ST 代码基上长出来的完整产品**，所以这份读的不只是前端，是把它整个当对照组。

## 0. 高度

**先纠正两个前提。** 一，它没有后端。`server/node/server.cjs` 1591 行 Express 只做三件事：托管 `dist/`、反代模型 API（`/proxy`、`/proxy2`、带 WebSocket 的流式 job）、一个密码保护的文件 KV（`/api/read|write|list|remove`）给同步用；Hono 版是 11 行 hello world。整个 harness（组装、lorebook、记忆、脚本、流式写回）跑在浏览器里，入口是 `process/index.svelte.ts` 的 `sendChat`，一个 2100 行的函数。所以"前后端对标"实际是"它的浏览器内管线对我们的 server 内 session"。二，Svelte 没有给它流式。它的流式路径恰恰是绕开 Svelte 响应式的：provider 每个 chunk 传**累计全文**而不是 delta（`anthropic.ts:823`），默认档每个 chunk 对全文跑一遍正则脚本、覆写 `message.data`、消息列表的 hash 变了就把整个 `Chat` 组件卸了重挂、`ChatBody` 从 markdown-it 到 DOMPurify 全流程重解析；后补的 balanced 档是 125ms 定时器加 rAF 合并，再导出一个命令式的 `updateStreamingDisplay` 就地改文本（`Chat.svelte:96`）；消息列表本身不是 keyed each，是手写 diff 加 `mount` / `unmount` / `insertBefore`（`Chats.svelte:65-167`）。框架在这条路径上既没帮忙也没碍事，决定性能的是"delta 还是全文"和"解析在不在 delta 路径上"。这两点都是 store 设计，与栈无关。

**三堆。**

(a) **结构缺口的兼容补丁**，占逻辑层的大半。病根和 ST 同一个：模型输出是无类型散文，回合没有阶段，历史是扁平数组，没有事件日志。于是：Trigger V2 的一百来种效果（`triggers.ts`，2834 行一个 switch）在扁平指令表上用 `v2If / v2EndIndent` 模拟缩进块，数组和字典序列化进字符串变量；正则脚本的 `@@move_top / @@inject / @@repeat_back` 从散文里抠状态栏；`request` 触发器把整个 prompt 数组 `JSON.stringify` 交给脚本再 `parse` 回来（`request.ts:255`）；lorebook 的三十五个 `@@` 装饰器里 `@@inject_at / inject_replace` 是"模板没有槽位就再发明一种文本补丁"；API 已经给出结构的 thinking 和 tool call 被拍扁成 `<Thoughts>` 和 `<tool_call>idname</tool_call>` 文本再正则还原（`anthropic.ts:268,1181`、`mcp.ts:356`）；`{{setvar}}` 没有事件日志，靠每回合对全部历史重放一遍维持一致（`runCurrentChatFunction`）；lorebook 的跨回合状态塞在聊天变量 `__internal_ka_<id>` 里；分支是复制整条 chat 再插一条 `{{specialcomment::branchedfrom::…}}` 魔法注释消息（`Chat.svelte:930`）；`disabled: 'allBefore'` 用消息字段当上下文截断标记。

(b) **脱离工程实践的部分**：`sendChat` 2100 行，模板 switch 为了先算 token 再真组装复制了两遍；保存是 `while(true){ sleep(500) }` 轮询加一个 `$effect` 里全量 snapshot 触发追踪，每次重写整个 blob 并留 20 份完整副本；`Database` 接口 2603 行，角色上挂七种 TTS 配置；"新消息"按钮有六种摆位，其中一处 title 还是韩文；`reloadKeys` 每个 delta 自增但无人消费；手机键盘高度让用户在 vh / dvh / svh / lvh 里自选；热键靠 `querySelector('.button-icon-reroll').click()`。

(c) **已经做对、值得记的**：v3 插件沙箱（`factory.ts:436-560, 771-923`）是 `sandbox` iframe 加 nonce CSP 加 `connect-src 'none'`，structured-clone RPC，流用 Transferable 桥，权限按脚本 hash 持久化并周期重确认；卡内 CSS 的作用域化走真 AST（`@adobe/css-tools`，每个选择器前缀 `.chattext`、类名加 `x-risu-`、`<style>` 先 hex 封装过 DOMPurify 再解码，`parser.svelte.ts:953-1030`）；`customHTML` 主题把用户 HTML 映射成 Svelte 片段白名单而不是 `@html`；引号先换成 PUA 字符、渲染后变成 `<mark risu-mark="quote1">`，是这个门类对"对白怎么区分"的现成答案；`{#await}` 期间回显上一次解析结果，流式无闪；HypaV3 的摘要用消息 `chatId` 做引用而不是下标，孤儿按集合子集清理；每条消息存 `promptInfo.promptText` 和四阶段耗时，可回看当时实际发出的 prompt；RisuSave 分块只重编码脏块；冷存储写后读回校验再替换；每种用途（主模型、副模型、记忆、情绪、翻译）独立配模型加 fallback 链。

**最大的一个发现：swipe 在 RisuAI 里不是数据。** `Message` 没有 swipes 字段，reroll 是把末尾到上一条 user 的消息 pop 掉重生成，候选只活在 `DefaultChatScreen.svelte:50` 的组件局部变量 `rerolls` 里，换角色即清空；分支是整条复制。也就是说这个门类里最现代的客户端，在我们做成一等公民的那一条轴上比 ST 还弱（ST 至少把 `swipes[]` 存在消息上）。agent-harness-survey §2 已经说过兄弟节点是少数派，这里是第二票。它不改变我们的决定，但把代价说清了：视图必须按路径算，没有现成的参照可抄，Open WebUI 的消息树是仅剩的一个。

**第二个发现：记忆的形态和 harness 组收敛到同一处。** HypaV3 存在 chat 对象上，`summaries[{text, chatMemos, isImportant}]`，模型写、系统存、只在超预算时摘要、原消息不删只是不进上下文；每回合从摘要里按"用户标重要、最近、相似、随机"四桶配额选，相似用 embedding 加 RRF 融合。它要摘要散文是因为没有 record 阶段，和 agent-harness-survey §3 的判断一样。我们的 notes 折叠在这里又得到一次独立复现，零协议改动。

**第三个发现：卡要 UI 的问题，它用"消息里塞 HTML"接，我们用 iframe 接，而它的插件沙箱就是我们那个 iframe。** 卡作者能发出的是 `{{img::}}` 资源、作用域化的 `<style>`、`risu-btn / risu-trigger` 属性（事件委托转成 trigger 或 Lua 的 `onButtonClick`），不能跑 JS。这是在没有视图协议的前提下能做到的上限，代价是每条消息一套 DOM 清洗加 CSS AST 重写。README §五说的"作者 SPA 在 iframe 里跑、只通过有类型的消息协议对话"，`factory.ts` 那九十行 RPC 已经写过一遍了，到时逐行读。

## 1. 回合管线对照

| 阶段 | RisuAI（`process/index.svelte.ts`） | 本项目 |
| --- | --- | --- |
| 发送前 | UI 层直接把用户 `Message` push 进 DB（`DefaultChatScreen.svelte:157-215`），`input` 触发器与 `editinput` 正则先改一遍 | `Input` 是 Action 的一部分，节点在 narrate 之后才生成 |
| 查找 | lorebook 全量 clone，关键词子串匹配（`fullWordMatching` 用 `split(' ')`，对 CJK 无意义），递归无上限，按 `priority` 贪心装预算，每条每回合 tokenize | lookup 阶段：枚举（lore 钩子），闸门状态里的 `since / shown` |
| 决定 | 无。只有 `start` 触发器可 `stopSending` 或 `runLLM` | decide：读数与动作在写之前结算 |
| 组装 | 模板项 `plain / chatML / persona / description / lorebook / memory / chat / cache`，遍历两次；`cachePoint` 打在最近三条 user 上，但前缀每回合都可能变（lore 激活、`{{random}}`、setvar 重放、`request` 触发器） | 卡的 fragment 按 id 装配，前缀稳定是设计目标 |
| 请求 | fallback 模型循环、`reformater` 按模型 flag 折叠 system / 交替角色、thinking 与 tool call 拍扁成文本 | provider 层三种格式，不拍扁 |
| 写回 | 先 push 一条空 `char` 消息，每 chunk 覆写 `data`；中止 `return false`，半截留在消息里但跳过全部后处理，无标记 | delta 事件追加到活动节点；停止产生 `stopped` 节点 |
| 检查 | 无 | check：违规或漏讲重写一稿 |
| 记录 | `output` 触发器可 `sendAIprompt` 整回合重发（递归调 `sendChat`）；自动续写也是递归；`igpPrompt` 结果 `+=` 进消息；情绪分类、图生成各一次调用 | record 是 narrate 之后一次调用，产物带类型 |

二次模型调用点：图片描述、记忆摘要、igp、情绪、auto-suggest、翻译、触发器 `runLLM`、Lua 的三个 LLM 函数、MCP `internal:aiaccess`。每种可配独立模型，这是做对的；但它们没有一个共享的"阶段"概念，各自在 `sendChat` 里找位置插。

结构化输出：有 `jsonSchemaEnabled` 加 `extractJson`，OpenAI 走 `response_format`，Claude 只对返回文本抠 JSON；MCP 工具调用真的接了（Anthropic、Google 都循环执行 `tool_use`），工具来源三合一（模块的远程 SSE 加 OAuth refresh、插件 `registerMCP`、内置 `fs / dice / googlesearch / risuaccess`）。但这些全是旁路，主管线仍是散文加正则。`risuaccess` 让模型改用户的角色卡和脚本，供内置助手 Iris 用；这是"模型写卡"的一个实例，对应我们方向 4 的自然语言到卡数据的编译，只是它让模型直接动数据，没有编译这一步。

## 2. 数据模型对照

`Chat = { message: Message[], note, name, localLore, scriptstate, hypaV3Data, modules, bookmarks, … }`，`Message = { role: 'user' | 'char', data: string, saying?, chatId?, time?, generationInfo?, promptInfo?, disabled?: false | true | 'allBefore', isComment? }`（`database.svelte.ts:1831-1905`）。一切派生状态要么每回合重算（lore 激活），要么塞进 `scriptstate` 字符串字典（变量、lore 的跨回合状态），要么存在 chat 上（记忆摘要）。`chatId` 是事后补的字段，HypaV3 和部分编辑都靠它。

与我们的日志树比：它是"扁平数组加三个口袋"，我们是"不可变节点加派生视图"。它为此付的税和 BaiBai-Book 那份读出的一样：每回合全量重放 setvar、分支整条复制、删除中间一条时其后组件全部重挂（key 含 `idx`）。

持久化：单 blob `database.bin`，`RISUSAVE\0` 魔数加分块，脏块才重编码，整文件重写，20 份备份；后端四选一（账号 HTTP、Node KV、OPFS / IndexedDB、Tauri 文件）共用 `setItem / getItem / keys / removeItem`；冷存储把十天没动的角色和聊天压缩搬走，DB 里留壳。本质是手工分页，在解决"整个 DB 一个 blob"自己造出来的问题。多人同步是 PeerJS 互传 Chat 对象。除本地 zip 外不加密，而本地 zip 的 key 由服务器 GET 下发。

卡格式：CCv3 相对 v2 多 `nickname / group_only_greetings / source / assets[] / creation_date`、lore 的 `use_regex` 与内容内 `@@` 装饰器、charx 容器；Risu 自己的扩展在 `extensions.risuai`（正则、触发器、`defaultVariables`、`backgroundHTML`、`lowLevelAccess`、`onboarding` 等二十余项）。导入时资产落盘换成内部 uri，其余原样塞进 `char.extentions`，`virtualscript` 因安全丢弃。模块（lorebook 加正则加触发器加资产加 MCP）不进卡，是 DB 级对象，启用来源五处合并。

## 3. 聊天界面：能当 spec 用的与不能的

**能当 spec 用的（都很小）：**

- **贴底与分页**：滚动容器 `flex-col-reverse`，scrollTop 为零即底部，流式增长时在底部就自然贴底，负 scrollTop 小于 100 时加载更多；初始 30 条，每次加 15（`chatLoadPages.ts`）。"只有最新一条能 swipe"靠 CSS `first-of-type` 决定，零 JS。这是和"锚点加跟随状态机"相反的另一条路，便宜，但要在 rig 里验它在 iOS Safari 上的 `overflow-anchor` 行为与读屏顺序，再定。
- **对白着色**：引号在 markdown 之前换成 PUA 占位符，渲染后变成 `<mark risu-mark="quote1">`，配可换的 `customQuotes`。中文没有斜体，"动作与对白怎么区分"的门类答案就是这个：标记对白，不标记动作。我们自家的子集渲染器直接按这个做。`.chat-width { word-break: normal; overflow-wrap: anywhere }` 对 CJK 是对的。
- **流式无闪**：`{#await markParsingResult}` 期间 `{@html lastParsed}` 显示上一次结果。
- **解析频率与组件重挂分层**：balanced 档的定时器加 rAF 合并，流中那条从列表 hash 里剔除、命令式就地更新。思路对，实现是补丁；我们的 reducer 本来就按动画帧合并 delta。
- **部分编辑**：hover 块级元素出编辑按钮，渲染后的纯文本用 exact → anchor → fuzzy → bigram 四级匹配回溯到原始 markdown 范围，带置信度（`partialEdit.ts:326-345`）。我们的 `edit` 是整节改，这个是段落级改，值得记一笔，不是现在做。

**不能当 spec 用的（Deckled 那份仍是更好的来源）：**

- **输入法**：全仓库只有 `!e.isComposing` 一道（`DefaultChatScreen.svelte:602`），没有 `keyCode 229`、没有 compositionend 时序处理，翻译输入框连这一道都没有。韩文输入法和中文一样有这个问题，它没解。Deckled 的 72 行控制器仍是唯一值钱的那份代码。
- **手机键盘**：无 visualViewport，用户自选 vh / dvh / svh / lvh。
- **跟随**："在底部 100px 内"一个布尔，新消息到了 700ms 后 `scrollIntoView`，只在消息数增长时触发，不随 delta。没有"读者接管"的状态表。
- **长局**：无虚拟化，无 `content-visibility`；分页加冷存储是它的全部答案。
- **消息的形状**：头像在左、名字行、图标按钮一排、正文；`mobilechat` 气泡主题硬编码浅色。它默认就是聊天，和我们设计稿的"一节一张卡片、没有两个说话者"是两个产品。

**Svelte 5 用法本身**：`DBState = $state({ db })` 一个深代理装整个数据库，组件里到处是 `DBState.db.characters[selId].chats[chatPage].message[idx]` 长链；runes 与 legacy store 并存（`$state` 408 处、`writable` 56 处、`get()` 311 处），`selectedCharID` 是 store 又镜像成 rune；`ReloadGUIPointer` 一类手动失效计数器；`setTimeout(10)` 躲 effect 循环并写了注释承认。这是"整个 DB 一个响应式代理"这条路的终态，与框架无关，React 里用一个巨型 context 会得到同样的东西。我们的 store 是事件 reducer，不会走到这里。

## 4. 对协议与客户端的要求

**协议：零改动。** 四个分片都没有读出我们缺的东西。记忆、分支、阶段、类型化产物四条，它都在用补丁的方式趋近我们已经有的形态。

**客户端，只留下这几条：**

1. 对白用标记而不是斜体区分，是自家渲染器的一条规则，连同 `overflow-wrap: anywhere`。
2. `col-reverse` 贴底加分页进 bake-off，对手是 Deckled 的跟随状态表；在真页面上定，不在 mock 上定。
3. 流式事件保持 delta 语义，解析按段落不按整节；永远不传累计全文。这是它用三档"性能模式"反证的。
4. 写作者视图的 iframe 协议时，先读 `plugins/apiV3/factory.ts` 的 RPC 与权限模型，再读 DOMPurify 加 CSS AST 那一套，知道"不隔离"要付的价。
5. 每节存当时实际发出的请求与阶段耗时（它的 `promptInfo / generationInfo`），我们的 `call` 事件在 inspect 模式下已经有，确认 node 投影里留着。

**对栈的回答。** 这一轮要的证据拿到了：Svelte 既不是它流式顺畅的原因，也不是它卡的原因。RisuAI 是一个证明"栈便宜、store 贵"的样本，和 Deckled 从另一边证明的是同一件事。栈的决定仍按上一轮的说法：读完 OpenCode 的 app 包（事件总线到 store 这一层）后，看哪边能抄到更多对口代码。现在的分数是 React 那边有 IME 控制器、状态表、折叠原语、reducer 四样可搬，Svelte 这边有引号标记和 `col-reverse` 两样可搬且都与框架无关。

**可见的天花板。** 它的 12 万行里 harness 核心（组装、lore、记忆、脚本）约一万行，其余是接入层、设置页、七种 TTS、翻译、本地推理、图生成、VN 模式、插件与模块。核心小、外围大、补丁多，与 agent-harness-survey §4 的读数一致。差别是它没有 OpenClaw 那份事后的 `VISION.md`，也没有一个"该是数据、该是插件、还是该删"的问题可问。
