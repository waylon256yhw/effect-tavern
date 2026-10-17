# 读 provider 层记录：SillyTavern、API Hub、Deckled，以及 `effect/ai`

2026-10-17。写 demo 之前先把 provider 层想清楚。读了四样东西：SillyTavern 原版的 provider 层（`src/endpoints/backends/chat-completions.js`、`src/prompt-converters.js`、`public/scripts/openai.js`）；我们给它打的补丁 SillyTavern-ApiHub（`index.js`、`url-utils.js`、`secret-*.js`、`docs/debug.md`）；同级项目 Deckled 的协议层（`apps/server/src/providers/`、`packages/protocol/`、`notes/PROVIDER-LAYER*.md`、`docs/adr/`、`docs/known-issues/`）；以及 Effect 4 自带的 `effect/ai` 模块与它的官方 provider 包（`@effect/ai-anthropic`、`@effect/ai-openai`、`@effect/ai-openrouter`，均为 4.0.5）。

读的目的和前几份一样：前两样暴露的是真实的接入诉求与真实的失败；Deckled 是我们自己在另一个项目里对同一问题的一次回答，它的架子是本项目需要的超集；`effect/ai` 是本仓库自检里暂用的接口，读它是为了确认要不要留。结论在第 6 节：用 ai-sdk，取 Deckled 的架子，`effect/ai` 退出。

## 1. SillyTavern 的 provider 层是什么

**它没有 provider 抽象。** "provider" 是一个字符串 `chat_completion_source`，26 个取值（`src/constants.js:187-214`）。两条大 switch 链按它分支：浏览器端的 `createGenerationParameters`（`openai.js:2691-3127`）组请求，服务端的 `/generate`（`chat-completions.js:2259-2597`）发请求。端点、密钥、模型、采样、消息形状、流解析全部挂在这个字符串或模型名正则上。

配置不是"每个连接一条记录"，而是摊平的全局字段：

- 模型：每个 source 一个字段（`claude_model`、`google_model`、`custom_model`……），26 分支的 `getChatCompletionModel` 选用（`openai.js:1722-1782`）。
- 端点：硬编码常量；覆盖只能靠一个全局 `reverse_proxy` 加 `proxy_password`，且只对 9 个 source 生效（`openai.js:2739-2749`）；`custom` 有自己的 `custom_url`。设了 `reverse_proxy` 就跳过密钥库，把 `proxy_password` 明文当密钥发（`chat-completions.js:232, 477`）。
- 自定义 header / body：YAML 字符串，只对 `custom` 生效（`chat-completions.js:2409-2410, 2671-2673`），YAML 解析错误静默吞掉。Claude、Gemini 没有任何 header / body 覆盖。
- preset 携带连接字段：`settingsToUpdate`（`openai.js:305-409`）的第四个元组位标记"这是连接字段"，`bind_preset_to_connection` 默认开，套一个 preset 会顺手改 source、URL、模型。

消息转换按协议各写一份：`convertClaudeMessages`（`prompt-converters.js:197-376`）、`convertGooglePrompt`（`:432-623`），OpenAI 系原样透传加可选的"合并同角色"后处理（`:827-954`，合并时把图片换成随机 token 再换回来）。里面值得记的几条：

- system 的处理三家三样：Claude 把开头的 system 收进 `system[]`，后面的 system 转 user，空了塞一句 `"Let's get started."`；Gemini 收进 `system_instruction`；OpenAI 系原样。
- 前缀续写（prefill）：Claude 把尾随 assistant 消息 `trimEnd()` 后直接发；开了 thinking 或模型在"不能 prefill"正则表里时，把它改成 user 角色发出去（`chat-completions.js:393-395`）。DeepSeek 用 `prefix` 标志、Moonshot 用 `partial`、Mistral 要配置开关，均要求请求里没有工具。Gemini 尾随 model 轮即前缀，个别 flash 型号要转 user。
- 缓存：只有 Anthropic，只在 `config.yaml` 全局配（`enableSystemPromptCache`、`cachingAtDepth`、`extendedTTL`），不按请求。断点打在最后一个 system 块与最后一个工具上，`cachingAtDepth` 跳过尾随 assistant（prefill）后在深度 N 与 N+2 的角色切换处打（`prompt-converters.js:985-1011`）。Gemini 的 `cachedContent` 整个代码库里不存在。
- 结构化输出：OpenAI 系 `response_format: json_schema`；Moonshot / ZAI / SiliconFlow 退化成 `json_object` 加一条 user 消息贴 schema；Gemini `responseSchema`；Claude 强制工具 `tool_choice: {type:'tool'}`。没有任何东西阻止 Claude 同时设强制工具与 thinking。
- 流：服务端不解析 SSE，`forwardFetchResponse` 把上游字节原样管给浏览器，浏览器按 source 各写一段解析（`openai.js:3222-3306`）。**usage 从不解析**，没有 `stream_options.include_usage`，命中率这种事在 ST 里不可见。中止在两跳上都能工作。
- 采样参数：约 250 行手写的按 source、按模型名的删改与夹值（`openai.js:2872-3120`），服务端再删一轮。用户可见的排除只有 `custom_exclude_body` 这个 YAML。

