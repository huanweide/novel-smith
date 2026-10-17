/**
 * 导入小说 · 前史资产提炼（M3 内核）
 *
 * ## 为什么需要它
 * 导入一本书最容易出现的状态是「正文进去了，但项目是空的」：
 * 角色卡空、世界书空、伏笔空。于是第一次续写时，AI 只看得见刚写的那一章，
 * 前面 900 章的人名、功法、地名、伏笔全靠正文里那几行提示词硬撑——
 * 写出来的人名飘、功法自相矛盾、上一章埋的钩子直接失踪。
 *
 * 这里的定位是**零 LLM 的规则提炼**：纯本地正则 + 统计，导入完秒级出结果，
 * 不烧 token、不看 API Key。产出全是**待审草稿**（reviewStatus=pending），
 * 作者扫一眼确认或丢弃，绝不静默污染生成上下文。
 *
 * ## 三类资产
 *  1. 角色卡（CharacterCard 草稿）—— 对话标签 + 称谓 + 姓氏频次三路投票
 *  2. 世界书（LorebookEntry 草稿）—— 复用 entity-detector 的法宝/功法/地点/材料模式
 *  3. 伏笔（PendingCommitment 草稿）—— 线索句式抽取（「日后」「总有一天」「发誓」…）
 *
 * 另外产出 timelineDigest / storylineDigest 两段聚合文本，直接喂给
 * 「全部读取」的长期记忆，让续写章一落地就知道「此前各章发生了什么」。
 *
 * ## 有意为之的取舍
 *  - **采样而非全量**：一本 900 章的书正文几百万字，全量扫既慢又会把
 *    早期路过的路人甲也当成角色。默认取前 30 章 + 每 N 章采一章。
 *  - **草稿而非直填**：规则提炼必然有误判，误判的角色卡一旦 approved
 *    就会持续污染每一次生成。宁可让作者多扫一眼。
 *  - **不猜性格不猜外貌**：规则填不了「矛盾」「驱动」这些字段，
 *    留空让后续 AI 填表补，比胡编一段假设定强。
 */

import { countWords, type ParsedChapter } from "./types";
import { detectEntities, isCompleteEntityName } from "@/lib/entity-detector";

// ─── 采样 ──────────────────────────────────────────────────

export interface SampleOptions {
  /** 开头连续采样的章数（角色与设定在前几章交代得最清楚） */
  head?: number;
  /** 之后每隔 N 章采一章 */
  stride?: number;
  /** 单章最多取多少字（超长章掐头去尾，取中段密度最高的部分） */
  perChapterWords?: number;
}

export interface SampledChapter {
  index: number;
  title: string;
  text: string;
}

function clip(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  // 取中段：开头常有环境铺垫、结尾常是作者抒发，中段信息密度最高
  const start = Math.floor((t.length - maxChars) * 0.3);
  return t.slice(start, start + maxChars);
}

/** 从章节列表里采样出适合规则扫描的文本集合。 */
export function sampleChapters(
  chapters: ParsedChapter[],
  opts: SampleOptions = {},
): SampledChapter[] {
  const head = opts.head ?? 30;
  const stride = Math.max(1, opts.stride ?? 5);
  const perChapterWords = opts.perChapterWords ?? 6000;
  const out: SampledChapter[] = [];
  const total = chapters.length;
  if (total === 0) return out;

  for (let i = 0; i < total; i++) {
    const c = chapters[i]!;
    const inHead = i < head;
    const strideHit = head > 0 && (i - head) % stride === 0;
    // 采样不足 head 时全采，避免短书只提炼了前几章
    const tooFew = total <= head * 2;
    if (!inHead && !strideHit && !tooFew) continue;
    if (!c.content.trim()) continue;
    out.push({
      index: c.index,
      title: c.title,
      text: clip(c.content, perChapterWords * 2),
    });
  }
  return out;
}

// ─── 角色识别 ──────────────────────────────────────────────

