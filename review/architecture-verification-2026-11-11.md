2026-11-11，基于 `0275127`。独立核验 Claude 的九项 architecture proposal，判断标准：改善当前内聚，减少重复知识，不为未来协议扩展增加抽象。未修改实现。

结论：主要问题是少数规则存在多个所有者，并非后端整体分层需要重做。建议封盘前处理 1、8、2、3；4 做小范围收敛；5 拆开处理；6 只做一次性升级门；7、9 暂缓。

| # | 核验结论 | 建议范围 |
|---|---|---|
| 1 响应类型 | 成立；三个类型缺项均存在，但不能直接称为运行时丢数据 | 由生产方导出类型，客户端和 CLI 引用；统一 HTTP 失败解码 |
| 2 stage reading | 成立；预览标签错误已复现 | 共享实际读取策略，保留预览与执行各自的流程 |
| 3 world 派生 | 成立；已有可测成本 | 收敛进 Derived，修复缓存依赖和重复折叠 |
| 4 draft fold | 重复与分歧成立；正常生产流程触发条件尚未证实 | 共享 Draft 核心和纯折叠，不搬播放队列、UI 副作用 |
| 5 卡片路径 / 机械投影 | 路径方言、部分能力缺失成立；部分“缺项”是设计要求 | 分成两个任务，保留工坊的封闭输出词汇 |
| 6 数据升级 | 每次打开扫描及重复 DDL 成立；当前丢列未发生 | 一个基线版本戳；不补造历史版本体系 |
| 7 deliveries builder | 重复存在，但三种 previous 有阶段上的理由 | 暂缓大 builder；没有证据表明当前结果错误 |
| 8 install gate | 成立，收益明确 | 值级校验与预览分开，共享 decode / validate / lint |
| 9 provider 探测 | 归属可以改善，但不是缺陷 | 触及该代码时搬迁，保留 library 的查表与凭证解析 |

**1：类型统一值得先做，但要区分契约遗漏与行为错误。**

证据：`runtime/src/session.ts:150` 的 `cardView` 返回 catalogs；`client/src/store.ts:61` 的 CardView 未声明。`server/src/library.ts:76` 的 Routing 支持 author；客户端只用 Phase。`server/src/data.ts:174` 的 Input 缺 invoke，但 stories.list 是解析整份 input JSON，SQL 已把 invoke-only 节点计入，不能说 invoke 被接口实际删除了。

类型从产生数据的模块导出即可；已有 `ReturnType<Library[...]>` 用法可延续。无需独立协议包、代码生成或全量响应 runtime schema。共享声明仍不等于验证 JSON。

实际用户可见的问题是 `client/src/wire.ts:290` 把非 2xx SSE 响应作为原始 JSON 字符串显示，普通请求的 got 也丢掉 code。可统一失败解码，同时保留各自状态处理。

**2：共享规则成立，“预览必然等于运行”需要限定。**

证据：`runtime/src/view.ts:98` 与 `session.ts:204` 重复 lore 展开；view 的 asked / penned 与 session 的 record / narrate 重复选择条件。view:124 用旧的 `L.readable` 生成标签，真正 lookup 则由 `contextLookup` 决定。

复现：给 wuxia 卡换入一个解锁、`access.model=false, access.player=true` 的 lore，运行 `view(..., {stage:'lookup', lore:true})`，lore 段仍输出 `in the index`，lookup 文档则不含该内容。这是作者预览误报，未发现因此向模型泄漏内容。

建议共享 lore 名字展开、资源读取资格、产品选择和 guard 展开等策略；让 Derived 提供路径事实。view 保留 greeting / state 覆盖与解释文本，session 保留阶段顺序和模型调用。不要做一个包含大量 stage / mode 标志的万能 request builder。

空历史预览无法凭空拥有真实会话的 resident、revision、压缩与历史 world。验收应比较相同输入事实下的策略结果，不能承诺任意 preview 与 play 字节一致。

**3：提升优先级，问题已不限于代码整洁。**

证据：`runtime/src/derived.ts:123` 的 settleTurn 只在 world 无键时命中缓存。wuxia 声明 world 产品，初始空表仍有产品键。`world.ts:25` 的 applyChanges 即使 changes 为空也 structuredClone；`session.ts:994` 的 timeline 对每个节点分别折叠自己及父节点的路径。