**URL 没有归一化，三套规则并存**：Claude / OpenAI 在用户 URL 后拼路径（用户必须自带 `/v1`，裸域名会拼出 `//messages`）；Gemini 自己拼 `/{apiVersion}/models/...`（用户带了 `/v1beta` 就翻倍），密钥走 query string，经代理也走；`custom` 原样使用。

## 2. API Hub 做了什么，被什么逼的

它是纯浏览器扩展，把 26 个 source 压成三种**协议**：OpenAI Compatible → `custom`，Anthropic → `claude`，Gemini → `makersuite`（`index.js:32-36`）。一个连接是 `{format, endpoint, 密钥, model, availableModels, excludeBody, preset, regexPreset, promptPostProcessing}`（`:252-267`）。激活连接就是把这些字段写回 ST 的全局（`syncConnectionRuntime`，`:416-465`）。

它的代码大半花在对抗 ST，每一处都指向一个 ST 的缺陷：

| 缺陷 | ApiHub 的对策 |
|---|---|
| 运行时是一个可变全局，preset、切 source、保存模型列表都会改它，出错后下一个请求可能发到另一个 source（`docs/debug.md:1-38`） | 在 `GENERATION_STARTED` 时比对 source、模型、URL、密钥 id、`proxy_password`，不一致就重写一遍（`:363-410`） |
| source 与模型是两个设置，source 漂移后改模型无效 | 触发 source `change` 之前与之后各设一次模型（`:427-459`） |
| 一个连接 = source + 单个全局代理；代理密钥是明文设置 | Anthropic 与 Gemini 走"代理"路径，明文密钥抄进 `proxy_password`，因此要求 `allowKeysExposure`（`:189-191`） |
| 没有 URL 归一化 | `normalizeUrl`：去尾斜杠，不以协议版本结尾就补 `/v1` 或 `/v1beta`，末尾 `#` 为直连不补（`url-utils.js:83-106`）。它自己也不自洽：预览会剥掉 `/v1beta`，运行时只去斜杠，实际发出时仍会翻倍 |
| `/status` 没有 Claude 分支，Gemini 列模型只能走 UI 的 Connect | Anthropic 当成 OpenAI 兼容去拉 `/v1/models`（先把密钥抄进 custom 的密钥槽）；官方 Gemini 点原生按钮，每 300ms 轮询 DOM 文本 15 秒再抓 `<select>`（`:919-957`） |
| body 定制只有 custom 且是 YAML | 五个勾选框，在 `CHAT_COMPLETION_SETTINGS_READY` 上从 `generate_data` 删键（`:490-502`）；只能删 ST 从 body 抄过去的键，删不掉后端自己加的（`safetySettings`、`thinking`、`stop_sequences`） |
| preset 携带连接字段 | 先套 preset 再写连接，等 `OAI_PRESET_CHANGED_AFTER` 五秒超时（`:535-569, 756-759`） |

读出来的正面结论只有一条：**三种协议视角是对的。** 用户面对的不是 26 个厂商，是三种线上格式加任意端点。

## 3. Deckled 的协议层

Deckled 走的是 Vercel ai-sdk 加 Mastra，Effect 只管服务组合、取消与 wire 校验。"魔改"不是补丁包，四个 `@ai-sdk/*` 钉死精确版本，所有改动是未修改工厂外面的包装。

有用的部分，按与本项目的相关性：

