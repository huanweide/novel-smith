/**
 * 故事线 · 树 / 时间轴 / 线索集 / 因果链
 *
 * 「能抄的直接抄」：进度、分组、因果链、事件去重采纳、完结回填，
 * 全部**直接 import 小说模式的纯函数**，不重写、不产生第二份真相：
 *   · computeStorylineProgress / groupStorylinesByMain / sortChildrenByStatusThenOrder / buildCausalChain
 *     ← src/lib/storyline-progress.ts
 *   · completeStorylineElements / MAIN_ELEMENT_KEYS / SIDE_ELEMENT_KEYS
 *     ← src/core/storyline/complete.ts
 *   · computePlotEventAdoptions ← src/core/pipeline/plot-event.ts
 *
 * 游戏本特有的只有一件事：**故事线由已发生的事自动长出来**。
 * 不预生成主线任务（那等于给玩家派活，违反「受限永远低于自由」），
 * 只在第一次真的发生事情时建一条「眼前这条路」作为主线，之后把里程碑挂上去。
 *
 * 纯函数，零 LLM。
 */

import { completeStorylineElements, MAIN_ELEMENT_KEYS, SIDE_ELEMENT_KEYS } from "@/core/storyline/complete";
import { computePlotEventAdoptions } from "@/core/pipeline/plot-event";
import {
  buildCausalChain,
  computeStorylineProgress,
  groupStorylinesByMain,
  sortChildrenByStatusThenOrder,
} from "@/lib/storyline-progress";
import type { SagaEventKind, SagaLineEvent, SagaLineType, SagaStoryline } from "./types";

export {
  computeStorylineProgress,
  groupStorylinesByMain,
  sortChildrenByStatusThenOrder,
  buildCausalChain,
  completeStorylineElements,
  MAIN_ELEMENT_KEYS,
  SIDE_ELEMENT_KEYS,
};

/** 自动主线的固定 id：一本游戏本最多一条自动主线，玩家可另建 */
export const AUTO_MAIN_ID = "sl_auto_main";

export function ensureAutoMain(storylines: SagaStoryline[], round: number): {
  storylines: SagaStoryline[];
  created: boolean;
} {
  const list = storylines || [];
  if (list.some((s) => s.id === AUTO_MAIN_ID)) return { storylines: list, created: false };
  const main: SagaStoryline = {
    id: AUTO_MAIN_ID,
    type: "main",
    parentId: null,
    title: "眼前这条路",
    description: "从你踏进这个世界开始，走过的事自会长成一条线。",
    status: "active",
    order: -1,
    // 主线三要素，结局不预填
    sevenElements: { origin: "", process: "", result: "" },
    events: [],
    createdRound: round,
    updatedRound: round,
  };
  return { storylines: [main, ...list], created: true };
}

/** 当前该往哪条线挂事件：活跃主线 > 任意主线 > 建自动主线 */
export function targetLine(storylines: SagaStoryline[], round: number): {
  storylines: SagaStoryline[];
  line: SagaStoryline;
} {
  const ensured = ensureAutoMain(storylines, round);
  const mains = ensured.storylines.filter((s) => s.type === "main");
  const line = mains.find((s) => s.status === "active") || mains[0] || ensured.storylines[0];
  return { storylines: ensured.storylines, line };
}

/** 时间轴下一位（浮点，便于插序；抄 StorylineEvent.position） */
export function nextPosition(events: SagaLineEvent[]): number {
  return (events || []).reduce((m, e) => Math.max(m, e.position || 0), 0) + 1;
}

/**
 * 把本轮真实发生的大事采纳进时间轴。
 * 去重靠 `computePlotEventAdoptions`（同 round 同标题不重复、跳过项不占位）。
 * 返回新增事件，供浮体与因果链使用。
 */
export function adoptMilestones(
  storylines: SagaStoryline[],
  round: number,
  milestones: Array<{ title: string; kind?: SagaEventKind; tag?: string; content?: string }>,
): { storylines: SagaStoryline[]; added: SagaLineEvent[] } {
  if (!milestones || milestones.length === 0) return { storylines, added: [] };
  const t = targetLine(storylines, round);
  const ref = `round_${round}`;
  const adoption = computePlotEventAdoptions({
    plotEvents: milestones.map((m) => m.title),
    existingEvents: t.line.events.map((e) => ({ title: e.title, sourceRefs: e.sourceRefs })),
    nodeId: ref,
    startPosition: nextPosition(t.line.events) - 1,
  });
  if (adoption.adoptedCount === 0) return { storylines: t.storylines, added: [] };

  const byTitle = new Map(milestones.map((m) => [m.title.trim(), m]));
  const added: SagaLineEvent[] = adoption.toCreate.map((e, i) => {
    const src = byTitle.get(e.title) || { title: e.title };
    return {
      id: `ev_${round}_${i}_${e.position}`,
      kind: src.kind === "CLUE" ? "CLUE" : "MILESTONE",
      tag: src.tag || "",
      title: e.title,
      content: src.content || e.content,
      position: e.position,
      role: "advance" as const,
      round,
      sourceRefs: e.sourceRefs,
    };
  });

  return {
    storylines: t.storylines.map((s) =>
      s.id === t.line.id
        ? { ...s, events: [...s.events, ...added], updatedRound: round }
        : s,
    ),
    added,
  };
}

