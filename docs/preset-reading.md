# 读 preset 记录：linux_1.3（终端模拟加工具调用搬运）

2026-10-14。读了一份生态里的 OpenAI 风格 preset（`linux_1.3.json`，215KB，为 Gemini 写），方法同 `card-reading.md`：代码方向（harness 拿它做什么）、语文方向（作者在写什么、对谁说）、本项目的家。只描述结构；松绑类条目按机制一行带过，不评价内容与效果。

依据：ST 本机源码（`~/SillyTavern`，06bde939f）的 `public/scripts/openai.js`（prompt 装配、`squashSystemMessages`、main / jailbreak 的卡覆盖）、`public/script.js`（正则的 prompt 深度）、`extensions/regex/engine.js`（preset 作用域正则、`markdownOnly` / `promptOnly` / 深度窗口）、`src/endpoints/backends/chat-completions.js` 与 `src/prompt-converters.js`（Gemini 的 tools 与 system_instruction 转换）。两个第三方扩展 SPreset 与 Tavern Helper 本机未安装，它们的语义按字段名与脚本源码推断。

## 1. 清单

### 1.1 prompt_order（唯一一份，character_id 100001 即全局默认，26 条）

全部 `injection_position` 0（相对位置），没有任何按深度注入；`forbid_overrides` 全为 false。token 按 CJK 字数/3 加其余字符/4 估算，含宏原文。启用条目合计约 8.1k。

| # | identifier / 名 | role | sys | 类 | 开 | ~tok | 机制 |
|---|---|---|---|---|---|---|---|
| 0 | `SPresetSettings` 预设说明 | system | | 内容 | ✓ | 58 | `{{// }}` 注释包住的作者声明（对玩家说话，宏展开后为空）；`setvar` 把 set1 / set2 初始化为空白，作下一条的默认值 |
| 1 | 标签设置 | system | | 内容 | ✓ | 34 | 只有 `setvar`：set1 / set2 写成 `<sumUp>` `<pose>` `<choices>` 三个输出标签的两种列表格式，供 24、25 号用。展开后为空 |
| 2 | `<世界设定与背景>` | system | | 内容 | ✓ | 25 | 一行伪 shell 提示符 `cat …world_and_background_settings.md` 加开标签，正文只有 `······` 占位 |
| 3 | 字数 | system | | 内容 | ✓ | 6 | `setvar::zishu::1500`，供 24 号插值 |
| 4–9 | worldInfoBefore、personaDescription、charDescription、charPersonality、scenario、worldInfoAfter | system | ✓ | 标记 | ✓ | 0 | 卡与玩家的六个钩子，全落在 2 号打开的"文件"里；`wi_format` `{0}`、`scenario_format` / `personality_format` 原样 |
| 10 | dialogueExamples | system | ✓ | 标记 | ✓ | 0 | 卡的 `mes_example`，紧挨历史之前 |
| 11 | `nsfw` 历史记录（只读文件挂载） | user | ✓ | 内容 | ✓ | 23 | 不是内容槽，被借作框架：闭合 `</世界设定与背景>`，再 `cat …history_chapters.log` 打开 `<历史记录>` |
| 12 | chatHistory | system | ✓ | 标记 | ✓ | 0 | 历史；最新玩家输入在其末尾 |
| 13 | /历史记录（挂载结束） | user | | 内容 | ✓ | 19 | 闭合 `</历史记录>`，加一行"以上为已归档章节，准备读下一章" |
| 14 | `jailbreak` 结尾（框架闭合） | user | ✓ | 内容 | ✓ | 32 | 被借作框架：一行分隔线加 `</已归档历史章节>`。全文件没有对应的开标签 |
| 15 | `enhanceDefinitions` 写作风格 | **assistant** | ✓ | 内容 | ✓ | 346 | 伪造的 assistant 回合：模型"已经 cat 出了" `writing_guidelines.md`。内容是作者的文风规范（体感、节奏、禁用套话、每轮只推进半步），其中一行是成人内容许可 |
| 16 | `main` 作者简介·恋爱写作 | user | ✓ | 内容 | ✗ | 381 | 三选一的"作者人设"之一：虚构一位小说家的档案，用作文风与基调 |
| 17 | 作者简介·风趣毒舌 | system | | 内容 | ✗ | 540 | 同上，另一位 |
| 18 | 作者简介·古典武侠 | system | | 内容 | ✓ | 584 | 同上，出厂启用的一位；唯一缺 `cat` 文件头的一条 |
| 19 | 结尾 | system | | 内容 | ✓ | 2040 | 终端输出规范（只在一个 bash 代码块里输出、照原文 cat 文件）；一个 `<USER_REQUEST>` 让模型 cat 第一章；一个"随机数文件"装 **429 个 `{{roll 1999999}}`**；闭合 `</Linux_terminal_emulator>` |
| 20 | ToolCall 引导·系统声明 | system | | 内容 | ✓ | 1915 | 身份替换：先借用一个真实编码助手产品的身份声明，夹 41 个 roll，`clear` 后换成"Linux 终端模拟器"身份；伪造的内核启动与 panic 日志；一份"执行配置"（只经工具输出、关闭思考） |
| 21 | ToolCall 引导·用户调度 | user | | 内容 | ✓ | 240 | 伪配置文件格式的调度指令：cd、ls、cat 写作规范、`file --analyze-*` 分析章节、cat 章节进 `display_stream` |
| 22 | ToolCall 引导·模型响应 | assistant | | 内容 | ✓ | 87 | 伪造的 assistant 确认回合（"已就绪、思考已绕过"） |
| 23 | ToolCall 引导·执行唤醒 | user | | 内容 | ✓ | 1783 | "立即调用 `%TOOL_NAME%`"；390 个 roll；一个用户角色里伪造的 `<thinking>思考关闭</thinking>` 块 |
| 24 | ToolCall 引导·工具说明 | system | | 内容 | ✓ | 742 | 成为工具定义的 description：输出流水线（终端命令 → `<content>` 正文约 `{{getvar::zishu}}` 字 → set1 标签）、把场景声明为不受审查的本地档案沙箱、一条写死的旧工具名、一份用户自定义"红线"列表 |
| 25 | ToolCall 引导·字段说明 | system | | 内容 | ✓ | 208 | 成为 `display_stream` 参数的 description：同一流水线的 TOML 版，标签列表来自 set2 |