- **格式 → 工厂的表**（`compiler.ts:307-314, 566-586`）：`openai-completions`、`openai-responses`、`anthropic-messages`、`google` 四种，比 ApiHub 多一种 Responses。每种格式有默认路径（`/v1` 或 `/v1beta`）与操作路径；`normalizeProviderEndpoint`（`packages/protocol/src/provider-url.ts:89-122`）拒绝 userinfo、fragment、非 http(s)、query（Gemini 的 `?alt=sse` 除外），把用户粘贴的完整操作路径剥回前缀，区分"格式默认"（裸 origin）与"精确前缀"。背景是 Anthropic 官方 SDK 自动拼 `/v1` 而 OpenAI 的不拼，`/v1/v1/messages` 一类错误由此而来。
- **每次运行用不可变的配置快照**（ADR-0004）：profile 的 revision 是配置加密钥的 sha256，换密钥即换 revision；设置改动只影响之后的运行。环境变量刻意不作为密钥来源，因为会让请求静默发错地方。
- **推理强度是一条五档的统一刻度**（`off|low|medium|high|max`），按格式翻译（`reasoning-effort.ts:113-162`）：Anthropic 是 `thinking:{type:"adaptive"}` 加 `effort`；Responses 是 `reasoningEffort`；Gemini 是 `thinkingBudget` 的 0 / 2048 / 8192 / 24576 / 32768 并按目录夹值。`off` 只在模型声明了 off 值时发，因为 DeepSeek 对 `reasoning_effort:"none"` 返回 400。
- **Anthropic 缓存**：顶层注入一个 `cacheControl: {type:"ephemeral", ttl:"5m"}`，不打块级断点（`:188-214`）；选 5m 是因为 1h 的写入按 2 倍计费。
- **冻结的对话前缀**（ADR-0014，`agent/prefix.ts`）：Anthropic 的 thinking 块与它生成时的 `system + tools + 之前消息` 绑定，换前缀重放就是 400；所以第一次请求的 system 字节级冻结重放，指令或工具变化记为边界，边界之前的签名推理从出站副本里剥掉，遇到 `Invalid signature` 设边界重试一次。
- **请求追踪**（`request-trace.ts`）：包装工厂的 `fetch`，记 `request / response / stream-first-byte / stream-end` 四个阶段，敏感 header 与密钥值按正则与精确匹配脱敏，默认只记元数据（字节数、sha256、消息数），`body` 模式记转换后的完整 body。它看不到流的内容，所以无法从追踪核对用量。
- **wire 协议**（`packages/protocol/src/schema.ts`）：parts 模型（`step-start / text / reasoning / tool / attachment`），`conversation.snapshot {entries, liveRun, seq}` 加带 `seq` 的增量（`entry.text.delta` 等），客户端丢弃 `seq <= lastSeq` 的帧，重连先快照再重放缓冲。原始工具参数与结果从不上 wire。浏览器有意打包了 Effect Schema（ADR-0010）：`export *` 早已把它带进来了，手写守卫没省下任何东西。
- 记在 known-issues 里的坑：Mastra 丢了连续工具调用后请求以 assistant 文本结尾，Anthropic 返回 400 "does not support assistant message prefill"，OpenAI 兼容网关则昂贵地循环；Mastra 的 `usage_update` 是按 step 不是累计；Anthropic 的 `input_tokens` 只算未命中部分，ai-sdk 归一成 `inputTokens {total, noCache, cacheRead, cacheWrite}`；目录列了的模型端点不一定提供（网关 404）；转售模型的 `reasoning_options` 三百多个名字不一致。

与本项目不同的前提：Deckled 是 agent 循环，模型掌握工具与多步，所以前缀冻结、签名重放、工具结果里的媒体、`maxSteps` 这些问题都是它的核心问题。下一节会看到，这些在分阶段回合模型里大多消失。

## 4. `effect/ai` 已经有什么

本仓库的 `effect@4.0.0` 自带 `effect/ai`：`LanguageModel`（`generateText` / `generateObject` / `streamText`）、`Prompt`（system / user / assistant / tool 四种消息，part 为 text / reasoning / file / tool-call / tool-result，每条消息与每个 part 带按 provider 键的 `options` 记录）、`Response`（流式 part：`text-start/delta/end`、`reasoning-*`、`tool-params-*`、`finish` 带 `usage {inputTokens:{total, uncached, cacheRead, cacheWrite}, outputTokens}`）、`Model`（`ProviderName` / `ModelName` 服务）、`Tool` / `Toolkit`、`AnthropicStructuredOutput` / `OpenAiStructuredOutput`（把 Schema 改写成各家接受的 JSON Schema 子集）、`Tokenizer`、`Telemetry`、`Chat`。`LanguageModel.make` 只要求两个钩子：`generateText(ProviderOptions) → Effect<PartEncoded[]>` 与 `streamText(ProviderOptions) → Stream<StreamPartEncoded>`，`ProviderOptions` 已把 prompt、tools、toolChoice、responseFormat（`text` 或 `{json, objectName, schema}`）、span 归一好。`test/loop.ts` 里的假模型就是这样写的。

官方 provider 包（4.0.5，peer `effect ^4.0.5`，本仓库钉在 4.0.0，升级 diff 只有 `ProviderOptions.toolCallValidation` 与一个类型别名）：

