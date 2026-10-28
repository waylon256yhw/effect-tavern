# 客户端的形状与它向协议提的要求

设计稿（已被 `client-design-brief-3.md` 的重画稿取代，本文的数据模型对照仍有效）：https://claude.ai/artifact/X1rfLi2uLPmog74g8A6V3e（互动小说阅读器主界面，按 `docs/client-design-brief.md` 做）。三个方向里取 A：每一节是一张卡片，读者的话在两张卡片之间，没有两个说话者；附注收在卡片底部一行，点开展开。手机 390 与桌面 1280，深浅两套。本文记录设计稿定下的形状，把它的数据模型逐项对到 `src/session.ts` 的接口上，列出已供、缺、多余，以及对三处冲突的决定。README §五"demo 的顺序"要的清单就是这一份。

## 一、设计稿定下的

- **一节的结构**：正文常驻，附注默认折叠成一行（状态变化、线索与备注的数量），正文流式输出时不显示附注，写完再出现；建议跟在最新一节后面。
- **输入**：界面上没有任何一步直接发送，建议、片段、代称都只填进输入框。身份只有两种：角色（场内，进故事）与场外（只影响下一节），一个开关，发出后回到角色；大世界没有角色，不显示开关。回车只换行，桌面 ⌘↵ 发送，手机用按钮；选字时的回车只确认候选。
- **版本与分支**：有多个版本的节显示 ‹ 2/3 ›，点数字列出全部版本（类型、开头一句、后续节数），切换时这一节不动，后面的节淡入替换。
- **对过去一节的动作**：每节一个入口「⋯」（手机长按、桌面右键）；展开附注时重来、改写、编辑排在底部；改读数点那一行，钉住点线索旁的图钉。
- **读数面板**：只有带规则的故事常驻，手机上是标题下一条放三项，点开是全部并可直接改；桌面放左栏。没有规则的故事，读数只出现在附注里。
- **长局导航**：标题下显示当前节号与章节名，点开是目录（章节、钉住的线索、搜索）；滚动时右侧出现拖动条；只载入最近的节。
- **流式不跳**：发送后新的一节移到屏幕顶部，下方留一屏空白，正文每长一行留白短一行，视口不动；往上翻不被拉回，底部出现回到底部的入口。等待时光标停在正文将要开始的位置；带规则的故事同时显示正在掷的骰子。

设计稿的节模型：`{ input: { mode: 'act' | 'direct', text }, active, versions: [{ kind, paras, set, add, clues, notes, dice, scene, extras, sug, next }] }`。

## 二、对到协议上

| 设计稿 | 协议（`src/session.ts`） | 备注 |
| --- | --- | --- |
| `input.mode` act / direct | `Input.text` / `Input.note` | 纯 direct 轮就是只有 note 的轮：不进历史，只作用于下一节 |
| `versions` + `active` | 同一 parent 下的兄弟节点 | ~~"当前在哪个兄弟"是客户端状态，协议不存~~ 2026-10-23：head 由服务端持有（`src/log.ts`），切版本是 `checkout` 动作，刷新不丢 |
| `set` / `add` | 相邻 `Node.state` 的 diff | 闪烁与"上次变化在哪一节"都由客户端从 diff 算 |
| `clues` | `Node.delivered` | 读到的、check 确认的、钉住的三类合在一起 |
| `notes` / `sug` / `inner` / `scene` | products：`notes`、`options`、`inner`，卡声明的 `scene` | 建议只填输入框不发送，所以这个客户端不用 `pick` |
| 重来 / 换写法 / 编辑 / 改读数 | `swipe` / `reword` / `edit` / `setField` | 重来重掷骰、改写沿用结果、改读数不开新版本后面的节从新值往下算：协议正是如此 |
| 钉住 | `Node.readable` 名单 + 下一次 act 的 `input.pin` | 见下 |
| 等待时的骰子 | `stage: decide` 与它的 `call` 事件先于 narrate 到达 | 客户端在正文之前就知道掷了什么 |
| 附注写完才到 | record 是 narrate 之后的一次调用，随 `node` 事件到达 | 一致 |
| 开场 | `greet` 的根节点 | 一致 |

**钉住的语义**（第二稿定的，协议随之改）：钉的不是已读到的线索，是"故事里还没讲到的事"。名单是节点投影的 `readable`（已解锁、有未读层的条目的 hook），钉一条挂在输入框上方，随下一次发送作为 `input.pin` 带走：那一轮它强制开窗、进 `must`，check 验证，没讲到就走那一次纠错重写，仍没讲到就留在名单里。一次一条，发场外的话也算。原来节点级的 `pin` 动作删了。

## 三、三处冲突与决定

