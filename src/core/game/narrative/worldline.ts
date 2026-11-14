/**
 * 世界线 · 跨章编年时间轴 + 6 阶段节奏
 *
 * 「一本游戏本就是一条世界线」（src/app/gamesaga/page.tsx:101）——
 * 小说模式里没有 WorldLine 表，对应物是 `GameSaga` 本身 + `StoryNode.worldTime`
 * + `buildTimelineDigest`（按章序「第N章《标题》：代表句」）。
 * 所以移植成「跨章编年」：每章记一条，按 chapterIndex 排成一条线。
 *
 * 6 阶段**直接复用** `computeNarrativeStage`（src/core/pipeline/narrative-stage.ts）：
 * 开篇/早期发展/中期发展/后期发展/高潮/收尾，阈值 8/30/55/78/92/100。
 * 关键：游戏本**不预设目标章数**，因此永远走「防抢跑」分支，阶段夹在「后期发展」以内
 * ——这正是开放世界该有的：不因为写了十几章就自动逼玩家进高潮/结局。
 *
 * 纯函数，零 LLM。
 */

import { computeNarrativeStage, formatStage, type NarrativeStage } from "@/core/pipeline/narrative-stage";
import type { SagaChronicleEntry } from "./types";

export { computeNarrativeStage, formatStage };
export type { NarrativeStage };

/** 一条叙事正文里挑「代表句」：最长的、带动作意味的一句，不编造 */
function representativeSentence(text: string): string {
  const parts = (text || "")
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 120);
  if (parts.length === 0) return (text || "").trim().slice(0, 80);
  // 优先靠后的句子（一章通常以「发生了什么」收尾），但不取过长段落
  return parts.slice(-3).sort((a, b) => b.length - a.length)[0];
}

/** 章推进时记/更新一条编年（同章幂等：后写的补进去而不是堆重复条目） */
export function recordChapter(
  chronicle: SagaChronicleEntry[],
  input: {
    chapterIndex: number;
    chapterTitle: string;
    worldTime?: string;
    narrative: string;
    keyEvents?: string[];
    round: number;
  },
): { chronicle: SagaChronicleEntry[]; added: boolean } {
  const idx = Math.max(0, Math.trunc(input.chapterIndex || 0));
  const id = `ch_${idx}`;
  const summary = representativeSentence(input.narrative);
  const keyEvents = (input.keyEvents || []).map((e) => e.trim().slice(0, 200)).filter(Boolean).slice(0, 12);
  const existing = (chronicle || []).find((c) => c.id === id);
  if (existing) {
    // 合并：代表句取最新的（这一章刚发生的事更该被记住），大事去重追加
    const nextEvents = Array.from(new Set([...(existing.keyEvents || []), ...keyEvents])).slice(-12);
    return {
      chronicle: chronicle.map((c) =>
        c.id === id
          ? {
              ...c,
              summary: summary || c.summary,
              chapterTitle: input.chapterTitle || c.chapterTitle,
              ...(input.worldTime ? { worldTime: input.worldTime } : {}),
              keyEvents: nextEvents,
            }
          : c,
      ),
      added: false,
    };
  }
  const entry: SagaChronicleEntry = {
    id,
    chapterIndex: idx,
    chapterTitle: (input.chapterTitle || `第 ${idx + 1} 章`).slice(0, 120),
    ...(input.worldTime ? { worldTime: input.worldTime.slice(0, 80) } : {}),
    summary,
    keyEvents,
    createdRound: input.round,
  };
  return { chronicle: [...(chronicle || []), entry].sort((a, b) => a.chapterIndex - b.chapterIndex), added: true };
}

/**
 * 当前阶段（游戏本适配）。
 *
 * 为什么分母要托底 13：原函数按 `(chapterIndex+1)/totalChapters` 算百分比，
 * 而游戏本的章节是玩家随开随建的——开局只有 1 章时，第 1 章会被算成 100%，
 * 一进游戏就跳「后期发展」，六个阶段等于白抄。13 是从开篇阈值 8% 反推的
 * 温和尺度（1/13≈7.7%），让阶段按**章序**渐进：第1章开篇、2-3章早期、4-6章中期…
 * 已存在章节超过 13 时改用真实章数（那时比例才有意义）。
 *
 * 关键：始终**不传 targetChapters**，让原函数的防抢跑分支生效——
 * 阶段夹在「后期发展」以内，永不自动进高潮/收尾（开放世界不预设结局）。
 * 唯一进「收尾」的开关是玩家/系统显式标记主线完结。
 */
export function stageOf(chapterIndex: number, totalChapters: number, mainQuestComplete = false): NarrativeStage {
  return computeNarrativeStage(
    Math.max(0, chapterIndex),
    Math.max(13, totalChapters || 0),
    mainQuestComplete ? { mainQuestComplete: true } : undefined,
  );
}

/** 阶段是否发生了变化（跨阶段才弹浮体，不每轮刷屏） */
export function stageChanged(prevKey: string | undefined, next: NarrativeStage): boolean {
  return !!prevKey && prevKey !== next.key;
}

/** 世界线摘要（抄 buildTimelineDigest 的「第N章《标题》：代表句」，给提示词与 UI） */
export function formatChronicle(chronicle: SagaChronicleEntry[]): string {
  return (chronicle || [])
    .slice()
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map((c) => `第${c.chapterIndex + 1}章《${c.chapterTitle}》：${c.summary}`)
    .join("\n");
}