/** 复姓 */
const COMPOUND_SURNAMES = new Set([
  "欧阳", "太史", "端木", "上官", "司马", "东方", "独孤", "南宫", "万俟", "闻人",
  "夏侯", "诸葛", "尉迟", "公羊", "赫连", "澹台", "皇甫", "宗政", "濮阳", "公冶",
  "太叔", "申屠", "公孙", "慕容", "仲孙", "钟离", "长孙", "宇文", "司徒", "司空",
]);

/** 单姓（百家姓常用字，覆盖面足够长篇中文小说） */
const SURNAMES = new Set(
  ("赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公"
  ).split(""),
);

/** 称谓后缀——命中即强证据（X道 / X长老 / X师兄…） */
const HONORIFIC_TAIL = [
  "道", "真人", "道友", "前辈", "长老", "掌门", "宗主", "门主", "教主", "魔王",
  "师兄", "师姐", "师弟", "师妹", "师尊", "师父", "老爷子", "先生", "女士",
  "医生", "教授", "老师", "院长", "队长", "警官", "经理", "总监", "博士", "院士",
];

/** 说话动词前缀标签：X说道 / X道：/ X冷笑 / X开口… */
const SPEECH_TAG = "(?:说道|说|道|问道|问|答道|答|喝道|喊|叫|笑道|笑道|冷笑|淡笑|开口|低语|喃喃|轻声|沉声|叹道|怒道)";

/** 明显不是人名的字（避免「他说」类噪声与常用词被当姓） */
const NAME_STOP_CHARS = new Set(["说", "道", "问", "答", "笑", "的", "了", "着"]);

export interface CharacterCandidate {
  name: string;
  /** 0-1，投票得分归一 */
  confidence: number;
  /** 命中的证据类型 */
  evidence: Array<"speech" | "honorific" | "surname">;
  /** 采样文本中出现的总次数 */
  mentions: number;
  /** 首次出现的章序号 */
  firstChapter: number;
}

/** 统计一个候选名在采样集中的出现次数 */
function countMentions(name: string, samples: SampledChapter[]): number {
  let n = 0;
  for (const s of samples) {
    // 朴素计数：名字不含正则元字符（都是汉字），直接用 split
    n += s.text.split(name).length - 1;
  }
  return n;
}

/** 收集「引号说话 + 说话动词在引号后」的标签式人名：`「……。」他说道` */
function collectSpeechTagged(samples: SampledChapter[]): Map<string, number> {
  const tally = new Map<string, number>();
  // 「……」+ 1~3 字 + 说话动词
  const re = new RegExp(`」\\s*([\\u4e00-\\u9fff]{1,3})${SPEECH_TAG}`, "g");
  // 说话动词在前的标签式：`他说道` 里的人称代词不是名字，直接靠
  // 「XX说道 / XX道：」这类带姓或名的形式抓
  const re2 = new RegExp(
    `([\\u4e00-\\u9fff]{2,4})${SPEECH_TAG}[：:“"「]?`,
    "g",
  );
  for (const s of samples) {
    for (const rx of [re, re2]) {
      rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(s.text)) !== null) {
        // 贪婪的{2,4} 会把动词的尾巴一起吃进来（「林川说道」→候选「林川说道」），
        // 也可能从上一小句尾巴咬（「旁边的苏长老沉声道」→候选「边的苏长老」），
        // 所以先剥尾部修饰与说话动词，再交给人名校验。
        const cand = stripSpeechTail(m[1]!);
        if (!isPlausibleName(cand)) continue;
        tally.set(cand, (tally.get(cand) ?? 0) + 1);
      }
    }
  }
  return tally;
}