### 1.2 顶层设置

| 键 | 值 | 对请求形状的影响 |
|---|---|---|
| `assistant_prefill` / `assistant_impersonation` | 空 | 无 prefill；脚本反正会弹掉末尾 assistant（§2） |
| `continue_prefill` / `continue_postfix` | false / `\n\n` | 续写走 nudge 消息，不走 prefill |
| `squash_system_messages` | true | 相邻、无 name、非空的 system 合并（排除 newMainChat / newChat / groupNudge）。决定 §2 里哪些条目落在同一条消息 |
| `use_sysprompt` | true | Gemini 路径下开头的连续 system 进 `system_instruction` |
| `function_calling` | **false** | ST 自己不发工具；工具全由脚本注入 |
| `names_behavior` | 0 | 消息正文不带说话人名；示范与历史一旦被压平就丢了谁说的 |
| `openai_max_context` / `max_tokens` | 2,000,000 / 40,000 | 上下文预算实际不起作用，示范永不被 ST 先丢 |
| 采样 | temp 1、top_p 1、top_k 50，其余中性；`seed` −1；`n` 1 | provider 配置 |
| `stream_openai`、`show_thoughts`、`reasoning_effort` auto | | 开着思考显示，提示词却反复要求"关闭思考"：配置与文字冲突 |
| `media_inlining` | true | 脚本只取文本 part，图片在搬运中丢失 |
| `impersonation_prompt`、`new_chat_prompt`、`new_example_chat_prompt`、`continue_nudge_prompt`、`group_nudge_prompt` | ST 默认文本 | harness 固定模板，作者没动 |
| `extensions.SPreset.ChatSquash` | enabled false | 另一种把对话拼成 `User:` / `Assistant:` 文本的压平器，未启用 |

