/**
 * 协同层 · 每轮把「真实发生的事」同时写进五套叙事系统
 *
 * 这是本次移植真正的新东西：小说系统各管各的（故事线表、伏笔表、世界书表…），
 * 游戏本让它们**共享一次演算**——引擎每轮产出的信号只解析一次，
 * 同时推进伏笔、故事线时间轴、世界卡、跨章编年、6 阶段，
 * 再把「被系统读出去的东西」变成右侧浮体（不同颜色、逐条上浮、不用点确定）。
 *
 * 铁律（与 game-core 一致）：
 *   · 只用引擎**真实产出**的信号，不编造事件、不替玩家决定剧情；
 *   · 纯函数、零 LLM、零 prisma，同一输入重放结果一致（幂等）；
 *   · 不写世界常识——没有「什么时候该进高潮」的硬判定，阶段只是给 AI 的节奏参考。
 */

import type { CausalitySeed, GameEntity } from "../types";
import type { DiscoveryKind } from "../discovery-view";
import {
  detectPayoffs,
  fulfillBySeeds,
  plantFromSeeds,
} from "./foreshadow";
import { adoptMilestones, ensureAutoMain } from "./storyline";
import { recordChapter, stageOf } from "./worldline";
import { registerEntities, registerCard } from "./worldcard";
import type { NarrativeLedger, SagaWorldCard } from "./types";
import { emptyLedger, normalizeLedger } from "./ledger";

/** 引擎一轮的真实产出（字段全部来自 game_done / parsed，不臆造） */
export interface RoundSignals {
  round: number;
  chapterIndex: number;
  chapterTitle: string;
  totalChapters: number;
  worldTime?: string;
  narrative: string;
  playerAction: string;
  newEntities: GameEntity[];
  /** 本轮真正入库的 gain 物品名 */
  gainedItems: string[];
  titles: string[];
  /** 本轮新种下的因果种子 */
  plantedSeeds: CausalitySeed[];
  /** 本轮被兑现的因果种子（已带 triggeredRound） */
  triggeredSeeds: CausalitySeed[];
  /** 上一轮账本里的阶段 key（用于判断是否跨阶段） */
  prevStageKey?: string;
}

export interface NarrativeDiscovery {
  kind: DiscoveryKind;
  text: string;
}

export interface SyncResult {
  ledger: NarrativeLedger;
  discoveries: NarrativeDiscovery[];
  changed: boolean;
}

/** 发现文案统一带前缀，让 parseDiscovery 的关键词分类稳定命中（不靠猜） */
function disc(kind: DiscoveryKind, text: string): NarrativeDiscovery {
  return { kind, text: text.slice(0, 120) };
}

/**
 * 推进一整轮。返回新账本 + 本轮要上浮体的提示。
 * 同一轮信号重复调用不会产生重复条目（世界卡 / 伏笔 / 事件 / 编年都按 id 幂等）。
 */