/**
 * 剥掉候选名尾部与说话方式重叠的部分。
 *
 * 为什么不能只剥单字：中文里说话动词常带两字修饰（「低声说道」「沉声道」
 * 「冷笑道」），贪婪的 {2,4} 会把整个修饰语吃进候选，于是：
 *   「他低声说道」→「他低声」
 *   「苏长老沉声道」→「老沉声」
 *   「有人低声道」  →「人低声」
 * 这些长度都是 3，光靠剥「说/道」一个字剥不干净。
 *
 * 做法：反复剥尾部的两字修饰语（它们本身就是 SPEECH_TAG 的一部分），
 * 再剥单字停用字。
 */
function stripSpeechTail(cand: string): string {
  let s = cand;
  // 先剥两字说话修饰（低声 / 沉声 / 淡笑 / 冷笑 / 怒道 …）
  for (let i = 0; i < 3; i++) {
    if (s.length < 3) break;
    const tail2 = s.slice(-2);
    if (!SPEECH_MODIFIER_2.has(tail2)) break;
    s = s.slice(0, -2);
  }
  // 再剥单字停用字（说道 / 道 / 问 / 答 …）
  for (let i = 0; i < 3; i++) {
    if (s.length < 2) break;
    const last = s[s.length - 1]!;
    if (!NAME_STOP_CHARS.has(last)) break;
    s = s.slice(0, -1);
  }
  // 再剥尾部否定/副词修饰：「林川没有答话」→「林川没有」→「林川」
  for (let i = 0; i < 3; i++) {
    if (s.length < 2) break;
    const tail2 = s.slice(-2);
    if (!NEGATIVE_TAIL_2.has(tail2)) break;
    s = s.slice(0, -2);
  }
  return s;
}

/** 说话动词前的常见两字否定/副词修饰，作为候选名尾部时整体剥掉 */
const NEGATIVE_TAIL_2 = new Set([
  "没有", "不曾", "并未", "未曾", "只好", "只能", "却是", "只是", "也是", "又是",
  "便也", "仍旧", "依然", "始终", "终究", "连忙", "急忙", "赶紧", "不禁",
]);

/** SPEECH_TAG 里的两字修饰语，作为候选名尾部时整体剥掉 */
const SPEECH_MODIFIER_2 = new Set([
  "低声", "沉声", "轻声", "淡笑", "冷笑", "怒道", "叹道", "笑道", "喝道", "喊道",
  "喃喃", "低语", "怒喝", "冷笑", "失笑", "苦笑", "大笑", "笑问", "笑答", "开口",
]);

/** 收集称谓型人名：`青云宗主`、`玄天老祖` 等（尾字是称谓，前面 1~2 字是人名） */
function collectHonorific(samples: SampledChapter[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const tail of HONORIFIC_TAIL) {
    // ⚠️ 窗口必须**收紧到 2 字**：{2,3} 的贪婪会从上一小句尾巴开始切
    //（「旁边的苏长老」→ 候选「边的苏长老」→ 因首字「边」被拒 → 苏长老整个漏掉）。
    // 称谓型人名的名字部分绝大多数是 2 字（苏长老=苏+长老、云老祖=云+老祖），
    // 取 3 字反而引入了跨句噪声。
    const rx = new RegExp(`([\\u4e00-\\u9fff]{2})${tail}`, "g");
    for (const s of samples) {
      rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(s.text)) !== null) {
        const cand = m[1]!;
        if (!isPlausibleName(cand)) continue;
        tally.set(cand, (tally.get(cand) ?? 0) + 1);
      }
    }
  }
  return tally;
}

/** 是否像一个可入库的中文人名 */
function isPlausibleName(cand: string): boolean {
  if (cand.length < 2 || cand.length > 4) return false;
  // 首字是代词/虚词 → 一定不是人名。
  // 这条挡掉了大量切分碎片（「他低声」「有人低」的「他/有」开头）。
  if (IMPOSSIBLE_HEAD.has(cand[0]!)) return false;
  if (cand.length === 4) return hasSurname(cand);
  // 含明显功能/代词字的丢弃
  for (const ch of cand) {
    if (NAME_STOP_CHARS.has(ch)) return false;
    if (!/[一-龥]/.test(ch)) return false;
  }
  // 「他们」「我们」「自己」这类代词
  if (/^(他们|我们|你们|自己|对方|此人|众人|大家|别人|他人|别人)$/.test(cand)) return false;
  // ⚠️ 3 字候选必须**有姓氏**才算数。
  // 旧实现「cand.length === 3」直接放行，等于所有三字垃圾串都能建卡，
  // 这就是「他低声」「林川没有」混进角色列表的原因。
  return hasSurname(cand);
}

