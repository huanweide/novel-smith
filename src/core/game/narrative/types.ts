/**
 * 游戏本 · 叙事账本类型（移植自小说模式，2026-11-14）
 *
 * 「能抄的直接抄、不自己做」——字段名刻意与小说系统对齐，这样
 * `computeStorylineProgress` / `groupStorylinesByMain` / `buildCausalChain` /
 * `completeStorylineElements` / `computePlotEventAdoptions` 可以**直接复用**，
 * 不产生第二份真相。
 *
 * 抄自：prisma/schema.prisma（Storyline / StorylineEvent / PendingCommitment / LorebookEntry）
 *      src/core/storyline/complete.ts、src/lib/storyline-progress.ts
 * 详见 docs/internal/游戏本叙事系统移植-决策表.md
 *
 * 三条铁律（与游戏本自由度一致）：
 *   1. 不写「世界常识」——这里只有记录结构，没有任何「什么时候能做什么」的判定；
 *   2. 不预设结局——`ending` 永远不自动填；
 *   3. 不造主线任务——故事线由**已发生的事**长出来，玩家也可手动加。
 */

import type { WorldCategory } from "@/lib/world-category-classifier";

// ─── 故事线 ────────────────────────────────────────────────────

export type SagaLineType = "main" | "side";
/** 统一漂移：不抄小说系统里定义了却全链路未用的 paused，也不抄历史残留的 thread */
export type SagaLineStatus = "active" | "completed" | "abandoned";

/** 抄 StorylineEvent.kind：里程碑 / 普通事件 / 线索集（CLUE 不进时间轴因果链） */
export type SagaEventKind = "MILESTONE" | "EVENT" | "CLUE";

/** 抄 StorylineEvent.role：剧情推进点 / 卡点阻碍 / 分支选择点 */
export type SagaNarrativeRole = "advance" | "probe" | "vote";

export interface SagaLineEvent {
  id: string;
  kind: SagaEventKind;
  /** CLUE 的归类标签；MILESTONE 存阶段名 */
  tag: string;
  title: string;
  content: string;
  /** 浮点时间轴，抄 StorylineEvent.position（不绑章节号） */
  position: number;
  role?: SagaNarrativeRole;
  round: number;
  /** 抄 StorylineEvent.sourceRefs；computePlotEventAdoptions 靠它去重 */
  sourceRefs: Array<{ type: string; ref: string }>;
}

export interface SagaStoryline {
  id: string;
  type: SagaLineType;
  /** 支线挂主线，主线为 null（抄 Storyline.parentId） */
  parentId?: string | null;
  title: string;
  description: string;
  status: SagaLineStatus;
  order: number;
  /**
   * 主线三要素 origin/process/result；支线七要素 desire…ending。
   * 名字必须叫 sevenElements —— computeStorylineProgress 按这个键读。
   */
  sevenElements: Record<string, string>;
  events: SagaLineEvent[];
  createdRound: number;
  updatedRound: number;
}

// ─── 伏笔（PendingCommitment 五状态机）─────────────────────────

export type SagaCommitmentStatus =
  | "pending"
  | "detected"
  | "partially_fulfilled"
  | "fulfilled"
  | "voided";

/** 抄 PendingCommitment.statusHistory 的审计链：能看到「什么时候、因为什么」 */
export interface SagaStatusHistoryEntry {
  from: SagaCommitmentStatus | "none";
  to: SagaCommitmentStatus;
  trigger: string;
  round: number;
  details: string;
}

export interface SagaCommitment {
  id: string;
  description: string;
  /** causality=由因果种子自动登记（协同点）；player/ai/import 为其它来源 */
  source: "causality" | "player" | "ai" | "import";
  priority: "high" | "medium" | "low";
  status: SagaCommitmentStatus;
  /** fulfillmentRatio：0 / 0.5 / 1 */
  ratio: number;
  /** 闭环条件：命中任一即视为兑现 */
  closureConditions: string[];
  entityIds: string[];
  statusHistory: SagaStatusHistoryEntry[];
  plantedRound: number;
  detectedRound?: number;
  fulfilledRound?: number;
  voidedRound?: number;
  voidReason?: string;
  /** 兑现时的正文片段 */
  snippet?: string;
  /** 后续发展思路（写作参考，可手填） */
  developmentHint?: string;
  /** 协同：这条伏笔来自哪颗因果种子；兑现时反查销账 */
  linkedSeedId?: string;
}

