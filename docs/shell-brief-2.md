# 空间壳层二期 brief：舞台去顶条、正负空间归位、故事 tab、读数页（2026-10-31，#117 二期，交 Opus 实现；tab 一节 10-31 晚按 Cherry 的模型改为视图 tab）

一期（`c69b233` / `ae0a9cd`）把三层立体空间立住了：地面（顶条 + 左栏）、台上一张舞台卡、台上临时挂载的读数卡。走查暴露的五个问题（左上角名字写三遍、读数键和另两枚图标语法不一、故事管理器用了"设置"的图形、读数卡 18.5rem 窄柱、首屏纯文本）出自同一个错位：安装级和卡片级的控件掉进了舞台和左栏底脚。这份 brief 是一次归位，顺着同一条逻辑把前四个解开（第五个是 #120 / #1 的事，这里不碰）。来源：Gemini 的 `spatial-shell-v2-proposal.md` 与 10-31 的三轮对齐；下面的结论都已定，不再重开。

和一期 brief 不同，这份直接给生产代码：接缝按文件写，版式只给尺度，不给像素。

## 定稿

1. **舞台去顶条。** 阅读器态的舞台卡没有 `.strip`：没有横线、没有 `卡 › 局`、没有人设和写法 chip。右上角三枚纯图标（Timeline、Inspector、读数）absolute 悬在正文列外侧的留白里，正文从舞台卡顶边流下。
2. **人设与写法回左栏的单卡工作区。** 数据层已经是这个范围：persona 按卡存，writing 是玩家级加 `forCard` 覆盖层，都不是按局的。
3. **设置、主题、语言上顶条右端。** 左栏折叠后它们仍在；左栏底脚只剩卡的事（故事管理器），图标换掉。
4. **顶条左端是 tab 列表**，Cherry Studio 的模型（视图多实例、数据单份）：一枚 tab = { 故事或空, 页面栈, 滚动位置 }，"+"开新 tab，一枚可以是设置、一枚是写卡台、一枚是另一局。一个阅读器、一份故事数据；切到另一局的 tab 就是 `openStory`。镜像（两枚 tab 同一局）允许，不设禁令。
5. **读数升格为页**（`Page` 加 `"status"`），三枚图标同一种行为：原地换页、Esc 与返回。`mount`、`mount-scrim` 与其状态整个删除。桌面双栏、窄舞台与手机单列。
6. **手机端删 `storysheet`**：抽屉里的工作区已经有人设、写法；读数是页；顶条是 `☰ | 卡 › 局 | 三图标`。

## 接缝

### 顶条 `.shell-top`（shell.tsx）

左端：折叠键不动；其右是 tab 列表。右端：三枚安装级图标（语言、主题、设置），从 `side.tsx` 的 `.side-foot` 原样搬来（同一个 `.icon.sm`，同样的 aria-pressed）。

**tab 的模型**（读过 Cherry 的 `TabsProvider.tsx` / `TabRouter.tsx`：tab 只存地址，数据在公共池；没有"已打开就拒绝"，重复的 tab 是同一份数据的两个窗口；只能发生一次的副作用用 `useIsActiveTab` 门住）：