/** 首字为代词/虚词时不可能是人名（「他低声」「有人低」「老沉声」） */
const IMPOSSIBLE_HEAD = new Set([
  "他", "她", "它", "我", "你", "您", "咱", "谁", "众", "有", "无", "不", "没",
  "这", "那", "哪", "什", "怎", "但", "却", "又", "也", "就", "才", "都", "再",
  "很", "太", "更", "最", "还", "已", "将", "被", "把", "让", "使", "令",
  "一", "两", "几", "某", "另", "各", "每", "全", "半", "多", "少", "好", "请",
]);

/** 是否以姓氏开头（复姓优先） */
function hasSurname(name: string): boolean {
  if (name.length < 2) return false;
  if (COMPOUND_SURNAMES.has(name.slice(0, 2))) return true;
  return SURNAMES.has(name[0]!);
}

/** 姓氏开头且长度 2~3 的汉字串候选（用于频次兜底投票） */
function collectBySurname(samples: SampledChapter[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const s of samples) {
    // 在正文里找 2~3 字的姓氏开头串
    const rx = /[一-龥]{2,3}/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(s.text)) !== null) {
      const seg = m[0];
      for (let len = 2; len <= 3; len++) {
        if (seg.length < len) continue;
        const cand = seg.slice(0, len);
        if (!hasSurname(cand)) continue;
        if (!isPlausibleName(cand)) continue;
        tally.set(cand, (tally.get(cand) ?? 0) + 1);
      }
    }
  }
  return tally;
}

/**
 * 三路投票产出角色候选。
 *
 * 权重：对话标签 > 称谓 > 纯姓氏频次。
 * 纯姓氏频次是最弱的一路——中文里「方才」「忽然」这种词也以姓氏开头，
 * 所以它的票必须低，且必须靠 mentions 门槛（见 filterCharacters）。
 */
export function extractCharacters(
  samples: SampledChapter[],
  opts: { minMentions?: number; max?: number } = {},
): CharacterCandidate[] {
  const minMentions = opts.minMentions ?? 5;
  const max = opts.max ?? 40;

  const speech = collectSpeechTagged(samples);
  const honor = collectHonorific(samples);
  const byName = collectBySurname(samples);

  const score = new Map<string, { ev: Set<CharacterCandidate["evidence"][number]>; raw: number }>();
  const bump = (name: string, ev: CharacterCandidate["evidence"][number], w: number) => {
    const cur = score.get(name) ?? { ev: new Set(), raw: 0 };
    cur.ev.add(ev);
    cur.raw += w;
    score.set(name, cur);
  };

  for (const [n, c] of speech) bump(n, "speech", c * 1.0);
  for (const [n, c] of honor) bump(n, "honorific", c * 0.8);
  for (const [n, c] of byName) bump(n, "surname", c * 0.12);

  const out: CharacterCandidate[] = [];
  for (const [name, { ev, raw }] of score) {
    const mentions = countMentions(name, samples);
    if (mentions < minMentions) continue;
    // 只有姓氏频次一路证据的候选一律丢弃。
    // 实测：这类候选几乎全是贪婪切分碎片（「林川握」「云宗」）——
    // 中文里以姓氏开头的词（方才/忽然/后来）天然命中姓氏模式，
    // 频次再高也只是证明这串字常出现，不证明它是一个人名。
    // 要留必须有对话标签或称谓这类硬证据。
    if (!ev.has("speech") && !ev.has("honorific")) continue;
    // 归一化：对话票和称谓票给上限，纯频次只作微调
    const signal = Math.min(1, (ev.has("speech") ? 0.5 : 0) + (ev.has("honorific") ? 0.35 : 0))
      + Math.min(0.3, mentions / 200);
    out.push({
      name,
      confidence: Math.round(Math.min(1, signal + (ev.size === 3 ? 0.1 : 0)) * 100) / 100,
      evidence: [...ev],
      mentions,
      firstChapter: findFirstChapter(samples, name),
    });
    void raw;
  }

  out.sort((a, b) => b.mentions - a.mentions || b.confidence - a.confidence);
  return out.slice(0, max);
}