本机 Bun，真实 wuxia 卡、合成直链已提交节点；每节点短 prose、空 beats / answers / changes；使用内存 Store 载入，模型入口直接抛错确保不调用模型。每个长度同一 session 连续调用 timeline 四次：

| 节点数 | wuxia timeline，四次 ms | 移除 world 产品的对照，四次 ms | wuxia activeContext 单次 ms |
|---|---|---|---|
| 100 | 10 / 8 / 8 / 7 | 2 / 1 / 1 / 2 | 1 |
| 500 | 164 / 167 / 163 / 166 | 17 / 15 / 13 / 13 | 2 |
| 1000 | 665 / 661 / 660 / 661 | 53 / 52 / 53 / 53 | 3 |

这是合成微基准，不是真实长局、HTTP 延迟或手机性能；对照用于显示 world 路径成本，不代表优化后的结果。已足以支持在封盘前处理，尤其 timeline 是同步计算。

建议由现有 Derived 持有前缀的 fields/world 派生结果，让同一节点的多个读取复用。不另建 world service。不能仅删除非空 world 的缓存限制：settle 读取 world，缓存必须包含这一依赖；祖先 amendment 与当前产品初始定义也必须得到正确失效。先消除重复计算，仍慢再考虑结构共享，暂不引入持久化快照或通用缓存框架。

**4：统一的是 draft 内容折叠，不是客户端与服务端全部状态机。**

`server/src/turn.ts:119` 的 track 在 narrate 且 text 非空时才清 products；`client/src/store.ts` 的 applyNow 在 narrate 时总清 products。二者对“空正文但已有产品，再开始 narrate”的结果不同；本次没有证明正常模型流程必然产生该序列。

客户端初始化 draft 是 action → draft，并非第三份 event fold；它还保存 composition 用来恢复输入框。这些应继续归 UI。建议共享核心 Draft 与 stage / delta 的内容折叠；服务器保留 run、stop、订阅与失败交接，客户端保留播放队列、composition 与 Atom 更新。不要为了图上的对称要求 CLI 也维护自己不需要的 draft。

**5：不同 schema 不等于错误；不能自动把 Card 能力全放给模型。**

`runtime/support/workshop.ts:8` 的机械输出 schema 确实缺 start、catalog 列以及多项产品行为字段。`view.ts:175` 与 lint / workshop 的路径也确实不统一。

但是 `docs/workshop-brief.md` §1 明确要求模型不填 Field.label / group 等展示词，§2–3 要求模型只输出封闭增量，不输出正文或判据；judge 还特意变成 judged:true。它本来就不该是 Card 去掉几个 text 字段的机械镜像。label / group 的缺失不能计入 bug。

路径构造/解析，与哪些键允许模型编写，是两种独立知识；不应因为都涉及 card 就放进一个大模块。可在路径确实被诊断跳转和选择共同使用时统一小范围语法；机械投影留在 workshop 及其宿主输入准备附近。复用适合的基础 schema，明确允许字段，比通用递归 AST schema 变换更符合封盘目标。

尚未找到用户此前“七项 mismatch”的独立列表，因此未宣称逐项对齐完成。

**6：版本戳合理，历史兼容范围另论。**

`server/src/data.ts:274` 起每次 open 探测形状；legacyNodes 查询每次对 node 的 JSON 字段做条件扫描；两个 story DDL 当前一致，所谓丢列是未来修改失配风险。

最小方案是把既有兼容过程视为一次 baseline upgrade，成功后写版本戳，当前文件不再扫描历史节点。无需追溯编造五个从未发布的版本，更不需要 migration registry、双写或降级机制。迁移和版本戳的失败恢复语义应一起验证，不能失败后仍标成完成。

是否删除旧 player / base 兼容代码取决于现存文件，仓库本身不足以回答；本次不把“直接删掉”列为确定动作。

**7：阶段差异不是重复代码的反证，也不是错误的证据。**

`session.ts:483` 的 auto / selected 对比 resident；contextLookup 的 held 还会纳入 current 和本轮已注入内容；gate 的 findLast 需要看本轮刚交付的版本。residentOn 本来通过 latest 保证一个 identity 只留最新快照，因此 resident.find 本身不意味着拿到旧版本。

一个跨 lookup、gate、sibling 的 builder 很可能还要求调用方按顺序执行相同方法，增加生命周期接口却没有真正隐藏顺序约束。当前建议保留阶段编排；有具体 superseded 错误再修，也可在同一阶段内部消除机械重复。