- 一枚 tab = `{ id, story: number | null, page: Page, under: Page[], scroll?: number }`。`pages.ts` 今天的模块级 `page` 与 `under` 变成活跃 tab 的字段，`open` / `close` / `toReader` / `escaping` 对活跃 tab 操作；`land` 写活跃 tab 的 `story`。列表与活跃 id 存设备（`fold.ts` 那种读回：不在 listing 里的故事 id 丢掉，页面栈不存，重载后每枚 tab 落在它的故事的阅读器或卡片页）。
- 数据单份：`log`、`draft`、`working`、`editing`、`calls`、`focus` 仍是"打开的那一局"的单例，不按 tab 分。网页里始终一个阅读器。
- 切 tab：目标 tab 的 `story` 与 `current` 相同 → 只换页面栈和滚动位置，不发请求（同一局的阅读器 tab 与 Inspector / 写卡台 tab 之间秒切）；不同 → `openStory(story)`，`land` 之后恢复该 tab 的页面栈与滚动位置；`story` 为空 → 页面栈照常（设置、卡片页不需要局）。
- **离开一局时暂存，切回时恢复**：`openStory` 走 `land`，`turn.abandon()` 会丢未发的输入，`pin` 被清。所以离开一局前按故事 id 在内存里记下 `boxes()`（compose / noted / aside）和 `pin`，切回该局时写回。暂存按**故事**记，不按 tab；不落设备。滚动位置按 tab 记。
- "+"：开一枚 `{ story: null, page: "card" }`，落在当前卡（工作区那张）的卡片页，即开局落地。新 tab 从不复制上一枚（Cherry 的裸 `/app/chat` 跳到全局最近话题，正是让人迷惑的地方，不学）。
- 入列：侧栏点局、`browse`、`newStory` 开局都在**活跃 tab** 里发生，写它的 `story`；不去别的 tab 里找。镜像允许，关掉镜像 tab 不碰故事。
- 有界：最多 8 枚；"+"在满时丢最早的非活跃一枚。tab 名是 `卡 › 局`（`.shell-tab` 已有的 `.c › .s`），空 tab 显示卡名；截断不换行。
- 点击：非活跃 tab → 切 tab；活跃 tab 且 `page !== "reader"` 且有故事 → `toReader()`；否则无事。
- ×：移除；关的是活跃 tab 时切到相邻一枚（右边优先）；最后一枚不显示 ×。删档：`onDelete` 之后持有被删故事的 tab 变成 `{ story: null, page: "card" }`（那张卡的卡片页），不消失。
- 点：listing 里 `busy !== null` 的故事，其每枚 tab 显示 `.busy-dot`（侧栏同一元素）。**未读点**按故事记（内存）：某局 `busy` 从非空变 null 时它不是活跃 tab 的故事 → 记未读；它的所有 tab 一起亮，切到其中任一枚时一起灭。零服务端改动。
- 门住的副作用：Escape 与页面栈只对活跃 tab；滚动位置只在离开 tab 时写；`land` 只由活跃 tab 触发。没有后台 DOM，所以没有别的要门。
- 没有任何局时顶条左端是一枚空 tab（第一张卡的卡片页，`boot` 已经这么落）。

### 舞台卡 `.stage-card`（shell.tsx、shell.css、reader.css）

- 宽屏分支删掉整条 `.strip`（crumb、人设 chip、写法 chip、`.strip-right`）。`--strip` token 留给手机顶条。
- 三枚图标 `position: absolute; top/right` 在舞台卡右上角，`.icon.sm` 三枚含间距与右距 **不超过 98px**。算术：72rem 窗口、左栏拖到上限 320px 时舞台约 824px，`main` 被 clamp 到 672px，纯留白 76px 加 `main` 的内边距约 100px，98px 是这组图标的占宽上限，写成注释。读数键 `aria-pressed` 表示读数页开着；`changed` 的点删掉（轮末 Record pill 已带同一个点）。Inspector 禁用条件不变。
- 正文的滚动区顶部留出图标行的高度（padding-top，不是一行 flex），第一行起笔在图标之下；滚动时正文在顶部 `--fade` 里从图标底下穿过。不许出现一条横线或一条空白死带。
- 页面（card、timeline、settings、writing、inspect、status）盖住舞台时这三枚图标不显示（它们是阅读器的）。

### 左栏工作区 `.workspace`（side.tsx、shell.css）

- 卡头之下、故事搜索之上，两行：人设、写法。行的形态就是今天 `storysheet` 的 `.row`（图标 + 标签 + 当前值），从 shell.tsx 搬过来，点开 `openPicker` / `openWriting` 不变，`disabled={!me()}` 不变。手机端这两行随抽屉一起出现，`onLeave` 关抽屉后再开。
- `.side-foot`：三枚安装级图标搬走后，脚部只剩故事管理器，右对齐不变。图标 `ph/sliders-horizontal` → `ph/archive`（icons.tsx 的 `Sliders` 若无别处使用则删除导出）。aria-label 不变。

### 读数页（store.ts、pages.ts、App.tsx、readings.tsx、新 status.css 或并入 reader.css）

