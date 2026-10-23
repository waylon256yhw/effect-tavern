# 卡页原型 brief（2026-10-24，给 Gemini 出 artifact demo）

和 `docs/timeline-prototype-brief.md` 那次一样：只给数据、规则和约束，不给版式。要的是一个自包含的 HTML（数据内联、无依赖、无构建），桌面 1280 和手机 390 都能打开，light/dark 用 `light-dark()` 和文末的 token。文件顶部用注释写清信息层次怎么定的（什么一眼可见、什么点开才看、什么不画），之后会移植到 Solid。

两轮讨论已经定下的结论不再重开：不做常驻边栏；卡页是阅读器之上的第三个页面（Inspector 看一轮，Timeline 看整棵树，卡页看这张卡）；开场在卡页上选；cast 不进 schema，模块名是 `Fragment.label`；卡页只读，形状就是以后工作台原位编辑的形状。

## 它是什么

卡在玩家一侧的 manifest。两个角色，同一页：

- 玩家的入口和参照：打开一张卡、日志为空时先落到这里（这卡是什么、挑一个开场或直接开始）；玩到一半从 ⋯ Session 菜单进来（这卡到底声明了什么）。
- 测试者看 Inspector 时的参照：must、hook、读数答案要对着卡的声明才读得懂。

卡分两层。第一层是**声明**：字段与边界、动作与概率、读数、开场、虚构模块的名字、lore 与护栏的规模、导演开关、默认通道。这层天然是玩家的，也是这页的全部内容。第二层是**提示词正文**：fragment 的文字、lore 的层、护栏的原话、asks 的措辞。这层是作者的，服务端根本不发（`GET /card` 的投影就是边界），这页不画、也不暗示。禁令本身就是提示，对玩家同样成立。

## 数据

`GET /card` 的投影，服务端静态，一局不变：

| 字段 | 含义 |
| --- | --- |
| `id`、`title`、`summary` | 名字和一句话。`summary` 可缺（老卡没有） |
| `input` | 默认通道：`act` 参与者视角（玩家在故事里，输入是台词），`note` 作者视角（玩家在故事上，输入是给叙述者的指示） |
| `heading` | 回合标题引用（字段路径或 `产物.键`），可缺；有它才有场景列表 |
| `director` | 导演开关 |
| `guard` | 护栏条数，只有数 |
| `lore` | `{ entries, layers }`，只有规模；当前已解锁待讲的在节点上，不在这页 |
| `greetings` | `{ text, do? }[]`：开场正文（整段散文，可到六百字）和它的开局效果（让这个开场区别于初始状态：路线、日期、紧张度） |
| `fiction` | `{ id, label?, when? }[]`：虚构模块，无正文。没有 `when` 的是常驻模块（人物、势力、地点）；有 `when` 的是状态驱动的变体（理的六个好感分段、盐道的"见血之后"） |
| `rules.fields` | `{ path, label?, group?, type: int/number/boolean/enum, min?, max?, options?, initial }` |
| `rules.actions` | `{ id, text, when?, roll?, hit?, miss?, do? }`：`text` 是模型看到的选项，`roll` 是概率，`hit`/`miss` 是掷骰两头的效果，`do` 是无骰动作的效果 |
| `rules.readouts` | `{ id, text, when?, options: { id, text, do }[] }`：写之后向模型提的选择题，选项带效果 |
| `rules.over`、`rules.cap` | 终局条件、拍数上限 |
| `products` | `{ id, shape }[]`：这卡开着的 record 产物（notes / options / inner 是 harness 默认，其余是卡声明的） |

三种声明式的小结构，页面要把它们翻成人话，客户端已有纯函数（`src/phrase.ts`），demo 照这个输出画：

- Cond：`{path,is}` / `{path,op,value}` / `{all}` / `{any}` / `{not}` / `{event}` → `体力 = 0 or 敌手 = 0`、`交情 ≥ 8 and not (on x or 体力 = 0)`、布尔 `恋人` / `not 恋人`；空 `all` 是 `always`，空 `any` 是 `never`。
- Effect：`{path,set}` / `{path,add}` / `{event}` → `起点 = 血案`、`敌手 −10`、`体力 + 敌手`、`event strike:hit`。
- Chance：数 / `{path}` / `{judge}` → `60%`、`by 体力`、`judged`。

不在 `/card` 上、来自日志树的三样：日志是否为空（落页规则）；本阅读线已揭晓几层（节点的 `delivered` 沿线去重计数）；有几条线程（根的个数，Timeline 的概念）。

## 规则（demo 里的动作）

