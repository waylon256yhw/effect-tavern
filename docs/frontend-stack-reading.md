# 读四个前端对照：gpui-kit、mygo、zeron、T3 Code

2026-10-19。这一轮的问题是客户端的技术选型，特别是"React 生态之外有没有能走多端的栈"。读了四个，全是 2026-10-17 到 10-19 的 `main`：

- **gpui-kit**（longbridge，v0.8.0）：Rust 桌面框架，建在 Zed 的 GPUI 上，`gpui-base` 行为层加 `gpui-component` 视觉层加 `gpui-shell` QuickJS 脚本层，75 个组件，AccessKit，WASM 展示。Longbridge Pro 自用。
- **mygo**（egoist）：Go 桌面应用框架，纯 Go 无 cgo，一个窗口要么是系统 webview 里的网页，要么是 Go 自己在 GPU 上画的原生 UI；原生 UI 也能编成 wasm 在浏览器 canvas 上跑。35 万行 Go，113 篇文档。
- **zeron**（zeronsh）：coding agent 控制台，从 Electron 加 React 加 mugen 整个重写成 Rust 加 gpui，3.5 个月 940 个 PR；有 iOS app。
- **T3 Code**（pingdotgg）：coding agent 控制台，Effect 服务端加共享 contracts 加 client-runtime 加 React web、Electron、React Native 三端，五十万用户。

方法同前：四个 agent 分片读源码，我读 ARCHITECTURE、research、performance 一类文档并抽查六条最重的结论（zeron 的 iOS 不跑 gpui、弹簧常量与重钉规则、T3 Code 没有 delta 事件、续传预算、gpui-kit 的 wasm 在触屏上把输入框设成只读、mygo 的浏览器后端），都成立。

## 0. 高度

**这一轮的问题有了答案：四个里只有 T3 Code 到了手机，而且走的是 React Native 原生，不是浏览器。** 三个"新潮"的原生栈没有一个能到手机浏览器，它们自己说的：

- zeron 的 iOS 是第三版，UIKit 加 CoreText 画 Rust 算出来的显示列表，gpui 在手机上的份额是零。前两版（SwiftUI 套在每个 cell 里、UITableView 加 hosting）各死于一次"每个 token 重建全部行"。
- gpui-kit 的 WebAssembly 文档自标 `maturity: showcase-only`，画廊的 loader 在触屏设备上主动把隐藏输入框设成 `readonly` 加 `inputmode=none`，注释写"在手机上通过离屏 input 往 canvas 打字本来就不可用"；web 端零系统字体，CJK 靠 42KB 的子集加浏览器 canvas 逐字代画；原生 iOS 是 experimental，依赖一个 GPUI 版本不对齐的 fork，验证范围是"UIKit 保留导航栏和底部输入框，GPUI 只画中间一块"。
- mygo 没有 iOS / Android backend。wasm 端能加载，但滚动文档只列滚轮、触控板、滚动条、键盘，文字由 canvas 画所以不可选、不可放大、读屏不可见，包体 8 到 10 MB。

**但它们交出了同一份与框架无关的 spec。** 四个项目在转录面上收敛到一组技术（§2），谱系是 chenglou 的 pretext 加 wingleeio 的 mugen：块粒度的行加稳定 id、高度在显示前精确、弹簧式跟底加只从输入事件打断、只重解析最后一个开放块、高亮与淡入只在 paint 层。zeron 从 web 带进 Rust，又从 Rust 带进 UIKit，三次都成立；gpui-kit 和 mygo 各自独立做到了其中大半；T3 Code 在 React 里做到了一部分。这和 agent-harness-survey §2 是同一种读数：互不相关的系统收敛到的地方，就是经过验证的工程。

**T3 Code 另外交出了缝的形状。** 它是"Effect 服务端拥有会话、共享一份 Schema、客户端跑一个 runtime"这条路上规模最大的样本，而缝的设计只有几条规则（§3），我们已经在 Effect 上，可以直接搬。它也给了一个反例：线上没有 delta 事件，每 50ms 发整段累计文本。对工具多、文本短的代码代理合理，对几千字的中文散文是浪费。我们的 `delta` 是对的，但要在服务端按 50ms 攒批。

**三堆，对这四个一起下：**

