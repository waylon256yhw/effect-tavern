# 读 Deckled 的 Workbench：哪些能搬进玩家客户端

读的是 `~/deckled`（2026-08 到 2026-10，1144 次提交，`apps/website/src` 六万六千行）的主工作面：Transcript、Composer 与它们的设计记录（`docs/research/frontend-v1-exploration.md`、`docs/adr/0010`、`docs/design/message-area-states.md`、`workbench-controls.md`、`shell.md`）、九月的 Score / nib / dial 一轮（issue #406–#446）、四张断言截图。方法：三个 agent 分片读代码（transcript 与数据路径、composer、设计系统与测试流程），我读文档、issue 与截图。

## 0. 高度

**它回答的问题不是我们的问题。** Deckled 的 Workbench 两个月在打磨一件事：一个 agent 的工作（工具调用、思考、审批、提问、任务）怎样和它的散文答复共处在一栏 400px 宽的列里。九月的最终形态（一轮工作画成五线谱 Score、右侧刻度盘 dial、右下笔尖 nib）全是对**这个对象**的解。我们的对象是日志树上的节点：散文一张脸，数据一张脸，兄弟节点是真的。两边只在"一栏连续的阅读流，正文边流边长"这一层重合。

**它花了两个月学到、我们零成本拿走的三件事：**

1. **消息区的状态表**（`message-area-states.md`）。following 是一个 ref，不是渲染里派生的布尔；滚轮、触摸、方向键、展开一个细节都是"读者接管"；离底 80px 内只重新武装不吸附；本局结束时若仍在跟随，上滚一次停在阅读起点；自己发的消息跟随到底，队列发的不动视图。每条边都挂在一个离散事件上。这张表与具体外观无关，直接当我们的 spec。
2. **回合状态不等于传输状态**（`model/round-state.ts`）。"线上有没有请求在飞"与"这一轮做完没有"是两件事；封印、操作条、跟随收尾全部读回合状态。我们的对应物是 `stage` 事件给出的阶段：`working{phase}`、`settled`、`failed`。
3. **仪器层与内容层**（exploration §8.8 的诊断）。他们从报纸 Mock 推导 chrome，每件仪器都和正文抢地盘，病灶是"仪器层从未被设计过"。解法是走廊：正文的左右边界都在设备栏内缘，浮层永远压不到字；一个区域只有一个滚动的主人。我们在画第一屏之前就该把"内容 / 视口仪器 / 会话仪器"三层分开。

**它没解决、我们必须自己解决的两件：** 长会话（整段在 DOM，无虚拟化，无 `content-visibility`，每个 delta 让整段 markdown 重解析）；手机（固定 400px 几何、hover 门控的状态、10–13.5px 字阶、18–28px 图标钮、`user-select: none`、全站没有 900px 以下的断点）。"手机上五百节点流式不卡"在 deckled 里是空白。

**它自己推翻过的，不要再捡：** 圆角 / 投影例外清单（8 月定，8 月底废，`theme.css` 现在是 2–24px 的圆角梯）；截图断言（ADR-0010 决定七删光了，浏览器层只留给几何与真实加载事件）；19 世纪报纸基调（9 月改成 Linear 式中性灰）；每楼一个可折叠工具列表 TraceView（嵌套滚动，被 Score 取代）。

## 1. 机制：搬、改、不搬

**原样搬（都很小、零依赖）：**

| 东西 | 在哪 | 解决什么 | 我们的用法 |
| --- | --- | --- | --- |
| IME 控制器 | `model/composer-keyboard.ts`，72 行 | `isComposing` / `keyCode 229` / 自己的 composing 位 / `compositionJustEnded`：WebKit 会在确认候选的 Enter keydown **之前**发 compositionend，所以 compositionend 后第一个 Enter 仍归输入法，`setTimeout(0)` 释放。控制器只建一次，提交谓词走 ref，监听器是原生 `addEventListener` | 中文输入是主场景，这是最值钱的一份代码 |
| 草稿作为纯值 | `model/composer-draft.ts` | `Draft` 是一个值，每个变化是 `(draft, …) → draft`，无变化返回同引用；`canSend` 是纯函数；页面拥有 `useState<Draft>`，Composer 只展示不改；`onSend` 返回 boolean，拒绝则草稿不动 | 字段换成 `{ act, aside, pick?, toggles }`；没有正文的 aside 可发，等价于他们"只有 chip 也可发" |
| 输入框几何 | `composer.css` | 固定内衬放在不滚动的 `.composer-field` 包裹里，textarea 自己 `padding: 0`；`field-sizing: content` 自动长高，`max-height: 35dvh`；发送 / 停止共一个槽，`busy` 由活动回合派生 | 照抄，手机上再加 `enterkeyhint` 与 visualViewport |
| Block + useFold | `view/block.tsx`，92 行 | 一行头加一段体的折叠原语：`expanded = manual ?? auto`，用户点过就永远听用户的；折叠走 `grid-template-rows: 1fr ↔ 0fr`，不量高度；`fold` 省略即不可折；头尾功能钮在折叠钮之外 | 节点下面的数据带（状态、揭示、产物）正是这种东西 |
| 流式 reducer | `chat/conversation-store.ts` | 每帧带 `seq`，小于等于 `lastSeq` 的丢；delta 按 id 追加、不可变替换；delta 的通知按动画帧合并，其余同步；投影按条目对象 `WeakMap` 记忆，一个 delta 只重投影一轮；本地 Stop 之后在途的帧要吞掉 | `delta` 追加到活动节点，`node` 事件是 upsert，`GET /nodes` 是快照 |
| 锚点与跳转 | `scroll-surface.tsx`、`nib.tsx` | 每个条目 `data-message-id`，所有跳转都是 `scrollToMessage(id, { align, scrollMargin: EDGE })`；回合之间一枚封印是跳转落点 | 节点即回合；封印词汇换成我们的（end / over / cap、兄弟数） |
| 跟随逻辑 | `scroll-surface.tsx`，约 100 行 | 见 §0 第 1 条；陷阱：程序滚动触发同样的 scroll 事件，要用 `programmatic` 旗直到真实滚轮 / 触摸证明接管；不要开两个跟随者（库自带的 autoScroll 被关掉了）；nib 量活动回合的**底缘**，不量整轮，跟随中不量 | 不引 `@shadcn/react`，按状态表重写 |
| 三层测试的规矩 | ADR-0010 决定七 | node（reducer）/ jsdom（结构、文案、回调）/ Chromium（只留几何与真实加载）；无固定 sleep，全仓一个 `flush`，fake 必须委托真 reducer，有无 dev server 都能过 | 规矩照抄，浏览器层尽量小（他们那层 8 秒起，69/78 个用例搬去了 jsdom） |
| rig + fixtures | `main.tsx` 的 `?page=`、`rig/fixtures/*` | `lazy()` 挂真实生产组件到和线协议同形的假数据上，生产永远不 import rig；毕业是一次满足四个条件的搬家 | fixtures 就是录下来的一段事件流 |
| 长按删除 | `HoldButton`，600ms | 唯一在触屏上比桌面更顺的手势 | 节点上的破坏性动作 |