**8：支持统一 gate，但不要把 preview 藏进安装校验。**

`server/src/library.ts:549` 和 `runtime/support/author.ts:7` 重复 decode / validate / lint；`server/src/author.ts:71` 两处 YAML round-trip 属实。建议值级检查返回解码 card 与 diagnostics；checkCard(source) 做解析和展示报告；安装只用 gate；compile 直接检查 candidate。现有 checkCard 还调用 view / openings，直接让安装复用它会增加无关行为。

结构化诊断 wire 是可独立决定的输出改进，不是合并 gate 的前置条件。

**9：归属优化成立，优先级维持低。**

`library.ts:173`、`:498` 的 endpoint 去重、format 合并与 probe trace 适合 provider；但现有闭包确实调用 providerOf / secretOf，并非原样纯函数。迁移时以已解析 Provider / Secret 为参数，library 留下查表与持久化。现在无行为问题，不值得单独为了减 library 行数重排。

**我的封盘建议。**

第一批做 1 + 8（删除契约和校验的重复）；第二批做 2（同一读取规则）与 3（同一路径派生计算），分开提交以便区分语义变化和性能变化。4 可做一个局部纯函数。5 修已决定支持的机械能力，不扩成通用 schema 工程；6 做最小一次性升级门。7、9 不作为封盘门槛。

用可观察行为来验收：相同事实下预览与运行选择相同资源；live 与 attach 的 draft 内容一致；分支切换/祖先修订后 state 与 world 正确；卡从 CLI/HTTP 安装得到一致诊断。模块或文件数量减少不是验收条件。

验证：全仓 `pnpm run verify` 退出码 0；上述 preview 复现和 timeline 微基准已执行。没有运行真实供应商调用、浏览器交互或真实用户数据库迁移；也没有声称九个候选以外的全部实现均被逐行审计。

**第二轮：Gemini 报告的独立复核与上述结论修正。**

来源：`/Users/hanwen/.gemini/antigravity/brain/a911d817-cb3f-4a0f-be9a-51831ba9564f/backend-architecture-review.md`。本轮未改实现；用内存 SQLite、假模型重新构造复现，并重跑 `bun packages/runtime/test/lookup.ts`（通过）。Gemini 制品目录内未见随报告交付的复现脚本，不能据报告中的“实测”直接推定全部测试步骤已审阅。

1. **C8 漏验成立，提高优先级。** 最小卡加 theater/feed:true，cards.put 成功且 data.cards.get 可读，随后 lib.view 与会话使用抛错；world 表格的 name:string 初始值写成 17 也能入库，lib.view 成功，但会话 greet 抛 SchemaError。两种卡的 checkCard 均直接抛异常。本轮独立确认了 Gemini 的核心发现，我第一轮只检查了 gate 重复，没有验证校验覆盖完整性。它应进入第一批。不过这证明的是非法卡污染安装状态和相关功能失败，不足以直接定性全局 P0 或进程崩溃。

2. **C7 的重复成立，修复方案不可照搬。** 独立构造 always + player 可调用的 shared 词条，先 act，再 edit 添加 invoke，得到两条完全相同 resourceId/revision 的快照。第一轮“暂缓 C7”应修正为先修这个确定缺陷。但 `runtime/test/lookup.ts:82` 明确要求同轮 lookup 第一层、gate 第二层时保留两个版本，并断言第二份 superseded 等于第一份 revision。Gemini 将这一行为也称为污染，提出以 resident 为唯一基线、按 resourceId 覆盖，直接冲突现有契约。正确的最小方向是覆盖 reused 路径的 `(resourceId, revision)` 去重，保留不同 revision 的交付证据；无需先建累积器。

3. **生产宿主分叉成立，是本轮最有价值的新增结构发现。** main 导入 dev.handler，而 CLI 走 start/openHost；inspect、数据目录、密钥探测、overlay 和关闭流程的差别都有代码证据。应共享生产装配政策，并显式隔离开发态。无需以“六文件合一”为目标；host、监听生命周期和短入口可以保留各自职责。inspect:true 使完整 trace 对访问者可见，但默认绑定 127.0.0.1，实际泄露范围取决于部署，未实测公网暴露。