| 线上格式 | 包 | 事实 |
|---|---|---|
| Anthropic Messages | `@effect/ai-anthropic` | 完整。`apiUrl` 可换（默认 `https://api.anthropic.com`，自己拼 `/v1/messages`，所以用户给裸 origin）。`cache_control` 从消息或 part 的 `options.anthropic.cacheControl` 读，system / user / tool-result 都打，assistant 块上是 TODO。`thinking` 与 `output_config.effort` 走 `Config`。尾随 assistant 自动 `trim()`（Anthropic 拒绝尾随空白），即前缀续写可用。结构化输出：模型支持就走原生 `output_config` json_schema 加 beta 头，否则退化成强制工具。mid-conversation system 消息按能力表处理。`transformClient` 可包 HttpClient |
| OpenAI Responses | `@effect/ai-openai` | 只有 `/responses`，**没有 chat/completions**。`prompt_cache_key`、`reasoning.effort`、`previous_response_id` 都有 |
| OpenAI 兼容 chat/completions | 没有官方包；`@effect/ai-openrouter` 发的就是 `POST {apiUrl}/chat/completions`，`apiUrl` 可换，`HTTP-Referer` / `X-Title` 不设就不发 | 消息、`cache_control`、`response_format: json_schema`、流式 `usage` 都齐。读 `delta.reasoning` 与 `reasoning_details`，**不读 `reasoning_content`**（DeepSeek 与多数国内中转的字段），后果只是推理文本不显示。OpenRouter 专有字段（`models`、`plugins`、`provider`）不设就不发 |
| Gemini generateContent | **没有 v4 包**（`@effect/ai-google` 停在 0.16，peer effect 3） | 要自己写：`Prompt → contents + systemInstruction`、`responseSchema`、`thinkingConfig`、`alt=sse` 流、`usageMetadata.cachedContentTokenCount → cacheRead`。Deckled 的 `@ai-sdk/google` 可作形状参照 |

## 5. 审视：去掉 provider 层，分阶段回合模型里什么会坏

按回合骨架逐个阶段问，harness 对 provider 的全部要求只有这些：

1. **工具是有的，但每个阶段都是强制单次调用。** README 第一节已定：工具是能力的单位（名字、输入 schema、输出 schema、处理函数），阶段是 harness 对工具的一次调用方式，默认强制单个、一轮结束。lookup 强制调 `read_lore`，decide 强制调 `act`，record 强制答选择题。`test/loop.ts` 目前把这些全写成 `generateObject(schema)`，在线上这与"强制一个工具"是同一个请求：Anthropic 的结构化输出就是强制工具或 `output_config`，OpenAI 系是 `json_schema`。所以 provider 层要的是**工具定义加 `toolChoice` 强制到指定工具**，以及等价的 JSON schema 输出；模型在多个工具里挑、调完再来一轮，是方向 7 的开放阶段，按阶段 opt-in，demo 不做。一个线上事实要记住：Anthropic 的强制工具与 thinking 互斥，要让 decide 带推理就得走 `output_config` 的 json_schema 路径而不是强制工具，这是连接能力 `structured` 要区分的原因。
2. **narrate** 要 `generateText` / `streamText`，不带工具；截断时以部分正文为尾随 assistant 再问一次。这要求 provider **接受尾随 assistant 消息**（前缀续写）。能力因格式与模型而异：Anthropic 可（开 thinking 则不可），Gemini 多数可，OpenAI Responses 不可，兼容端点看中转。
3. **缓存是基础设施**：头区前缀最大是 harness 的职责。Anthropic 需要显式断点，Gemini 与 OpenAI 系隐式。harness 恰好知道稳定前缀在哪里结束：头区（玩家层 → 卡框架 → 角色）的末尾，以及历史里已折叠前缀的末尾（`folded` 按块移动，块内字节稳定）。所以断点由 harness 打在消息的 provider options 上，adapter 不猜。
4. **用量要可见**：`usage` 里的 cacheRead / cacheWrite 是"缓存是基础设施"这条立场的唯一验证手段，demo 的检查器界面必须把每个请求的用量摆出来。ST 从不解析 usage，这是它永远验不了缓存的原因。
5. **每个阶段可以换回答者**："查找阶段换一个便宜的回答者"已写进 README。所以 provider 层的单位不是"当前连接"，是**连接表 + 阶段到连接的绑定**，默认全部指向一个。
6. **推理要送回模型，这是节点存什么的问题。** 普通聊天也需要上一轮的推理在场，不只是 agent 循环。它的代价在 harness 这边：节点上 narrate 的输出不能只是 `prose: string`，要是 parts（text 加 reasoning，reasoning 带 provider 的签名元数据），`narratorHistory` 渲染过去的 assistant 轮时把 reasoning part 一起渲染，是否渲染是连接上的一个开关。三家都能带回去：Anthropic 的 `signature` / `redacted_thinking`、Gemini 的 `thoughtSignature`、兼容端点的 `reasoning_content`，ai-sdk 的 provider 包都已经做了。Deckled 那套冻结前缀与签名边界在这里不需要：我们是单发（one-shot），可以有多个 agent 但没有循环，阶段内不多轮；签名真失效时（头区被玩家改了、前缀折叠移动了）兜底是一次去掉 reasoning parts 的重试，折叠边界之前的推理本来就随折叠消失。
7. **流**：只有 narrate 流。其余是小 JSON，不流。
8. **中止**：Effect 的 fiber 中断到 fetch 的 abort，一个 `AbortController` 接在 `Effect.acquireUseRelease` 上，Deckled 已经这样做。
9. **追踪**：请求本身是日志树的纯函数，不另存；但实际发出的 HTTP body（adapter 转换之后）在调中转时需要能看，工厂的 `fetch` 包一层就是 Deckled 那个 tracer 的位置。