(a) **与框架无关、直接当 web 客户端规格的**：§2 的收敛表全部，§3 的缝。
(b) **只因原生才存在的税**：zeron 必须 fork gpui 打十几个补丁（去 GPL crate、毛玻璃、换行规则、图片 atlas 泄漏、macOS 26 的 CABackdropLayer），睡眠唤醒后 CVDisplayLink 卡死，手搓 16,330 行 composer 才有 IME，CJK 字宽全靠 FFI 回退测量，38 份性能与回归文档，CI 30 到 45 分钟；gpui-kit 的字体、无障碍、IME 在 web 上全要自己背；mygo 每帧重建 view 树，与 DOM 不兼容，复用不了任何 web 组件。浏览器把这些全包了，这就是我们不出 web 的理由，不是偏好。
(c) **能不能到手机**：上面说了。原生栈三个都到不了手机浏览器；T3 Code 到手机的代价是一套与 web 零共享 UI 的 React Native app，markdown 和 composer 都是原生模块。

## 1. 四个是什么

| | 栈 | 对象 | 到手机 | 中文 IME | 转录面规模 |
| --- | --- | --- | --- | --- | --- |
| gpui-kit | Rust，GPUI 0.3.9 预发布 | 桌面组件库 | 原生 experimental（嵌一块），wasm 自判不可用 | 桌面成熟：内联组合加下划线、候选窗定位、韩文逐键特判（`state.rs:4303-4716`） | `message_scroller.rs` 578 行，`virtual_list.rs` 905 行 |
| mygo | Go，无 cgo，Metal / D3D11 / GL / CPU | 桌面应用框架 | 无 backend；wasm 无触摸滚动 | 桌面三平台真接口（NSTextInputClient / GtkIMContext / WM_IME_REQUEST）；浏览器端隐藏 textarea 转发，手机未验证 | `ui/markdown` 9.2K，`ui.List` 虚拟列表 |
| zeron | Rust 加 gpui（fork）；iOS 是 UIKit | 代码代理控制台 | 是，但不经 gpui | 桌面手搓 `EntityInputHandler`（`composer.rs:4592-4760`）；iOS 用原生 `UITextView` | `transcript.rs` 16.2K，`composer.rs` 16.3K，`markdown/render.rs` 4.5K |
| T3 Code | Effect 加 React；Electron 加载 web；RN 原生 | 代码代理控制台 | 是，RN | `isComposing || keyCode === 229` 一行（`composer-logic.ts:51`），移动视口 Enter 不发送，无 visualViewport | `MessagesTimeline.tsx` 加 `.logic.ts` 约 3.5K |

## 2. 转录面的收敛表

| 技术 | zeron（桌面 / iOS） | gpui-kit | mygo | T3 Code web | 本项目设计稿 |
| --- | --- | --- | --- | --- | --- |
| 行 = 一个 markdown 块，不是一条消息；id 稳定 `{msg}#{part}.{block}`，流中与写完同形 | 是（`transcript.rs:1-16`） | TextView 可滚动时本身就是块级 list | 块级 | 行 = 消息，按 id 复用行对象 | 节是单位，节内按段落 memo 即是此条 |
| 高度在显示前精确，前缀和偏移，可见范围二分 | iOS 是（`LayoutFrame`，无估计、无 self-sizing，SQLite 高度缓存计划作废）；桌面 gpui list 测量式 | `virtual_list` 解析式，`message_scroller` 测量式加接缝重测 | `ui.List` 量过的估未量的，按行锚定 | LegendList `estimatedItemSize=90` | 未定；web 可用 `content-visibility` 替代 |
| 跟底是弹簧，带前馈项追流式增长 | 常量 damping 0.7 / stiffness 0.05 / mass 1.25 / growth EMA 0.12 / lead 32px（`transcript.rs:184-205`） | `FollowMode::Tail` 在 GPUI 内 | `FollowAnimation` 弹簧 | `maintainScrollAtEnd` 切 smooth | 未定 |
| 打断只从输入事件判断，不从滚动位置；重钉要求向底移动 | 断：`d > prev + 1 && d > 2`；重钉：`d <= 70 && d < prev`（`:3907-3968`） | 用户滚动清 tail，`scroll_to_end` 重设 | 用户上滚脱钩、回底重挂 | `[overflow-anchor:none]` 加 `maintainVisibleContentPosition` | Deckled 状态表同义 |
| 距离判停不用速度；超 2.5 屏直接 teleport | 是（`:285`） | | | | |
| 发送后把提问钉在视口顶部，下面留一屏（own-turn runway） | 桌面 `OwnTurnAnchor`，iOS 照抄（`TranscriptListView.swift:126-134`） | | | | **设计稿已定**（client-shape §一"流式不跳"），这里是独立的第二次出现 |
| 增量解析：只重解析最后一个开放块 | 从倒数第二个顶层块行首重解析，`3` 变 `3.` 可能并入前面的 loose list（`parser.rs:2104-2113`） | 弹出末块重解析，≤4KB 同步否则后台（`state.rs:1314-1352`） | 只重解析最外层未闭合块，已完成块永不改 | 以闭合围栏加空行为边界缓存前缀 mdast | 自家子集渲染器按段落 |
| 半写语法显示为"将成之物" | `mend.rs` 只在显示树上闭合 `**` 和 `[link](` | | `**bol` 已加粗、未闭合 fence 已是代码、表头等分隔行再出现 | | |
| 高亮与淡入只在 paint 层，永不改布局 | 是；fade 靠 cosmic-text 忽略颜色 run | `stream_fade.rs` 按字节区间 | 淡入只影响 paint | CSS `@starting-style` 只在 `data-streaming` 时 | |
| 揭示节奏按词或句匀速，中文句界含 `。` | | | `Stream` 250ms 追平，`BySentence` 含 ideographic full stop | | |
| 解析在后台，旧结果作为前缀先提交 | | 是（`state.rs:597-640`） | | | |

