import type { AppState } from './types'
import { DEFAULT_AI_CONFIG } from './ai'
import { todayKey } from './utils'

const now = Date.now()
const day = 86400000

export function createSeedState(): AppState {
  const bookId = 'book_1'
  const bookId2 = 'book_2'

  const v1 = 'vol_1'
  const v2 = 'vol_2'

  const chapters = [
    {
      id: 'ch_1',
      bookId,
      volumeId: v1,
      title: '第一章 废柴觉醒',
      order: 0,
      status: 'published' as const,
      synopsis: '林尘被家族判定为废脉，坠崖后偶得上古传承，觉醒混沌之体。',
      goal: '立住"废柴"处境，让坠崖传承成立。',
      conflict: '家族欺辱 vs 少年不屈。',
      turning: '坠崖刹那，传承之声自崖底响起。',
      hook: '万丈金光冲天而起。',
      pov: '林尘',
      cast: ['char_1'],
      foreshadowIds: ['fs_1'],
      outlineStatus: 'written' as const,
      content: `青云镇，林家。

"废物！连这点灵气都引不动，也配姓林？"

演武场上，少年被一脚踹翻在地。他叫林尘，林家嫡系子弟，却在十六岁这年测出九品废脉，成了整个家族的笑柄。

他抹去嘴角的血，没有辩解，只是默默攥紧了拳头。指甲深深陷入掌心，渗出丝丝血迹。

三年了。三年来他受尽冷眼，可他从未放弃。因为他记得父亲失踪前留下的那句话——

"尘儿，这个世界，比你想象的要大得多。"

夜深，林尘独自来到后山断崖。望着崖底翻涌的云海，他深吸一口气，纵身跃下。

风声在耳边呼啸。就在意识即将模糊的刹那，一道古老而沧桑的声音，自崖底深处响起——

"混沌之体，历经万载，终于等到了有缘人……"

刹那间，万丈金光自崖底冲天而起。`,
      createdAt: now - day * 10,
      updatedAt: now - day * 10,
    },
    {
      id: 'ch_2',
      bookId,
      volumeId: v1,
      title: '第二章 混沌传承',
      order: 1,
      status: 'published' as const,
      synopsis: '林尘获得混沌老祖传承，修为暴涨，但传承引来觊觎。',
      goal: '完成蜕变，同时埋下"必须隐藏"的压力。',
      conflict: '力量暴涨 vs 混沌之体不可示人。',
      turning: '九品废脉一夜蜕为混沌之体。',
      hook: '冲天金光被暗处几双眼睛目睹。',
      pov: '林尘',
      cast: ['char_1', 'char_2'],
      foreshadowIds: ['fs_2'],
      outlineStatus: 'written' as const,
      content: `当林尘再次睁开眼时，发现自己身处一座古老的石殿之中。

石殿中央，悬浮着一枚散发着混沌气息的玉简。就在他触碰玉简的瞬间，海量信息如潮水般涌入脑海。

《混沌造化诀》——上古混沌老祖的毕生所学。

"从今日起，你便是本座的传人。"那道声音再度响起，却已虚弱无比，"记住，混沌之体举世罕见，切莫轻易示人。待到你能独当一面之时，方可出世……"

声音渐渐消散，石殿也随之崩塌。林尘只觉一股磅礴的力量在体内流转，原本堵塞的经脉被一一冲开。

九品废脉，竟在一夜之间，蜕变成了传说中的混沌之体。

当他重新回到林家时，天已微亮。没有人知道，这个曾经的废物，已经悄然完成了蜕变。

而更没有人知道，那道冲天的金光，早已被几双隐藏在暗处的眼睛，尽收眼底。`,
      createdAt: now - day * 9,
      updatedAt: now - day * 9,
    },
    {
      id: 'ch_3',
      bookId,
      volumeId: v1,
      title: '第三章 初露锋芒',
      order: 2,
      status: 'reviewing' as const,
      synopsis: '家族大比，林尘一鸣惊人，击败昔日欺辱他的堂兄。',
      goal: '当众立威，改写"废物"标签。',
      conflict: '全场哄笑的轻视 vs 一击定音的实力。',
      turning: '一招击败淬体九重的林虎。',
      hook: '高台上家主一言不发的注视。',
      pov: '林尘',
      cast: ['char_1', 'char_3'],
      foreshadowIds: ['fs_3'],
      outlineStatus: 'written' as const,
      content: `一月之后，林家年度大比。

"下一个，林尘对战林虎！"

此言一出，全场哄笑。林虎，林家年轻一代的佼佼者，早已踏入淬体九重。而林尘，在众人印象里，依旧是那个连灵气都引不动的废物。

"堂弟，我让你三招。"林虎负手而立，满脸戏谑。

林尘没有说话，只是缓缓抬起了手。

下一瞬，他动了。

没有人看清他是如何出手的。只见一道残影掠过，林虎庞大的身躯便如断线风筝般倒飞而出，重重砸在演武场的石柱上，当场昏死过去。

全场死寂。

"这……这不可能！"大长老猛地站起身，眼中满是难以置信。

林尘收回手，神色平静地扫过众人，最终目光落在高台之上那位始终一言不发的家主身上。

他知道，从这一刻起，一切都不同了。`,
      createdAt: now - day * 2,
      updatedAt: now - day * 1,
    },
    {
      id: 'ch_4',
      bookId,
      volumeId: v1,
      title: '第四章 神秘来客',
      order: 3,
      status: 'draft' as const,
      synopsis: '（待写）一位神秘黑袍人登门，与林尘父亲的失踪有关。',
      goal: '引入父亲失踪的第一条实线索。',
      conflict: '黑袍人的善意来意 vs 林尘的戒备。',
      turning: '',
      hook: '',
      pov: '林尘',
      cast: ['char_1'],
      foreshadowIds: ['fs_1', 'fs_2'],
      outlineStatus: 'plan' as const,
      content: '',
      createdAt: now - day * 1,
      updatedAt: now - day * 1,
    },
    {
      id: 'ch_5',
      bookId,
      volumeId: v2,
      title: '第五章 青云学府',
      order: 0,
      status: 'draft' as const,
      synopsis: '（待写）林尘离开家族，前往更大的舞台——青云学府。',
      goal: '完成卷末转场，把主角送入学府。',
      conflict: '安于一隅 vs 更大的世界在召唤。',
      turning: '',
      hook: '',
      pov: '林尘',
      cast: ['char_1', 'char_4'],
      foreshadowIds: [],
      outlineStatus: 'plan' as const,
      content: '',
      createdAt: now,
      updatedAt: now,
    },
  ]

  return {
    books: [
      {
        id: bookId,
        title: '混沌神尊',
        author: '墨客',
        genre: '玄幻奇幻',
        synopsis:
          '九品废脉的少年林尘，坠崖偶得上古混沌传承，从此逆天改命，一步步踏上神尊之位。这是一条以混沌证道、碾压诸天的崛起之路。',
        coverColor: '#6d5efc',
        status: 'ongoing',
        dailyGoal: 4000,
        createdAt: now - day * 12,
        updatedAt: now - day * 1,
      },
      {
        id: bookId2,
        title: '都市最强医仙',
        author: '墨客',
        genre: '都市异能',
        synopsis: '退伍军医回归都市，一手绝世医术，一身惊天本领，在繁华都市中搅动风云。',
        coverColor: '#f2762e',
        status: 'hiatus',
        dailyGoal: 3000,
        createdAt: now - day * 40,
        updatedAt: now - day * 20,
      },
    ],
    volumes: [
      {
        id: v1,
        bookId,
        title: '第一卷 · 家族崛起',
        order: 0,
        synopsis: '废脉少年在家族内觉醒混沌之体，于年度大比一鸣惊人，立足林家。',
        goal: '林尘摆脱废柴之名，查得父亲失踪的第一条线索。',
        conflict: '家族内部的轻视与倾轧 vs 林尘隐藏实力、悄然成长。',
      },
      {
        id: v2,
        bookId,
        title: '第二卷 · 学府风云',
        order: 1,
        synopsis: '林尘进入青云学府，结识苏清月，卷入东域各方势力的博弈。',
        goal: '在学府站稳脚跟并接触到父亲失踪背后的势力。',
        conflict: '隐藏身份自保 vs 天才云集处的锋芒必露。',
      },
    ],
    chapters,
    characters: [
      {
        id: 'char_1',
        bookId,
        name: '林尘',
        role: '主角',
        desc: '林家嫡系子弟，初为九品废脉，坠崖后觉醒混沌之体。性格坚韧隐忍，目标查明父亲失踪真相。',
      },
      {
        id: 'char_2',
        bookId,
        name: '混沌老祖',
        role: '传承者',
        desc: '上古大能，留下一缕残念与《混沌造化诀》，是林尘的引路人。身份成谜。',
      },
      {
        id: 'char_3',
        bookId,
        name: '林虎',
        role: '反派 / 堂兄',
        desc: '林家年轻一代佼佼者，淬体九重，长期欺辱林尘，家族大比中被其一击击败。',
      },
      {
        id: 'char_4',
        bookId,
        name: '苏清月',
        role: '女主（待登场）',
        desc: '青云学府天才少女，与林尘在学府相识。设定：冷艳、剑道天才。',
      },
    ],
    settings: [
      {
        id: 'set_1',
        bookId,
        category: 'power',
        name: '修炼体系',
        desc: '淬体境 → 凝气境 → 筑基境 → 金丹境 → 元婴境 → 化神境 → 神尊境。每境九重。',
      },
      {
        id: 'set_2',
        bookId,
        category: 'location',
        name: '青云镇',
        desc: '林家所在的小镇，故事起点。灵气稀薄，最强者不过筑基。',
      },
      {
        id: 'set_3',
        bookId,
        category: 'faction',
        name: '林家',
        desc: '青云镇三大家族之一，主角出身家族。家主实力深不可测，对林尘态度暧昧。',
      },
      {
        id: 'set_4',
        bookId,
        category: 'item',
        name: '混沌玉简',
        desc: '记载《混沌造化诀》的上古玉简，触碰即认主。来历与混沌老祖有关。',
      },
      {
        id: 'set_5',
        bookId,
        category: 'location',
        name: '青云学府',
        desc: '东域最顶尖的修炼学府，第二卷主舞台。汇聚各方天才。',
      },
    ],
    foreshadows: [
      {
        id: 'fs_1',
        bookId,
        title: '父亲的失踪',
        detail: '林尘父亲三年前离奇失踪，留下"世界比你想象的大得多"。疑似与更大的势力/秘境有关。',
        status: 'planted',
        chapterId: 'ch_1',
      },
      {
        id: 'fs_2',
        bookId,
        title: '暗中窥探的眼睛',
        detail: '第二章结尾，冲天金光被暗处之人目睹。这批人身份未明，后续将登门。',
        status: 'progressing',
        chapterId: 'ch_2',
      },
      {
        id: 'fs_3',
        bookId,
        title: '家主的暧昧态度',
        detail: '家族大比上家主一言不发，似有所知。伏笔：家主可能知道混沌之体的秘密。',
        status: 'planted',
        chapterId: 'ch_3',
      },
    ],
    dailyLog: {
      [todayKey(new Date(now - day * 4))]: 3200,
      [todayKey(new Date(now - day * 3))]: 4100,
      [todayKey(new Date(now - day * 2))]: 2800,
      [todayKey(new Date(now - day * 1))]: 4600,
    },
    ui: {
      theme: 'dark',
      fontSize: 17,
      lastBookId: bookId,
      lastChapterId: 'ch_3',
    },
    ai: { ...DEFAULT_AI_CONFIG },
  }
}