没有坏的、因此不是需求的：ST 的 26 个 source 与按模型名正则删参数（参数不设就不发，不需要黑名单机制）；`squash system`、`continue_nudge`、`continue_postfix`（装配是一种形状，没有多个 system 要挤）；模型列表的 DOM 轮询（列模型是连接的一个可选操作，失败就手填）；preset（已经消失，剩下的采样参数就是连接记录上的字段）；工具结果里的媒体、`maxSteps`、多步重试、前缀冻结（没有循环）。

## 6. 跨文件的规则

1. **provider 层用 Vercel ai-sdk，不用 `effect/ai`，取 Deckled 的架子去掉它为 agent 循环多做的部分。** 理由：这一层是动态的，好用优先，不需要严格 schema；ai-sdk 今天就有四种格式的 provider 包（Gemini 与 openai-compatible 是 `effect/ai` 缺的两种，而兼容端点是主要用法），推理往返、`toolChoice` 强制、`generateObject`、usage 的 cacheRead / cacheWrite 都现成；Deckled 的 URL 规则、快照、追踪可以直接抄。harness 看到的是本项目自己的一个小服务：`object(schema)`、`text`、`stream` 三个方法，返回 Effect / Stream，用 ai-sdk 实现，假模型是第二个实现（或 `ai/test` 的 `MockLanguageModelV4`）。`effect/ai` 的 `Prompt` / `LanguageModel` 从 `test/loop.ts` 退出；`effect` 不必升级。
2. **线上格式四种，不是厂商 N 种**：`anthropic`、`openai-compatible`（chat/completions）、`openai-responses`、`gemini`，一一对应 `@ai-sdk/anthropic`、`@ai-sdk/openai-compatible`、`@ai-sdk/openai` 的 `.responses()`、`@ai-sdk/google`。版本钉死（Deckled 的理由：各工厂拼 URL 的规则不同，升级会移动路径）。没有要写的 adapter。
3. **连接是一条不可变记录**：`{id, format, endpoint, key, model, config, capabilities}`，`config` 是该格式的参数结构，**不设的字段不发**，这就是 ApiHub 五个勾选框与 ST 两百五十行删参数的全部需求。一次回合用启动时拍下的快照，改设置只影响下一回合（Deckled ADR-0004）。密钥不从环境变量读。
4. **阶段绑定连接，而不是"当前连接"。** 一张表 `stage → connectionId`，默认全指一个；每个阶段还可以带一份参数覆盖：结构化阶段 temperature 低、推理关；narrate 用连接自己的。这是"请求形状归 harness、采样归 provider 配置"在代码里的位置。
5. **能力在连接上声明，harness 按能力选路**：`prefill`（接受尾随 assistant）、`structured`（原生 schema / 强制工具 / 仅 json_object）、`reasoningBack`（过去轮的推理是否送回）。由格式加模型给默认值，用户可以改，因为中转会撒谎。`prefill: false` 时截断恢复不可用，demo 阶段把它当硬失败并提高 `max_tokens`，不写 ST 那种"转成 user 角色"的兜底。
6. **缓存断点由 harness 打，adapter 只翻译。** 两个位置：头区最后一条消息、折叠前缀最后一条消息，写成消息的 `providerOptions.anthropic.cacheControl`；非 Anthropic 格式忽略它。不用 Deckled 顶层一个 `cacheControl` 的粗粒度做法，因为头区与历史前缀的稳定性不同。
7. **节点存 parts，不存字符串。** narrate 的输出按 ai-sdk 的 part 存（text、reasoning 带 providerMetadata），`prose` 变成派生读取。历史视图渲染 assistant 轮时按连接的 `reasoningBack` 决定带不带 reasoning part。这是规则 1 里"推理要送回"在节点上的落点，也是前端协议里 parts 模型的来源：wire 上的节点就是这些 parts。
8. **URL 规则照 Deckled 的**：用户给前缀，`/v1`（Anthropic、OpenAI 系）或 `/v1beta`（Gemini）是格式默认，粘了操作路径就剥回前缀，拒绝 userinfo / fragment / query；"精确前缀"开关替代 ApiHub 的 `#` 语法。`packages/protocol/src/provider-url.ts` 可以整个搬。
9. **用量必须上检查器**：每个请求记 usage 四个数与 finishReason，和请求形状一起是节点派生视图的一部分。这是验证"缓存是基础设施"的唯一手段，也是 ST 永远做不到的一件事。
10. **追踪一个开关**：包工厂的 `fetch`，默认关，开了记 URL、脱敏 header、body 字节数与 sha256，`body` 模式记完整 body。先 `Effect.log`，不做 NDJSON 文件与四阶段。
11. **推理强度一条刻度**，`off | low | medium | high | max`，按格式翻译（Deckled `reasoning-effort.ts` 的表），`off` 只在模型声明了 off 值时发。

