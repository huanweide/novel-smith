/**
 * 实体自动创建器 —— 蒸馏发现的新实体自动入库
 *
 * 1.3 数据反哺：本地蒸馏检测到的新实体（置信度 ≥ 0.7）
 * 自动写入 CharacterCard（角色）或 LorebookEntry（物品/地点/功法/材料）。
 *
 * 查重：大小写不敏感对比已有角色名 + 世界书标题 + 角色别名（P1-1 别名归一）；
 * v0.46.63 增加相似度去重（繁简/错别字变体，如「青龙镇/青龍镇」）。
 * v0.46.74 收紧：长名仅当繁简归一后编辑距离 0 才并（P1-2，编辑距离 1 一律不并，避免误并漏建）。
 */

import {
  classifyWorldCategory,
  type WorldCategory,
} from "@/lib/world-category-classifier";

// ─── 实体类型 → Lorebook category 映射 ──────────────────────

// 显式类型映射：优先把蒸馏出的实体类型直接路由到 15 类世界卡分类之一。
// 键入 WorldCategory，类型系统强制值域合法（不会映射出非法分类）。
// 前半段是 entity-detector 实际产出的类型（已映射）；后半段与 entity-sync 的
// TYPE_TO_CATEGORY 共享更完整词汇，便于未来扩展 / 防御未知 type（F5）。
const ENTITY_TYPE_TO_CATEGORY: Record<string, WorldCategory> = {
  // detector 实际产出的类型
  pill: "item",
  artifact: "item",
  technique: "technique",
  location: "geography",
  material: "item",
  // 与 entity-sync 共享的更完整类型词汇（防御未知 type，F5）
  organization: "faction",
  creature: "creature",
  fate: "fate_system",
  physics: "physics",
  public: "public_system",
  magic_system: "magic_system",
  culture: "culture",
  history: "history",
  law: "law",
  currency: "currency",
  other: "custom",
  // character 走 CharacterCard，不走 LorebookEntry
};

/**
 * 把蒸馏出的实体（类型 + 名称）解析为世界卡 15 分类之一（F5）。
 *
 * 解析顺序（与 entity-sync.ts:228-238 的兜底完全一致）：
 *  1. 先走显式 ENTITY_TYPE_TO_CATEGORY 映射；
 *  2. 未命中（落到 "custom" / 未映射 type）时，用确定性世界卡分类器对「名称」
 *     重新路由，避免 faction / creature / culture / history / law / currency /
 *     fate_system / physics / public_system 等实体经此路径静默误归 custom；
 *  3. 只接受世界卡分类；角色关系（交角色卡负责）/ 元桶保持 custom，不重路由。
 *
 * 抽成纯函数便于单测（无需 mock prisma），与 entity-sync 行为对齐、杜绝漂移。
 */
export function resolveEntityCategory(type: string, name: string): WorldCategory {
  let category: WorldCategory = ENTITY_TYPE_TO_CATEGORY[type] || "custom";
  if (category === "custom") {
    const cr = classifyWorldCategory(name);
    if (cr.category && cr.category !== "character_relationship") {
      category = cr.category;
    }
  }
  return category;
}

// ─── 相似度去重 ──────────────────────────────────────────────

/** 常见繁↔简异体映射（繁体字符 → 简体），覆盖小说高频字 */
const TRAD_TO_SIMP: Record<string, string> = {
  蕭: "萧",
  動: "动",
  雲: "云",
  葉: "叶",
  國: "国",
  龍: "龙",
  風: "风",
  會: "会",
  體: "体",
  邊: "边",
  門: "门",
  馬: "马",
  長: "长",
  車: "车",
  鳥: "鸟",
  書: "书",
  時: "时",
  來: "来",
  個: "个",
  師: "师",
  術: "术",
  醫: "医",
  禪: "禅",
  館: "馆",
};

/** 字符级繁简归一化：繁体字符映射为简体，其余字符原样保留 */
function normalizeTraditional(s: string): string {
  let out = "";
  for (const ch of s) {
    out += TRAD_TO_SIMP[ch] ?? ch;
  }
  return out;
}