- **落页**：日志空 → 这页；有节点 → 阅读器。从 ⋯ Session 菜单随时进来，Escape 或 Back 回阅读器（有故事时才有"回去"）。
- **开场**：浏览开场不写任何东西（读的是静态数组）；点"以此开始"发一次 `greet(i)`，落唯一的根，进阅读器。没有开场的卡（wuxia）：一个"开始"直接进阅读器，阅读线为空，输入框等第一句。
- **玩到一半来这页**：开场仍然列着，点它是开一条新线程（根），旧线留着（Timeline 里并排）；措辞要让人知道这不是重置。Start over 和删空故事都落到这页。
- **已揭晓**：lore 那一行写"共 N 条 M 层 · 本线已揭晓 K 层"，K 来自日志，demo 里给个数即可。

## 约束

1. **层次是这页的全部设计**。一眼可见：一句话、视角（参与者 / 作者）、开场、虚构模块（变体折进它所属的模块：`理 · 6 个状态分段`，不是七条）、字段（边界、初值、由谁驱动：动作写它，还是哪条读数推它、单轮幅度多少）、动作作为规则书（文字、概率短语、命中 / 落空效果）、lore 与护栏的规模、导演、开着的产物。点开才看：读数的分档与效果；带 `when` 的读数默认只报"另有 N 项条件读数"，条件在展开里；变体的 `when`；动作的 `when`。动作效果里的 `event` 是内部接线，不画。
2. **不画**：fragment 正文、护栏原话、lore 的 id / hook / 层、asks、snippets 与格式键（它们是输入框的）。
3. **数据有界，只有散文换行**。字段、动作、读数各不过一手之数；模块最多七八个；开场一到两段（生态卡可能五六个，列表要撑得住）；一句话就是一句话。开场正文是唯一的长散文，它换行，别的都不换。
4. **页面骨架沿用 Inspector**：`.inspect` 的顶栏（Back、标题）、桌面在画布上的卡、手机 390 的 tab（`data-pane`）、段落头（`.sechead` 的 `.lbl` 与 `.meta`）。整页不滚，面板各自滚。
5. **组件库是平台**：`<details>`、`<dialog>`、popover、原生滚动、CSS；不用库。控件旁不放说明文字，用 aria-label 加 `data-hint`；图标标 Phosphor 的名字，demo 里内联简单 SVG；数字用等宽。
6. **两个状态同一页**：落页态（没有故事，主动作是开场或开始）和参照态（有故事，主动作是回故事，开场变成"从这里开新线程"）。demo 里一个开关切这两态。
7. **词汇**：Card、Opening（开场）、Begin、Module（虚构模块）/ Variant（变体）、Field（字段）、Action、Readout（读数）、Guard（护栏）、Lore、Director、participant / author（参与者 / 作者视角）、Thread。

## 样例（四张模板卡的真实投影，`vp dev` 的 `GET /api/card` 就是这个）

四张卡沿两个坐标铺开：自检 RPG（wuxia：字段、动作、骰子、读数、lore、护栏，没有开场）、一对一纯聊天（伴星：什么都没有，一个长开场）、一对一带读数（理：七个模块里六个是变体，两条读数一条带条件）、大世界指导续写（盐道：作者视角，两个开场一个带效果，枚举字段）。页面要在这四张上都成立。

### wuxia

```json
{"id":"wuxia","title":"竹林","summary":"自检卡：竹林里与剑客 A 的一场对峙，带骰子、读数、两条 lore 和一条护栏。","heading":"scene.place","input":"act","director":true,"guard":1,"lore":{"entries":2,"layers":4},"greetings":[],"fiction":[{"id":"a","label":"A"},{"id":"a-cool","label":"A（疏远）","when":{"path":"bond","op":"lt","value":8}},{"id":"a-warm","label":"A（信任）","when":{"path":"bond","op":"gte","value":8}}],"rules":{"fields":[{"path":"hp","label":"体力","group":"Body","type":"int","min":0,"max":100,"initial":40},{"path":"foe","label":"敌手","group":"People","type":"int","min":0,"initial":30},{"path":"bond","label":"交情","group":"People","type":"int","min":-30,"max":100,"initial":0}],"readouts":[{"id":"warmth","text":"how A treated the player this turn","options":[{"id":"cold","text":"cold","do":[{"path":"bond","add":-5}]},{"id":"flat","text":"indifferent","do":[]},{"id":"warm","text":"warm","do":[{"path":"bond","add":4}]},{"id":"close","text":"intimate","do":[{"path":"bond","add":8},{"event":"warmth:close"}]}]}],"actions":[{"id":"strike","text":"attack B","roll":0.6,"hit":[{"path":"foe","add":-10},{"event":"strike:hit"}],"miss":[{"path":"hp","add":-10},{"event":"strike:miss"}]},{"id":"talk","text":"talk","do":[{"event":"talk"}]}],"over":{"any":[{"path":"hp","is":0},{"path":"foe","is":0}]},"cap":4},"products":[{"id":"notes","shape":{"kind":"list"}},{"id":"options","shape":{"kind":"list","max":4}},{"id":"inner","shape":{"kind":"text"}},{"id":"scene","shape":{"kind":"record","keys":[{"key":"place","type":"text"},{"key":"present","shape":{"kind":"table","columns":[{"key":"name","type":"text"},{"key":"mood","type":"enum","options":["calm","tense"]}]}}]}},{"id":"people","shape":{"kind":"table","columns":[{"key":"name","type":"text"},{"key":"note","type":"text"}],"max":8}}]}
```