不做的：26 个 source；按模型名正则的参数黑名单；全局 `reverse_proxy` 与明文 `proxy_password`；preset 携带连接；模型列表的 UI 轮询；冻结前缀与签名边界；Mastra；`effect/ai`。

## 7. 原型与实测（2026-10-17）

`packages/provider` 按第 6 节写成：`src/url.ts`（Deckled 的 URL 规则，三种格式）、`src/connection.ts`（连接记录、能力默认值、`compile` 到 ai-sdk 模型、`listModels`、请求追踪）、`src/call.ts`（`object` / `text` / `stream` 三个 Effect 调用、缓存断点、推理刻度、Effect Schema 直接作为 ai-sdk 的 Standard Schema）。`test/url.ts` 是 URL 规则的断言；`test/anthropic.ts` 用真 key 在 Haiku 5.5 上验六件事：列模型、强制 schema、prefill、缓存断点的写与读、签名推理往返、流与中断。全部通过，八个请求。实测改掉或补上的事实：

- **当前的 Claude 全部拒绝 prefill。** Haiku 5.5 对尾随 assistant 消息回 400 "This model does not support assistant message prefill"。ST 的 `noPrefillModel` 正则列的是 opus-4-6、sonnet-4-6、opus-4-7、opus-4-8、Fable、Claude 5 全系；只有 haiku-4-5、opus-4-5、sonnet-4-5 这一代还收。所以 `anthropic` 格式的 `prefill` 默认 false，README 第四节"截断恢复依赖 provider 接受末尾的 assistant 前缀，未验证"现在有了答案：在 Anthropic 上不可用，截断恢复要走别的路（提高 `max_tokens`，或下一轮以"继续"指令重问）。
- **`thinking.type: enabled` 在 Haiku 5.5 上被拒**，只收 `adaptive` 加 `output_config.effort`；adaptive 下模型自己决定要不要想，问题太简单就没有 reasoning part。推理刻度表因此只发 adaptive。
- **签名推理往返成立**：第一轮的 assistant 消息（ai-sdk 的 `response.messages[0]`，reasoning part 带 `signature`）原样放回第二轮，请求体里出现 `thinking` 块，200。这就是节点要存的东西。
- **缓存断点成立**：头区最后一条 system 消息上的 `cacheControl`，第一次 `cacheWrite > 0`，第二次 `cacheRead > 0`。usage 四个数从 ai-sdk 的 `inputTokenDetails` 取。
- **ai 7 默认拒绝消息列表里的 system 消息**（"Use the instructions option instead"），要开 `allowSystemInMessages`。我们的头区与中途送入的 lore 都是 system 消息，这个开关常开。
- **ai 7.0.62 提前取消流的迭代器会留下一个以 `undefined` 拒绝的 promise**，Node 默认把它当崩溃。不取消迭代器：中断只 abort 信号，后台把流排干到 ai-sdk 随后发出的 `abort` part 为止。实测 abort 后约 1.2 秒排干，无悬空 promise。
- **代理是连接上的显式字段，三态。** 起因：本机走系统代理，Node 26 的 fetch 默认不读环境变量里的代理，对 api.anthropic.com 直接 403 "Request not allowed"；Bun 默认读，所以 Deckled 从未遇到。查了一圈现代做法（Node 官方企业网络指南、OpenAI 与 Anthropic 的 TS SDK 文档、Bun / Deno 的 fetch、ai-sdk 的 issue）：运行时层各管各的默认（Bun、Deno 默认读环境，Node 要 `NODE_USE_ENV_PROXY=1` 或 `--use-env-proxy`，v22.21 / v24.5 起），SDK 层一律显式、从不自己读环境（`fetchOptions.dispatcher` / `proxy` / `client`），应用层的单个全局代理（LobeChat `PROXY_URL`、ST `requestProxy`）是老形状。所以 `Connection.proxy` 照 Bun 的三态：不写跟运行时走，`false` 强制直连，URL 显式走它。实现是 undici 的 `ProxyAgent`（或直连的 `Agent`）作 `dispatcher`，必须配 undici 自己的 `fetch`，不能塞给 Node 自带的那个，两份 undici 混用会静默失效；undici 钉 8.x，与 Node 26 自带的同大版本。两个实测教训：undici 的 fetch 不收 Node 全局的 `Request` 对象（"Failed to parse URL from [object Request]"），追踪包装只能透传 `(url, init)`；`listModels` 与生成走同一个 fetch。实测连接把 shell 的 `https_proxy` 显式写进 `proxy`，verify 脚本不再需要 `NODE_USE_ENV_PROXY`。
- Haiku 5.5 列模型走 GET `/v1/models` 加 `x-api-key` 与 `anthropic-version` 即可，Deckled 的"Anthropic auth token 作 bearer"分支保留但未测（本地只有 api key）。