/** 编辑距离（Levenshtein），用于识别繁简/错别字变体 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * 同人异称识别（v1.6.3）：尊称 / 描述性变体与正主指同一人，应并入别名而非拆成两张卡。
 * 例：韩先生 / 韩姓男子 / 韩某 / 老韩 与 韩立 视为同一人；韩立 与 韩雪 视为不同人。
 */
const HONORIFIC_TOKENS = [
  "先生", "女士", "女子", "男子", "姑娘", "公子", "少年", "少女",
  "姓", "某", "氏", "老板", "师傅", "师父", "大人", "阁下", "兄台", "小姐",
  "夫人", "殿下", "陛下", "兄", "姐", "君", "公", "翁", "婆", "徒弟",
  "管家", "仆", "婢", "少侠", "大侠", "壮士", "道友", "前辈", "掌门",
  "宗主", "将军", "王", "皇", "帝", "后", "妃", "书生", "侠女", "女侠", "朋友",
];
const PREFIX_HONORIFICS = ["老", "小", "阿", "大"];
const BEFORE_FILLERS = ["", "大", "小", "阿", "二", "三", "老", "少", "姓"];

/**
 * 后缀尊称（姓 + 后缀尊称，如 迭戈先生 / 王夫人）：同人异称补充维度。
 * 模块级导出供 resolveDiscoveryMergeTarget 与 resolveNameToCanonical 共用，避免两处重复定义漂移。
 */
export const SUFFIX_HONORIFICS = [
  "先生", "女士", "小姐", "公子", "姑娘", "少年", "少女", "夫人", "阁下", "大人",
  "老板", "师傅", "师父", "少爷", "殿下", "陛下", "兄台", "大侠", "少侠", "壮士",
  "道友", "前辈", "掌门", "宗主", "将军", "书生", "侠女", "女侠", "朋友",
];

/**
 * 称谓 / 职业尊称（姓 + 称谓变体，如 李大师 / 王神医 / 张郎中 / 赵城主）：与正主指同一人，
 * 应并入正主而非拆成两张卡。与 HONORIFIC_TOKENS（X先生/女子 等标准尊称）互补——
 * 本集合覆盖「职业/身份尊称」，单独成列便于按需增删，且不污染自动建卡/角色去重的主判定分支。
 */
const TITLE_WORDS = [
  "大师", "老师", "教授", "博士", "真人", "道长", "神医", "圣手", "药师", "法师",
  "术士", "剑客", "刀客", "城主", "郡主", "县令", "知府", "掌柜", "郎中", "军师",
  "统领", "校尉", "捕快", "镖师", "管家", "伙计", "小二", "丫鬟", "侍女", "奴才",
  "护卫", "侍卫", "船夫", "渔夫", "樵夫", "农夫", "铁匠", "木匠", "裁缝", "账房",
  "媒婆", "稳婆", "巫师", "刺客", "杀手", "盗贼", "神偷", "侠盗", "道人", "和尚",
  "尼姑", "方丈", "住持",
];

/** 是否为「姓 + 称谓/职业尊称」变体（李大师 / 王神医 / 张郎中）。长度 3~5 字，整段后缀即称谓。 */
export function isTitleVariant(name: string): boolean {
  const n = normalizeTraditional(name.trim().toLowerCase());
  if (n.length < 3 || n.length > 5) return false; // 至少 姓+2字称谓；过长非变体
  const rest = n.slice(1); // 去掉姓
  return TITLE_WORDS.some((t) => rest === t); // 整段后缀即称谓（李大师）；称谓后不允许再有实义字
}