- `Page` 联合加 `"status"`；`loads` 不加项（读数全在内存）；`open("status")`、Esc、`close` 走现有机制，不另写监听。shell.tsx 里 `mount` 信号、它的 `createEffect`、`onSettled` 的 Escape 监听、`.mount`、`.mount-scrim`、`.mount-head`、`.mount-body` 与 `--mount-w` 全部删除。
- 页头与其他页同一语法（返回 + 页名"读数"，手机端 `--topbar`）。
- 内容两块：**左 = 世界的静态切面**（`Pinned`、`StatusTable`）；**右 = 本幕的变化**（`TurnRecord`、`Demand`）。`Pinned` 从 shell.tsx 搬进 readings.tsx。
- 版式：居中容器，`grid-template-columns: repeat(2, minmax(22rem, 26rem))`，列间 `--space-6`；用 **`@container`** 查舞台卡的宽度（不是 `@media`，舞台宽度随左栏变），容不下两列时单列堆叠（左块在上）。左块无可见项（无规则卡如《伴星》：没有状态表、没有 pin）时单列居中，不留半屏空白。`meter`、kv 行因此落在 22–26rem 的尺度里，不许拉到 42rem。
- 不画立绘位、不画人物表占位：#1 Catalog 有数据再开。小剧场（`Demand`）仍是右块脚部的菜单，形状等 #101 / #76。

### 手机（shell.tsx）

- `storysheet` 与它的 `<Sheet>` 删除（`Sheet` 组件本身留着，manager 与 `RecordSheet` 在用）。
- 顶条：`☰`（抽屉）| `卡 › 局`（纯文字，不再是按钮，没有 ▾）| Timeline、Inspector、读数三枚 `.icon`。390px 下 crumb 截断，图标不缩。
- 抽屉里的工作区带人设、写法两行（同一份 DOM，见上）。

### 词（locales/zh-CN.ts、en.ts，x18n check 过）

新增：tab 的 ×（"关闭此局"）、未读点的 aria-label（"刚生成完"）、读数页的返回沿用 `common.backToStory`。删除：`side.closeReadings` 及其他只被 mount 用的键。`side.readings` 留作页名。

## 约束

1. **一个语法。** 三枚图标一种形态、一种行为；tab 是 `.shell-tab` 的复数加"+"，不是新控件；人设、写法两行与 `storysheet` 的行同一份样式。
2. **不做**：数据多实例（两局的 log / draft / DOM 同时常驻，Cherry 也没有）、tab 拖拽排序、tab 固定、tab 休眠、读数页的立绘位与人物表、任何新依赖。
3. **数据有界**：tab ≤ 8；读数两块各自滚动；名字截断不换行。
4. **删除是这个 PR 的一半**：`.strip` 宽屏分支、`mount` 三件套、`storysheet`、`Sliders`、`--mount-w`、只被它们用的 CSS 与词。净行数应为负。
5. **控件旁不放说明文字**，aria-label 齐全；`aria-pressed` 给读数键，`aria-current` 给当前 tab；Phosphor 图标走 icons.tsx。
6. 一个 PR，顺序：归位（strip 删、工作区收两行、顶条收三键、archive 图标）→ 读数页并删 mount → 手机删 storysheet → tab（pages.ts 的页面栈归 tab、暂存与恢复、顶条）。每步 `vp check` 与 `vp run verify` 绿。

## 验收（用户在自己的浏览器里看）

- 1280 与 1152 宽、左栏 260 与 320：阅读器态左上角只有一处 `卡 › 局`（顶条 tab）；舞台卡顶部无横线；三图标不压正文第一个字；滚动时正文从图标下穿过。
- 点读数：舞台原地换成读数页，背景不虚化；《理》双栏，《伴星》单列居中；Esc 与返回回阅读器；左栏在 72rem 下折叠时读数页单列。
- 左栏折叠后顶条右端三键仍可点；底脚只剩 archive 图标，aria-label 是"本卡的故事管理"。
- 在《竹林》输入框敲半句不发，开一轮，"+"开新 tab（落在卡片页），侧栏切到《理》：顶条两枚 tab，《竹林》的带呼吸点，跑完变未读点；点回《竹林》：半句台词还在，流式画面接上或已跑完，未读点灭。同一局再开一枚 tab 进 Inspector，两枚之间切换不发请求。× 关掉一枚，剩一枚时无 ×；删档后那枚 tab 变成卡片页；刷新后 tab 列表还在、各落在自己的故事上。
- 手机 390：顶条 `☰ | 卡 › 局 | 三图标`，无 ▾、无 sheet；抽屉工作区里有人设、写法两行。