/** 追加一条线索（CLUE 不进因果链、不参与要素提炼，抄 StorylineWorkbench 的线索集语义） */
export function addClue(
  storylines: SagaStoryline[],
  lineId: string,
  round: number,
  clue: { tag?: string; content: string },
): { storylines: SagaStoryline[]; added: SagaLineEvent | null } {
  const content = (clue.content || "").trim().slice(0, 300);
  if (!content) return { storylines, added: null };
  const line = (storylines || []).find((s) => s.id === lineId);
  if (!line) return { storylines, added: null };
  if (line.events.some((e) => e.kind === "CLUE" && e.content === content)) {
    return { storylines, added: null };
  }
  const ev: SagaLineEvent = {
    id: `clue_${round}_${line.events.length}`,
    kind: "CLUE",
    tag: (clue.tag || "").trim().slice(0, 60),
    title: "",
    content,
    position: nextPosition(line.events),
    round,
    sourceRefs: [{ type: "player", ref: `round_${round}` }],
  };
  return {
    storylines: storylines.map((s) => (s.id === lineId ? { ...s, events: [...s.events, ev], updatedRound: round } : s)),
    added: ev,
  };
}

/** 主线汇聚自身 + 所有子支线的 CLUE（抄 useStorylineWorkbench 的 aggregatedClues） */
export function aggregatedClues(storylines: SagaStoryline[], lineId: string): Array<SagaLineEvent & { from: string }> {
  const line = (storylines || []).find((s) => s.id === lineId);
  if (!line) return [];
  const lines = line.type === "main"
    ? [line, ...storylines.filter((s) => s.parentId === line.id)]
    : [line];
  return lines
    .flatMap((s) => s.events.filter((e) => e.kind === "CLUE").map((e) => ({ ...e, from: s.title })))
    .sort((a, b) => a.position - b.position);
}

/** 时间轴视图：排除 CLUE，按 position 升序（先发生 → 后导致） */
export function timelineOf(line: SagaStoryline): SagaLineEvent[] {
  return (line?.events || []).filter((e) => e.kind !== "CLUE").sort((a, b) => a.position - b.position);
}

/** 完结一条线：按类型回填三/七要素，结局不预填，已填不覆盖 */
export function completeLine(
  storylines: SagaStoryline[],
  lineId: string,
  round: number,
): SagaStoryline[] {
  return (storylines || []).map((s) => {
    if (s.id !== lineId) return s;
    const children = s.type === "main"
      ? storylines.filter((c) => c.parentId === s.id).flatMap((c) => c.events)
      : [];
    const sevenElements = completeStorylineElements(
      s.type as SagaLineType,
      s.sevenElements,
      s.events,
      children,
    );
    return { ...s, status: "completed", sevenElements, updatedRound: round };
  });
}

/** 切换主线/支线时清理另一套要素残留（抄 stripElements，防要素串味） */
export function switchLineType(storylines: SagaStoryline[], lineId: string, type: SagaLineType): SagaStoryline[] {
  const allowed = type === "main" ? MAIN_ELEMENT_KEYS : SIDE_ELEMENT_KEYS;
  return (storylines || []).map((s) => {
    if (s.id !== lineId) return s;
    const cleaned: Record<string, string> = {};
    for (const k of allowed) cleaned[k] = s.sevenElements?.[k] || "";
    return { ...s, type, sevenElements: cleaned, parentId: type === "main" ? null : s.parentId ?? null };
  });
}

/** 新建一条玩家自定义故事线（不写死内容，不派任务） */
export function createLine(
  storylines: SagaStoryline[],
  input: { title: string; type: SagaLineType; description?: string; parentId?: string },
  round: number,
): { storylines: SagaStoryline[]; line: SagaStoryline | null } {
  const title = (input.title || "").trim().slice(0, 120);
  if (!title) return { storylines, line: null };
  const id = `sl_${round}_${storylines.length}`;
  const line: SagaStoryline = {
    id,
    type: input.type === "main" ? "main" : "side",
    parentId: input.type === "main" ? null : input.parentId || AUTO_MAIN_ID,
    title,
    description: (input.description || "").trim().slice(0, 500),
    status: "active",
    order: storylines.length,
    sevenElements: input.type === "main"
      ? { origin: "", process: "", result: "" }
      : { desire: "", obstacle: "", action: "", result: "", twist: "", turn: "", ending: "" },
    events: [],
    createdRound: round,
    updatedRound: round,
  };
  return { storylines: [...storylines, line], line };
}