**改了再用：**

- **nib**：留"回到最新 / 活动回合不在视野 / 一轮在视野外结束"三种状态，扔掉 orb、谱面、审批按钮。
- **操作条**：Copy / Edit / Retry 对应我们的 copy / reword / swipe，但 hover 显影在触屏上不存在，动作要常驻在节点脚。
- **`toBlocks`**：保留"从数据出发的纯函数"这个形状，分支全换：我们的节点已经是带类型的产物，不需要 parts → blocks 的折叠。
- **色彩与字阶预算**（`shell.md` §2.1、§3.1）：一页最多三处上色、六档字阶里一页最多四档、mono 只给说明、全大写只给节标题。他们是在一页破了之后才写的事后规则；我们在第一屏之前就写成天花板，阅读流应该不超过三档。
- **图标钮三档 / 浮层三档**：尺寸 18–28px 低于 44px 触控目标；Hint 是 hover 专属，手机上没有。只取"全站只有一种按钮配方、一种焦点环"这个纪律。

**不搬：**

- Score、dial：九百行 canvas 加声音，是给"agent 一轮工作"画的；我们的导航问题是兄弟节点与路径切换，deckled 没有这个对象（它的分支是复制整条对话，用 ReactFlow 画成独立的 Timeline 面板）。
- streamdown 及其 CJK 插件：两个 agent 意见相反。设计系统那份说搬，理由是 CJK 标点紧贴强调的失效形（`*他说"别动。"*`、动作斜体以 。！？ 收尾）在小说里比技术文档更常见；transcript 那份说不搬，理由是每个 delta 整段重解析是手机预算的敌人。**取后者**：我们的正文是卡声明的散文，标记只有段落、动作斜体、对白引号，一个几十行的自家渲染器处理 CJK 边界是平凡的；把那张标点用例表（exploration §3.3）直接当它的测试。
- 工具行、审批、提问、任务 dock、委派、模型选择、技能、提及、附件：全是 agent 专属。
- 圆角例外清单、截图断言：他们自己废了。

## 2. 流程：这才是最该搬的

- **issue 的形状**：目标 / 要做的 / 生产里有 rig 里没有的按下列处置 / 删除 / 不变式 / 验证。不变式一栏（"消息区只有一个滚动主人"、"浏览永远不改变正文滚动位置"）是把设计判断变成可断言的东西。
- **先在仓库外探索，回来按原语改写**：#406 "视觉与交互方向先在仓库外探索（claude.ai Artifact），稿子回来后再按本仓库的原语改写落地"；#445 的胶囊是在 Design canvas 的画板上定的，issue 里写"取画板的答案，不多取"。
- **rig → 走查 → 生产**：每个大改先做 `?page=` 靶场，用真实长度的场景（长思考、多工具交替）走查手感，再进产品；bake-off 做成 rig 里的切换钮，当天删输家连码。
- **走查怎样才有产出**：agent 读全部源码并用 playwright 跑通全链路，浅深两色、展开态、等待态、失败态逐一截图核对，再给人看；每条用户裁决记成带原话的编号行。反例也记了：在 mock 数据上做 A/B 误导过一个骨架级决定，"骨架级的决定在真页面上定"（`shell.md` §9）。
- **规则写在破之前**：预算、控件族、焦点环都是审计数出"6 档按钮尺寸、5 种 hover、3 种焦点环、26 个无 focus-visible 的类"之后才立的。我们有机会反过来。

## 3. 对协议与客户端的要求

- 事件流加 `seq`，`GET /nodes` 作为快照；断线重连靠它。现在的 server 没有（一进程一局，demo 够用），进持久化时一起加。
- 客户端的回合状态从 `stage` / `call` / `node` 派生，不从 SSE 连接状态派生。
- 节点投影已经够用：正文 parts、状态、事件、揭示正文都在。还缺的是**节点的兄弟**：客户端要画"这个节点有几个兄弟、现在读的是哪个"，`Node` 投影要带 `siblings`（同父节点的 id 列表）或由客户端从 `nodes()` 推。
- 搬的代码全是 React（函数组件、`useSyncExternalStore`、ref 模式）。采用它们等于把框架定成 React + Vite；这是一个决定，不是默认。
