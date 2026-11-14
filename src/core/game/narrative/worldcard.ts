/**
 * 世界卡 · 15 类 / 自动归类 / 待审闸门
 *
 * 抄 `LorebookEntry`（schema.prisma:173-205）+ `world-category-classifier.ts`
 * 的 15 类白名单与确定性分类器 + `WorldPanel` 的「待审→已确认」闸门。
 *
 * 关键取舍（贴游戏本「受限永远低于自由」）：
 *   · 分类器只做**归类建议**，不改 world 状态、不判定「这个东西能不能存在」；
 *   · 自动登记的世界卡默认 `reviewStatus: "pending"`，不进提示词——
 *     避免 AI 随口一句名词就悄悄变成「世界设定」污染后续叙事；
 *   · 玩家在「世界」页签点确认，才 approved 并注入上下文。
 *
 * 「山卡」在本项目里不存在独立表：山门/宗门由分类器归 faction，山脉/秘境归 geography。
 */

import {
  ALL_WORLD_CATEGORIES,
  WORLD_CATEGORY_LABELS,
  classifyWorldCategory,
  type WorldCategory,
} from "@/lib/world-category-classifier";
import type { GameEntity } from "../types";
import type { SagaWorldCard } from "./types";

export { ALL_WORLD_CATEGORIES, WORLD_CATEGORY_LABELS };

/** 引擎实体类型 → 15 类（抄 entity-auto-creator.ts:23-43 的映射，不 import 以避开 prisma 依赖） */
const ENTITY_TYPE_MAP: Record<string, WorldCategory> = {
  character: "character_relationship",
  location: "geography",
  faction: "faction",
  item: "item",
  technique: "technique",
  creature: "creature",
  other: "custom",
};

/** 给一个名字建议世界卡分类：先按实体类型，无法判定时交给确定性关键词分类器 */
export function suggestCategory(name: string, entityType?: string): WorldCategory {
  const mapped = entityType ? ENTITY_TYPE_MAP[entityType] : undefined;
  if (mapped && mapped !== "custom") return mapped;
  const r = classifyWorldCategory(name || "");
  if (r.category && ALL_WORLD_CATEGORIES.includes(r.category)) return r.category;
  return mapped || "custom";
}

function cardId(source: string, title: string): string {
  // 确定性 id：同名不重复登记，重放同一轮也幂等
  let h = 0;
  const s = `${source}:${title}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `wc_${source}_${(h >>> 0).toString(36)}`;
}

const STOP_TITLES = new Set(["", "无", "未知", "主角", "玩家"]);

/** 自动登记一张世界卡（幂等：同 source+title 已存在则不重复） */
export function registerCard(
  cards: SagaWorldCard[],
  input: {
    title: string;
    category?: WorldCategory;
    entityType?: string;
    content?: string;
    depth?: number;
    source: SagaWorldCard["source"];
    round: number;
    approved?: boolean;
  },
): { cards: SagaWorldCard[]; added: SagaWorldCard | null } {
  const title = (input.title || "").trim().slice(0, 120);
  if (!title || STOP_TITLES.has(title) || title.length < 2) {
    return { cards: cards || [], added: null };
  }
  const id = cardId(input.source, title);
  if ((cards || []).some((c) => c.id === id)) return { cards: cards || [], added: null };
  const card: SagaWorldCard = {
    id,
    title,
    category: input.category || suggestCategory(title, input.entityType),
    keys: [title],
    content: (input.content || "").trim().slice(0, 500),
    depth: input.depth ?? 3,
    enabled: true,
    reviewStatus: input.approved ? "approved" : "pending",
    createdRound: input.round,
    source: input.source,
  };
  return { cards: [...(cards || []), card], added: card };
}

/** 一批实体自动登记（去重 + 逐条给出新增，供浮体用） */
export function registerEntities(
  cards: SagaWorldCard[],
  entities: GameEntity[],
  round: number,
): { cards: SagaWorldCard[]; added: SagaWorldCard[] } {
  let next = cards || [];
  const added: SagaWorldCard[] = [];
  for (const e of entities || []) {
    const r = registerCard(next, {
      title: e?.name || "",
      entityType: e?.type,
      content: e?.description,
      source: "entity",
      round,
    });
    next = r.cards;
    if (r.added) added.push(r.added);
  }
  return { cards: next, added };
}

/** 确认 / 启用 / 停用 / 改分类（玩家在「世界」页签操作） */
export function patchCard(
  cards: SagaWorldCard[],
  id: string,
  patch: Partial<Pick<SagaWorldCard, "title" | "category" | "content" | "depth" | "enabled" | "reviewStatus">>,
): SagaWorldCard[] {
  return (cards || []).map((c) => {
    if (c.id !== id) return c;
    const next = { ...c };
    if (typeof patch.title === "string" && patch.title.trim()) next.title = patch.title.trim().slice(0, 120);
    if (patch.category && ALL_WORLD_CATEGORIES.includes(patch.category)) next.category = patch.category;
    if (typeof patch.content === "string") next.content = patch.content.trim().slice(0, 500);
    if (typeof patch.depth === "number") next.depth = Math.max(0, Math.min(4, Math.trunc(patch.depth)));
    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    if (patch.reviewStatus === "pending" || patch.reviewStatus === "approved") next.reviewStatus = patch.reviewStatus;
    return next;
  });
}

/** 按 15 类分组（抄 WorldPanel 的板块视图，空类也保留，好让玩家看见全貌） */
export function groupCardsByCategory(cards: SagaWorldCard[]): Array<{
  category: WorldCategory;
  label: string;
  cards: SagaWorldCard[];
}> {
  return ALL_WORLD_CATEGORIES.map((category) => ({
    category,
    label: WORLD_CATEGORY_LABELS[category],
    cards: (cards || []).filter((c) => c.category === category),
  }));
}

/** 只取已确认且启用的卡（给提示词注入用），按 depth 升序（常驻优先） */
export function approvedCards(cards: SagaWorldCard[]): SagaWorldCard[] {
  return (cards || [])
    .filter((c) => c.reviewStatus === "approved" && c.enabled)
    .sort((a, b) => a.depth - b.depth || a.createdRound - b.createdRound);
}