4. **宿主报告有两处事实错误和一项未经证实的产品判断。** 新建内存库实际 `lib.names()` 有 **606** 条 baseline 名称，未 refresh 不等于永远空对象；当前 tavern serve 命令没有报告所称的 --inspect 参数。support/cards.ts 注释把 player 的 lexicon 称为 sample pack，plain 明确是 minimal player，因此不能仅凭差异认定 plain 是生产配置遗漏。统一默认值值得决定，但统一成 player.harness 是产品选择，不是唯一正确修复。

5. **C1 的方向可取，“绝不能 import type”过于绝对。** 当前 sibling 包隔离值得保留，我收紧第一轮直接由 server 导出给 client 的建议。但 type-only 依赖不会把 node:sqlite 自动打进浏览器，也没有造成必然的运行期循环。共享类型应按职责归属；Local 已属于 layer，Routing 不是读投影，不宜把一切堆入 projection.ts 来换取“零新文件”。

6. **C4 可以先修条件，但反对纯折叠的理由不充分。** 播放时序与 draft 内容变化是可分离的；requestAnimationFrame 并不在逻辑上排斥共享纯内容函数。不过在本次封盘范围，先修已知重置差异更便宜。CLI 没有 draft，无需为了对称引入。

7. **C2 新指出的 current / invoked / expandState 遗漏可由代码对照确认。** 但 Derived 的既有职责是路径事实，不能因为“不新文件”就无限收入阶段请求装配。是否放入既有模块应看输入和职责，文件数不等于抽象成本。

8. **layout 是已确定设计的缺口，但不必改 SQLite DDL。** 当前 draft 已是 id/json，可在 JSON 文档层扩展。另一个报告未处理的生命周期问题：cards.put 安装成功会 data.drafts.del(card.id)；如果布局只附在草稿上，安装就丢布局。决定保存 shape 前，应先明确安装后保留 author chrome 的规则。

9. **性能结论成立，精确收益尚不能承诺。** 本轮无需重复此前基准；Gemini 的空 changes wuxia 结果与本报告同量级。yandao 与有世界变更的 wuxia 不是控制变量对照，27 倍是两种负载的观测比值；“约 25 行、100% 安全、回到 10ms”都需实现后验证。缓存必须解决祖先修订与依赖身份，不能把估计当验收结果。

修订后的顺序：第一批完整安装 gate、生产宿主政策对齐、C7 同版本重复修复、C3 派生优化；随后 C1/C2 和工坊纯值复用。layout 按已定需求补齐且先明确安装后的保留语义。C6 最小版本戳、C9 搬迁仍可独立排期。无需把所有发现都扩成模块重构。

**第三轮：对 Gemini / Claude 收敛方案的补充核验。**

- C7 新提议的 findLast + uniqueDeliveries 仍需先跳过已存在的同版本。直接调用现有函数复现：原快照 r2 含 superseded:r1；再次 `freeze(r2, previous=r2)` 会省略 superseded；uniqueDeliveries 的 Map 后写覆盖前写，最终 r2 丢失 superseded:r1。因此 added 中先排除 deliveries 已有的 `(resourceId, revision)`，保留原冻结证据；仅新版本查最新 previous 并 freeze。验收除了重复消失，还要断言原 superseded 与交付顺序不变。本轮这是函数级反例，未修改 session 实现。
- 不新增 client → server 依赖的结论已一致。workspace 拓扑是合理顾虑，但当前 server 的二进制脚本名为 compile，client 为 build，不能直接推导当前某条递归命令必然失败；client tsconfig 也已有 types:node。无需为此争论或添加依赖。另需注意 Routing 的键是 runtime 的 Phase 加 author，放 provider 不能反向导入 runtime，也不能再复制一套阶段枚举；推荐留在拥有阶段语义的 runtime 侧。
- headless.ts 虽短，却是 package.json 中 start:headless / compile:headless 的实际入口，执行 await start()。只要装配规则统一，这种三行 executable entrypoint 可以保留，删除不是架构收益。
- layout 的 `{card?, layout?}` 方案可以作为最小实现：GET 的 draft 标志由 card 是否存在决定，不能再由数据库行是否存在决定；安装和放弃内容编辑后保留 layout。需让操作含义明确为“放弃内容编辑但保留布局”，并避免只更新 card 时覆盖已存 layout。兼容已存在的裸 Card 属于既有数据适配，不需要扩成通用版本框架。

**第一批实施记录（2026-11-11）。**