## 8. 回合循环在真模型上跑了四轮（2026-10-17）

`packages/runtime/test/loop.ts` 拆成了 `harness.ts`（循环本体加一张测试卡，模型由 `useModel` 注入）、`loop.ts`（脚本化模型加断言，不变）、`loop-live.ts`（本机的 Anthropic 连接，四轮，按检查器的样子打印每个阶段的请求、输出、用量）。Haiku 5.5，25 个请求全部 200，11k 输入 2.5k 输出。

跑通之前修的三件事，都是 provider 层之外的：

- **空枚举没有 JSON Schema 类型。** check 阶段在没有开窗时 `fired: Array(Literals([]))` 生成 `{not: {}}`，Anthropic 拒绝。规则：没有选项的问题不问，字段按条件出现在 schema 里。
- **中途的 system 消息只能紧跟 user。** Anthropic 现在收消息列表里的 system（历史里跟在 user 后面的 lore 送入没问题），但本轮的指令尾巴（送入、结果、MUST / MAY、基调、aside）原来放在历史末尾的 assistant 之后，400。改成放在玩家输入之后，三种格式都能接受这个位置，而且指令离生成更近。
- 结构化调用显式给 `maxOutputTokens`，否则 ai-sdk 对它不认识的模型名按 128k 发并逐次告警。

跑出来的判断质量：

- 叙述、record 的 notes、读数（攻击后 warmth 选 cold）、direct 的基调、check 对"B 不死"的遵守，都合理。分层 lore 按设计走：第一轮只拿到第一层，第二轮击中开窗，导演给 must，叙述者揭示"你要找的李就是我"，check 确认 fired。
- **decide 不收敛，已改问法解决。** 第一次跑，四轮里每一轮都把同一拍重复到上限：问李 → talk×4，拔剑 → strike×4（hp 40→20），停手 → talk×4。模型把每次 decide 当成"玩家这句话是什么动作"来答，不把"So far"当已经发生的事，也不选 end。试了三种措辞的"还有下一拍吗"：要么仍然重复到上限，要么把"直到他倒下为止"也砍成一拍，同一个问题换措辞只是在两个方向之间摆。结论是信息不在那个位置：要不要多拍，写在输入的措辞里，第一拍就能读出来；结果之后要不要停，才是每拍一问的事。改法：第一次 decide 多答一个 `again`（输入的措辞是否要求不止一拍），没有就一拍结束、不进循环；有才进 §10.2 的每拍循环，循环里的问题以继续为默认，看结果决定停。`decideSchema` 加了可选的 `again`，自检卡的脚本把"strike B"当两拍。改后两次跑都收敛：单拍输入一次 decide 就结束，"一剑接一剑地砍，直到他倒下为止"四拍到上限（结构化阶段同时固定 temperature 0，设计第 4 条本来就要求）。研究记录第十节选的 D 做法保住了。
- **缓存全零**是预期的：这张测试卡的头区几十个 token，远低于 Anthropic 的最小可缓存前缀，断点打了也不写。要验缓存得用一张真卡。

## 9. 节点存 parts，推理往返在 Anthropic 上撞到块绑定（2026-10-17）

`Turn.prose: string` 改成 `Turn.reply: Part[]`（`text` 与带 `providerOptions` 的 `reasoning`），`prose(t)` 是派生读取；`narratorHistory` 渲染过去的 assistant 轮时带上 parts，是否真的发回去由连接的 `reasoningBack` 决定，在 harness 的 `toP` 一处翻译。provider 的 `text()` 返回 `parts`，不再返回整条 ai-sdk 消息。五个自检与 provider 实测都过。

真连接上开 `reasoningBack` 跑，第二轮 400：

> Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block" (beta `thinking-binding-controls-2026-08-01`). Content before this block differs from when it was created, first at `messages.0.content.1`.

