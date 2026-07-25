/**
 * Summary Engine V1 configuration — ported 1:1 from the approved Previewer
 * source (ENGINEERING/Prototype/data/summaryBlocks.json, blocks 2026-07-05).
 *
 * APPROVED & FROZEN — block IDs are permanent; do not edit claims, conditions,
 * thresholds, connectives or variant texts without founder approval.
 */

import type { SummaryEngineConfig } from '../../types/moments';

export const SUMMARY_ENGINE_CONFIG: SummaryEngineConfig = {
  engineVersion: 'Summary Engine V1 · blocks 2026-07-05',
  thresholds: { high: 0.56, low: 0.44 },
  connectives: ['', '而', '同时，', '另一方面，', ''],
  dimensions: [
    {
      code: 'AGY',
      sliderKey: 'c',
      name: '掌控感',
      signals: ['CHG-03', 'CHG-01', 'CHG-02', 'EMW-01', 'MEA-11', 'CHG-08', 'MEA-10', 'EMW-04', 'CHG-09'],
    },
    {
      code: 'HUM',
      sliderKey: 'h',
      name: '人性预设',
      signals: ['TRU-01', 'TRU-05', 'TRU-02', 'MEA-12', 'TRU-03'],
    },
    {
      code: 'CON',
      sliderKey: 'n',
      name: '联结取向',
      signals: [
        'CAR-01',
        'CAR-02',
        'CAR-03',
        'REL-04',
        'REL-05',
        'REL-06',
        'MEA-02',
        'TRU-06',
        'REL-07',
        'REL-08',
        'REL-09',
        'REL-10',
      ],
    },
    {
      code: 'TIM',
      sliderKey: 't',
      name: '时间与意义',
      signals: [
        'MEA-01',
        'MEA-02',
        'CHG-07',
        'CHG-08',
        'CHG-02',
        'MEA-05',
        'MEA-06',
        'CHG-05',
        'CHG-06',
        'MEA-03',
        'MEA-04',
      ],
    },
    {
      code: 'SEC',
      sliderKey: 'a',
      name: '安稳与自由',
      signals: ['MEA-08', 'MEA-09', 'CHG-07', 'TRU-06', 'TRU-02', 'EMW-05', 'CHG-09'],
    },
  ],
  blocks: [
    {
      id: 'SB-AGY-01',
      dim: 'AGY',
      claim: 'Turns setbacks, then moves',
      conditions: [
        { signal: 'CHG-01', op: '>=', value: 0.56 },
        { signal: 'CHG-03', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '事情不顺的时候，你的第一反应常常不是「为什么是我」，而是把它翻个面，看看有没有能用的角度——然后就顺着新角度走下去了。',
        },
        { rhythm: 'short', text: '你更习惯把变化翻个面，找到能用的角度就出发。' },
      ],
    },
    {
      id: 'SB-AGY-02',
      dim: 'AGY',
      claim: 'Receives reality first, then steps',
      conditions: [
        { signal: 'EMW-01', op: '>=', value: 0.56 },
        { signal: 'CHG-02', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '事情来了，你似乎先把它接住——不争辩、不绕开——然后很快就动起来。这种「认了，然后走」的节奏，是你面对变化时最常见的样子。',
        },
        { rhythm: 'short', text: '你更倾向先接受眼前的事实，再迈出下一步——接得快，动得也不慢。' },
      ],
    },
    {
      id: 'SB-AGY-03',
      dim: 'AGY',
      claim: 'Acts on the world directly',
      conditions: [
        { signal: 'CHG-03', op: '>=', value: 0.6 },
        { signal: 'CHG-02', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '你似乎不太等事情自己变好——能动手的地方，你会直接动手。方向盘握在自己手里的时候，你走得最稳。',
        },
        { rhythm: 'short', text: '能改变的事，你倾向直接去改，而不是慢慢适应。' },
      ],
    },
    {
      id: 'SB-AGY-04',
      dim: 'AGY',
      claim: 'Reads events as weather',
      conditions: [
        { signal: 'MEA-11', op: '>=', value: 0.56 },
        { signal: 'CHG-03', op: '<=', value: 0.44 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '顺与不顺，你似乎更愿意把它们当作天气——来了就来了，不太往自己身上揽。这让你少了很多自责，也可能让方向盘偶尔离手远了些。',
        },
        { rhythm: 'short', text: '你可能更习惯用运气去理解起落，让自己和结果之间留一点缓冲。' },
      ],
    },
    {
      id: 'SB-AGY-05',
      dim: 'AGY',
      claim: 'Control through the drawn staircase',
      conditions: [
        { signal: 'CHG-08', op: '>=', value: 0.56 },
        { signal: 'CHG-03', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '你的掌控感来自铺路：把要走的路先画出来，再一步一步走实。变化到了你这里，往往先变成一张新的路线图。',
        },
        { rhythm: 'short', text: '你似乎习惯用规划来接住变化——先画路线，再上路。' },
      ],
    },
    {
      id: 'SB-AGY-F',
      dim: 'AGY',
      fallback: true,
      claim: 'Agency not yet legible',
      conditions: [],
      variants: [
        {
          rhythm: 'long',
          text: '关于你怎么面对变化，这几个瞬间还没让 Seen 看分明——这一面，留给之后的日子。',
        },
        { rhythm: 'short', text: '你与「掌控」的关系，Seen 还想再多看几眼。' },
      ],
    },
    {
      id: 'SB-HUM-01',
      dim: 'HUM',
      claim: 'Reads people kindly first',
      conditions: [{ signal: 'TRU-01', op: '>=', value: 0.6 }],
      variants: [
        {
          rhythm: 'long',
          text: '读人的时候，你的第一反应偏向善意：先替对方找一个说得通的理由，而不是先怀疑动机。',
        },
        { rhythm: 'short', text: '你似乎习惯先把人往好处想。' },
      ],
    },
    {
      id: 'SB-HUM-02',
      dim: 'HUM',
      claim: 'Guard up, readings kind (Watchful Kindness)',
      conditions: [
        { signal: 'TRU-02', op: '>=', value: 0.56 },
        { signal: 'TRU-01', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '你身上有一种少见的组合：门口有锁，心里没墙。对不熟的人和事，你会先留个心眼；但真正读人的时候，你还是习惯往好处想。',
        },
        { rhythm: 'short', text: '你可能一边保持警觉，一边把人往好处想——防备是习惯，善意是底色。' },
      ],
    },
    {
      id: 'SB-HUM-03',
      dim: 'HUM',
      claim: 'Guard up, readings dark',
      conditions: [
        { signal: 'TRU-02', op: '>=', value: 0.56 },
        { signal: 'TRU-01', op: '<=', value: 0.44 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '对人，你的第一道反应是清醒：先看清风险，再决定靠多近。这不是冷，是你和世界打过交道之后的诚实。',
        },
        { rhythm: 'short', text: '你对人保留一份审慎——信任在你这里，要慢慢挣。' },
      ],
    },
    {
      id: 'SB-HUM-04',
      dim: 'HUM',
      claim: 'Withholds verdicts',
      conditions: [
        { signal: 'TRU-05', op: '>=', value: 0.56 },
        { signal: 'TRU-01', op: '<', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '你不太急着给人下结论。事情可以就事论事，但「这个人怎么样」，你更愿意让它多悬一会儿。',
        },
        { rhythm: 'short', text: '对人下判断这件事，你习惯让子弹多飞一会儿。' },
      ],
    },
    {
      id: 'SB-HUM-05',
      dim: 'HUM',
      claim: 'Kind readings, unhurried verdicts',
      conditions: [
        { signal: 'TRU-01', op: '>=', value: 0.56 },
        { signal: 'TRU-05', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '对别人的行为，你似乎习惯先找一个善意的解释，而且不急着给人下结论——事可以议论，人先留白。',
        },
        { rhythm: 'short', text: '你更倾向把人往好处想，也更愿意让判断多等一等。' },
      ],
    },
    {
      id: 'SB-HUM-F',
      dim: 'HUM',
      fallback: true,
      claim: 'Human-nature reading not yet legible',
      conditions: [],
      variants: [
        { rhythm: 'long', text: '你怎么看人，这几个瞬间透露得还不多——留给之后慢慢展开。' },
        { rhythm: 'short', text: '关于人性这一面，Seen 还没读到你的底色。' },
      ],
    },
    {
      id: 'SB-CON-01',
      dim: 'CON',
      claim: 'Gives warmly, holds the line (Boundaried Warmth)',
      conditions: [
        { signal: 'CAR-01', op: '>=', value: 0.56 },
        { signal: 'REL-04', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '你愿意对世界温柔，但温柔是有边界的——能给的你给得很自然，给不了的你也不勉强自己开口答应。这不是冷淡，是你对自己和对方都诚实。',
        },
        { rhythm: 'short', text: '你似乎习惯在付出的同时留好边界：心是热的，线是清的。' },
      ],
    },
    {
      id: 'SB-CON-02',
      dim: 'CON',
      claim: 'Binds deep when it binds',
      conditions: [{ signal: 'CAR-02', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '一旦你决定接住一段关系，你是打算负责到底的那种接法——不是收留几天，是把它写进往后的日子里。',
        },
        { rhythm: 'short', text: '你似乎愿意为真正的联结，承担长期的分量。' },
      ],
    },
    {
      id: 'SB-CON-03',
      dim: 'CON',
      claim: 'Fortune flows to their people',
      conditions: [{ signal: 'REL-06', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '好事落到你头上，第一时间就会长出别人的名字——你的幸福感，好像天生是要分着用的。',
        },
        { rhythm: 'short', text: '好运在你这里，往往先流向你亲近的人。' },
      ],
    },
    {
      id: 'SB-CON-04',
      dim: 'CON',
      claim: 'Cares through arrangements',
      conditions: [{ signal: 'CAR-03', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '你的关心常常长成「安排」的样子：找到渠道、搭好路径、把事情真正解决——比起安慰的话，你更习惯把事办妥。',
        },
        { rhythm: 'short', text: '你更习惯用解决问题的方式，去在乎一个人。' },
      ],
    },
    {
      id: 'SB-CON-05',
      dim: 'CON',
      claim: 'Keeps their own news close',
      conditions: [{ signal: 'TRU-06', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '自己的事，你习惯先揣着——不是不信任谁，只是重要的消息，你想先在自己这里放稳。',
        },
        { rhythm: 'short', text: '你的消息，通常先在自己这里放一放。' },
      ],
    },
    {
      id: 'SB-CON-F',
      dim: 'CON',
      fallback: true,
      claim: 'Connection not yet legible',
      conditions: [],
      variants: [
        { rhythm: 'long', text: '你和人靠近的方式，这几个瞬间还没画出轮廓——之后再看。' },
        { rhythm: 'short', text: '联结这一面，Seen 还想多认识你一点。' },
      ],
    },
    {
      id: 'SB-TIM-01',
      dim: 'TIM',
      claim: 'Meaning lives in experiencing',
      conditions: [{ signal: 'MEA-01', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '对你来说，日子的意义不太在清单里，而在亲身去感受的那一下——有些事，就是要自己到场。',
        },
        { rhythm: 'short', text: '你似乎相信，意义就藏在体验本身。' },
      ],
    },
    {
      id: 'SB-TIM-02',
      dim: 'TIM',
      claim: 'Meaning lives in being of use',
      conditions: [{ signal: 'MEA-02', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '你的意义感和「有没有帮上」连得很紧——能被需要、能派上用场的时刻，最像你活着的样子。',
        },
        { rhythm: 'short', text: '对你而言，有用，本身就是意义。' },
      ],
    },
    {
      id: 'SB-TIM-03',
      dim: 'TIM',
      claim: 'Tomorrow gets a staircase',
      conditions: [{ signal: 'CHG-08', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '明天在你这里不是等来的，是画出来的：先有阶梯，再有远方。你对未来的认真，藏在规划里。',
        },
        { rhythm: 'short', text: '你习惯先给未来画好阶梯，再慢慢往上走。' },
      ],
    },
    {
      id: 'SB-TIM-04',
      dim: 'TIM',
      claim: 'The days are kept whole',
      conditions: [{ signal: 'CHG-07', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '你的日子有自己的形状，而且你愿意守着它——不是不敢变，是它本来就运转得让你安心。',
        },
        { rhythm: 'short', text: '你更愿意让生活留在原来的轨道上，稳稳地走。' },
      ],
    },
    {
      id: 'SB-TIM-05',
      dim: 'TIM',
      claim: 'Kept days, with room for wonder',
      conditions: [
        { signal: 'MEA-01', op: '>=', value: 0.56 },
        { signal: 'CHG-07', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '你不太想推翻现在的日子——它运转得好好的。但在这份「照旧」里，你给体验留了一个位置：有些事，就是想亲身去感受一次。',
        },
        { rhythm: 'short', text: '你似乎想把生活留在原来的轨道上，同时给「想体验的事」留出一节车厢。' },
      ],
    },
    {
      id: 'SB-TIM-F',
      dim: 'TIM',
      fallback: true,
      claim: 'Time & meaning not yet legible',
      conditions: [],
      variants: [
        { rhythm: 'long', text: '时间和意义这一题，Seen 还没读到你的答案——不急。' },
        { rhythm: 'short', text: '你与时间的关系，还留白着。' },
      ],
    },
    {
      id: 'SB-SEC-01',
      dim: 'SEC',
      claim: 'Floor first, and the ceiling can wait',
      conditions: [
        { signal: 'MEA-08', op: '>=', value: 0.56 },
        { signal: 'MEA-09', op: '<=', value: 0.44 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '在安稳和自由之间，你几乎不用犹豫：先把地基打牢。对你来说，确定性不是束缚，是让一切成立的前提。',
        },
        { rhythm: 'short', text: '你把安稳排得很靠前——地基牢了，别的才谈得上。' },
      ],
    },
    {
      id: 'SB-SEC-02',
      dim: 'SEC',
      claim: 'Sails first, anchors are negotiable',
      conditions: [
        { signal: 'MEA-09', op: '>=', value: 0.56 },
        { signal: 'MEA-08', op: '<=', value: 0.44 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '比起守着安稳，你更怕日子被拴住。方向必须是自己的——为此付一点代价，你也认。',
        },
        { rhythm: 'short', text: '自由在你这里排第一：路要是自己选的，才走得有劲。' },
      ],
    },
    {
      id: 'SB-SEC-03',
      dim: 'SEC',
      claim: 'Secures the floor to launch from it',
      conditions: [
        { signal: 'MEA-08', op: '>=', value: 0.56 },
        { signal: 'MEA-09', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '安稳和自由，在你这儿好像不是二选一：你要先把地基打牢，但打牢不是为了停在原地——是为了敢往更远的地方走。',
        },
        { rhythm: 'short', text: '你似乎把安稳当跳板，不当终点。' },
      ],
    },
    {
      id: 'SB-SEC-04',
      dim: 'SEC',
      claim: 'A quiet floor — kept safe, kept private',
      conditions: [
        { signal: 'MEA-08', op: '>=', value: 0.56 },
        { signal: 'TRU-06', op: '>=', value: 0.56 },
      ],
      variants: [
        {
          rhythm: 'long',
          text: '你的安全感是安静的：底垫稳，消息收好，重要的东西先放进自己看得见的地方。',
        },
        { rhythm: 'short', text: '你习惯把安稳，建在别人看不见的地方。' },
      ],
    },
    {
      id: 'SB-SEC-05',
      dim: 'SEC',
      claim: 'Floor first (simple)',
      conditions: [{ signal: 'MEA-08', op: '>=', value: 0.56 }],
      variants: [
        { rhythm: 'long', text: '安稳，在你这里排得很靠前——先把底垫稳，其他都可以慢慢来。' },
        { rhythm: 'short', text: '你更愿意先守住确定的部分，再考虑别的。' },
      ],
    },
    {
      id: 'SB-SEC-F',
      dim: 'SEC',
      fallback: true,
      claim: 'Security/freedom not yet legible',
      conditions: [],
      variants: [
        { rhythm: 'long', text: '安稳与自由怎么排序，这几个瞬间还没让 Seen 看清——留给之后。' },
        { rhythm: 'short', text: '这一面还在雾里，值得再多几个瞬间。' },
      ],
    },
    {
      id: 'SB-AGY-06',
      dim: 'AGY',
      claim: 'Outcomes are made by effort — the lever feels real',
      conditions: [{ signal: 'MEA-10', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '在你眼里，结果大多是干出来的——所以你也愿意把力气押在自己身上，相信这笔账不会白记。',
        },
        { rhythm: 'short', text: '你更相信事在人为：功夫下到了，路就会出来。' },
      ],
    },
    {
      id: 'SB-TIM-06',
      dim: 'TIM',
      claim: "Life measured by one's own coordinates",
      conditions: [{ signal: 'MEA-05', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '你的日子有自己的刻度，别人的进度条快慢，改不了你要去的方向。',
        },
        { rhythm: 'short', text: '你更习惯用自己的标准，丈量自己的生活。' },
      ],
    },
    {
      id: 'SB-TIM-07',
      dim: 'TIM',
      claim: "Others' progress converts to fuel",
      conditions: [{ signal: 'MEA-06', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '别人的好消息会在你心里点一下火——有点紧，也有点劲。你习惯把这种感觉烧成往前走的燃料。',
        },
        { rhythm: 'short', text: '比较会让你上一点发条，而你通常把它拧成动力。' },
      ],
    },
    {
      id: 'SB-CON-06',
      dim: 'CON',
      claim: 'Life among known faces',
      conditions: [{ signal: 'REL-07', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '你喜欢被熟悉的人围绕的日子——街坊叫得出名字，生活有人情的回声。',
        },
        { rhythm: 'short', text: '熟人环绕的生活，让你觉得踏实。' },
      ],
    },
    {
      id: 'SB-CON-07',
      dim: 'CON',
      claim: 'At ease unwatched',
      conditions: [{ signal: 'REL-08', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '你珍惜不被注视的自由——人群越大，你越自在，生活是自己的，不用交代给谁。',
        },
        { rhythm: 'short', text: '不被打扰的日子，对你是一种奢侈的舒服。' },
      ],
    },
    {
      id: 'SB-CON-08',
      dim: 'CON',
      claim: 'Few and real',
      conditions: [{ signal: 'REL-09', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '朋友在你这里不用多——几个真的，就足够撑起一整个生活。',
        },
        { rhythm: 'short', text: '你的联结讲究浓度：少而真。' },
      ],
    },
    {
      id: 'SB-CON-09',
      dim: 'CON',
      claim: 'Peace over the point',
      conditions: [{ signal: 'REL-10', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '跟人起冲突这件事，你能绕就绕——不是没脾气，是你觉得和气比争一口气值钱。',
        },
        { rhythm: 'short', text: '你更愿意把摩擦绕过去，把和气留下来。' },
      ],
    },
    {
      id: 'SB-TIM-08',
      dim: 'TIM',
      claim: 'The past is visited',
      conditions: [{ signal: 'CHG-06', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '过去在你这里是活的——你会时不时回去坐一坐，回来的时候，手里多半带着点温度。',
        },
        { rhythm: 'short', text: '你习惯常回头看看，再接着往前走。' },
      ],
    },
    {
      id: 'SB-TIM-09',
      dim: 'TIM',
      claim: 'Travelling light',
      conditions: [{ signal: 'CHG-05', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '你习惯给生活减重：该翻篇的翻篇，东西和心事都不多留——轻一点，走得远一点。',
        },
        { rhythm: 'short', text: '你更喜欢轻装往前，过去的就让它过去。' },
      ],
    },
    {
      id: 'SB-TIM-10',
      dim: 'TIM',
      claim: 'Being needs no warrant',
      conditions: [{ signal: 'MEA-03', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '「为什么活着」这个问题，你已经放下了——活着本身就站得住，不需要再向外要理由。',
        },
        { rhythm: 'short', text: '对你来说，存在本身就是答案。' },
      ],
    },
    {
      id: 'SB-TIM-11',
      dim: 'TIM',
      claim: 'Answers are self-found',
      conditions: [{ signal: 'MEA-04', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '你相信意义是各人自己找的——你不接别人的标准答案，也不把自己的塞给别人。',
        },
        { rhythm: 'short', text: '人生的答案，你觉得得自己找——你也这样尊重别人。' },
      ],
    },
    {
      id: 'SB-SEC-06',
      dim: 'SEC',
      claim: 'Sails first (simple)',
      conditions: [{ signal: 'MEA-09', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '自由这件事，你排得很靠前——能自己选的日子，才算自己的日子。',
        },
        { rhythm: 'short', text: '路要是自己选的，你才走得有劲。' },
      ],
    },
    {
      id: 'SB-SEC-07',
      dim: 'SEC',
      claim: 'Certainty first',
      conditions: [{ signal: 'CHG-09', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '面对未知，你更想先知道——哪怕答案不轻松。确定下来，你才好安排接下来的路。',
        },
        { rhythm: 'short', text: '你宁可要一个确定的答案，也不要悬着。' },
      ],
    },
    {
      id: 'SB-SEC-08',
      dim: 'SEC',
      claim: 'Guarding today',
      conditions: [{ signal: 'EMW-05', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '有些答案你宁可不看——不是不敢，是你把今天的心境看得更要紧。',
        },
        { rhythm: 'short', text: '你会替今天挡掉一些不必要的沉重。' },
      ],
    },
    {
      id: 'SB-AGY-07',
      dim: 'AGY',
      claim: 'No budget for the unmovable',
      conditions: [{ signal: 'EMW-04', op: '>=', value: 0.56 }],
      variants: [
        {
          rhythm: 'long',
          text: '改变不了的事，你不给它情绪预算——省下来的力气，都花在够得着的地方。',
        },
        { rhythm: 'short', text: '不可控的事，你通常不让它消耗你。' },
      ],
    },
  ],
};