### banxing

```json
{"id":"banxing","title":"伴星","summary":"一对一纯聊天：依瑞丝。没有规则、没有 lore，一个人和她的开场。","input":"act","director":false,"guard":0,"lore":{"entries":0,"layers":0},"greetings":[{"text":"为了社交而维持形象，为了利益而昧离本心，为了生活化身为机械，为了他人的期待，去令自己对其感到满足。可是，“我”又在哪？\r\n我不知道。至少在夜幕降临，周围熟悉的一切拥抱酣眠时，这份宛如以身化作夜空中的孤星的静谧感，正是我正在离我最近的地方的证明。\r\n万籁俱寂。\r\n连月光都洒不进的封闭卧室中，只剩下她手机的微光，和拥抱着我的我。\r\n\r\n“话说，在家里的时候，我妈总是说，半夜玩手机不要关灯。”坐在身边的她细语道，同时轻轻提起被子，过膝袜包裹的双足没入被窝中。“说是黄斑病变，还是什么来着？可总觉得开了灯，氛围就不一样了。大约我只是喜欢静静呆在暗处吧。”她将可乐罐凑近唇边，微微仰起头。\r\n已经过紧的学生衬衫犹如枷锁一般，布料随着她的动作夸张地拉伸着。本应舒适的毛绒背心箍着她的躯干，束缚着那一对不属于学生的柔软。她将可乐罐放回床头，碳酸气泡随着她的轻轻鼻息融入黑暗。“嘛，可乐当然也是不能喝的，夜里吃喝容易长肉。呜…”就算忽略句尾可爱的小声音，软软的脸蛋和被过膝袜微微勒紧的大腿，也暴露了她此刻的想法。\r\n“话说，今晚你就在床上干坐着？”她将手机的微光略微照向你，和你那边床头柜的手机、零食饮料、游戏机。“今夜还长着呢。玩玩游戏，吃吃喝喝，抱我也可以。”她就这么将自己与前两项排比着。“啊，抱我的话晚点更好些，我在冲排行榜。”\r\n“总之，别辜负了属于你的夜晚。”"}],"fiction":[{"id":"character","label":"依瑞丝"},{"id":"examples","label":"示范"}],"rules":{"fields":[],"actions":[]},"products":[{"id":"notes","shape":{"kind":"list"}},{"id":"options","shape":{"kind":"list","max":4}},{"id":"inner","shape":{"kind":"text"}}]}
```

### ri