### 1.3 正则（两份，彼此漂移）

`extensions.regex_scripts`（15 条，ST 原生的 preset 作用域正则）与 `extensions.SPreset.RegexBinding.regexes`（18 条，第三方）是同一组脚本的两个版本，id 相同、参数不同。哪份生效取决于装了什么扩展；两份都在就都跑。深度按消息数，0 是最新一条。`placement` 1 为用户输入、2 为 AI 输出。

| 作用 | 脚本 | 原生版 | SPreset 版 |
|---|---|---|---|
| 给脚本打锚点 | `userinput` / `userinput_history` | 用户消息前加 `【LAST_USER_INPUT】`（深度 ≤1）/ `【HISTORICAL_USER_INPUT】`（≥1），仅 prompt | 同 |
| 硬窗口 | 去除 N 楼前 | 深度 ≥120 的消息清空 | ≥20 |
| 折叠成摘要 | 仅保留总结 | 深度 ≥60 的 AI 消息只剩 `<sumUp>` 内容 | ≥5 |
| 近处去摘要 | 去总结 | 深度 2–40 剥 `<sumUp>`（全文在，摘要多余） | 2–5 |
| 剥读数 | 去姿势 / 去 `<choices>` | `<pose>` 深度 ≥2 剥；`<choices>` 全剥 | 同 |
| 剥终端外壳 | 去···、去除 talk | 剥 ```` ```bash ```` 围栏；删掉 `<content>` 之前的一切（显示与 prompt 都删） | 后者改为剥 `<talk>` |
| 改写模型口癖 | 极其、不是…而是、不是…是 | 删"极其"；把"不是 X 而是 Y"改写成另一种句式，显示与 prompt 都改；"不是是"禁用 | 全启用 |
| 压平 | 去除换行 | 禁用 | **启用**（名为"去除選択肢"，实为把 AI 历史的换行全换成空格） |
| 存变量 | 获取最后总结 / 姿势 | 无 | 深度 1 的 `<sumUp>` / `<pose>` 写进变量 summary / posture；preset 里没有任何 getvar 读它们 |
| 前端渲染 | talk / 选项 / 状态美化 | 只显示：`<choices>` 变按钮、`<sumUp>`+`<pose>` 变状态面板，仅最新一条 | 同；另有"场景解析隐藏"剥 `<status>` |

原生版的历史视图因此分五段：0–1 全文；2–40 去摘要；41–59 全文；60–119 只剩摘要；≥120 空。

### 1.4 Tavern Helper 脚本（`extensions.tavern_helper.scripts[0]`，76KB）

自称"防截断传输脚本"，随 preset 激活挂载、`pagehide` 卸载。它替换顶层窗口的 `fetch`，拦截发往 `/api/backends/*/generate` 的请求，即 ST 前端装配完、发给自己后端之前的那一刻。三件事：

- **请求重写**（`prepareRequestBody`）：见 §2。
- **响应解包**：OpenAI 与 Gemini 两种协议，流式（SSE 增量解析 JSON 字符串参数）、非流式、异常 JSON 数组流都处理；把工具调用参数 `display_stream` 还原成普通文本增量，与模型直接吐的文本"取最长"；保留 Gemini 的 `thoughtSignature`。
- **自识别**：工具名每次随机（前缀加 16 位十六进制），按前缀识别自己的调用，不碰调用方自己的工具；调用方若设了 `tool_choice` 就整体放行。

## 2. 终端模拟与工具调用的包装

两层。第一层是 ST 的 prompt 装配，造一个"终端里 cat 文件"的虚构；第二层是脚本，把第一层的产物搬进一个工具定义里，换一组固定的引导消息发出去。真正的 `function_calling` 是关的，工具调用是脚本伪造的传输通道，不是能力。

### 2.1 第一层：ST 装配出的消息（squash 之后）

| 序 | role | 来自 | 内容 |
|---|---|---|---|
| 1 | system | 2 + 4–9（0、1、3 展开为空被丢） | `cat 世界设定` 开标签、`······`、世界书前、玩家 persona、卡的描述 / 性格 / 场景、世界书后 |
| 2 | system（带 name） | 10 | `[Example Chat]` 分隔与示范句，各自一条，因带 name 不被合并 |
| 3 | user | 11 | 闭合设定，打开 `<历史记录>` |
| 4 | system | newChat | `[Start a new Chat]` |
| 5… | user / assistant | 12 | 历史，已经过 §1.3 的 prompt 正则；用户消息带锚点前缀 |
| | user | 13 | 闭合历史 |
| | user | 14 | `</已归档历史章节>` |
| | assistant | 15 | 伪造的"已 cat 写作规范"回合 |
| | system | 18 + 19 + 20 合并 | 作者档案、终端输出规范与 429 个 roll、ToolCall 系统声明 |
| | user / assistant / user | 21 / 22 / 23 | 调度、确认、唤醒（伪造的三拍对话） |
| | system | 24 + 25 合并 | 工具说明、字段说明 |

不装脚本时这就是发出去的东西（`%TOOL_NAME%` 原样留着），模型被要求在 bash 代码块里先演 cd、ls、file 分析，再 cat 出 `<content>` 正文；原生正则"去除 talk""去···"正是为显示这种纯文本输出准备的。所以 preset 有一个降级模式。

### 2.2 第二层：脚本重写后的请求

脚本逐条扫描上表，按标记分拣：

- 含 `【ToolCall引导】` 的消息：按标记切块。"工具说明"块进工具 description，"字段说明"块进参数 description，其余块（20–23）各成一条引导消息，role 取原消息的 role。同一条消息里标记之前的文本（18、19 合并进来的作者档案和输出规范）留作上下文。
- 带 `【LAST_USER_INPUT】` 的用户消息：改写成 `cat chapter_01_preview.txt` 加原文再加 `cat chapter_01.txt`，即"预览已给，请输出正文"。
- 带 `【HISTORICAL_USER_INPUT】` 的：同样的外壳，文件名每次随机生成。
- 其余所有消息（头区、示范、历史里的 assistant 正文、13–15）：原文，丢掉 role。
- 以上按原顺序用 `\n\n---\n\n` 连成一个长卷。

`<已归档历史章节>` 开标签在任何条目里都不存在，脚本里"归档区间内 assistant 消息加 `[system@stream-output]` 前缀"和"按区间兜底找最新输入"两条路径因此是死的，全靠正则锚点工作。

发出的请求（ST 后端再转 Gemini）：

```
system_instruction  ← 20 的引导块（双重身份、伪启动日志、执行配置；41 个 roll）
contents            ← user 21 → model 22 → user 23（390 个 roll、伪 thinking 块）
                      末尾若是 assistant 就弹掉，保证以 user 结尾
tools[0]            ← name = dispatch_stream_payload_<随机16hex>
                      description = 24 + "【/workspace/archive/ 本地工作目录文件与历史章节归档】" + 整个长卷
                        （头区 → 示范 → 历史 → 最新输入 → 闭合标签 → 写作规范 → 作者档案 → 输出规范与 429 个 roll）
                      parameters = { display_stream: string（description = 25） }，必填
tool_choice         ← "auto"（不强制）
```

卡、玩家 persona、历史、示范、作者的文风规范，全部在工具定义的 description 里，不在任何消息里。消息只剩四条固定的、与本轮无关的引导。

### 2.3 一轮的输出与回收

模型调用随机名工具，把正文写进 `display_stream`：先演终端命令，再 `<content>` 正文，再 `<sumUp>`、`<pose>`、`<choices>`（三个标签只给了名字，格式要求不在 preset 里）。脚本把参数流还原成普通文本交给 ST，ST 照常存成楼层。显示时：去掉 `<content>` 之前的终端外壳与 bash 围栏，最新一楼的 choices 渲染成按钮、sumUp 加 pose 渲染成状态面板。下一轮 prompt 时同一楼层按深度依次失去 choices、pose、sumUp，再折叠成只有 sumUp，最后清空。

### 2.4 依赖

| 依赖 | 断了会怎样 |
|---|---|
| Tavern Helper 预设脚本 | 退化成 §2.1 的纯文本终端模式 |
| 正则锚点 `userinput*` | 脚本找不到最新输入（兜底路径是死的），最新输入被当普通历史 |
| `squash_system_messages` | 18–20 不合并时作者档案、输出规范单独成消息、不含标记，照样进长卷；24、25 分开时仍能各自被认出。可容错 |
| `use_sysprompt` | 关掉则引导块变成 Gemini 的 user 消息 |
| 1 号与 24、25 号 | 变量配对：1 关掉则标签列表为空白（0 号给的默认值），流水线不再要求三个标签 |
| 3 号与 24 号 | 3 关掉则"约字"缺数字 |
| 11、13、14 与 2 号 | 标签成对开合，任一关掉框架就不闭合 |
| `main` 关闭 | 卡的 `system_prompt` 覆盖目标是 `main`，main 被禁用就不覆盖：卡的系统提示被静默丢弃 |
| `jailbreak` 被借作闭合标签 | 卡若带 `post_history_instructions`，会替换掉这行闭合标签（`forbid_overrides` false） |

## 3. 归属分类

| 类 | 条目 | 占启用 token |
|---|---|---|
| (a) preset 作者的资产 | 15 写作规范；16–18 作者档案（三选一）；19 中的输出规范段；24 里的"红线"列表；0 号的声明 | ~1.2k（约 15%） |
| (b) 任何运行时都要的固定模板 | `[Start a new Chat]`、`[Example Chat]`、各种 nudge、`wi_format` 等格式串；区与区之间的分隔 | 极少，且作者全用默认值 |
| (c) ST 或生态专属脚手架（可选） | 2、11、13、14 的伪 shell 开合框架；19 的 roll 噪声；20–25 引导链；Tavern Helper 脚本；全部 prompt 正则；1、3 的变量 | ~6.8k（约 85%） |
| (d) 卡资产的钩子 | 4、6–10（世界书前后、描述、性格、场景、示范），全部在 2 号打开的"文件"里 | 0（标记） |
| (e) 玩家资产的钩子 | 5 persona（与卡字段混在同一个"文件"里）；12 历史与最新输入；2 号的 `······` 占位 | 0（标记） |

必需与可选：

- **整体必需**（缺一则不是这份 preset）：20–25 加脚本加锚点正则；或者降级模式下 19 的终端输出规范。二者都依赖 4–12 的标记顺序。
- **风格选项**：16–18（三选一，ST 不强制互斥，出厂只开一条）；15；3 的字数；1 的标签集。
- **联动对**：2 / 11 / 13 / 14 四条开合标签；0 / 1 与 24 / 25（变量默认与覆盖）；3 与 24；输出标签与对应正则（`<sumUp>` 与三条摘要正则、`<choices>` 与剥离和按钮、`<pose>` 与剥离和面板）；原生正则与 SPreset 正则是同一套的两份，改一份另一份不跟。
- ST 槽名在这里没有语义：`nsfw`、`jailbreak` 被当成"历史前、历史后的位置"用，`main` 关着，`enhanceDefinitions` 换成了 assistant 角色。作者只用槽的位置。

## 4. 映射到本项目

README 第二节："preset 作为提示词对象不存在，拆成框架层 fragment 与 provider 配置，请求形状归 harness。"逐模块：

| 模块 | 代码方向 | 语文方向 | 本项目的家 |
|---|---|---|---|
| 15 写作规范 | 历史之后，伪 assistant 回合 | 作者的文风与节奏要求，含"每轮只推进半步" | 玩家层 fragment。缺口：只能进头区，作者要的是历史之后 |
| 16–18 作者档案 | 三条互斥，历史之后 | 用一位虚构作者的档案定基调：不写指令，写"谁在写" | 玩家层 fragment，同一槽位的三个变体。缺口：选项只有布尔，没有"N 选一" |
| 3 字数、1 标签集 | `setvar` / `getvar` 插值 | 无 | 字数一半是 provider 的 `max_tokens`，一半是带数值的玩家选项。缺口：带值的选项与文本插值 |
| 2 的 `······` | 玩家可填的占位 | 留给玩家写世界设定 | `fragment.ts` 的"无 text 即玩家可填的槽"，现有 |
| 2 / 11 / 13 / 14 开合标签 | 把卡字段和历史包成"文件" | 无 | harness 请求形状：区的分界与历史的呈现方式归 harness，不是作者文本 |
| 4–9 卡字段、persona | 标记 | 卡与玩家的资产 | 卡框架与角色层；persona 进玩家层；有键世界书进 `lore.ts` |
| 10 示范 | 标记，历史之前 | 卡的 | 无槽，见下 |
| 12 历史 | 正则按深度改写 | 历史被框成"已归档章节"，后续正文是"下一章" | `history.ts` 的叙事者视图。按深度窗口、只留摘要的折叠就是 `folded` 加 notes 折叠 |
| `<sumUp>` | 正文末尾，模型同轮写 | 每轮自写摘要 | record 阶段的 notes，现有（分离成独立阶段） |
| `<pose>` | 最新一楼显示，之后剥掉 | 模型逐轮改写的当前姿势 | README 方向 1 遗留的"模型书写的文本字段"，无 |
| `<choices>` | 最新一楼渲染按钮，prompt 全剥 | 模型每轮写菜单 | 无；第二次出现（西西弗斯是第一次） |
| 口癖改写正则 | 改写历史里模型自己的套话 | 不让模型在近因里看到自己的口癖 | 无。属于叙事者历史视图的变换，正文非权威，可以做 |
| 19 终端输出规范与 roll 噪声 | 每次请求不同的数百个随机数 | 无 | 不应存在。每请求随机文本与"缓存是基础设施"直接冲突 |
| 20–25 引导链、脚本 | 改写整个请求，内容进工具 description，输出走工具参数 | 无 | 不应存在于 fragment 层。若某 provider 真需要换传输通道，那是 provider 适配器的私事，fragment 与历史视图都看不见它 |
| 采样、上下文、流式、思考 | 顶层键 | 无 | provider 配置 |
| `use_sysprompt`、squash、`names_behavior` | 请求形状 | 无 | harness 请求形状，按 provider 适配 |
| impersonation、continue nudge | ST 默认 | 无 | impersonation 无对应阶段；continue 对应截断恢复（末尾 assistant 前缀） |
| 0 号声明 | `{{// }}` 注释，不进提示词 | preset 作者对玩家说话 | 无槽。"作者对玩家的话"第三次出现（前两次是伴星的 `creator_notes`、青空理的 `first_mes`） |

**示范槽缺口：确认位置与生命周期，部分反驳"作为消息"。**

- 确认位置：`dialogueExamples` 紧挨历史之前，中间只有一条框架标签。
- 确认不折叠：所有压缩正则只作用于聊天楼层，示范不受影响；2M 上下文下 ST 的"先丢示范"永不触发。
- 反驳"作为消息"：这份 preset 故意把示范、历史乃至作者的文风规范一起压平成一份文档，丢掉 role（`names_behavior` 0 下连说话人都丢了）。消息还是文档是按 provider 定的请求形状，不是槽的属性。槽应规定的是位置（历史之前）、生命周期（非正史、不折叠、同一种语言），渲染方式归 harness。
- 新证据：作者把历史本身当示范（"已归档章节，维持风格一致"），同时接受 30 轮之后只剩摘要。历史既是示范又会被折叠，这个张力在这里由作者手调深度窗口来解决。

**`fragment.ts` 表达不了的：**

1. **历史之后的作者区。** `head()` 只产头区；`loop.ts` 的 narrate 尾部（lore、结果、简报、aside）全归 harness。这份 preset 自己的文本几乎全在历史之后，是作者对近因的选择（西西弗斯是第二个例子）。需要一个玩家层、卡框架都能放的后历史区，同样按文档顺序。
2. **包裹 harness 所有的区。** 开合标签成对夹住卡字段与历史。本项目不应让 fragment 夹住 harness 的区，而是让历史与卡区的呈现方式（转录稿还是文档）成为 harness 的按阶段选项。
3. **带值的选项。** `enabled` / `options` 只有布尔；这里要数值（字数）、N 选一（作者档案）、由其他选项派生的字符串（标签列表）。
4. **跨条目变量。** setvar 在前、getvar 在后，后写覆盖先写，即"默认加覆盖"，依赖顺序。本项目里这应是选项值加插值，文本不含逻辑。
5. **请求形状变换**（工具搬运、role 压平、system_instruction）：按设计就在 fragment 之外。
6. **每请求随机**：表达不了，也不该表达。

## 5. 跨文件的规则

- **preset 本身消失，这份文件支持。** 8.1k 启用 token 里约 15% 是作者的文风（文风规范、作者档案、输出规范的语文部分），全都是玩家层 fragment；其余是传输、伪装与噪声，没有家，也不需要家。
- **ST 槽名只是位置。** `nsfw` 是"历史前"，`jailbreak` 是"历史后"，`main` 关着。作者靠顺序工作，不靠槽的语义。本项目的"顺序即作者的文档顺序"被验证；槽名没有工作，只有位置有。
- **请求形状被玩家侧改写。** 卡、历史、文风全部离开消息、进入一个工具描述。"harness 拥有请求形状"的反面：ST 不拥有它，于是一个 76KB 的 fetch 拦截器拥有了它。这里的工具不是能力，是传输通道；"叙述阶段不带工具"不受影响，但"工具"一词在生态里也指传输。
- **缓存被主动打碎。** 860 个随机数、随机工具名、历史外壳里的随机文件名、全部上下文挤进一个每次都变的工具定义：没有任何稳定前缀。"缓存是基础设施、harness 负责"的必要性，在一份把缓存当代价付掉的 preset 里看得最清楚。
- **历史是视图，生态已经手搭出来了。** 五段深度窗口（去读数、去摘要、只留摘要、清空）就是按区间的折叠视图；`<sumUp>` 只留折叠就是 notes 折叠；改写口癖说明视图还可以过滤叙事者自己的套话。与青空理的正则折叠是第二次独立出现。
- **record 的三种产物再次同时出现。** 摘要（notes）、模型书写的文本字段（姿势）、模型生成的菜单（选项）挤在正文尾部、由正则拆开，各自有不同的显示与遗忘规则。本项目把 record 分出来是对的；后两种仍然没有家。
- **作者用"谁在写"代替"怎么写"。** 三份作者档案不下指令，只描述一位小说家；写作规范才是指令。两种并存说明框架层 fragment 里同时有人设式与规则式两种语文，不应强行统一。
- **两份正则漂移。** 同一套脚本存两份、参数不同、一份启用另一份禁用。配置复制即分叉；本项目的配置应只有一个来源。
- **配置与文字打架。** 思考显示开着，提示词四处要求关闭思考；`function_calling` 关着，整份 preset 靠工具调用。provider 配置与框架文字分开存放时，要能检查二者矛盾。
- **"截断"一词撞车。** 脚本的"防截断"指 provider 侧对输出的中途掐断，不是本项目 `finishReason: length` 的截断恢复；脚本还强制请求以 user 结尾、弹掉末尾 assistant。这只是作者的经验，不构成 Gemini 拒绝 assistant 前缀的证据，README 里"截断恢复依赖 provider 接受末尾 assistant 前缀"仍待验证。