读数：**前六行是滚动，后五行是文本，两组互不依赖。** 滚动那组在 web 上要自己写（LegendList 的 `maintainScrollAtEnd` 周围的 workaround 注释说明现成库并不省心），是几百行；文本那组我们的正文是卡声明的散文，标记只有段落、动作、对白，"只重解析最后一个开放块"退化成"只重渲染最后一段"，是平凡的。

## 3. 缝：T3 Code 怎么把服务端的会话送到客户端

传输是 WebSocket 加 `effect/rpc`，不是 SSE；HTTP 只做快照与历史分页。形状只有几条：

1. **流项三元组**：`snapshot{snapshotSequence, projection, historyCursor, hasMoreHistory} | event{sequence, event} | synchronized`（`orchestrationV2.ts:3296-3315`）。客户端按 seq 去重；服务端先订阅 PubSub 再读持久化尾巴，重叠靠去重（`ws.ts:862-864`）。
2. **续传预算**：带 `afterSequence` 来的订阅，重放最多 128 条、1 MiB，超了或中间有 create 事件就退回快照（`ThreadStream.ts:14-16, 91-108`）。十行逻辑。
3. **冷开有界快照**：最近 10 个用户轮或 75 行或约 1 MiB（`threadHistoryPaging.ts:13-17`），cursor 是 base64url 的不透明结构，更早的走 HTTP 分页，合并时不动当前滚动窗口。
4. **线上投影剥正文**：命令输出、diff 正文、工具结果在线边界剥掉，只留 `outputOmitted` 与失败标志，按需另取（`WireProjection.ts:97-140`）；性能测试把 10.4 MB 的全量快照压到 128 KiB。
5. **前向兼容的联合**：`ForwardCompatibleUnion` 把未知 tag 解码成哨兵并跳过，但仍推进 seq（`baseSchemas.ts:163-188`）；协议大版本 `ORCHESTRATION_PROTOCOL_VERSION = 2` 才硬断，URL 带版本，不匹配 426。
6. **客户端 runtime**：`effect/reactivity` 的 `Atom` 加 `SubscriptionRef`，事件按批 `Stream.runForEachArray`，批内去重后一次 `modify`，reducer 对流式项只做 `findIndex` upsert，注释明写"流式文本更新不得重新检查每行可见性"（`orchestrationV2Projection.ts:295-317`）。进 React 用 `@effect/atom-react`。另有 zustand 一轨给纯 UI 状态，无文档解释为何两轨。
7. **两层攒批**：适配器层 50ms 攒 provider 的 delta 再发整段文本；线层 50ms 内对 running 状态的工具项按 id 只留最新。每个订阅有 1000 条或 8 MiB 的预算，溢出即断流让客户端重连重放。

与我们的对照：`server/serve.ts` 现在是一动作一条 SSE，事件无 seq，`GET /nodes` 是全量快照。client-shape §五已经列了"事件的 `seq`"；T3 Code 把它从一个字段扩成上面七条，其中 1、2、5 是协议，3、4 是 server，6 是客户端。SSE 上照样成立，`Last-Event-ID` 天然就是 `afterSequence`。