function findFirstChapter(samples: SampledChapter[], name: string): number {
  for (const s of samples) {
    if (s.text.includes(name)) return s.index;
  }
  return samples[0]?.index ?? 1;
}

// ─── 世界书词条 ────────────────────────────────────────────

export interface LoreCandidate {
  name: string;
  /** artifact/pill/technique/location/material */
  type: string;
  content: string;
  mentions: number;
  confidence: number;
}

/**
 * 清洗 detector 给出的实体名。
 *
 * detector 的模式是「1~3 个汉字 + 专名后缀」，天然会把动词/代词粘进前缀：
 * 「必须找到玄天鼎」→「到玄天鼎」、「手持青锋剑」→「持青锋剑」。
 * 上游不动（改了会影响既有蒸馏与自动建卡的召回），
 * 这里在 M3 入口处剥掉首尾功能字，剥完不是完整专名就整个丢掉。
 */
const LEAD_JUNK = new Set([
  "到", "去", "来", "把", "被", "将", "已", "正", "在", "是", "有", "为", "与",
  "和", "及", "对", "从", "由", "用", "拿", "持", "带", "见", "看", "听", "说",
  "的", "了", "着", "过", "起", "得", "地", "又", "也", "都", "还", "就", "才",
  "一", "两", "三", "四", "五", "六", "七", "八", "九", "十", "这", "那", "其",
  // 量词：柄青锋剑 / 把玄天鼎 / 支长剑
  "柄", "把", "支", "条", "颗", "枚", "件", "张", "面", "枚", "缕", "丝",
  // 首字量词（detector 把量词切进了实体名里）：一座青铜 / 一口鼎
  // ⚠️ 不要放「道」——「玄天大道」这类正当设定名会被误伤
  "座", "口", "部", "尊", "位", "名", "双", "对", "群", "堆", "批",
]);
const TRAIL_JUNK = new Set([
  "的", "了", "着", "过", "们", "呢", "吧", "啊", "之", "所", "而",
  // 尾部量词：青铜古「座」/ 一「口」鼎 / 半「部」剑谱
  "座", "口", "部", "只", "把", "柄", "支", "条", "颗", "枚", "件", "张", "面",
  "缕", "丝", "尊", "位", "名", "双", "对", "群", "堆", "批",
  // detector 的贪婪切分把下一句的开头粘进来了：「章玄天鼎」「苏长老亲自引」
  "章", "节", "回", "卷", "篇", "段", "引", "亲", "自", "曰", "云",
]);

/**
 * 残留动词字：detector 的模式是「贪婪取 1~3 字 + 后缀」，
 * 所以「林川发现剑身」会切出「川发现剑」这种横跨人名与动词的碎片。
 * 含这些字的名字一律拒——宁可漏一条法宝，不可往世界书里灌垃圾。
 */
const VERB_IN_NAME = /[发现了想起说出走来看听吃喝来到去过给做想会能要镇守护主领]/;
// 「X 道」只在**带数字前缀**时才是切分碎片（「一道剑光」「三道伤口」），
// 「玄天大道」「天道法则」这类正当设定名必须放过——之前误伤过。
const VERB_TAIL_NUM = /[一二三四五六七八九十两]道/;

