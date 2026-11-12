/**
 * R6 · 召回效果量化 + 长期记忆衰减联动（纯函数、零 DB、零 LLM）
 *
 * 修两个真缺口：
 *  1. `loop.ts:52` 召回 12 条注入后，从不记录「本章正文有没有真的呼应」→ 填表/记忆效果无从度量。
 *  2. `memory-decay.ts` 的 S/A/B/C 衰减只在 cron 端点执行，写章时排序仍只看关键词长度(score)，
 *     于是「陈旧的 B 级琐碎设定」会因为名字长而挤掉「近期 A 级关键设定」。
 *
 * 做法：写章结束时用最终正文算命中率（可观测）；召回排序按「新鲜度 × 特异性」加权（真实生效）。
 * 硬约束：S 级永久不降权；权重恒 >0 且 ≤1；不改原数组、不删任何召回项。
 */

import { DECAY_RULES } from "@/lib/memory-decay";

export interface RecallLike {
  title: string;
  content?: string;
  score?: number;
  source?: "lorebook" | "table";
  via?: "keyword" | "semantic";
  chapterNumber?: number;
  tier?: string;
}

export interface RecallEffectiveness {
  total: number;
  hits: number;
  hitRate: number;
  hitsTitles: string[];
  misses: Array<{ title: string; source: string; via: string }>;
  byPath: Record<"keyword" | "semantic" | "unknown", { total: number; hits: number }>;
}

const norm = (s: string) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

/** 标题整体命中才算呼应；不做单字模糊，避免「子虚乌有」误命中「子虚乌有城」这类假绿。 */
function isEchoed(item: RecallLike, chapterText: string): boolean {
  const hay = norm(chapterText);
  const title = norm(item.title);
  if (title.length >= 2 && hay.includes(title)) return true;
  // 结构化表格的内容列常含关键设定词，取最长的一段实词做二次判定
  const content = norm(item.content ?? "");
  if (content.length >= 4) {
    const keyphrase = content.split(/[，。；、|,.;]/)[0];
    if (keyphrase.length >= 4 && hay.includes(keyphrase)) return true;
  }
  return false;
}

export function computeRecallEffectiveness(
  items: RecallLike[],
  chapterText: string,
): RecallEffectiveness {
  const list = items || [];
  const byPath: RecallEffectiveness["byPath"] = {
    keyword: { total: 0, hits: 0 },
    semantic: { total: 0, hits: 0 },
    unknown: { total: 0, hits: 0 },
  };
  const hitsTitles: string[] = [];
  const misses: RecallEffectiveness["misses"] = [];

  for (const it of list) {
    const path = it.via === "keyword" || it.via === "semantic" ? it.via : "unknown";
    byPath[path].total++;
    if (isEchoed(it, chapterText)) {
      byPath[path].hits++;
      hitsTitles.push(it.title);
    } else {
      misses.push({ title: it.title, source: String(it.source ?? "unknown"), via: path });
    }
  }
  const total = list.length;
  const hits = hitsTitles.length;
  return {
    total,
    hits,
    hitRate: total > 0 ? Math.round((hits / total) * 1000) / 1000 : 0,
    hitsTitles,
    misses,
    byPath,
  };
}

export interface RankedRecall<T> {
  item: T;
  title: string;
  decayWeight: number;
  weightedScore: number;
}

/**
 * 按「新鲜度 × 特异性」重排召回项。
 * 不删除任何项，只改变顺序；S 级恒为 1（永久记忆不因年代久远被压）。
 */
export function rankRecallItemsWithDecay<T extends RecallLike>(
  items: T[],
  currentChapter: number,
): Array<T & { decayWeight: number; weightedScore: number }> {
  return (items || []).map((it) => {
    const tier = String(it.tier || "B").toUpperCase();
    const rule = DECAY_RULES[tier];
    const age = Math.max(0, currentChapter - (it.chapterNumber ?? currentChapter));
    let decayWeight = 1;
    if (rule?.maxAge != null) {
      // 线性衰减到下限 0.25，过期后不再继续降（避免长篇后期所有旧记忆权重趋零）
      decayWeight = Math.max(0.25, 1 - (age / rule.maxAge) * 0.75);
      decayWeight = Math.round(decayWeight * 1000) / 1000;
    }
    const score = typeof it.score === "number" && Number.isFinite(it.score) ? it.score : 1;
    return {
      ...it,
      decayWeight,
      weightedScore: Math.round(score * decayWeight * 1000) / 1000,
    };
  }).sort((a, b) => b.weightedScore - a.weightedScore);
}
