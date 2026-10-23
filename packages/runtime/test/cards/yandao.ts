// 盐道: the world-card template, hand-written. No protagonist and no player in the fiction: the frame has no `persona`,
// the card fills `pov` itself (so the player's global pov slot yields), and `input` defaults to the note channel: what
// the player types is direction to the narrator, never a line of anyone in the story. Nothing else is special: the
// fiction is a town instead of a person, one world-state field moved by a readout, one layered lore entry whose second
// layer opens on an event the readout emits, the director on so MUST/MAY plays.
// Two greetings (the ecosystem's "IF line" openings): the second starts after the fight. Its `do` sets the tension, flips
// the `起点` enum that one fiction variant reads, and emits the event that opens the lore's second layer on turn 1.
import { decodeCard, type Card } from "../../src/card.ts"

export const load = (): Card =>
  decodeCard({
    id: "yandao",
    title: "盐道",
    summary: "大世界指导续写：川南盐运码头上，官府与盐帮在新立的查验卡前对峙；没有玩家角色，输入是给叙述者的指示。",
    input: "note",
    frame: [
      {
        id: "pov",
        text: "全知第三人称叙述，镜头可以在任何人物之间切换。故事里没有玩家角色；输入是作者给叙述者的指示，不是任何人物的话，不要把它写进故事。",
      },
      { id: "style", text: "白描，少用形容词；对白短，带方言味；每一幕有一个具体的物件或动作收尾。" },
    ],
    fiction: [
      {
        id: "town",
        label: "盐津镇",
        text: "盐津镇：川南山里的盐运码头。一条石板街沿河，北头是县衙，南头是盐帮的货栈。镇上三百户，靠盐吃饭。",
      },
      {
        id: "sides",
        label: "官府与盐帮",
        text: "官府：县令周秉文，五十出头，外省人，到任两年，想在盐税上做出政绩。差役头子叫老柯，本地人，两边都认识。\n盐帮：帮主沈大娘，六十岁，丈夫死后掌舵十五年，驼队和船都是她的。她的侄子沈二是跑外的，脾气急。",
      },
      {
        id: "now",
        label: "眼下",
        text: "眼下：县衙新立了盐道的查验卡，驼队进镇要开包验货。盐帮认为这是要抽第二道税，已经两趟驼队绕道不进镇。",
      },
      {
        id: "tense",
        label: "见血之后",
        text: "街面上已经见过血，店铺半数关门，镇民晚上不出门。",
        when: { path: "局势", op: "gte", value: 6 },
      },
      {
        id: "blood",
        label: "三天前的血案",
        text: "镇上人都记得三天前货栈门口那一场：差役断了胳膊，驼夫开了头，县衙拿人的告示还贴在卡子上。两边都在等对方先低头。",
        when: { path: "起点", is: "血案" },
      },
    ],
    greetings: [
      {
        text: "黄昏。盐津镇的石板街上，货栈的伙计把最后一垛盐包抬进门，门板合上，街面只剩挑水的和收摊的。县衙前新立的查验卡空着，两个差役坐在条凳上剥花生。河面上没有船。沈大娘的货栈门口挂着灯，灯下没人。",
      },
      {
        text: "三天前，货栈门口动了手。沈二的驼夫和查验卡的差役推搡起来，一个差役被盐包砸断了胳膊，一个驼夫额头开了口子，血洒在石板上，冲了两桶水还看得见印子。县衙贴了告示要拿打人的驼夫，沈大娘闭门不见客，沈二带着驼队停在镇外十里的渡口。天没黑透，街上就没人了。",
        do: [{ path: "局势", set: 7 }, { path: "起点", set: "血案" }, { event: "冲突:升级" }],
      },
    ],
    rules: {
      fields: [
        { path: "局势", type: "int", min: 0, max: 10, initial: 2 },
        { path: "起点", type: "enum", options: ["平静", "血案"], initial: "平静" },
      ],
      actions: [],
      readouts: [
        {
          id: "tension",
          text: "这一幕之后，官府与盐帮之间的局势",
          options: [
            { id: "eased", text: "缓和了", do: [{ path: "局势", add: -2 }] },
            { id: "same", text: "没有变化", do: [] },
            { id: "worse", text: "更紧张了", do: [{ path: "局势", add: 2 }] },
            { id: "broke", text: "动了手或见了血", do: [{ path: "局势", add: 4 }, { event: "冲突:升级" }] },
          ],
        },
      ],
    },
    lore: [
      {
        id: "yandao",
        layers: [
          "盐道之争已经半年，镇上人都说县令是外省人不懂盐。",
          "周秉文私下收过沈大娘的银子，查验卡是做给省里巡按看的戏；沈大娘知道，沈二不知道。",
        ],
        unlock: { all: [] },
        offer: { event: "冲突:升级" },
      },
    ],
    guard: [],
    director: true,
    // A world card's notes came back as scenery (docs/provider-reading.md §10). The fix is the ask, not the mechanism:
    // the card overrides the harness's notes wording by id, and the list shape stays (the fold reads it).
    asks: [
      {
        id: "product.notes",
        text: "记事只记事实：谁做了什么、谁说了什么要紧的话、什么变了、新出现的人名和地名。不写景物、天气和气氛，不评价文字。每条一句。",
      },
    ],
  })

// Direction, not dialogue: each line is what a novelist tells the narrator to write next.
export const turns = [
  "沈二带的驼队进镇，街上的人在看。先写镇子的样子，不要急着出事。",
  "老柯带两个差役上来查驼队，沈二不让开包。写到动手为止，写两三个旁观者的反应。",
  "切到县衙里。周秉文听到消息，写他和老柯的对话。",
  "第二天早上，镇上的传言。收尾时留一个悬念。",
]