function cleanEntityName(raw: string): null | string {
  let s = raw.trim();
  // 交替剥首尾 junk，最多 4 轮。
  // 「苏长老亲自引」要先剥「引」→「苏长老亲自」再剥「自」才干净，
  // 只剥固定 2 轮会漏（实测这正是碎片残留的主因）。
  for (let i = 0; i < 4; i++) {
    let changed = false;
    if (s.length >= 2 && LEAD_JUNK.has(s[0]!)) {
      s = s.slice(1);
      changed = true;
    }
    if (s.length >= 2 && TRAIL_JUNK.has(s[s.length - 1]!)) {
      s = s.slice(0, -1);
      changed = true;
    }
    if (!changed) break;
  }
  if (s.length < 2) return null;
  if (VERB_IN_NAME.test(s)) return null;
  if (VERB_TAIL_NUM.test(s)) return null;
  return isCompleteEntityName(s) ? s : null;
}

/** 从采样集里抽世界书草稿。复用 entity-detector 的模式库，不重复造轮子。 */
export function extractLore(
  samples: SampledChapter[],
  opts: { minMentions?: number; max?: number } = {},
): LoreCandidate[] {
  const minMentions = opts.minMentions ?? 3;
  const max = opts.max ?? 60;

  const merged = new Map<string, { type: string; mentions: number }>();
  for (const s of samples) {
    const res = detectEntities(s.text, { enableOwnership: false });
    for (const e of res.entities) {
      // 只取非角色类实体；角色由 extractCharacters 单独负责
      if (e.type === "character") continue;
      const name = cleanEntityName(e.name);
      if (!name) continue;
      const cur = merged.get(name);
      if (cur) {
        cur.mentions += 1;
        // 多类型命中时优先保留更具体的类型
        if (cur.type !== e.type && e.type !== "material") cur.type = e.type;
      } else {
        merged.set(name, { type: e.type, mentions: 1 });
      }
    }
  }

  const out: LoreCandidate[] = [];
  for (const [name, info] of merged) {
    const mentions = countMentions(name, samples);
    if (mentions < minMentions) continue;
    out.push({
      name,
      type: info.type,
      // 规则提炼不该编设定。content 只放「出现位置 + 频次」这类客观事实，
      // 具体设定留空让作者填或让后续 AI 填表补。
      content: `导入原文自动识别：${describeType(info.type)}（在采样范围内出现约 ${mentions} 次）。设定详情待补。`,
      mentions,
      confidence: Math.min(1, Math.round((0.4 + mentions / 100) * 100) / 100),
    });
  }
  out.sort((a, b) => b.mentions - a.mentions);
  return out.slice(0, max);
}

function describeType(t: string): string {
  switch (t) {
    case "pill": return "丹药";
    case "artifact": return "法宝";
    case "technique": return "功法";
    case "location": return "地点";
    case "material": return "材料";
    default: return "设定条目";
  }
}

// ─── 伏笔 ──────────────────────────────────────────────────

export interface CommitmentCandidate {
  description: string;
  /** 出现在哪一章 */
  chapter: number;
  priority: "high" | "medium" | "low";
  confidence: number;
}

/**
 * 线索句式——命中即说明作者在这儿留了钩子。
 * 这些是中文网文里最常见的「未兑现承诺」标记。
 */