export function syncRound(previous: NarrativeLedger | null | undefined, sig: RoundSignals): SyncResult {
  const base = normalizeLedger(previous || emptyLedger());
  const round = Math.max(1, Math.trunc(sig.round || 1));
  const discoveries: NarrativeDiscovery[] = [];
  const narrativeText = sig.narrative || "";

  // ── 1. 因果种子 → 伏笔机（协同点 A）───────────────────────────
  let commitments = base.commitments;
  const planted = plantFromSeeds(commitments, sig.plantedSeeds || [], round);
  commitments = planted.commitments;
  for (const c of planted.added.slice(0, 3)) {
    discoveries.push(disc("clue", `记下伏笔·${c.description.slice(0, 42)}`));
  }

  // 因果种子被显式兑现 → 对应伏笔销账
  const triggeredIds = (sig.triggeredSeeds || []).map((s) => s.id);
  const fulfilled = fulfillBySeeds(commitments, triggeredIds, round, narrativeText);
  commitments = fulfilled.commitments;
  for (const c of fulfilled.recovered.slice(0, 3)) {
    discoveries.push(disc("clue", `伏笔回收·${c.description.slice(0, 42)}`));
  }

  // ── 2. 正文确定性命中 → 伏笔推进（协同点 B）───────────────────
  // 排除埋设轮自身由 detectPayoffs 内部处理，绝不降级 fulfilled
  const detected = detectPayoffs(commitments, narrativeText, round);
  commitments = detected.commitments;
  const alreadyRecovered = new Set(fulfilled.recovered.map((c) => c.id));
  for (const c of detected.recovered) {
    if (alreadyRecovered.has(c.id)) continue;
    discoveries.push(disc("clue", `伏笔回收·${c.description.slice(0, 42)}`));
  }

  // ── 3. 新实体 / 物品 / 称号 → 世界卡（协同点 C）────────────────
  let worldCards: SagaWorldCard[] = base.worldCards;
  const entReg = registerEntities(worldCards, sig.newEntities || [], round);
  worldCards = entReg.cards;
  for (const c of entReg.added.slice(0, 4)) {
    discoveries.push(disc("world", `世界卡·${c.title}`));
  }
  for (const name of (sig.gainedItems || []).slice(0, 4)) {
    const r = registerCard(worldCards, { title: name, category: "item", source: "item", round });
    worldCards = r.cards;
    if (r.added) discoveries.push(disc("world", `世界卡·${r.added.title}`));
  }
  for (const name of (sig.titles || []).slice(0, 2)) {
    const r = registerCard(worldCards, {
      title: name,
      category: "character_relationship",
      content: "角色获得的称号",
      source: "title",
      round,
    });
    worldCards = r.cards;
    if (r.added) discoveries.push(disc("world", `世界卡·${r.added.title}`));
  }

  // ── 4. 真实发生的大事 → 故事线时间轴（协同点 D）───────────────
  const milestones: Array<{ title: string; kind?: "MILESTONE" | "CLUE"; tag?: string; content?: string }> = [];
  for (const s of sig.plantedSeeds || []) {
    milestones.push({
      title: `种下${s.type}·${s.subject}`.slice(0, 80),
      tag: "因果",
      content: s.description,
    });
  }
  for (const s of sig.triggeredSeeds || []) {
    milestones.push({
      title: `了却${s.type}·${s.subject}`.slice(0, 80),
      tag: "因果",
      content: s.description,
    });
  }
  for (const c of [...fulfilled.recovered, ...detected.recovered.filter((x) => !alreadyRecovered.has(x.id))]) {
    milestones.push({ title: `伏笔回收·${c.description.slice(0, 40)}`, tag: "伏笔", content: c.snippet });
  }
  for (const name of (sig.titles || []).slice(0, 2)) {
    milestones.push({ title: `得号·${name}`.slice(0, 80), tag: "称号" });
  }
  let storylines = base.storylines;
  if (milestones.length > 0 || (sig.newEntities || []).length > 0) {
    storylines = ensureAutoMain(storylines, round).storylines;
  }
  const adopted = adoptMilestones(storylines, round, milestones);
  storylines = adopted.storylines;
  for (const e of adopted.added.slice(0, 3)) {
    discoveries.push(disc("event", `里程碑·${e.title}`));
  }

  // ── 5. 跨章编年 + 6 阶段（协同点 E）───────────────────────────
  const ch = recordChapter(base.chronicle, {
    chapterIndex: sig.chapterIndex,
    chapterTitle: sig.chapterTitle,
    worldTime: sig.worldTime,
    narrative: narrativeText,
    keyEvents: adopted.added.map((e) => e.title),
    round,
  });
  const stage = stageOf(sig.chapterIndex, sig.totalChapters);
  // 上轮阶段从账本自取（状态闭环，不要求调用方重复传）；显式传入时以传入为准
  const prevStageKey = sig.prevStageKey || base.stageKey;
  if (prevStageKey && prevStageKey !== stage.key) {
    discoveries.push(disc("time", `时辰·进入${stage.label}（约 ${stage.percent}%）`));
  }

  const changed =
    planted.added.length > 0 ||
    fulfilled.recovered.length > 0 ||
    detected.recovered.length > 0 ||
    entReg.added.length > 0 ||
    adopted.added.length > 0 ||
    ch.added ||
    base.updatedRound !== round;

  return {
    ledger: {
      version: 1,
      storylines,
      commitments,
      worldCards,
      chronicle: ch.chronicle,
      updatedRound: round,
      // 阶段 key 存在账本里（不额外建列），下一轮用来判断是否跨阶段
      stageKey: stage.key,
    },
    discoveries,
    changed,
  };
}

/** 上浮提示有上限：一轮别刷屏（用户要「看着挺舒服」，不是弹幕） */
export function capDiscoveries(list: NarrativeDiscovery[], max = 8): NarrativeDiscovery[] {
  return (list || []).slice(0, max);
}

/**
 * 引擎胶水：把 `processGameTurn` 结算处已有的变量组装成 RoundSignals。
 *
 * 为什么单独抽出来：这段代码原本内联在引擎里，只能靠跑一整局 LLM 回合才能验，
 * 而跑回合会改真实存档（不可逆）。抽成纯函数后可单测，尤其锁死
 * 「本轮兑现的种子」= settledSeeds 里 triggeredRound === 本轮的那些 ——
 * 早期实现曾误把全部历史已兑现种子都当成「本轮兑现」，会重复弹浮体、重复记里程碑。
 */
export interface EngineTurnSignals {
  round: number;
  narrative: string;
  playerAction: string;
  newEntities: GameEntity[];
  gainedItemNames: string[];
  titleNames: string[];
  plantedSeeds: CausalitySeed[];
  /** markSeedTriggered 之后的完整种子库（含历史已兑现的） */
  settledSeeds: CausalitySeed[];
  meta?: { chapterIndex: number; chapterTitle: string; totalChapters: number; worldTime?: string };
}

export function toRoundSignals(x: EngineTurnSignals): RoundSignals {
  return {
    round: x.round,
    chapterIndex: x.meta?.chapterIndex ?? 0,
    chapterTitle: x.meta?.chapterTitle || "本章",
    totalChapters: x.meta?.totalChapters ?? 1,
    worldTime: x.meta?.worldTime,
    narrative: x.narrative || "",
    playerAction: x.playerAction || "",
    newEntities: x.newEntities || [],
    gainedItems: x.gainedItemNames || [],
    titles: x.titleNames || [],
    plantedSeeds: x.plantedSeeds || [],
    triggeredSeeds: (x.settledSeeds || []).filter(
      (s) => s.triggered && s.triggeredRound === x.round,
    ),
  };
}
