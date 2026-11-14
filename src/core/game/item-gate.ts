/**
 * 拾取门槛 —— 什么该进背包，什么不该
 *
 * 问题（用户原话）："主角捡起了一个树枝，他是想生火做个饭，你不能把这个树枝捡为一个道具
 * 放进主角的背包里，因为这没有意义，那就会有大量垃圾东西。"
 *
 * 三条判定，全部确定性，不问模型：
 *   1. 无价值杂物（树枝/石子/破布）→ 不入背包，只在正文里存在；
 *   2. 不是"物"的东西（称号/名号/身份）→ 进 titles，不进 items；
 *   3. 其余 → 正常入背包。
 *
 * 为什么必须在这一层拦：
 *   模型天生倾向于"玩家提到什么就发什么"，不拦的话背包三天就变成垃圾场，
 *   而背包一乱，"送礼/偷窃/使用"这些动词就失去意义。
 *
 * 保守原则：拿不准的一律**放行**。宁可多收一件，不可把剧情关键道具吞掉。
 */

export type LootKind = "item" | "title" | "trinket";

/** 无价值杂物（精确匹配，不做模糊，避免误杀"桃木枝"这类法器） */
const TRINKET_WORDS = new Set([
  "树枝", "木棍", "枯枝", "石子", "石头", "小石子", "瓦片", "碎瓦", "破布", "布条",
  "草", "杂草", "野草", "树叶", "落叶", "泥土", "一把土", "沙子", "灰", "灰尘",
  "水", "一碗水", "一捧水", "砖头", "半块砖", "铁片", "空瓶", "木片", "绳头",
  "碎瓷", "破碗", "旧鞋", "烂菜叶", "鸡毛", "鱼骨", "骨头",
]);

/** 称号类（不是"物"，不能进背包） */
const TITLE_PATTERN =
  /(第[一二三四五六七八九十百千]+(名|人|位)?|之首|之最|称号|名号|封号|魁首|榜首|无双|无敌|第一人|天下第一|举世)/;

/** 明确的价值标记：命中就一定是物品，哪怕名字像杂物 */
const VALUE_MARKERS = /(宝|珍|稀有|传世|镇派|镇店|名器|神器|仙器|灵器|法螺|丹|符|令牌|印|令|玉|珠|刃|剑|刀|枪|弓|甲|袍)/;

function norm(s: string): string {
  return (s || "").trim().replace(/^[一二三四五六七八九十两]+(把|根|块|片|张|个|枚|颗)/, "");
}

/**
 * 判断一条"获得"是什么。
 * @param name 物品名
 * @param desc 描述（可选，有描述时更容易判成真物品）
 */
export function classifyLoot(name: string, desc?: string): LootKind {
  const n = norm(name);
  if (!n) return "trinket";

  // 称号/名号优先判——"剑道之首"含「剑」，若先跑价值标记会被误判成武器
  if (TITLE_PATTERN.test(n) && n.length <= 12) return "title";

  // 有明确价值标记 → 一定是物品，放行（防误杀"桃木枝"这类）
  if (VALUE_MARKERS.test(n)) return "item";

  // 无价值杂物 → 不入库
  if (TRINKET_WORDS.has(n)) return "trinket";

  // 有像样描述（≥8 字）的，按物品处理
  if ((desc || "").trim().length >= 8) return "item";

  return "item";
}

export interface LootCandidate {
  operation: string;
  name: string;
  desc?: string;
}

export interface LootGateResult {
  /** 允许进背包的 */
  keep: LootCandidate[];
  /** 被挡下的杂物（正文里仍然存在，只是不进背包） */
  trinkets: LootCandidate[];
  /** 被识别为称号的（进 titles，不进 items） */
  titles: LootCandidate[];
}

/**
 * 批量过闸。
 * 只有 `gain` 需要过闸——消耗/丢弃/损毁必须照常处理，否则背包里的东西删不掉。
 */
export function gateLoot(changes: LootCandidate[]): LootGateResult {
  const keep: LootCandidate[] = [];
  const trinkets: LootCandidate[] = [];
  const titles: LootCandidate[] = [];

  for (const c of changes || []) {
    if (!c || !c.name) continue;
    if (c.operation !== "gain") {
      keep.push(c);
      continue;
    }
    const kind = classifyLoot(c.name, c.desc);
    if (kind === "trinket") trinkets.push(c);
    else if (kind === "title") titles.push(c);
    else keep.push(c);
  }
  return { keep, trinkets, titles };
}

/** 称号入册：去重、上限 20、新的在前 */
export function mergeTitles(prev: string[] | null | undefined, incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...incoming, ...(prev || [])]) {
    const n = (t || "").trim().slice(0, 20);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 20) break;
  }
  return out;
}

/** 给界面看的一句话（"发现物品：屠龙刀" / "得到称号：天下第一"） */
export function lootNotice(c: LootCandidate, kind: LootKind): string {
  if (kind === "title") return `得到称号：${c.name}`;
  return `发现物品：${c.name}`;
}
