/**
 * 角色卡准入 —— 谁配拥有一张卡，谁不配
 *
 * 规则（用户原话，2026-11-14）：
 *   "当角色出现时，如果他是个重要角色，至少得有个名字，或者有一定重要的戏份，才能进入角色卡；
 *    如果连名字都没有（比如是个店小二），那就不能进角色卡。
 *    如果这个角色已经死了，可以把他放在后面，作为退场死亡角色，但依然可以打开他的角色卡。"
 *
 * 两条判据，全部确定性，不问模型：
 *   1. 准入门 = 有没有「名字」。「店小二」这种职业泛称不算名字——
 *      他连被称呼的资格都没有，自然没有卡。正文里他仍然存在、仍然可以互动，
 *      只是名录里不出现（受限永远低于自由：不建卡 ≠ 不许写他）。
 *   2. 死亡不是删除。退场角色排序垫后，卡永远打得开——死人留下的线索
 *      往往比活人还多（谁杀的他、他死前藏着什么）。
 *
 * 纯函数，零 LLM，可单测。
 */

/** CharacterSheet 的死亡相关字段（与 characters/route.ts 的接口解耦，这里只认需要的） */
export interface MortalSheet {
  dead?: boolean;
  /** 退场回合（kill 成功时由引擎写入；手动标记时也可填） */
  exitRound?: number;
}

/**
 * 职业与身份泛称——没有名字的人。
 *
 * 判据：这些词是「岗位」不是「称呼」。你可以说"那个店小二"，
 * 但你不能对着"店小二"三个字建立一段恩怨——它不指向任何一个人。
 * 精确匹配，不做子串：避免误杀「小二哥」这类绰号与「柳掌柜」这类姓名。
 */
const GENERIC_NAMES = new Set([
  // 店铺与市井
  "店小二", "小二", "伙计", "掌柜", "老板", "老板娘", "摊主", "贩夫", "商贩", "路人", "路人甲",
  "路人乙", "百姓", "平民", "众人", "人群", "围观者", "看客", "行人",
  // 宅院与杂役
  "侍女", "丫鬟", "婢女", "仆人", "仆役", "家丁", "门房", "管家", "杂役", "杂工", "厨子", "厨娘",
  "马夫", "车夫", "船夫", "挑夫", "脚夫", "更夫",
  // 行走江湖的岗位
  "护卫", "守卫", "卫士", "亲卫", "侍卫", "保镖", "镖师", "士兵", "士卒", "卒", "兵卒", "军士",
  "斥候", "哨探", "岗哨", "守门人", "门卫", "捕快", "衙役", "差役", "狱卒", "禁军", "巡兵",
  // 泛称的人
  "老者", "老人", "老翁", "老妇", "妇人", "妇女", "汉子", "壮汉", "汉子们", "少年", "少女",
  "孩子", "孩童", "小孩", "婴儿", "青年", "中年人", "男子", "女子", "男人", "女人", "老头",
  "老太婆", "胖子", "瘦子", "高个", "矮个", "独眼", "瘸子", "疤脸",
  // 修行界的无名者
  "修士", "散修", "弟子", "门人", "僧人", "和尚", "道士", "道人", "尼姑", "教众", "信徒",
  "香客", "客商", "酒客", "食客", "住持", "知客",
  // 其它
  "某人", "某人甲", "未知", "无名", "无名氏", "???", "？？？",
]);

/** 名字合法性：空、太长、纯标点都不算名字 */
function hasValidName(name: string): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  if (n.length > 20) return false;
  if (/^[^\p{Script=Han}\p{L}\p{N}]+$/u.test(n)) return false; // 纯标点/符号
  return true;
}

/**
 * 是不是职业/身份泛称（店小二这一类无名者）。
 * UI 用它决定点开名字热点时给不给完整人物卡——不立卡 ≠ 不许互动，
 * 泛称占位卡上仍然可以自由输入对他做什么。
 */
export function isGenericName(name: string): boolean {
  return GENERIC_NAMES.has((name || "").trim());
}

/**
 * 该不该给这个人建卡。
 *
 * @param name 出现的名字（实体名/候选名）
 * @param opts.isPlayer      主角永远有卡（这是玩家自己）
 * @param opts.alreadySaved  已建档的永远保留（准入只挡新的，不倒删旧的——
 *                           昨天还是路人、今天被剧情给了名字，已建的卡不是错误）
 * @param opts.hasBrief      有正经简介（项目角色卡/前传快照带来的）——
 *                           作者认真写过的东西不算路人，哪怕名字起得随意
 */
export function shouldAdmitCard(
  name: string,
  opts?: { isPlayer?: boolean; alreadySaved?: boolean; hasBrief?: boolean }
): boolean {
  const o = opts || {};
  if (o.isPlayer) return true;
  if (o.alreadySaved) return true;
  if (!hasValidName(name)) return false;
  const n = name.trim();
  if (GENERIC_NAMES.has(n)) return !!o.hasBrief; // 泛称但有作者简介 → 作者钦定的重要角色，放行
  return true;
}

/** 一次准入判定的人话解释（名录里「为什么没有他」的悬浮提示） */
export function admissionReason(
  name: string,
  opts?: { isPlayer?: boolean; alreadySaved?: boolean; hasBrief?: boolean }
): string {
  const o = opts || {};
  if (o.isPlayer) return "这是你自己";
  if (o.alreadySaved) return "已有档案";
  if (!hasValidName(name)) return "连个正经名字都没有";
  if (GENERIC_NAMES.has(name.trim())) {
    return o.hasBrief ? "作者钦定的角色" : "无名之辈（店小二这一类），不立卡";
  }
  return "有名字的人";
}

/**
 * 名录排序：在场（活着）在前，退场死亡垫后。
 *
 * 为什么死亡垫后但不删（用户口径）：死人也可以打开角色卡——
 * 排序表达的是「你眼下该关心谁」，不是「谁还存在」。
 * 同组内保持原有顺序（不按拼音/笔画重排——名录的稳定性本身就是信息，
 * 上一眼在第三位的人这一眼还在第三位，找人才不会累）。
 */
export function sortRoster<T extends { name: string } & Partial<MortalSheet>>(
  entries: T[]
): T[] {
  const alive: T[] = [];
  const dead: T[] = [];
  for (const e of entries || []) {
    if (e?.dead) dead.push(e);
    else alive.push(e);
  }
  return [...alive, ...dead];
}

/**
 * 标记死亡。幂等：已标记的不覆盖原回合（第一次死在第几回合就永远是第几回合）。
 */
export function markDead<T extends MortalSheet>(sheet: T | undefined, round: number): T & MortalSheet {
  const prev = sheet || ({} as T);
  if (prev.dead) return { ...prev, dead: true, exitRound: prev.exitRound ?? round };
  return { ...prev, dead: true, exitRound: round };
}

/** 卡面上的退场印章文案 */
export function deadSeal(sheet: MortalSheet | undefined | null): string | null {
  if (!sheet?.dead) return null;
  return typeof sheet.exitRound === "number" ? `殁 · 第${sheet.exitRound}回合` : "殁";
}