const HOOK_PATTERNS: Array<{ re: RegExp; priority: CommitmentCandidate["priority"]; weight: number }> = [
  { re: /(日后|将来|未来)[^。！？]{0,24}(一定|必然|会|将)[^。！？]{0,24}[。！？]/g, priority: "high", weight: 1 },
  { re: /(总有一天|迟早)[^。！？]{0,24}[。！？]/g, priority: "high", weight: 1 },
  { re: /(发誓|发誓要|立誓|起誓|发誓道)[^。！？]{0,24}[。！？]/g, priority: "high", weight: 1 },
  { re: /(承诺|答应|许诺|约定)[^。！？]{0,24}[。！？]/g, priority: "high", weight: 1 },
  { re: /(欠[^。！？]{0,12}(?:一个|一次|一笔)?[^。！？]{0,12})[。！？]/g, priority: "medium", weight: 1 },
  { re: /(必须[^。！？]{0,20}(?:找到|回来|完成|复仇|救回|带回))[^。！？]{0,12}[。！？]/g, priority: "medium", weight: 1 },
  { re: /(只有[^。！？]{0,20}(?:才能|才能)[^。！？]{0,20})[。！？]/g, priority: "medium", weight: 1 },
  { re: /(疑点|蹊跷|奇怪的是|不对劲)/g, priority: "medium", weight: 1 },
  { re: /(似乎[^。！？]{0,20}(?:有什么|藏着|隐瞒))/g, priority: "low", weight: 1 },
  { re: /(未完待续|敬请期待)/g, priority: "low", weight: 1 },
];

/** 单句去重（同一句在多章重复出现只留一条，取最早出现的那章） */
export function extractCommitments(
  samples: SampledChapter[],
  opts: { max?: number } = {},
): CommitmentCandidate[] {
  const max = opts.max ?? 40;
  const seen = new Map<string, CommitmentCandidate>();

  for (const s of samples) {
    for (const { re, priority, weight } of HOOK_PATTERNS) {
      const rx = new RegExp(re.source, re.flags);
      let m: RegExpExecArray | null;
      while ((m = rx.exec(s.text)) !== null) {
        const raw = m[0].trim();
        if (raw.length < 6) continue;
        const key = raw.replace(/\s+/g, "").slice(0, 24);
        const prev = seen.get(key);
        if (prev) continue; // 同一句在多章重复出现 → 只留最早那章
        seen.set(key, {
          description: raw,
          chapter: s.index,
          priority,
          confidence: Math.min(1, 0.4 + weight * 0.2),
        });
      }
    }
  }

  const out = [...seen.values()].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return rank[a.priority] - rank[b.priority] || a.chapter - b.chapter;
  });
  return out.slice(0, max);
}

// ─── 聚合摘要（timelineDigest / storylineDigest）────────────

/**
 * 按章取「信息密度最高的一句」当摘要。
 *
 * 不做真正的摘要压缩——规则压缩出来的句子必然丢信息，
 * 反而误导 AI。这里只做一件事：把每章最能代表发生了什么的那一句挑出来，
 * 按章序拼成可读的骨架。真正的压缩交给 LLM 的 ChapterSummary 流程。
 */
