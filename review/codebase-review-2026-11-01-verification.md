# 2026-11-01 review 独立复核

复核对象：`codebase-review-2026-11-01.md` 的七组、31 个条目；代码基线 `b21f669`。下文记录修复前的行为；首次复核未修改产品代码或原报告。本轮修复与验收见文末。

结论：报告抓到了多处真实缺陷，但不能把推荐清单直接当成已验证的 P0/P1 清单。它混合了已修问题、可恢复故障、仅运行时 API 可达的边界、浏览器行为推测，以及维护性建议。尤其需要撤回“摘要缓存不感知 amend”，并改写“永久损坏”“任意跨站网页能删除故事/调用模型”“每个气泡都强制重排”等表述。

验证环境：本机 Bun 1.4.4、仓库已安装依赖、Ego Lite Chromium 156。模型全部使用项目自己的 `fake`；数据库为 `:memory:` 或独立临时目录。HTTP 测试通过 `node:http` 访问临时回环端口，没有改代理环境。浏览器使用已有 Vite 服务承载独立测试页，所有 `/api` 请求均被模拟，未进入真实故事和密钥库。

标记含义：**确认**表示行为已由复现或直接调用链证实；**部分成立**表示问题机制存在，但原文的影响、条件或附带结论不准确；**未复现/待验证**不等于跨环境均无问题；**建议**不作为功能缺陷。

## 最值得先处理的已确认问题