// ─── 世界卡（LorebookEntry 15 类）───────────────────────────────

export interface SagaWorldCard {
  id: string;
  title: string;
  category: WorldCategory;
  keys: string[];
  content: string;
  /** 注入深度 0-4；depth<=2 常驻，>=3 关键词触发 */
  depth: number;
  enabled: boolean;
  /** 自动登记默认待审；玩家确认后才进提示词（抄 WorldPanel 的审批闸门） */
  reviewStatus: "pending" | "approved";
  createdRound: number;
  source: "entity" | "item" | "title" | "player" | "import";
}

// ─── 世界线（一本游戏本 = 一条世界线；跨章编年时间轴）───────────

export interface SagaChronicleEntry {
  id: string;
  /** 0-based 章序 */
  chapterIndex: number;
  chapterTitle: string;
  /** 书中世界时间标记（抄 StoryNode.worldTime） */
  worldTime?: string;
  /** 代表句（抄 buildTimelineDigest 的「第N章《标题》：代表句」） */
  summary: string;
  keyEvents: string[];
  createdRound: number;
}

// ─── 账本 ──────────────────────────────────────────────────────

export interface NarrativeLedger {
  version: 1;
  storylines: SagaStoryline[];
  commitments: SagaCommitment[];
  worldCards: SagaWorldCard[];
  chronicle: SagaChronicleEntry[];
  updatedRound: number;
  /** 上一轮算出的 6 阶段 key，用来判断「是否跨阶段」才弹浮体（不额外建列） */
  stageKey?: string;
}

/** 提示词预算封顶（不是数据库限制）：超出时保留较新 / 未收束的 */
export const NARRATIVE_CAPS = {
  storylines: 12,
  eventsPerLine: 60,
  commitments: 40,
  worldCards: 60,
  chronicle: 30,
} as const;

/**
 * 信封：`saga.causality` 从「裸数组」升级成可容纳叙事账本的对象。
 * 老存档（裸数组）与 session 三件套 `{causality,declaredFacts,goals}` 都照旧可读——
 * `parseExtensions` 只读 causality 键、忽略未知键，天然兼容。
 */
export interface SagaNarrativeEnvelope {
  causality: unknown[];
  narrative: NarrativeLedger;
  [key: string]: unknown;
}

/** 15 类世界卡的纸本中文栏目名（抄 worldPanelData.WORLD_MODULES，不 import 组件层、不带 emoji） */
export const WORLD_MODULE_LABELS: Record<WorldCategory, string> = {
  geography: "地理地图",
  faction: "势力阵营",
  item: "物品列表",
  magic_system: "力量体系",
  technique: "功法体系",
  creature: "生物种族",
  culture: "文化风俗",
  history: "历史背景",
  law: "规则法则",
  currency: "货币体系",
  character_relationship: "角色关系",
  custom: "特殊设定",
  fate_system: "命运体系",
  physics: "物理列表",
  public_system: "公开体制",
};

/** 注入深度中文（抄 worldPanelData.DEPTH_LABEL） */
export const DEPTH_LABEL: Record<number, string> = {
  0: "常驻·强效",
  1: "常驻·指令上",
  2: "常驻·系统",
  3: "触发·默认",
  4: "触发·深层",
};

/** 伏笔五状态中文（抄 foreshadowing/list 的分组口径） */
export const COMMITMENT_STATUS_LABEL: Record<SagaCommitmentStatus, string> = {
  pending: "已埋未收",
  detected: "已察觉",
  partially_fulfilled: "部分收",
  fulfilled: "已收",
  voided: "悬空",
};

/** 故事线类型/状态中文（抄 StorylineWorkbench 下拉） */
export const LINE_TYPE_LABEL: Record<SagaLineType, string> = { main: "主线", side: "支线" };
export const LINE_STATUS_LABEL: Record<SagaLineStatus, string> = {
  active: "活跃中",
  completed: "已完结",
  abandoned: "已废弃",
};

/** 事件类别中文（抄 StorylineWorkbench 时间轴兜底标题） */
export const EVENT_KIND_LABEL: Record<SagaEventKind, string> = {
  MILESTONE: "里程碑",
  EVENT: "事件",
  CLUE: "线索",
};

/** 叙事角色中文（抄 outline-context 的 [推进点]/[卡点]/[分支选择点]） */
export const NARRATIVE_ROLE_LABEL: Record<SagaNarrativeRole, string> = {
  advance: "推进点",
  probe: "卡点",
  vote: "分支",
};