/** 是否为「称呼/描述性变体」（如 韩先生 / 韩姓男子 / 韩某 / 老韩） */
export function isHonorificVariant(name: string): boolean {
  const n = normalizeTraditional(name.trim().toLowerCase());
  if (n.length < 2 || n.length > 5) return false;
  // 前缀尊称：老/小/阿 + 姓（≤3 字）
  if (PREFIX_HONORIFICS.includes(n[0]) && n.length <= 3) return true;
  const rest = n.slice(1); // 去掉姓
  // 风险 token（王/皇/帝/后/妃）可能是真实人名结尾（如「武帝」「王后」），保持严格判定，避免误并
  const RISKY_TITLE = new Set(["王", "皇", "帝", "后", "妃"]);
  for (const t of HONORIFIC_TOKENS) {
    const idx = rest.indexOf(t);
    if (idx === -1) continue;
    const before = rest.slice(0, idx);
    const after = rest.slice(idx + t.length);
    // token 后必须为空；token 前允许：空（单字姓+尊称，如「韩先生」）/ 单个修饰字（大/小/姓…）/ 1~2 字姓（「迭戈先生」「欧阳女士」）。
    // 风险 token（帝/王/后…）即使 before 为空也禁止——避免把「武帝」「王后」这类真实人名误判为「武+帝(尊称)」。
    // token 前允许的「姓/修饰」结构：
    //  - 风险 token（帝/王/后/妃/皇）：仅允许修饰字 filler 且非空，避免「武帝」「王后」误判为「武+帝(尊称)」；
    //  - 双字尊称（先生/女士/公子…）：before 可为空，或单字名余（欧阳女士→阳 / 迭戈先生→戈）；
    //  - 单字尊称（君/公/翁…）：before 必须为空（整段 rest 即 token），否则「山君」会被拆成「韩+君」误判
    //    （韩山君 是真实人名「韩山·君」，非「韩」的尊称变体，归入正主会错并）。
    let beforeOk: boolean;
    if (RISKY_TITLE.has(t)) {
      beforeOk = BEFORE_FILLERS.includes(before) && before !== "";
    } else if (t.length >= 2) {
      beforeOk = before === "" || /^[一-龥]$/.test(before);
    } else {
      beforeOk = before === "";
    }
    if (after.length === 0 && beforeOk) return true;
  }
  return false;
}

/** 提取「姓」：前缀尊称（老韩）取第二字，否则取首字 */
export function coreSurname(name: string): string {
  const n = normalizeTraditional(name.trim().toLowerCase());
  if (PREFIX_HONORIFICS.includes(n[0])) return n[1] || n[0];
  return n[0];
}

/** 两名称是否「同人异称」：共享姓，且其一为称呼变体、另一为普通姓名（仅成对判定，不含歧义闸门） */
export function samePersonByHonorific(a: string, b: string): boolean {
  const x = normalizeTraditional(a.trim().toLowerCase());
  const y = normalizeTraditional(b.trim().toLowerCase());
  if (!x || !y) return false;
  if (Math.abs(x.length - y.length) > 3) return false;
  if (coreSurname(x) !== coreSurname(y)) return false;
  const xHon = isHonorificVariant(x);
  const yHon = isHonorificVariant(y);
  return xHon !== yHon;
}

/**
 * 同人异称消歧：给定一组已有姓名，判断 honorificName（尊称/描述变体）能否无歧义并入某个同姓正主。
 * 能并入则返回该正主姓名，否则返回 null（同姓正主不唯一 → 拒绝，避免把「韩先生」错并进「韩雪」）。
 */
export function resolveHonorificTarget(allNames: string[], honorificName: string): string | null {
  if (!isHonorificVariant(honorificName)) return null;
  const surname = coreSurname(honorificName);
  const plainCands = allNames
    .filter((n) => n.trim().toLowerCase() !== honorificName.trim().toLowerCase())
    .filter((n) => !isHonorificVariant(n))
    .filter((n) => coreSurname(n) === surname);
  return plainCands.length === 1 ? plainCands[0] : null;
}

