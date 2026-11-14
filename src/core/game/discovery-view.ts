/**
 * 发现提示的「分类 + 拆字」
 *
 * 玩家原话（2026-11-14）：
 *   「实时渲染的填表得有一个显示效果，不能是黑框，最好有一种略微的立体效果。
 *     不要浮夸得炫眼睛，就是用不同颜色的浮体这种感觉，呈现在右侧的一个位置，
 *     一个个被渲染上去。也不需要点什么确定，它只是一个显示效果。」
 *
 * 引擎抛上来的是一句话（"获得物品·屠龙刀"），浮体要的是**两行**：
 *   小字分类（物品） + 正文（屠龙刀） + 可选小注（已进背包）。
 *
 * 「一个个被渲染上去」意味着同一批要错开出现，所以这里也给排期。
 *
 * 纯函数，零 LLM，可单测。
 */

/** 六类原有 + 「世界卡」（叙事系统移植新增）：一类一色，右侧浮体靠颜色区分 */
export type DiscoveryKind = "item" | "title" | "relation" | "clue" | "time" | "event" | "world";

export interface ParsedDiscovery {
  kind: DiscoveryKind;
  /** 小字：物品 / 称号 / 关系 / 线索 / 时辰 / 变故 / 世界卡 */
  cat: string;
  /** 正文：浮体上最大那行 */
  text: string;
  /** 小注：可以没有。不要为了有而有——空着比编一句强 */
  sub?: string;
}

const CAT_LABEL: Record<DiscoveryKind, string> = {
  item: "物品",
  title: "称号",
  relation: "关系",
  clue: "线索",
  time: "时辰",
  event: "变故",
  world: "世界卡",
};

/** 按关键词判类。顺序有讲究：先判最具体的，最后才是兜底 */
function classify(s: string): DiscoveryKind {
  if (/(世界卡|设定登记)/.test(s)) return "world";
  if (/(称号|名号)/.test(s)) return "title";
  if (/(物品|获得|失去|损坏|装备|拾得|拿到)/.test(s)) return "item";
  if (/(好感|关系|亲近|敌意|冷淡|翻脸)/.test(s)) return "relation";
  if (/(线索|伏笔|记下|线索册)/.test(s)) return "clue";
  if (/(时辰|第.日|天亮|入夜|过了)/.test(s)) return "time";
  return "event";
}

/** 拆出正文：去掉分类前缀（"获得物品·" / "发现人物·" 这类） */
function stripPrefix(s: string): string {
  const m = s.match(/^[^·：:]{1,8}[·：:]\s*(.+)$/);
  return m ? m[1] : s;
}

/**
 * 把引擎那句话变成浮体要的三段。
 *
 * 一条硬规矩：**不许编 sub**。只有确定知道后续状态时才写小注
 * （比如物品确实已进背包），否则留空。浮体是"世界给我的回执"，
 * 编一句小注就等于骗玩家。
 */
export function parseDiscovery(
  raw: string,
  opts?: { inBag?: boolean; kind?: DiscoveryKind },
): ParsedDiscovery {
  const s = (raw || "").trim();
  // 引擎/协同层已知类别时优先用它——关键词只作兜底，避免「世界卡·屠龙刀」被误判成物品
  const kind = opts?.kind || classify(s);
  const text = stripPrefix(s);
  let sub: string | undefined;
  if (kind === "item" && opts?.inBag) sub = "已进背包";
  if (kind === "title" && opts?.inBag) sub = "已记在名下";
  return { kind, cat: CAT_LABEL[kind], text: text || s, sub };
}

/**
 * 一批发现的上屏排期（毫秒）。
 *
 * 为什么不是固定的 120ms 间隔：条数多的时候固定间隔会把最后一条压到 1 秒后，
 * 玩家已经低头看正文了。所以总数越少间隔越大（看得清），越多越紧（不误事）。
 */
export function staggerDelays(count: number): number[] {
  if (count <= 0) return [];
  const step = count <= 3 ? 160 : count <= 6 ? 120 : 90;
  return Array.from({ length: count }, (_, i) => i * step);
}