- 审阅记录先单独提交：`e42bc64`。
- `abcb150`：纯值级 validateCard 覆盖 decode、rules、resolve/products、initialWorld、lint；安装与 compile 共享，compile 不再 YAML 往返；非法产品诊断和拒绝安装后的状态保留已测试。
- `0693acd`：main 改用生产 start/host；生产采用 plain、默认关闭 inspect，CLI --inspect / TAVERN_INSPECT=1 可开启；开发入口保留。普通 HTTP 启动刷新模型名，MODEL=fake 保持离线；未增加本地 CLI 每次调用的网络刷新。
- `77d8030`：edit 新增 invoke 时保留已冻结的同版本交付；新版本对比最新已交付快照。回归覆盖自动交付后追加 pin，以及同轮多版本与 superseded 保留。
- `2255f60`：Derived 缓存初始 world、路径前缀 world 与依赖它的 settlement；测试覆盖缓存复用、祖先修订失效、分支恢复。此前同一合成 wuxia 基准，1000 节点 timeline 四次从 665/661/660/661ms 降至 23/23/22/22ms，500 节点为 9/7/6/5ms；不代表真实长局或移动端耗时。
- `9db3216`：仅 aside 无正文的首稿进入重写时清除旧 products，attach 回归通过。
- 验证：`vp run verify` 全仓通过；`vp check` 0 errors，保留既有 context.ts 字符串展开告警。实际 bun build --compile 应用成功；临时目录运行编译后二进制，嵌入前端返回 200、四张嵌入卡可读、SIGTERM 正常退出。未启动或重启用户的开发服务器。
- 第一批完成；后续契约统一、预览读取规则共享、工坊 layout 与清扫项尚未实施。

**第二批实施记录（2026-11-11）。**

- `d506140`：客户端、远程 CLI 与服务端共享库读契约及 attach/draft/failure 类型；Input 复用 journal，Routing 由拥有 Phase 的 runtime 导出，模型列表条目归 provider。CardView 包含 catalogs，Routing 包含 author，持久化 Input 包含 invoke；没有增加 client → server 依赖。JSON 请求与 SSE 握手失败共用错误读取，保留服务端 code，并覆盖纯文本代理错误。
- `1e49055`：阶段读取规则按职责收回现有模块：context materialize 可读资源，product 选择与展开 asks，lore/names 统一名称展开，derived 共享 Current 投影。预览使用真实读取权限标注索引，补齐初始 world、record 的 invoked 与状态占位符，并对齐自动注入先于玩家指定注入的顺序。原有及新增对照测试直接比较预览与真实会话的 lookup/record 消息，覆盖 player-only、always、未填名称与 world。
- 同一提交将 workshop 应用器移入 `runtime/src/workshop.ts`，`author.checkValue(value, rows)` 提供纯值检查报告；宿主 support 只负责 YAML 及其默认玩家配置。原先 context 的 node:crypto 是浏览器复用的实际阻碍，改为 @noble/hashes 的 SHA-256，保留 canonical JSON 与十六进制 revision；纯模块按具体 provider 入口导入，避开开发机 IO 导出。新增 browser 测试构建浏览器目标包，在没有 Node/Bun 全局对象的 VM 中执行检查和 compile，并比较中文/嵌套值/键序的旧新 hash。此测试验证平台独立性，不等于浏览器页面交互验收。
- `98114f9`：draft JSON 存 `{card?, layout?}`，无 DDL 变化；旧裸 Card 按需归一化。GET 返回 `{card, draft, layout?}`，draft 只反映内容编辑；PUT 至少提供 card/layout 一项并保留未提供的另一项。安装成功或 DELETE 只清 card，保留 layout，没有 layout 才删行。回归覆盖 HTTP 双向独立更新、非法更新与安装失败不覆盖原值、安装/放弃后保留布局、数据库重开及旧格式读取。
- 验证：最终 `vp check`、`vp run verify`、client 的 `vp build`、`vp run docs:check` 均通过。check 为 0 errors，保留既有 context 字符串展开告警；client 构建有大 chunk 提示。本轮未调用真实供应商、未操作真实用户库、未启动或重启用户的开发服务器。
- 第二批完成。第三批仍是 C5 工坊机械能力/路径一致性与 C6 最小版本戳；C9 的 provider 探测循环迁移保持低优先级，本轮仅统一其列表类型。未引入共享跨端 draft reducer、通用兼容框架或模型输出 Schema AST 裁剪。