```json
{"id":"ri","title":"理","summary":"一对一：青空理，小镇教堂的圣女；好感度随每一幕的相处变化，理的态度随之分段。","input":"act","director":true,"guard":0,"lore":{"entries":1,"layers":2},"greetings":[{"text":"清晨的阳光穿过教堂高大的彩绘玻璃窗，在冰凉的石质地面上投下斑驳陆离的光影。空气中弥漫着淡淡的熏香和旧书卷的气息，混合着清晨特有的微凉湿意。你作为镇上的牧师，正缓步走向教堂大殿，准备开始一天的祈祷与工作。脚步声在空旷的廊道里回响，带来一种肃穆的宁静。\r\n\r\n就在你即将踏入大殿侧门时，一个熟悉的身影出现在前方不远处的廊柱旁。 那是理，身着纯白的圣女长袍，金丝刺绣在晨光下隐隐生辉。她深蓝色的长发被薄纱轻轻笼罩，只露出几缕垂在脸颊旁，衬得那张牛奶般白皙的脸庞更加柔和。她似乎正望着窗外出神，侧脸的轮廓在光线下显得格外恬静美好。\r\n\r\n听到你的脚步声，理的身子轻轻一颤，随即转过身来。当她的目光与你相遇时，那双深海色的眼眸里明显划过一丝慌乱，像是受惊的小鹿，下意识地想要躲藏，却又强迫自己停留在原地。 她的手指紧张地绞着胸前的十字吊坠，指节因为用力而微微泛起浅色。\r\n\r\n她似乎深吸了一口气，努力让自己的神情恢复平静，但那悄然爬上耳廓的红晕却出卖了她内心的波动。 她朝着你露出一个略显僵硬的微笑，那笑容不同于往日面对镇民时的温和端庄，也不同于与你日常相处时的亲切自在，反而带着一种难以言喻的紧张和…期待？\r\n\r\n她的嘴唇轻轻翕动了几下，像是有话要说，却又犹豫着不知如何开口。目光在你脸上短暂停留后，又迅速垂下，盯着自己黑色高筒短靴的鞋尖。阳光恰好落在她微颤的长睫毛上，投下一小片柔和的阴影。廊道里安静得只剩下你们两人轻微的呼吸声，以及远处偶尔传来的几声模糊的鸟鸣。\r\n\r\n你能感觉到气氛中弥漫着一种不同寻常的张力。理今天似乎有些不对劲，那份显而易见的紧张和欲言又止的神态，让你心中隐约有种预感。她紧握着吊坠的手指又收紧了几分，手背上甚至能看到淡淡的青色脉络。\r\n\r\n“那个…” 她终于鼓起勇气抬起头，再次看向你，深海色的眼眸里水光浮动，像是下定了某种决心。她的声音带着一丝不易察觉的颤抖，却又异常清晰地传入你的耳中：“牧师先生…我…我有话想对你说。”\r\n\r\n光线透过彩窗，在她白色的头纱上染上淡淡的彩色光晕，像是一层神圣而脆弱的光环。 她就那样站在那里，屏住呼吸，等待着你的回应，整个世界仿佛在这一刻都安静了下来，只剩下她眼中那份孤注一掷的勇气和深藏的情愫在无声地诉说。"}],"fiction":[{"id":"ri","label":"理"},{"id":"band--100","label":"理（好感 -100–20）","when":{"all":[{"path":"好感度","op":"gte","value":-100},{"path":"好感度","op":"lt","value":20}]}},{"id":"band-20","label":"理（好感 20–40）","when":{"all":[{"path":"好感度","op":"gte","value":20},{"path":"好感度","op":"lt","value":40}]}},{"id":"band-40","label":"理（好感 40–60）","when":{"all":[{"path":"好感度","op":"gte","value":40},{"path":"好感度","op":"lt","value":60}]}},{"id":"band-60","label":"理（好感 60–80）","when":{"all":[{"path":"好感度","op":"gte","value":60},{"path":"好感度","op":"lt","value":80}]}},{"id":"band-80","label":"理（好感 80–90）","when":{"all":[{"path":"好感度","op":"gte","value":80},{"path":"好感度","op":"lt","value":90}]}},{"id":"band-90","label":"理（好感 90+）","when":{"path":"好感度","op":"gte","value":90}}],"rules":{"fields":[{"path":"好感度","type":"int","min":-30,"max":100,"initial":60},{"path":"恋人","type":"boolean","initial":false},{"path":"哥哥","type":"boolean","initial":false}],"actions":[],"readouts":[{"id":"affinity","text":"这一幕里，理对你的好感怎么变了（变化范围 -5 到 +8）","options":[{"id":"cold","text":"明显疏远","do":[{"path":"好感度","add":-5}]},{"id":"cool","text":"略微冷淡","do":[{"path":"好感度","add":-2}]},{"id":"flat","text":"没有变化","do":[]},{"id":"warm","text":"略微拉近","do":[{"path":"好感度","add":3}]},{"id":"warmer","text":"明显拉近","do":[{"path":"好感度","add":5}]},{"id":"moved","text":"心动","do":[{"path":"好感度","add":8}]}]},{"id":"confession","text":"如果这一幕里理向你告白了，结果如何","when":{"all":[{"path":"好感度","op":"gte","value":60},{"path":"恋人","is":false},{"path":"哥哥","is":false}]},"options":[{"id":"none","text":"这一幕没有告白","do":[]},{"id":"accepted","text":"你接受了，两人成为恋人","do":[{"path":"恋人","set":true},{"event":"告白:成功"}]},{"id":"refused","text":"你没有接受，理说以后把你当作哥哥吧","do":[{"path":"哥哥","set":true},{"event":"告白:失败"}]}]}]},"products":[{"id":"notes","shape":{"kind":"list"}},{"id":"options","shape":{"kind":"list","max":4}},{"id":"inner","shape":{"kind":"text"}}]}
```