export function pickRepresentativeSentence(text: string): string {
  const sentences = text
    .split(/(?<=[。！？!?])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 60);
  if (sentences.length === 0) {
    return text.trim().slice(0, 50);
  }
  // 含「因为/所以/于是/却/但/竟然/忽然」等转折连接的句子信息量更大
  let best = sentences[0]!;
  let bestScore = -1;
  for (const s of sentences) {
    let sc = 0;
    if (/[一-龥]/.test(s)) sc += 1;
    sc += Math.min(3, (s.match(/[，。！？、；：]/g)?.length ?? 0)) * 0.2;
    if (/(因为|所以|于是|却|但是|竟然|忽然|终于|发现|意识到|决定|出手)/.test(s)) sc += 2;
    if (/(说道|问道|笑道|喝道)/.test(s)) sc -= 1; // 纯对白句信息量低
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return best;
}

/** 生成 timelineDigest：按章序的骨架摘要 */
export function buildTimelineDigest(
  samples: SampledChapter[],
  opts: { maxChars?: number } = {},
): string {
  const maxChars = opts.maxChars ?? 4000;
  const lines: string[] = [];
  for (const s of samples) {
    const line = `第${s.index}章《${s.title}》：${pickRepresentativeSentence(s.text)}`;
    lines.push(line);
    if (lines.join("\n").length > maxChars) break;
  }
  return lines.join("\n");
}

/** 生成 storylineDigest：只保留带转折/决策的大事件（比 timeline 更短更粗） */
export function buildStorylineDigest(
  samples: SampledChapter[],
  opts: { maxLines?: number } = {},
): string {
  const maxLines = opts.maxLines ?? 30;
  const lines: string[] = [];
  for (const s of samples) {
    const sent = pickRepresentativeSentence(s.text);
    if (!/(发现|意识到|决定|出手|背叛|死亡|突破|斩杀|逃|救|夺|毁|灭|成|败|胜|败|加入|离开|归来|现身)/.test(sent)) {
      continue;
    }
    lines.push(`第${s.index}章：${sent}`);
    if (lines.length >= maxLines) break;
  }
  return lines.join("\n");
}

// ─── 统一入口 ──────────────────────────────────────────────

export interface ExtractedAssets {
  characters: CharacterCandidate[];
  lore: LoreCandidate[];
  commitments: CommitmentCandidate[];
  timelineDigest: string;
  storylineDigest: string;
  /** 实际采样了多少章 / 采样总字数，写进日志便于事后判断提炼质量 */
  sampledChapters: number;
  sampledWords: number;
}

export interface ExtractOptions extends SampleOptions {
  maxCharacters?: number;
  maxLore?: number;
  maxCommitments?: number;
  minCharacterMentions?: number;
}

export function extractAssets(
  chapters: ParsedChapter[],
  opts: ExtractOptions = {},
): ExtractedAssets {
  const samples = sampleChapters(chapters, opts);
  const sampledWords = samples.reduce((s, c) => s + countWords(c.text), 0);
  return {
    characters: extractCharacters(samples, {
      minMentions: opts.minCharacterMentions ?? 5,
      max: opts.maxCharacters ?? 40,
    }),
    lore: extractLore(samples, { max: opts.maxLore ?? 60 }),
    commitments: extractCommitments(samples, { max: opts.maxCommitments ?? 40 }),
    timelineDigest: buildTimelineDigest(samples),
    storylineDigest: buildStorylineDigest(samples),
    sampledChapters: samples.length,
    sampledWords,
  };
}

/**
 * 提炼结果的紧凑摘要——给 UI 展示用。
 * 不返回全部候选（可能几十条），只给每类前 N 条 + 总数，让作者快速判断
 * 「这套草稿值不值得逐个审」，而不是被一屏列表淹没。
 */
export interface AssetsPreview {
  sampledChapters: number;
  sampledWords: number;
  characters: { total: number; top: Array<{ name: string; confidence: number; evidence: string[]; mentions: number }> };
  lore: { total: number; top: Array<{ name: string; type: string; mentions: number }> };
  commitments: { total: number; byPriority: Record<string, number>; top: Array<{ description: string; chapter: number; priority: string }> };
  digests: { timelineChars: number; storylineChars: number };
}

export function summarizeAssets(assets: ExtractedAssets, topN = 8): AssetsPreview {
  const byPriority: Record<string, number> = {};
  for (const c of assets.commitments) {
    byPriority[c.priority] = (byPriority[c.priority] ?? 0) + 1;
  }
  return {
    sampledChapters: assets.sampledChapters,
    sampledWords: assets.sampledWords,
    characters: {
      total: assets.characters.length,
      top: assets.characters.slice(0, topN).map((c) => ({
        name: c.name,
        confidence: c.confidence,
        evidence: c.evidence,
        mentions: c.mentions,
      })),
    },
    lore: {
      total: assets.lore.length,
      top: assets.lore.slice(0, topN).map((l) => ({ name: l.name, type: l.type, mentions: l.mentions })),
    },
    commitments: {
      total: assets.commitments.length,
      byPriority,
      top: assets.commitments.slice(0, topN).map((c) => ({
        description: c.description.slice(0, 60),
        chapter: c.chapter,
        priority: c.priority,
      })),
    },
    digests: {
      timelineChars: assets.timelineDigest.length,
      storylineChars: assets.storylineDigest.length,
    },
  };
}