v2 重写的教训与缝无关：provider id 泄进应用身份、子代理完成误关父 run、副作用藏在 reactor 里。它明说"保留 snapshot 加 cursor 的投影流语义"，变的是事件语义。

## 4. 各自值得单独记的

- **zeron**：`docs/research/mugen-pretext.md` 是整个谱系最完整的一页说明，常量全在；`proto/src/view.rs` 770 行纯派生"每个表面同一个行序"是多端共享的正确切法：共享的是数据到行到高度，画笔各平台自己。它从 gpui 真正带到手机的只有这一层，而这一层本来就不依赖 gpui。
- **gpui-kit**：`gpui-shell` 是"宿主拥有渲染、布局、文本、焦点，脚本拥有组合、呈现、业务逻辑"的桌面插件系统，QuickJS 加能力门加 cap-std，跑在原生进程里，没有 wasm 分支。它解决的是桌面应用的脚本层，不是读者设备上的作者视图；我们的沙箱仍是 iframe 加 postMessage（见 risuai-reading §0 第三条）。它的 §26 诚实列了什么没建，值得当文档范例。
- **mygo**：`ui.NewTester` 无窗口渲染到内存，按文本找元素，`Compose` 模拟 IME；Playwright 可照抄这个测试形状。`Trust` 一节（每窗口随机 secret、只有前端与自定义 scheme 能调 Go）是 Tauri 式 IPC 做对的样子。
- **T3 Code**：`web-ui.md` 的"大组件里的闭包泄漏"一节（V8 给一次 render 里所有闭包一个共享 scope，memo 过的 handler 把整个 render 的 scope 留在内存里）是 React 长寿组件的真问题，我们的阅读面就是这种组件。React Compiler 强制、禁 `useMemo` / `useCallback`。

## 5. 对协议与客户端的要求

**协议，三条，都是 client-shape §五"事件的 seq"那一条的展开：**

1. 事件带单调 `seq`；流项加 `snapshot` 变体，带 `seq` 与历史 cursor。
2. 续传规则：重放条数与字节双预算，超了发快照。
3. 事件联合前向兼容：未知 kind 解码成哨兵并跳过，仍推进 seq。

**server，两条：** `delta` 在服务端按 50ms 攒批再发，不逐 token；`call` 事件在玩家模式下已剥 `msgs`，照此把其余大 payload 也只留 id 与状态。

**客户端，照收敛表取：** 节内按段落 memo、只有尾段随 delta 重渲；弹簧常量与两条打断规则照抄；发送后提问钉顶留一屏，设计稿已有，zeron 是第二票；`content-visibility: auto` 先于虚拟化；淡入用 `@starting-style` 只在流式时；`isComposing || keyCode === 229` 加 Deckled 的 compositionend 时序。

**对栈的回答，这一轮结案。** 问题是"React 之外有没有能走多端的栈"，答案是没有一个到得了手机浏览器，而我们的硬要求是手机浏览器。它们交出的技术全部与框架无关，所以栈仍然按"哪边能抄到更多对口代码"定，这一轮之后的分数：React 加 Vite 那边新增了 T3 Code 的 `@effect/atom-react` 加 `SubscriptionRef` 的 client-runtime 形状（我们已在 Effect 上，这是最大的一笔）、`markdown-incremental` 的前缀缓存、LegendList 的 `maintainVisibleContentPosition` 用法、`isComposing || 229`；Svelte 与 Solid 这边这四个项目没有给出任何东西。桌面以后要包一层的话，T3 Code 的 Electron 只做 `loadURL` 加一个 preload 桥，零渲染差异，也就是 web 先行不欠多端任何债。原生那条路的全部代价在 §0(b)，到手机的那条路（React Native）要一套零共享 UI 的第二个客户端，都不在"demo 的前端要求"之内。

决定：**React 加 Vite，store 用 Effect 自己的 `Atom` / `SubscriptionRef` 加 `@effect/atom-react`，不引 zustand。** 下一步不再读栈，读的是实现：Deckled 的四样（IME 控制器、状态表、折叠原语、reducer）按 T3 Code 的 runtime 形状改写，收敛表的滚动六行在 rig 里做 bake-off 对手是 `col-reverse`（risuai-reading §4）。
