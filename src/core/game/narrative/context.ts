/**
 * 叙事账本 → 提示词上下文
 *
 * 抄 `src/core/pipeline/outline-context.ts:formatStorylines` 的信息结构：
 *   【剧情线：X】（主线/支线）→ 三要素/七要素 → 线索集 → 时间轴（先发生 → 后导致）
 * 再加上游戏本特有的：待收伏笔、已确认世界卡、当前 6 阶段、跨章编年。
 *
 * 为什么必须注入：只把系统画在左抽屉里，AI 写下一轮时根本不知道有这条主线、
 * 有这条没收的伏笔 —— 那就只是「展示」不是「协同」。注入后，AI 会在合适时机
 * 让伏笔自然结果、让故事线继续长，这才接上用户要的「实时演算触发伏笔」。
 *
 * 三条克制：
 *   · 只写**已发生**与**待收束**，不写「接下来应该发生什么」（不派任务）；
 *   · 未确认的世界卡不注入（待审闸门，防止 AI 随口名词变成设定）；
 *   · 有体量上限，超过就截断——提示词是有限预算。
 */

import { WORLD_CATEGORY_LABELS } from "@/lib/world-category-classifier";
import { formatStage, stageOf } from "./worldline";
import { activeCommitments, computePayoffStats } from "./foreshadow";
import { approvedCards } from "./worldcard";
import { aggregatedClues, computeStorylineProgress, timelineOf } from "./storyline";
import type { NarrativeLedger, SagaStoryline } from "./types";

function fmtLine(line: SagaStoryline, storylines: SagaStoryline[]): string {
  const typeLabel = line.type === "main" ? "主线" : "支线";
  const out: string[] = [`【剧情线：${line.title}】（${typeLabel}）`];
  if (line.description) out.push(`  简述：${line.description}`);

  // 要素：只报已填的，不把空占位塞给模型
  const keys = line.type === "main"
    ? ["origin", "process", "result"]
    : ["desire", "obstacle", "action", "result", "twist", "turn", "ending"];
  const label: Record<string, string> = {
    origin: "起因", process: "经过", result: "结果",
    desire: "欲望", obstacle: "阻碍", action: "行动", twist: "意外", turn: "转折", ending: "结局",
  };
  const filled = keys
    .map((k) => ({ k, v: (line.sevenElements?.[k] || "").trim() }))
    .filter((x) => x.v);
  if (filled.length > 0) {
    out.push(`  ${line.type === "main" ? "三要素" : "七要素"}：${filled.map((x) => `${label[x.k]}=${x.v}`).join("；")}`);
  }
  if (line.type === "main") {
    const p = computeStorylineProgress(line);
    out.push(`  要素进度：${p.label}`);
  }

  const clues = aggregatedClues(storylines, line.id);
  if (clues.length > 0) {
    out.push(`  线索集：${clues.slice(-6).map((c) => `[${c.tag || "未分类"}]${c.content}`).join("；")}`);
  }

  const timeline = timelineOf(line).slice(-8);
  if (timeline.length > 0) {
    out.push(`  时间轴（已发生，先发生 → 后导致）：`);
    for (const e of timeline) {
      out.push(`    · ${e.title || e.content}${e.tag ? `（${e.tag}）` : ""}`);
    }
  }
  return out.join("\n");
}

/** 完整上下文；账本为空时返回空串（调用方据此跳过注入，不污染 prompt） */
export function buildNarrativeContext(
  ledger: NarrativeLedger | null | undefined,
  opts: { chapterIndex?: number; totalChapters?: number } = {},
): string {
  if (!ledger) return "";
  const sections: string[] = [];

  const activeLines = (ledger.storylines || []).filter((s) => s.status === "active");
  if (activeLines.length > 0) {
    sections.push("## 故事线（已发生的事，不是待办任务）");
    for (const line of activeLines.slice(0, 6)) sections.push(fmtLine(line, ledger.storylines));
  }

  const pending = activeCommitments(ledger).slice(0, 12);
  if (pending.length > 0) {
    const stats = computePayoffStats(ledger.commitments);
    sections.push(`## 待收伏笔（${pending.length} 条未了，收束率 ${Math.round(stats.payoffRate * 100)}%）`);
    for (const c of pending) {
      sections.push(`- 【${c.status === "partially_fulfilled" ? "部分收" : "已埋未收"}】${c.description}（第${c.plantedRound}轮埋下）`);
    }
    sections.push("以上「因」尚未兑现，请在合适的剧情时机让其自然结果；不必本轮，可延后。不要生硬点破。");
  }

  const cards = approvedCards(ledger.worldCards).slice(0, 20);
  if (cards.length > 0) {
    // 按 15 类分组，抄 sync-global-prompt 的注入口径
    const grouped = new Map<string, string[]>();
    for (const c of cards) {
      const k = WORLD_CATEGORY_LABELS[c.category] || c.category;
      const list = grouped.get(k) || [];
      list.push(`${c.title}${c.content ? `：${c.content.slice(0, 80)}` : ""}`);
      grouped.set(k, list);
    }
    sections.push("## 世界设定（玩家已确认）");
    for (const [k, list] of grouped) sections.push(`### ${k}（${list.length}条）\n${list.join("\n")}`);
  }

  if ((ledger.chronicle || []).length > 0) {
    const ch = ledger.chronicle.slice(-4).map((c) => `第${c.chapterIndex + 1}章《${c.chapterTitle}》：${c.summary}`);
    sections.push(`## 这条世界线走过的地方\n${ch.join("\n")}`);
  }

  const stage = stageOf(opts.chapterIndex ?? 0, opts.totalChapters ?? 1);
  sections.push(formatStage(stage));

  return sections.join("\n\n");
}

/** 给进度条 / 页签头部用的一句话摘要 */
export function narrativeSummary(ledger: NarrativeLedger | null | undefined): string {
  if (!ledger) return "尚无故事线";
  const lines = (ledger.storylines || []).filter((s) => s.status === "active").length;
  const stats = computePayoffStats(ledger.commitments);
  const pendingCards = (ledger.worldCards || []).filter((c) => c.reviewStatus === "pending").length;
  return `${lines} 条故事线 · ${stats.pending + stats.partial} 条待收伏笔 · ${pendingCards} 张世界卡待确认`;
}