1. **HTTP 错误响应被当成正常数据。** `fetchCard()` 收到 404 后正常 resolve，把 `{error:"no story"}` 写进 `card`；`fetchNodes()` 更隐蔽：错误对象经 `Log.of()` 变成空日志，原本显示的节点被清空。[wire.ts](../packages/client/src/wire.ts#L52)
2. **无故事时修改快捷输入会请求错误的卡片接口。** `Inputs.put()` 完成 `putPlayer()` 后直接 `fetchCard()`；这时服务端确实返回 404。延迟 PUT、切换 current，再放行 PUT，可观察到两次请求分别携带故事 1、2 的请求头。[writing.tsx](../packages/client/src/writing.tsx#L566)
3. **`demand` 落盘取消正在编辑的玩家台词。** 开始 revise，再送入 demand 的 change 事件，`revising` 变成 null；下一次发送产生无显式 `parent` 的 act，落到当前 head 之后。[store.ts](../packages/client/src/store.ts#L360)
4. **卡页的开场白索引与开始按钮竞态。** 同一 CardPage 从 A 的第 4 个开场切换到只有 1 个开场的 B，显示“没有开场白”，仍发送 `greeting:3`。首次建故事请求未完成时双击，会发出两个 `POST /stories`。[card.tsx](../packages/client/src/card.tsx#L57)
5. **祖先 `setField` 可以破坏后代重放。** 祖先 hp 从 10 改成 0 后，后代已有动作的 `when: hp>0` 不再成立；snapshot 和新 Session 的 snapshot 均失败。恢复祖先 hp 后两个节点都恢复可读。应在接口边界处理；当前客户端只有 transport 方法，没有找到调用 `turn.setField` 的 UI。[session.ts](../packages/runtime/src/session.ts#L815)
6. **正式入口的暴露面需要明确。** 入口未限定监听主机、密钥读取无鉴权、`inspect:true` 泄露完整调用提示词均有代码或隔离 HTTP 证据。是否为仅本机/可信设备使用，决定解决方案与发布阻断程度。不要把开发辅助代码、提示词可见性和网络鉴权三件事合为一个无条件 P0。

## 一、架构

| 原条目 | 复核结果 | 独立证据与修正 |
| --- | --- | --- |
| I.1 生产/开发耦合、inspect | 部分成立 | `bun build ... --target=bun` 产物包含 `MockLanguageModelV4`、`credentials.json` 探测代码和 `inspect:true`。隔离库的假卡片 `REVIEW_PRIVATE_FRAME` 在 inspect=false 的 calls 中被剥离，true 时返回。证明的是**代码及运行时读取逻辑被打包**，不是本机密钥值被编译进二进制；未执行 Android 二进制。原文的 `import {dist,handler}`、`handle(lib,...)` 代码摘录与当前入口也不完全一致。 |
| I.2 got 未检查状态 | 确认 | 404 卡片读取污染 `card`；404 节点读取把已有日志变成空日志。不同接口后果不同，不能全描述成把 error 对象直接写入 Atom。写入失败的反馈还需按调用者区分，有些 provider/secret 写接口已经走 `checked()`。 |
| I.3 全局故事头、空故事 404 | 确认 | 无故事下 `/card` 为 404；模拟 await 期间切换故事，PUT/GET 请求头为 `["1","2"]`。由于 Player 本身全局共享，后续 GET 当前故事不一定就是错误，真正风险在响应落点及页面切换；空故事缺陷则无此歧义。 |

## 二、逻辑与边界

| 原条目 | 复核结果 | 独立证据与修正 |
| --- | --- | --- |
| II.1 点号字段与 lore 命名碰撞 | 确认 | `npc.trust` 的卡片解码、lint 无 error；初始状态确为扁平键，`available()` 却抛 `unknown state path npc.trust`。`lore` 字段同样通过 lint，参与 offer 数值比较时报 `lore is not a number`。`toString` 会读到继承属性而不报 unknown-path；未据此宣称存在代码执行。 |
| II.2 setField 永久损坏存档 | 部分成立 | 用真正的 SQLite Store 写入，重开 Session 后仍重放失败，故障会持久化。**数据没丢、并非不可恢复**：恢复祖先字段即可修复。现有 UI 没找到 setField 调用者，应描述为协议/运行时缺陷。 |
| II.3 摘要缓存不感知 amend；demand 过期快照 | 部分成立，主论点不成立 | 当前 `makeSummaries` 同时比较区间内 Turn 对象身份。测试中旧摘要 `old tail` 在替换 Turn 后变成 `new tail`，`summaryFor` 也先返回 undefined；该机制在早于本 review 的 `9f9559a` 已存在。附带的 demand 过期快照问题在直接运行时 API 中可复现：先构造两个 stream，再顺序执行，第二个覆盖第一个 product；HTTP 层同故事并发动作返回 409，不能据此断言常规 UI 并发会丢数据。UI 的 demandable 还只提供尚不存在的产物。 |
| II.4 judged action 缺 chance | 确认，收窄“崩溃” | `{next:"jump"}` 能通过动态 schema，随后 settlement 抛 `judge chance missing`，可让整轮失败。`server/turn.ts` 会把失败转换成 error 事件，不能描述为必然击穿服务进程。`roll.path` 值 5 的确被接受；超界概率没有校验，但比较结果等价于概率钳制到 1，不能把它与缺 chance 的故障等同。 |
| II.5 seeds 重置 | 确认行为 | 同一 SQLite 故事先跑两次，重建 Session 再跑一次，seed 为 `[1,2,1]`，roll 为 `[0.3359475394676412,0.9925923289042096,0.3359475394676412]`。历史重放稳定，但新动作序列重启后重复；修复应区分已记录 seed 与新 seed 的来源。 |
| II.6 demand 清 revising | 确认 | 实际 store reducer 和 createTurn 已复现：改写状态被清除，下一次 act 不再携带原节点的 parent。setField 的 change 以及无 draft 的其他 change 也经过同一路径，不能只给 demand 打补丁。 |
| II.7 切卡开场索引、Begin 重入 | 确认 | 真实 Solid CardPage 中复现，浏览器日志含 `greeting:3` 和两次建故事 POST。原文“两次 greet”的最终落点仍受后续异步完成顺序影响，证据直接确认的是两次创建请求。 |
| II.8 文件锁与 SIGINT | 部分成立 | 人工构造空 `.lock` 中间状态后，确实把 PID 解成 0 并分流，但目录是 **当前进程 PID**，不是 `<dir>/0/`；`readFileSync` 的 ENOENT 竞态缺保护可由代码确认，未做随机并发撞击。SIGINT 分支明确把退出权交给其他 listener；没在真实 Vite 中复现“不退出”，不能仅凭存在其他 listener 就判错。 |

## 三、性能

| 原条目 | 复核结果 | 独立证据与修正 |
| --- | --- | --- |
| III.1 snapshot 重复查询与路径扫描 | 确认，有条件 | 100 个节点一次 snapshot：无默认 route 时 routing read 100 次、providers list 0 次；有默认 route 时各 100 次。`pinned` 模式还会跳过 routing 查询。二次扫描来自每节点重新 `chain`、`settledAlong`、gated、readable；长单链的 O(N²) 机制成立，但没测手机 500 节点是否已越过产品门槛。 |
| III.2 exists/cardOf 重型 listing | 确认 | instrumentation 看到二者各调用一次 `data.stories.list(undefined,id)`。SQL 是递归回溯 **head 的祖先链**，不是整棵分支树；prepare 每次执行也确实存在。优先换轻量单行查询，statement 缓存是否值得可另测。 |
| III.3 关闭的 RecordSheet | 确认 | 挂载真实组件：100 个关闭 dialog、100 个内部 Record；追加一个 log 节点后实测 200 次 `JSON.stringify`。这是最直接的前端性能证据。 |
| III.4 dust 百万粒子、纹理与闪烁 | 部分成立 | 672×1500 的真实 dust 调用分配 4,032,000 字节 float buffer，即 1,008,000 个顶点；刚调用时旧元素仍 visible，完成后 hidden。未实拍新旧文字叠帧，因此闪烁仅有时序依据。测试机 MAX_TEXTURE_SIZE=16384、DPR=2，没有复现纹理溢出；4096 的移动 GPU 门槛需在目标设备验证。上限应针对上传的 image 尺寸，不要把带 margin 的绘制 canvas 尺寸直接当成纹理尺寸。 |
| III.5 Digest sent 重复扫描 | 确认调用机制 | `changed()` 对匹配到的 key 各调用两次 `sent()`，JSX 再读 `sent().size`；K 个都匹配时每次求值是 2K+1 次构造。当前 `changed` 也是普通函数，原文称其 memo 不准确。尚无端到端耗时测量，属于明确可消除的重复计算。 |

## 四、可维护性

| 原条目 | 复核结果 | 独立证据与修正 |
| --- | --- | --- |
| IV.1 三个大文件 | 建议 | 行数确为 893、1073、811。职责拆分可讨论，但大文件本身不能证明缺陷；应按可独立变化的接口切分，不能仅为缩短文件移动代码。 |
| IV.2 node.id 与 node.turn.id 混用 | 建议 | 当前 Node 投影由同一个 Turn 构造，`id: t.id, turn: t`，两者相等是实际不变量。统一命名可读性有价值，当前没有复现由此导致的查找错误。 |
| IV.3 recall 编码与 pin 缺校验 | 确认校验漏洞 | 构造 `people@0#999`，实际 narrate call 的提示词中出现 `undefined`。测试使用的索引既不在 readable 中，也不在产物数组中；失败点是未验证用户 pin 引用，不是“字符串编码”本身必然脆弱。测试中 check 没把该层记为 fired，所以最终 delivered 为空；污染发生在本轮 Prompt。 |

## 五、安全与传输

| 原条目 | 复核结果 | 独立证据与修正 |
| --- | --- | --- |
| V.1 监听、明文密钥、跨站请求 | 部分成立 | `.listen(port)` 无 host 限定意味着通配地址（常见为 `::` 双栈，未必字面 `0.0.0.0`）。隔离测试无认证读取虚构 key 成功；带不可信 Origin、cross-site 和 text/plain 的 POST `/stories` 返回 200。**普通跨站简单请求不能随意发 PUT/DELETE 或自定义 `x-tavern-story`**；不带故事头的 act POST 实测 404。因此“任意网页可删除故事或触发模型调用”没有被该攻击例证证明。未测试浏览器本地网络权限、真实 LAN 暴露或恶意站点利用，服务端拒绝跨站写入仍值得补齐。 |
| V.2 百分号编码异常 | 部分成立 | `/secrets/%FF/value` 的 handle 返回未捕获 URIError rejection，静态路径 `/%E0%A4%A` 同样成立；但原报告示例 `/cards/%FF` 位于 reply 回调内，**已经捕获并返回 404**。开发 Vite 的 `/api` 外层还有 catch；正式入口没有这一层。未通过杀进程试验声称一定导致服务退出。 |
| V.3 超大请求体 | 确认 | 向临时 HTTP 服务发送超限 ASCII JSON，客户端得到 `ECONNRESET`，而非有用的 413/400 响应。拒绝后 destroy，再进入回复路径的机制成立；未声称会崩进程。 |

## 六、交互

| 原条目 | 复核结果 | 独立证据与修正 |
| --- | --- | --- |
| VI.1 编辑器段落丢失 | Chromium 未复现 | 挂载真实 App/Editor，粘贴 `alpha\n\nbeta` 后 DOM 为 `<p>alpha</p><p>beta</p>`、innerText 保留双换行。全选退格后留下 `<p><br></p>`，输入 fresh、Enter、line 仍为两个 p。代码有 `defaultParagraphSeparator=p`，单换行 insertText 不等于最终 DOM 只有单换行。Safari/Firefox 未测，不能作跨引擎无问题结论。 |
| VI.2 Inspector 修饰键 | 确认 | 对真实 Inspect 发出带 metaKey 的 `[` keydown，defaultPrevented=true，page 切为前一节点。 |
| VI.3 手机无法操作故事按钮 | 部分成立 | 390px、hover:none 触屏模拟中，初始按钮组 opacity=0、pointer-events=none；但等布局稳定后在收藏位置触摸，Chrome 合成的 hover/click 使按钮可用，实测发出 starred PUT，没有打开故事。**隐藏与难发现成立，“完全无法操作”过强**；iOS/Android 真机仍需验证。 |
| VI.4 空框 `/` 一律拦截 | 原文空列表场景不成立 | snippets=[] 时 `<Show when={quick().length>0}>` 不挂载 menu，条件里的 `&& menu` 阻止拦截；真实 Composer 的主 textarea 收到 `/` 时 defaultPrevented=false。原文引用的 `usable()` 在当前文件不存在。有短语时 `/` 是已有快捷键设计，是否增加字面输入方式属于 UX 决策。 |
| VI.5 卸载清理 | 部分成立 | Confirm 卸载后调用 ask 可复现 InvalidStateError，但现有 UI 是否存在卸载后调用路径尚未证明。Manager 中输入查询后立即卸载，200ms 后仍发出搜索 GET，已复现；side 的相同机制及 shell 等 timer 可静态确认，但有限 timer 不能笼统称永久泄漏。Timeline 的 subscribe 只在目标进入 path 时释放，失败时确会保留；服务端已拒绝 busy 的 checkout，因此需补失败/取消清理，未做堆内存量化。 |

## 七、样式

| 原条目 | 复核结果 | 独立证据与修正 |
| --- | --- | --- |
| VII.1 anchor positioning 无回退 | 待目标浏览器验证 | 当前 `.latest` 确无常规 inset 回退，但本次 Chromium 支持 anchor，未测不支持的浏览器。fixed 的 auto inset 也不能直接推出坐标必为 `(0,0)`。报告把 Firefox 整体列为不支持的说法未做版本核实，不予采纳。 |
| VII.2 大字号负渐变起点 | 条件性成立，触发路径未证实 | 当前变量为 `--line-prose`，不是原文的 `--step`。默认 16px×1.75×0.75=21px，head=24px，实测透明起点为 3px。若根部正文大小改成20px，算式将得到 -2.25px；但当前 Writing 页没找到字号控制。浏览器 probe 只局部覆盖子元素字体变量，没有改变在根部已计算并继承的 gap，实测仍为3px；不能把这个 probe 算作视觉复现。 |
| VII.3 硬编码颜色 | 建议 | 色值存在，但颜色语义不同不必然要求复用同一 token；未找到“所有字面色值一律禁止”的项目规范。属于一致性检查，不是已确认功能问题。 |
| VII.4 shrinkwrap 强制同步布局 | 部分成立 | 读计算样式/写 width 的交替存在。对真实 shrinkwrap 的100气泡缩放，用 CDP 实测 **51次 RecalcStyle、2次 Layout**，布局耗时约1.2ms（本机单次样本）。不能据此说每气泡一次强制重排，或证明已经导致可见卡顿。批量读写仍是合理候选优化。 |

## 收敛修复与回归（同日）

按用户确认的 10 组范围修复。鉴权、Origin/CSRF、密钥明文查看和 `inspect: true` 保持现状，由 Issue #127 另行规划。未拆分模块，也未修改 Editor 或 Composer 的 `/` 快捷键。

临时复现脚本断言的是缺陷行为，已清理 `review/repro-2026-11-01/`。回归断言并入现有测试：

- `packages/client/test/pages.ts`：404/409/500 读取均 reject，card 与 log 保留原对象。
- `packages/client/test/turn.ts`：demand、setField 保留 revising，后续改写仍发送原 parent，新回合落盘后清除。
- `packages/runtime/test/card.ts`、`test/lint.ts`：点号扁平字段优先，嵌套 lore 路径正常；禁止 lore 保留字段；检定缺 chance 在 Schema 阶段失败。
- `packages/runtime/test/loop.ts`：不可读及越界 recall pin 在模型调用前拒绝，可读引用正常进入 Prompt；祖先修改检查非当前分支的后代，失败不写入，合法修改可重开，seed 接续。
- `packages/server/test/data.ts`、`test/library.ts`：轻量单行读取；exists/cardOf 不依赖递归 listing；100 节点 snapshot 仅查询一次 routing/provider，下次 snapshot 能读到变更。
- `packages/server/test/serve.ts`：API 与静态非法编码返回 400；超限请求断开后 handler 正常结束且不写响应头。

真实浏览器组件验证（用户已有 Vite 服务，隔离页面）：

- CardPage 从第 4 个开场切到另一张卡时回到第 1 个，同卡刷新保留所选开场；连续两次点击仅创建一个故事，请求期间按钮置灰。
- 100 个关闭 RecordSheet 内部挂载记录数为 0，追加日志时 JSON.stringify 次数由 200 降为 0；打开一个挂载 1 个，关闭后恢复为 0。
- Inspector 的 meta/ctrl/alt + 方括号均不 preventDefault；无修饰键仍能导航。
- Writing 快捷输入：无故事时 PUT `/api/player` 后 GET `/api/cards/b`；有故事时 GET `/api/card`，均无异常。
- CardPage、RecordSheet、Inspector 使用与应用共享 OBSERVE 实例的 captureArtifact / expectNoDiagnostics，无 diagnostics。API 与 Storage.setItem 均被模拟，未写入用户库；测试空间已关闭。

最终验收：`vp check` 与 `vp run verify` 均通过，格式、lint、类型检查及各包回归全部通过。另仅规范化基线中现有的格式问题以满足检查。未测试真实模型服务、Android、Safari/Firefox 或远程部署，这些不在本轮范围内。