/**
 * 变体 → 主卡名解析（消歧闸门，合并 entity-auto-creator 与 character-dedupe 的重复判定分支）：
 *  - 标准尊称（X先生 / X女子）：交给 resolveHonorificTarget（同姓唯一正主才返回，歧义 null）；
 *  - 单字缩写 / 姓+描述词（樊 / 韩姓男子）：resolveHonorificTarget 不覆盖（它只认 isHonorificVariant），
 *    故补一刀——按 coreSurname 在同姓非变体正主中找唯一匹配，歧义（≥2）则 null。
 * 任一变体解析不到唯一主卡 → 返回 null（需用户/LLM 确认，避免错并）。
 * 本函数是「同人异称 → 主卡」的唯一判定入口，autoCreate 与角色去重共用，避免两处逻辑漂移。
 */
export function resolveVariantTarget(allNames: string[], variantName: string): string | null {
  const byHonorific = resolveHonorificTarget(allNames, variantName);
  if (byHonorific) return byHonorific;
  if (isSurnameAbbrevOrDescriptor(variantName)) {
    const surname = coreSurname(variantName);
    const cands = allNames
      .filter((n) => n.trim().toLowerCase() !== variantName.trim().toLowerCase())
      .filter((n) => !isHonorificVariant(n) && !isSurnameAbbrevOrDescriptor(n))
      .filter((n) => coreSurname(n) === surname);
    if (cands.length === 1) return cands[0];
  }
  return null;
}

/**
 * 昵称缩写 / 姓氏缩写 + 描述词（v2.0.4，#297/#299 配套）：
 *  - 单字姓名（如「樊」「叶」）= 对应正主的昵称缩写，应并入别名而非拆成两张卡；
 *  - 前缀尊称（老X / 小X / 阿X）；
 *  - 「X姓 + 描述词」（韩姓男子 / 叶姓女子 / 萧姓青年 …）。
 * 与 isHonorificVariant 互补：后者覆盖「X先生/女子」等标准尊称，本函数覆盖单字缩写与「姓+描述」结构。
 * 仅做「是否为变体」的判定；能否无歧义并入正主由 resolveHonorificTarget 把关。
 */
const DESCRIPTOR_AFTER = ["", "男子", "女子", "青年", "少年", "老者", "少女", "姑娘", "公子", "书生", "壮士", "大侠", "少侠", "女侠", "侠女", "前辈", "掌门", "宗主", "将军", "王爷"];
export function isSurnameAbbrevOrDescriptor(name: string): boolean {
  const n = normalizeTraditional(name.trim().toLowerCase());
  if (!n) return false;
  // 单字姓（昵称缩写）
  if (n.length === 1) return true;
  // 前缀尊称（老韩 / 小韩 / 阿韩）
  if (PREFIX_HONORIFICS.includes(n[0]) && n.length <= 3) return true;
  // X姓 + 描述词（韩姓男子）
  const rest = n.slice(1);
  const idx = rest.indexOf("姓");
  if (idx === 0) {
    const after = rest.slice(1);
    if (DESCRIPTOR_AFTER.includes(after)) return true;
  }
  return false;
}

/**
 * 判断两个名称是否「高度相似、疑似同一实体的变体」。
 * 规则：忽略大小写后
 *  - 完全相同 → 是
 *  - 同人异称（尊称/描述变体，如 韩先生/韩立）→ 是（v1.6.3 新增，并入别名）
 *  - 长度差 > 2 → 否（明显不同实体）
 *  - 短名（任一 ≤2 字）先繁简归一化，归一化后相同 → 是（灭「萧炎/蕭炎」重复建卡，
 *    青砚 P2）；归一化后仍不同 → 否（不并，安全优先，避免「白云/白衣」被误并）
 *  - 长名（≥3 字）编辑距离 = 0 → 是（灭繁简/错别字，如 青龙镇/青龍镇、李尘/李麈）
 */