### yandao

```json
{"id":"yandao","title":"盐道","summary":"大世界指导续写：川南盐运码头上，官府与盐帮在新立的查验卡前对峙；没有玩家角色，输入是给叙述者的指示。","input":"note","director":true,"guard":0,"lore":{"entries":1,"layers":2},"greetings":[{"text":"黄昏。盐津镇的石板街上，货栈的伙计把最后一垛盐包抬进门，门板合上，街面只剩挑水的和收摊的。县衙前新立的查验卡空着，两个差役坐在条凳上剥花生。河面上没有船。沈大娘的货栈门口挂着灯，灯下没人。"},{"text":"三天前，货栈门口动了手。沈二的驼夫和查验卡的差役推搡起来，一个差役被盐包砸断了胳膊，一个驼夫额头开了口子，血洒在石板上，冲了两桶水还看得见印子。县衙贴了告示要拿打人的驼夫，沈大娘闭门不见客，沈二带着驼队停在镇外十里的渡口。天没黑透，街上就没人了。","do":[{"path":"局势","set":7},{"path":"起点","set":"血案"},{"event":"冲突:升级"}]}],"fiction":[{"id":"town","label":"盐津镇"},{"id":"sides","label":"官府与盐帮"},{"id":"now","label":"眼下"},{"id":"tense","label":"见血之后","when":{"path":"局势","op":"gte","value":6}},{"id":"blood","label":"三天前的血案","when":{"path":"起点","is":"血案"}}],"rules":{"fields":[{"path":"局势","type":"int","min":0,"max":10,"initial":2},{"path":"起点","type":"enum","options":["平静","血案"],"initial":"平静"}],"actions":[],"readouts":[{"id":"tension","text":"这一幕之后，官府与盐帮之间的局势","options":[{"id":"eased","text":"缓和了","do":[{"path":"局势","add":-2}]},{"id":"same","text":"没有变化","do":[]},{"id":"worse","text":"更紧张了","do":[{"path":"局势","add":2}]},{"id":"broke","text":"动了手或见了血","do":[{"path":"局势","add":4},{"event":"冲突:升级"}]}]}]},"products":[{"id":"notes","shape":{"kind":"list"}},{"id":"options","shape":{"kind":"list","max":4}},{"id":"inner","shape":{"kind":"text"}}]}
```

## Token（与 `packages/client/src/tokens.css` 一致）

```css
--surface-0: light-dark(#f9f9f7, #0b0b0b);  --surface-1: light-dark(#fcfcfb, #151515);
--surface-2: light-dark(#ffffff, #1a1a19);  --surface-3: light-dark(#ffffff, #20201f);
--ink: light-dark(#151515, #f5f5f5);  --ink-2: light-dark(#525252, #a3a3a3);  --ink-3: light-dark(#8a8a8a, #6f6f6f);
--alpha-1: light-dark(rgb(20 20 20 / 0.05), rgb(255 255 255 / 0.05));
--alpha-2: light-dark(rgb(20 20 20 / 0.1), rgb(255 255 255 / 0.09));
--alpha-3: light-dark(rgb(20 20 20 / 0.2), rgb(255 255 255 / 0.18));
--alpha-4: light-dark(rgb(20 20 20 / 0.35), rgb(255 255 255 / 0.3));
--line: var(--alpha-2);  --line-strong: var(--alpha-3);  --fill: var(--alpha-2);  --ghost-hover: var(--alpha-1);
--primary: var(--ink);  --primary-ink: var(--surface-1);
--danger: light-dark(#dc2626, #f87171);  --ok: light-dark(#1f7a3f, #4ade80);
--scrim: light-dark(rgb(0 0 0 / 0.2), rgb(0 0 0 / 0.5));  --ring: var(--alpha-4);
--radius-sm: 4px;  --radius: 8px;  --radius-card: 12px;  --radius-dialog: 16px;  --radius-pill: 999px;
--control: 32px;  --control-sm: 24px;  --icon: 20px;  --icon-sm: 16px;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
--text-caption: 0.6875rem;  --text-footnote: 0.75rem;  --text-body: 0.875rem;  --text-heading: 0.9375rem;
--text-prose: 1rem;  --text-title: 1.25rem;
--space-1: 4px;  --space-2: 8px;  --space-3: 12px;  --space-4: 16px;  --space-5: 24px;  --space-6: 32px;
```