这是 Deckled ADR-0014 遇到的同一件事，但在本项目里它是设计层面的冲突，不是实现细节：Anthropic 把 thinking 块绑定到它生成时之前的全部内容；我们的历史是按阶段重新渲染的视图，本轮的指令尾巴（送入、结果、MUST / MAY、基调、aside、纠正）按 §13.2 不沉淀，下一轮渲染出的前缀必然和生成时不同。Deckled 的办法是冻结第一次请求的前缀字节级重放，这里做不到，也不该做：压缩会移动前缀，头区会随读数的 `when` 片段切换。`drop_block` 也不解决问题，前缀总是不同，块总是被丢。所以 `anthropic` 的 `reasoningBack` 默认 false：节点照存推理（检查器可见、重放可查），不发回。`openai-compatible`（`reasoning_content`，无绑定）与 `gemini`（`thoughtSignature` 只绑函数调用）默认仍开，未在真连接上验。

改后五轮全过，每轮的 reply 里有一个 reasoning part（最后一轮模型没想），请求里 thinking 块为零。这一条要折进 README 的立场：推理往返是按格式的能力，不是 harness 的承诺。

## 10. 两张真卡在循环上跑了（2026-10-17）

`test/live.ts <wuxia|banxing|ri>`：循环本体（`harness.ts`）现在由 `useCard` 注入卡数据（规则、lore），`greet` 放第 0 轮开场节点，三张卡共用同一个打印器。两张真卡的材料从本机读（`~/Downloads/伴星.json`、`~/MagVarUpdate/example`），`test/cards/banxing.ts` 与 `test/cards/ri.ts` 是手做的编译：把作者的东西各放到读卡记录说的位置。

**伴星（纯聊天）。** Note 行进 frame 的 style 槽，其余 description 进角色层，`mes_example` 作为"示范"角色片段（它本来没有槽），`first_mes` 是第 0 轮节点，`creator_notes` 不进提示词，`{{char}}` 替换成角色名而不是作品名。四轮八个请求全 200。叙述在声线上（懒散、害羞、对自己的话做精神分析），用到了卡里的细节（过膝袜、兔耳手机壳、排行榜）。缓存成立：头区 1282 token 第一轮写入，之后每轮读；第四轮折叠边界移动，摘要块写入一次。开场节点没有玩家输入、消息列表以 assistant 开头，Anthropic 接受。

**青空 理（变量加事件）。** 角色信息、NPC、地点是片段；六段好感度 EJS 变成六个带 `when` 的角色片段，头区里只有当前段；好感度是一个带边界的 int 字段，由 record 阶段的读数（六个选项，-5 到 +8）移动；关系是两个布尔；告白事件是一个两层 lore 条目：第一层可读的铺垫，第二层在条件（好感 ≥ 60 且无关系）成立时作为窗口 offer 出去；结果由第二个读数结算（接受 → 恋人，拒绝 → 哥哥）。时间、日期、当前所想、PAD 情绪没有搬，是 `card.ts` 写明的天花板。从"即将表白"的开场（好感 60）跑四轮：lookup 读到第一层 → 窗口开出第二层 → 导演 must 加基调 → 叙述写出告白 → check 确认 fired → 读数 none（她说了，玩家还没答）；第二轮玩家接受 → 读数 accepted → 恋人 true、事件 告白:成功；好感 60 → 63 → 71 → 76 → 81，下一轮头区换到 80–90 那段。十一个请求全 200，头区 8.4k token 一次写入、之后每轮读，总计 2.5 万 token 从缓存读。

三件在跑的过程中学到的：

- **事件型条目要两层。** `offers` 只加深已可见的条目（lore.ts 的设计），一个只有一层、`unlock` 永远为 0 的条目永远不会被 offer。第一次我把它做成单层并让 `unlock` 等于条件，结果 lookup 把它当知识读走了，导演没有参与；改成"可读铺垫 + 开窗指令"两层之后，才走了导演的路。这条该写进卡协议：事件就是 lore 的第二层。
- **玩家层缺视角槽位。** 没有它，Haiku 替玩家回答了告白（输入说"我也一样"，叙述写成"需要认真考虑"），读数于是三轮都是 none。加一条玩家全局片段"不替玩家说话、不替玩家做决定"后一次通过。这不是魔咒，是 README 第二节说的"语言、视角、文风归玩家层"里的视角。
- **record 的提问要说清 notes 是什么。** 原来的问法让 Haiku 写文学评语（"场景描写细腻，可作为参考"）并把 Known 整段抄回来；改成"只记这一幕新确立的事实，短句，不重复 Known，不评论写作"后是事实了，但第四轮仍会把 Known 里的几条改写一遍再交。压缩的来源是 notes，这个重复要在折叠时去重或在问法上再收。

另有两处是模型的事，先记下：narrate 对大卡会写到 700 token 被截断，Anthropic 上没有 prefill 恢复，live 把上限放到 1200；叙述者把"新来的牧师"当成了养父罗伦斯，是卡本身的歧义（NPC 信息说罗伦斯抚养了理，开场白又让玩家是新牧师）。