export function isSimilarName(a: string, b: string): boolean {
  // P1-2：繁简归一在比对前统一完成（青龍镇→青龙镇），使后续仅依赖编辑距离判定，
  // 不改动匹配链路（matchNameStrict/matchKeyword/recall）。
  const x = normalizeTraditional(a.trim().toLowerCase());
  const y = normalizeTraditional(b.trim().toLowerCase());
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > 2) return false;
  // 短名（≤2 字）：归一化后仍不同即视为不同实体，不引入编辑距离，
  // 避免「白云/白衣」「叶凡/叶帆」被误并。
  if (x.length <= 2 || y.length <= 2) {
    return false;
  }
  // 长名（≥3 字）：仅当繁简/大小写归一后「完全一致（编辑距离 = 0）」才判同类合并；
  // 编辑距离 1（如「青云宗/青云山」「剑/刀」类语义不同的实体）一律不并，避免误并漏建。
  return levenshtein(x, y) === 0;
}

/**
 * 发现名清洗（round-22）：剥离 LLM 误写入实体名的发现标记（🆕自动发现 / 待审 等），
 * 避免脏后缀污染下游去重启发式。reviewStatus 的「待审」语义由 UI 基于 reviewStatus 字段展示，
 * 不依赖名字里的文字。
 */
const DISCOVERY_MARKER_RE =
  /[\s　]*(🆕|🔍|⚑|▶)?\s*自动发现|（自动发现）|\(自动发现\)|待审|🔍|⚑|▶/gi;
export function normalizeDiscoveryName(raw: string): { name: string; hadMarker: boolean } {
  const trimmed = raw.trim();
  const cleaned = trimmed.replace(DISCOVERY_MARKER_RE, "").replace(/\s+/g, " ").trim();
  return { name: cleaned, hadMarker: cleaned !== trimmed };
}

/**
 * 自动发现阶段实时别名合并（round-22，替换 resolveVariantTarget 的「仅 plain 正主」限制）：
 * 允许「两变体互并」——只要同姓唯一候选（无论候选是普通正主还是另一个变体）即合并加 alias，
 * 实现「韩姓男子」+「韩先生」实时归并同一卡，避免先建两张脏卡再等 dedupe 的闪烁。
 *  - 入参必须是变体（尊称/描述词/单字缩写），普通姓名不走此路；
 *  - 含「·」的候选（隐藏身份/马甲）不自动合并，返回 null（独立建卡，B 修正）；
 *  - 同姓候选 ≥2（歧义，如 韩立/韩雪）→ null，不合并，等后续 LLM/大纲判断（安全优先，且单字名仅当有同姓正主才合并，避免误并真单字角色）。
 */
export function resolveDiscoveryMergeTarget(allNames: string[], variantName: string): string | null {
  const v = variantName.trim().toLowerCase();
  if (!v) return null;
  // 后缀尊称（只匹配结尾，避免误命中「王小明」这类含单字尊称的普通名）：
  // 「迭戈先生」= 迭戈 + 先生，按后缀尊称识别为变体，可合并到同姓正主。
  const hasSuffixHonorific = SUFFIX_HONORIFICS.some((t) => v.endsWith(t));
  const isVariant =
    isHonorificVariant(variantName) ||
    isSurnameAbbrevOrDescriptor(variantName) ||
    variantName.trim().length === 1 || // 单字缩写
    hasSuffixHonorific;
  if (!isVariant) return null;
  if (v.includes("·") || v.includes("•") || v.includes("・")) return null; // 马甲不自动合并
  const surname = coreSurname(variantName);
  const cands = allNames
    .map((n) => n.trim())
    .filter((n) => n.toLowerCase() !== v)
    .filter((n) => !n.includes("·") && !n.includes("•") && !n.includes("・"))
    .filter((n) => coreSurname(n) === surname);
  return cands.length === 1 ? cands[0] : null;
}