1. **keepTail**（改写与编辑共用后续的节）。树里兄弟是新节点、没有孩子，后续挂在旧兄弟下；共用要嫁接 parent 指针，而 edit 重跑 check 与 record，后续的 notes 会和新正文不一致。**砍掉**，不加嫁接动作。
2. **输出中停止**。原来关掉响应就中断整轮，没有节点，部分正文只能是客户端的幽灵，"继续"无处可接。**改为按阶段分两种**：正文开始之前关响应是取消，什么都不留；正文开始之后关响应是收尾，narrate 在当前位置停、check 跳过（截断的是玩家不是模型）、record 照跑、节点照存，`end: "stopped"`。"继续"于是就是它下面一条 note 子轮（文字"继续。"），协议早就有，不是 swipe 的一种，也不需要 prefill。
3. **纠错重写**。check 不过时 narrate 第二次跑，客户端会收到第二个 `stage: narrate` 和一整段新 delta；设计稿没有"第一稿被第二稿替换"这个状态。**留给客户端设计**，协议不动。

## 四、快捷输入是 harness 的基础设施

生态里的 QR（Quick Reply）、Cherry Studio 的 `{}` 列表、酒馆的输入助手是同一类东西：高频输入的便捷设施，归 harness，不归卡也不归"玩家自己写的 fragment"。按截图拆成三样：

- **括号助手**：把选中文字包进 `「」『』《》""` 或移动光标。纯客户端，手机键盘没有直角引号。
- **快捷片段**：Cherry 的列表把"内容模板"和"发给谁"混在一起（OOC、继续、推进剧情是 note；旁白、内心是进剧情的文字加一个标注）。这里的片段是 `{ name, text, note? }`，Player 层数据（`Player.snippets`），harness 带默认几条（session `snippets`），客户端按 `/` 拉出，填进输入框不发送。
- **代称**：片段要跨故事复用才需要 `{{user}}` 一类的东西。能力留着，形式用设计稿的小块，解析在客户端用卡的投影做，harness 不解析。

**心声**（以及旁白、以另一个角色说话）是同一件事：玩家文字的一段带一个属性，"谁听得到"或"以谁的身份"。现在用记号：`⦅⦆` 包住的是角色没说出口的话，harness 用一条 ask（`input.thought`，玩家与卡可按 id 覆盖）在输入含记号的那轮向叙事者说明。以后要变成带类型的段，只改 `said()` 一处。多角色切换走同一条路，不加第二个 persona 槽。

## 五、协议欠客户端的

