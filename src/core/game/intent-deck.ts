/**
 * 意图盘 —— 把"此刻能做什么"从场景里算出来（确定性，零 LLM）
 *
 * 解决的问题不是"给玩家更多自由"，而是**玩家不知道自由长什么样**：
 * 一个空白输入框等于把创作的活派回去，多数人只会写"继续"。
 * 这里把自由具化成几张牌：谁在场、能去哪、手头有什么没了的事。
 *
 * 三条设计约束：
 *   1. 只出"现在真能做"的牌（不在场的人不给，没东西就不给"送"）；
 *   2. 每张牌标代价（多久 / 有没有险），让人能权衡，而不是盲选；
 *   3. **盘不能空**。世界数据薄的时候给两张兜底牌（看一眼 / 歇一歇），
 *      它们任何处境都成立——空盘会让玩家重新跌回"不知道该写什么"。
 */

import type { SceneBundle } from "./scene";

export type IntentGroup = "person" | "item" | "place" | "thread" | "self";

export interface IntentCard {
  id: string;
  group: IntentGroup;
  verb: string;
  object: string;
  /** 一行副标：≤ 12 字，不解释机制，只给处境 */
  hint: string;
  /** 代价徽标：1 刻 / 半日 / 一夜 / 两天 */
  cost?: string;
  /** 有风险（不是禁止，是可能失败） */
  risk?: boolean;
  actionType: string;
  actionText: string;
  target?: string;
  targetItem?: string;
}

export interface DeckInput {
  present?: Array<{ name: string; note?: string }>;
  /** 认识但不在场的人：给"去找他" */
  elsewhere?: Array<{ name: string }>;
  items?: Array<{ name: string; quantity?: number }>;
  places?: Array<{ name: string; hours?: number }>;
  threads?: Array<{ text: string; subject?: string; risk?: boolean }>;
}

export function hoursLabel(hours?: number): string | undefined {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) return undefined;
  if (hours <= 1) return "1 刻";
  if (hours <= 4) return "半日";
  if (hours <= 10) return "一日";
  if (hours <= 24) return "一夜";
  return `${Math.round(hours / 24)} 天`;
}

function firstSentence(s?: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  return t.split(/[。！？\n]/)[0].slice(0, 12);
}

/** 永远成立的兜底牌：任何处境都能点，用来"破冰" */
export const FALLBACK_CARDS: IntentCard[] = [
  {
    id: "self:look",
    group: "self",
    verb: "看",
    object: "四周",
    hint: "先看清处境",
    cost: "1 刻",
    actionType: "observe",
    actionText: "打量四周，看清此刻的处境",
  },
  {
    id: "self:rest",
    group: "self",
    verb: "歇",
    object: "一口气",
    hint: "等事情自己发生",
    cost: "半日",
    actionType: "rest",
    actionText: "找个地方歇一歇，让时间往前走一段",
  },
];

/**
 * 生成意图盘。limit 默认 8：一屏能扫完，超过就要滚动＝又变成负担。
 * 顺序按"此刻最该被看见的"：人 → 事 → 地 → 物 → 兜底。
 */
export function buildIntentDeck(input: DeckInput, limit = 8): IntentCard[] {
  const out: IntentCard[] = [];
  const present = (input.present || []).filter((p) => p && p.name);
  const items = (input.items || []).filter((i) => i && i.name);
  const places = (input.places || []).filter((p) => p && p.name);
  const threads = (input.threads || []).filter((t) => t && t.text);

  // 人：问一句（永远可做）；送（有东西才出牌）
  for (const p of present.slice(0, 3)) {
    out.push({
      id: `ask:${p.name}`,
      group: "person",
      verb: "问",
      object: p.name,
      hint: firstSentence(p.note) || "探探口风",
      cost: "1 刻",
      actionType: "dialogue",
      actionText: `向${p.name}问起${firstSentence(p.note) || "眼下的处境"}`,
      target: p.name,
    });
    if (items.length > 0) {
      const gift = items[0];
      out.push({
        id: `gift:${p.name}:${gift.name}`,
        group: "person",
        verb: "送",
        object: gift.name,
        hint: `给${p.name}`,
        cost: "1 刻",
        actionType: "use_item",
        actionText: `把${gift.name}送给${p.name}`,
        target: p.name,
        targetItem: gift.name,
      });
    }
  }

  // 认识但不在场的人：给一张"找"——想见某人时要有下一步，而不是只被拦下
  for (const p of (input.elsewhere || []).filter((x) => x && x.name).slice(0, 2)) {
    out.push({
      id: `find:${p.name}`,
      group: "person",
      verb: "找",
      object: p.name,
      hint: "不知在何处",
      risk: true,
      actionType: "explore",
      actionText: `去找${p.name}`,
      target: p.name,
    });
  }

  // 事：手头没了的线索/约定
  // 牌面优先用挂靠对象（人名/势力名），整句话退到副标——「追 老陈」比「追 老陈主动约林舟天黑后再见」像牌。
  for (const t of threads.slice(0, 2)) {
    const subject = (t.subject || "").trim();
    out.push({
      id: `thread:${subject || t.text}`,
      group: "thread",
      verb: "追",
      object: subject || firstSentence(t.text),
      hint: subject ? firstSentence(t.text) : "还没了结",
      risk: t.risk !== false,
      actionType: "custom",
      actionText: `追查${firstSentence(t.text)}`,
    });
  }

  // 地：能走到的（副标留空——"去旧城图书馆"本身已经说清了，再添一句就是废话）
  for (const p of places.slice(0, 3)) {
    out.push({
      id: `go:${p.name}`,
      group: "place",
      verb: "去",
      object: p.name,
      hint: "",
      cost: hoursLabel(p.hours),
      actionType: "explore",
      actionText: `前往${p.name}`,
    });
  }

  // 物：用得上的
  for (const it of items.slice(0, 2)) {
    out.push({
      id: `use:${it.name}`,
      group: "item",
      verb: "用",
      object: it.name,
      hint: it.quantity && it.quantity > 1 ? `还有 ${it.quantity} 件` : "在身上",
      actionType: "use_item",
      actionText: `使用${it.name}`,
      targetItem: it.name,
    });
  }

  return finalize(out, limit);
}

/** 去重 + 兜底补齐 + 截断 */
function finalize(cards: IntentCard[], limit: number): IntentCard[] {
  const seen = new Set<string>();
  const deduped = cards.filter((c) => {
    const k = `${c.group}|${c.verb}|${c.object}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const max = Math.max(1, limit);
  const out = deduped.slice(0, max);
  // 空盘必须补：至少留一张兜底牌，玩家才有地方下手
  for (const f of FALLBACK_CARDS) {
    if (out.length >= max) break;
    if (out.some((c) => c.id === f.id)) continue;
    out.push(f);
  }
  return out;
}

/** 场景 → 意图盘（UI 直接用这个） */
export function buildDeckFromScene(scene: SceneBundle, limit = 8): IntentCard[] {
  return buildIntentDeck(
    {
      present: scene.present.map((name) => ({ name })),
      elsewhere: (scene.knownElsewhere || []).map((name) => ({ name })),
      items: scene.items.map((name) => ({ name })),
      places: scene.places,
      threads: scene.threads,
    },
    limit
  );
}