/**
 * 自动建角色卡门槛（夜间深度优化·(d) 谨慎建卡）：
 * 仅当候选名在全项目正文出现次数 ≥ 阈值才自动建角色卡，避免把只出现一两次的次要小角色
 * （如某章只出现一次的服务员）误建成角色卡污染数据。变体（尊称/缩写/小名）并入正主别名
 * 不走此判定（变体本就不建独立卡）。
 * 抽成纯函数便于单测（不依赖 prisma）。默认阈值 2：本章高频出现的主角/重要配角自然达标，
 * 仅出现一次的路人被拦截；后续若该名多次出现再自动建卡（自愈）。
 */
export const MIN_CHARACTER_APPEARANCES = 2;
export function shouldAutoCreateCharacterCard(
  appearanceCount: number,
  min = MIN_CHARACTER_APPEARANCES,
): boolean {
  return appearanceCount >= min;
}

// ─── 实体名 → 角色卡正主归一（填表/合并级联共用入口，v3.x）─────────

/** 角色卡「正主名 + 别名」清单，作为归一解析的注册表 */
export interface CanonicalCharacter {
  name: string;
  aliases?: string[];
}

/**
 * 把任意实体名解析为角色卡正主名：同人异称 / 别名 / 称谓变体 / 错字变体 → 正主。
 * 入参 characters 为「当前所有角色卡的正主名 + 别名」清单（不含已合并软删的脏卡）。
 *
 * 解析顺序（安全优先：任一变体解析不到唯一同姓正主即退回原名，绝不误并）：
 *  1. 精确命中（繁简/大小写归一后）正主名或任一别名 → 正主名；
 *  2. 变体解析：尊称 / 缩写 / 描述词 / 称谓变体 / 后缀尊称，同姓唯一「非变体」正主才并，歧义 → 不并；
 *  3. 高度相似（繁简/错别字变体，如 李尘/李麈）→ 正主名；
 *  4. 都不中 → 返回原名（不是已知角色，保持原样落库，不臆造合并）。
 *
 * 典型链路：填表写入「李大师」时，若项目已有正主「李富贵」（别名含 李大师）或
 * 同姓唯一正主，则自动归一到「李富贵」，使代码级去重自然并回，无需手动点去重。
 * 纯函数，便于单测（不依赖 prisma）。
 */
export function resolveNameToCanonical(characters: CanonicalCharacter[], name: string): string {
  const target = (name || "").trim();
  if (!target) return name;
  const norm = (s: string) => normalizeTraditional((s || "").trim().toLowerCase());
  const targetNorm = norm(target);
  if (!targetNorm) return name;

  // 1. 精确命中正主名或别名
  for (const c of characters) {
    if (norm(c.name) === targetNorm) return c.name;
    for (const a of c.aliases || []) {
      if (norm(a) === targetNorm) return c.name;
    }
  }

  // 候选：非变体的正主名（变体不应作为合并目标，避免把「韩先生」当正主去并「韩雪」）
  const isVariantName = (n: string): boolean =>
    isHonorificVariant(n) ||
    isSurnameAbbrevOrDescriptor(n) ||
    isTitleVariant(n) ||
    n.trim().length === 1 ||
    SUFFIX_HONORIFICS.some((t) => n.trim().toLowerCase().endsWith(t));
  const mainNames = characters.map((c) => c.name).filter((n) => !isVariantName(n));

  // 2. 变体解析（同姓唯一正主才并，歧义 null → 退回原名）
  const isTargetVariant =
    isHonorificVariant(target) ||
    isSurnameAbbrevOrDescriptor(target) ||
    isTitleVariant(target) ||
    target.trim().length === 1 ||
    SUFFIX_HONORIFICS.some((t) => target.trim().toLowerCase().endsWith(t));
  if (isTargetVariant) {
    const surname = coreSurname(target);
    const cands = mainNames
      .filter((n) => norm(n) !== targetNorm)
      .filter((n) => coreSurname(n) === surname);
    if (cands.length === 1) return cands[0];
  }

  // 3. 高度相似（繁简/错别字变体）
  for (const c of characters) {
    if (isSimilarName(c.name, target)) return c.name;
    for (const a of c.aliases || []) {
      if (isSimilarName(a, target)) return c.name;
    }
  }

  return name;
}