- **卡与玩家层的投影端点**：`GET /card` 已带 id、标题、简介（`summary`，2026-10-23）、回合标题引用、默认通道（`input`，客户端据此决定参与者 / 作者视角的输入框）、规则、开场（`greetings` 整条，含 `do`；客户端按下标 `greet`）、导演开关、护栏条数、lore 的条数与层数、虚构模块（`fiction` 去掉正文：id、`label`、`when`）、`snippets`、`format`。cast 不进 schema：虚构区的单元是 fragment 不是人（盐道的 `sides` 一条写四个人），展示名是 `Fragment.label`，工作台编辑的也是同一份。护栏与 lore 只给数：禁令本身就是提示，对玩家同样成立；当前可讲的（readable）在节点上。仍缺状态条放哪三项。persona 有无不上线：客户端只读通道（模板里 wuxia、伴星没有 persona 槽却是参与者卡）。dev.ts 不再替玩家 greet（除非显式 `GREETING`）：开场是卡页上选的，服务端选的会留成孤儿根。 2026-10-24 卡页已建（`src/card.tsx`，`docs/card-page-brief.md` 与 Gemini 的 `docs/card-page-prototype.html`）：`page` 的第四个值，日志空时落页，⋯ 菜单的 Card 项随时进，Start over 与删空都落到它；开场在卡页上选（`greet` 按下标，故事中选开场是开新线程），无开场的卡直接开始；`Field.hidden` 让状态表与卡页同时跳过一个字段（理的恋人 / 哥哥）；`GET /card` 加 `tokens.head`，runtime 的 `tokens()` 是按字符的估算，权重用 Anthropic count_tokens 在模板卡上量过（中文 1.25 / 字，其余 0.3），精确计数以后是连接的能力。
- ~~**兄弟的类型**~~：2026-10-22 已有，`Turn.sibling` 记 swipe / reword / edit，版本列表按它画图标。
- ~~**`reword` 的风格**~~：2026-10-22 已有，`reword` 带可选的 `note`，并入这个兄弟的 input.note（只随它走）。
- **`demand` 的参数**：设计稿按人物要内心想法，`demand` 只收产物 id。
- ~~**检查器要的 calls**~~：2026-10-22 已有，`call` 事件带 `ms`，server 按节点留存，`GET /calls` 读回（`{ [node]: Call[] }`，play 模式下 msgs 为空）。按区域的 token 数没有：没有分词器在环里，区域按缓存断点切开后只报字符数，token 是整次调用的。
- **事件的 `seq`：不要。** 关掉响应就是停止（§三 2），断线等于停止：服务端已把这一轮收成 `stopped` 节点或撤掉，客户端回读 `/nodes` 即可，没有可续的流。
- **客户端用不上的**：`pick`（建议只填输入框）。2026-10-27 删掉了：没有调用方，选中的建议就是一次普通的 act。
- ~~**客户端欠协议的：`edit` 的入口与编辑态**~~：2026-10-23 已做。玩家自己的那句：点气泡回到 composer 的修订态（Cherry Studio 的做法），对号留正文重算记录（`edit` 带 `input`），箭头重来（`act` 到同父），Escape 取消并恢复原草稿。铅笔是 Swipe / Reword 旁的第三键（手机 Record 弹层底部、桌面右卡）；正文原位变 textarea，字号行高同段落、底色同改写输入框，随内容长高；Enter 分段，⌘↵ 发 `edit`（与 composer 同键），Escape 取消，没改或清空也是取消。
- ~~**重开一局**~~：2026-10-23 已做，按树推出来：根是兄弟，一条线（ST 的一个 chat）是一个根的子树，第一节的版本列表就是线的列表。Start over 开一个新根（有开场 `greet`，没有就 `checkout(null)`，head 置空、阅读线清空等玩家第一句），旧线不动；Delete story 是 `DELETE /nodes/<根>`，页面自己的 confirm（`<dialog class="confirm">`，取消在左、红色的 Delete 在右）；日志空了而卡有开场就再 `greet`。两项在本线没有玩家回合时灰掉：空线上没有东西可留下或可删。
- **一局 = 一棵单根树（2026-10-25）**：存档层（server `library.ts`，`/stories`）出现后，"线程"（同一棵树的第二个根）和"故事"是一件事的两个名字，玩家只看故事：Start over 与卡页上的开场都走 `POST /stories`（沿用当前 persona），Delete story 是 `DELETE /stories/<id>`，运行时的多根 log 不变，客户端只是不再造第二个根。故事、persona（新建、改、删）、写法开关（`PUT /player`，一行摘要加弹层：它们是 head 文本，改一次整个缓存前缀作废，所以不做成回合旋钮）、钉住、Timeline 与 Inspector 的入口都在阅读线旁的 session 卡上（`side.tsx`：桌面左栏，手机标题拉起同一份内容），composer 的 ⋯ 菜单退役；场景导航删除（标题是模型改写的产物，相邻相同是巧合，地图是 Timeline），`heading` 只给回合标题。`GET /stories` 每行带 `turns` 与 `last`（head 的玩家台词，或 head 正文的首句）。
- **主题手动切换（2026-10-28，#70）**：`tokens.css` 的 `light-dark()` 跟随系统，`:root[data-theme]` 钉住一边；入口是 session 卡底部导航的第四枚图标（`ph/circle-half`，#77 原型定的左二右二），不在设置页。选择存 `localStorage`（`theme`），不进 Player：主题是这块屏幕和这间屋子的事，而且要在首帧之前生效，`main.tsx` 第一个 import 就是 `theme.ts`。只存"和系统相反"的那一边：翻回系统正在显示的那边就清掉，页面重新跟随系统（白天黑夜的切换照旧跟），所以不需要第三个"跟随系统"状态。手机 sheet 里同一个按钮，按下不关 sheet。
- **Story 行只认玩家起的名（2026-10-28，#75 第一步）**：`GET /stories` 去掉 `opening` 与 `last`（同一张卡的每个 story 都从同一句 greeting 起步，未命名的行全部相同，head 的末句在 192px 里只剩一个碎片），`data.ts` 不再为列表读任何节点 JSON；`turns` 只数 head 所在那条线上（head 到根）带玩家输入的节点（`input.text != ''` 或有 `input.note`），greeting 不算一轮，swipe 出来的兄弟节点也不会重复计数，别的线不算。行是 `title ?? "New story"` 加副行 `N turns · 16 minutes ago`（零轮只给时间），服务端继续存 `null`：`title === null` 就是「没改过名」的状态，第二步的筛选要用。改名是复用 `.confirm` 样式加一个 `.field` 的 dialog，铅笔和行上双击都开它，桌面和手机 sheet 同一套，Enter 保存、空白清名、Escape 不动。`.story` 加 `grid-template-columns: minmax(0, 1fr)`，长名不再把列表撑出横向滚动条。
- **左栏按 #77 原型落地（2026-10-28）**：卡头常驻一枚进卡页的角标（20px，hover 时前倾），简介 `-webkit-line-clamp: 3`；人设、写作两行各一行加右侧 chevron，芯片缩一号（22px、caption 字号），三枚四字芯片 55px 正好排进 chevron 旁的 176px，写作超过三枚收成前两枚加「+N」，补充芯片叫「本卡补充」；底部导航纯图标左二右二（时间线、检查器 ｜ 主题、设置）。选人设从 popover 换成 `Sheet`（手机从底部升起叠在 session sheet 上，桌面居中 25rem）：搜索名字和正文、两行一条、「卡片默认」置顶带勾、底部「管理人设」去设置页；没有人设时不再 disable，弹窗里就是「卡片默认」和去新建的路。`Session` 不再需要 id 前缀（dialog 都用 ref 持有），picker 作为 `.session` 的兄弟渲染，免得 sheet 的标题吃到 `.session h2` 的小标样式。Stories 定长 4 条和「全部 N 个故事」等 #75 第二步的管理页。
