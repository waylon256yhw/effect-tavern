# 读 chenglou 的 pretext：长列表的精确布局层，不是流式

读的是 `@chenglou/pretext` 1.0.0（2026-10-22，零依赖，1 MB unpacked）、仓库里的 `pages/demos/markdown-chat.md`（Markdown 聊天 demo 的范式说明）和 issue #313（流式与增量 prepare 的原型与数字）。起因是"流式怪怪的"那轮：有印象说别家的流式底层是 pretext 加 marked。结论先说：pretext 是**流完之后**的长列表布局层，流式本身它不碰，作者自己把这条写在"Not covered"第一行。

## 0. 高度

**它做的事只有一件：不碰 DOM 就知道一段文字在某个宽度下的行数和高度。** `prepare()` 一次性归一化空白、用 `Intl.Segmenter` 切出断行机会、用 canvas 量每段宽度，返回一个句柄；`layout(prepared, width, lineHeight)` 之后是纯算术。精确到和浏览器自己的换行一致（它以浏览器字体引擎为 ground truth 迭代），所以能在首屏之前就知道每条消息的确切高度。

它解决的问题是**量级**：一万条 Markdown 消息，只挂屏幕内的行，滚动条对应整段历史，窗口变宽变窄时正在读的那条钉住不动。十万条时首屏 5 秒、堆 400 MB，iPhone 上崩了；一万条是它的舒适区。

## 1. markdown-chat 的范式

模型层（`markdown-chat.model.ts`）与画面层（`markdown-chat.ts`）分开，DOM 只画：

- **一切量过的值归模型。** 字体写两遍（canvas 字符串和 CSS）就会漂（它量过 500 字重画成 400）；每段文字带一个 `TextStyle`，pretext 用它的 `font` 量，CSS 从 `--font` 变量取同一个值。内联代码的 padding 算进宽度，边框用 inset `box-shadow` 画，因为 `border` 会挤内容。
- **每块只 prepare 一次，按宽度只做 layout。** `marked.lexer()` 切块，段落 / 标题 / 列表项走 `prepareRichInline()`（同样式一段一项），代码块 / 表格走 `pre-wrap`。高度只问行数，行本身只在那一行上屏或宽度变化时才建。
- **帧循环纪律。** 事件只记事实、只排一帧（`scheduleRender()`），一帧里先读 scroller 的 `clientWidth / clientHeight / scrollTop` 各一次，再在 JS 里算完布局、锚点、可见区间，再写 DOM，最后才 `scrollTo()` 并回读。高度先写，否则浏览器会把滚动夹在旧高度里。
- **可见区间二分查找**；只挂两条横幅之间的行，离开的移走，新来的插在第一条保留行之前。
- **每一行一个绝对定位的 div**，`white-space: nowrap` 加段落的 `dir`，混合方向的词序交给浏览器；不同字体相接处的空格画在量它的那个元素里（误差从 3.53 px 到 0.01 px）。
- **只画文本，从不 innerHTML**：marked 不消毒，所以它只 lex，一切输出走 `textContent`，链接只留 http(s)。
- **resize 时钉住阅读位置**：锚点是"消息序号 + 它顶端在横幅下的偏移"，只有重新布局让锚点消息的顶端动了才滚；滚动位置以浏览器回读的值为准，不以请求值、不以"程序滚动"旗为准（舍入会累加）。
- 试过又扔掉的：估算高度、`ResizeObserver` 事后纠正、DOM 节点池、每帧滚到锚点（iOS 橡皮筋时抖）、只加载屏幕附近的块（滚动条对不上整段历史）、把 resize 摊到几帧、布局进 worker。

## 2. 流式：它明确不覆盖

`prepare()` 两个阶段都跑整段文字：分析（空白、Segmenter、合并）和量宽（canvas，按字体加片段缓存）。流式按 token 重 prepare 整条消息，总开销随长度平方增长。#313 的数字（Node 上假 canvas，M5 Max，是下限）：一万字符的消息按 4 码点一个 token 流完，英文 1.6 秒、阿拉伯文 1.75 秒、泰文 2.7 秒、**日文 15 秒**——CJS 要再切一次字单元，每字符贵十倍。三个增量 prepare 原型（按段落分开 prepare、富文本项复用、编辑窗口）都搁置；最后推荐的只是"每段单独 prepare、只重做被改动的那段"这个用法模式，没有 append API（#153 关闭，不计划）。

所以流式阶段它帮不上：正在流的那段每个 delta 都要重 prepare，CJK 最贵。它的位置在节点落地之后。

## 3. 对照我们：三堆

**已经治好、与它无关。** "流式怪怪的"两条病根是浏览器两端对齐在每个字到达时重排整行并在换行处跳一次，和没有播出缓冲；前者去掉 `text-align: justify`，后者移植 Cherry Studio 的自适应抖动缓冲（`packages/client/src/store.ts`）。它的 justification 演示是英文 Knuth-Plass 式（河流、软连字符），不是 CJK 流式对齐问题。

**我们已有、用的是平台。** resize 时钉住阅读位置：我们用 DOM 正常排版，浏览器自带的 scroll anchoring 就在做；pretext 必须自己做是因为它每行绝对定位、绕开了浏览器。帧循环纪律（事件只记事实、读-算-写-滚、以回读值为准）我们的 follow 代码已经这么写（`follow.ours` 就是回读值）。

**量级不到。** 队列里"只载入最近的节"这条，我们的量级是几百节不是一万；chatbot-template 那轮记下的 `content-visibility: auto` 加 `contain-intrinsic-size` 就够，不引层。它的"试过又扔掉"那张表是将来真到那个量级时的地图：估算高度和 ResizeObserver 纠正都别走。

## 4. 要求

对协议：无。对客户端：无新项；"只载入最近的节"按 `content-visibility` 做，pretext 等节数真到需要精确虚拟化的量级再回来看。流式阶段不要指望任何布局库，播出缓冲和对齐方式才是流式手感的变量。
