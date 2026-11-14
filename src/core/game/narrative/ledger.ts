/**
 * 叙事账本 · 信封读写（零迁移的核心）
 *
 * 背景：`GameSaga.causality` 是 `Json?`，历史上存**裸数组**（因果种子）。
 * 引擎 `game-engine.ts` 每轮 `data:{ causality: settledSeeds }` 会整列覆盖。
 * 我们把它升级成「信封」对象，让同一列同时装因果种子与叙事账本：
 *
 *   裸数组                       → 老存档，读成 seeds，账本为空
 *   { causality, declaredFacts, goals } → session 三件套，读成 seeds，账本为空
 *   { causality, narrative, ... }       → 新信封
 *   null / 坏 JSON / 任意脏值     → 空账本，绝不抛错
 *
 * 为什么天然兼容：`parseExtensions()` 只读 `causality` 键、忽略未知键，
 * 所以 `causalityOnly(saga.causality)` 与 session 三件套路径一行都不用改。
 * 唯一要改的是引擎写入点——必须「读旧信封 → 合并 → 写回」，否则会冲掉账本。
 *
 * 纯函数，零 prisma / 零 LLM，可单测。
 */

import { ALL_WORLD_CATEGORIES, type WorldCategory } from "@/lib/world-category-classifier";
import type {
  NarrativeLedger,
  SagaChronicleEntry,
  SagaCommitment,
  SagaCommitmentStatus,
  SagaEventKind,
  SagaLineEvent,
  SagaLineStatus,
  SagaLineType,
  SagaNarrativeEnvelope,
  SagaNarrativeRole,
  SagaStatusHistoryEntry,
  SagaStoryline,
  SagaWorldCard,
} from "./types";
import { NARRATIVE_CAPS } from "./types";

export function emptyLedger(): NarrativeLedger {
  return { version: 1, storylines: [], commitments: [], worldCards: [], chronicle: [], updatedRound: 0 };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const LINE_TYPES: SagaLineType[] = ["main", "side"];
const LINE_STATUSES: SagaLineStatus[] = ["active", "completed", "abandoned"];
const EVENT_KINDS: SagaEventKind[] = ["MILESTONE", "EVENT", "CLUE"];
const ROLES: SagaNarrativeRole[] = ["advance", "probe", "vote"];
const COMMIT_STATUSES: SagaCommitmentStatus[] = [
  "pending", "detected", "partially_fulfilled", "fulfilled", "voided",
];

// ─── 逐条归一化：脏数据丢弃，不让一条坏记录毁掉整局 ───────────────

export function normalizeEvent(raw: unknown): SagaLineEvent | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 80);
  const content = str(raw.content, 300);
  const title = str(raw.title, 120);
  if (!id || (!content && !title)) return null;
  return {
    id,
    kind: oneOf(raw.kind, EVENT_KINDS, "EVENT"),
    tag: str(raw.tag, 60),
    title,
    content,
    position: num(raw.position, 0),
    ...(oneOf(raw.role, ROLES, "advance") && typeof raw.role === "string" && ROLES.includes(raw.role as SagaNarrativeRole)
      ? { role: raw.role as SagaNarrativeRole }
      : {}),
    round: Math.trunc(num(raw.round, 0)),
    sourceRefs: arr(raw.sourceRefs)
      .filter(isObj)
      .map((r) => ({ type: str(r.type, 20) || "round", ref: str(r.ref, 80) }))
      .filter((r) => r.ref),
  };
}

export function normalizeStoryline(raw: unknown): SagaStoryline | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 80);
  const title = str(raw.title, 120);
  if (!id || !title) return null;
  const sevenElements: Record<string, string> = {};
  if (isObj(raw.sevenElements)) {
    for (const [k, v] of Object.entries(raw.sevenElements)) {
      const s = str(v, 300);
      if (s) sevenElements[k.slice(0, 30)] = s;
    }
  }
  const events = arr(raw.events)
    .map(normalizeEvent)
    .filter((e): e is SagaLineEvent => !!e)
    .sort((a, b) => a.position - b.position)
    .slice(-NARRATIVE_CAPS.eventsPerLine);
  return {
    id,
    type: oneOf(raw.type, LINE_TYPES, "side"),
    ...(str(raw.parentId, 80) ? { parentId: str(raw.parentId, 80) } : {}),
    title,
    description: str(raw.description, 500),
    status: oneOf(raw.status, LINE_STATUSES, "active"),
    order: num(raw.order, 0),
    sevenElements,
    events,
    createdRound: Math.trunc(num(raw.createdRound, 0)),
    updatedRound: Math.trunc(num(raw.updatedRound, 0)),
  };
}

export function normalizeCommitment(raw: unknown): SagaCommitment | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 80);
  const description = str(raw.description, 300);
  if (!id || !description) return null;
  const status = oneOf(raw.status, COMMIT_STATUSES, "pending");
  const history: SagaStatusHistoryEntry[] = arr(raw.statusHistory)
    .filter(isObj)
    .map((h) => ({
      from: str(h.from, 30) as SagaStatusHistoryEntry["from"],
      to: oneOf(h.to, COMMIT_STATUSES, "pending"),
      trigger: str(h.trigger, 40) || "unknown",
      round: Math.trunc(num(h.round, 0)),
      details: str(h.details, 200),
    }));
  return {
    id,
    description,
    source: oneOf(raw.source, ["causality", "player", "ai", "import"] as const, "ai"),
    priority: oneOf(raw.priority, ["high", "medium", "low"] as const, "medium"),
    status,
    ratio: Math.max(0, Math.min(1, num(raw.ratio, status === "fulfilled" ? 1 : 0))),
    closureConditions: arr(raw.closureConditions).map((c) => str(c, 120)).filter(Boolean).slice(0, 12),
    entityIds: arr(raw.entityIds).map((e) => str(e, 80)).filter(Boolean).slice(0, 12),
    statusHistory: history,
    plantedRound: Math.trunc(num(raw.plantedRound, 0)),
    ...(typeof raw.detectedRound === "number" ? { detectedRound: Math.trunc(raw.detectedRound) } : {}),
    ...(typeof raw.fulfilledRound === "number" ? { fulfilledRound: Math.trunc(raw.fulfilledRound) } : {}),
    ...(typeof raw.voidedRound === "number" ? { voidedRound: Math.trunc(raw.voidedRound) } : {}),
    ...(str(raw.voidReason, 200) ? { voidReason: str(raw.voidReason, 200) } : {}),
    ...(str(raw.snippet, 200) ? { snippet: str(raw.snippet, 200) } : {}),
    ...(str(raw.developmentHint, 300) ? { developmentHint: str(raw.developmentHint, 300) } : {}),
    ...(str(raw.linkedSeedId, 80) ? { linkedSeedId: str(raw.linkedSeedId, 80) } : {}),
  };
}

export function normalizeWorldCard(raw: unknown): SagaWorldCard | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 80);
  const title = str(raw.title, 120);
  if (!id || !title) return null;
  const category = oneOf<WorldCategory>(raw.category, ALL_WORLD_CATEGORIES, "custom");
  return {
    id,
    title,
    category,
    keys: arr(raw.keys).map((k) => str(k, 60)).filter(Boolean).slice(0, 10),
    content: str(raw.content, 500),
    depth: Math.max(0, Math.min(4, Math.trunc(num(raw.depth, 3)))),
    enabled: bool(raw.enabled, true),
    reviewStatus: oneOf(raw.reviewStatus, ["pending", "approved"] as const, "pending"),
    createdRound: Math.trunc(num(raw.createdRound, 0)),
    source: oneOf(raw.source, ["entity", "item", "title", "player", "import"] as const, "entity"),
  };
}

export function normalizeChronicle(raw: unknown): SagaChronicleEntry | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 80);
  if (!id) return null;
  return {
    id,
    chapterIndex: Math.trunc(num(raw.chapterIndex, 0)),
    chapterTitle: str(raw.chapterTitle, 120),
    ...(str(raw.worldTime, 80) ? { worldTime: str(raw.worldTime, 80) } : {}),
    summary: str(raw.summary, 300),
    keyEvents: arr(raw.keyEvents).map((e) => str(e, 200)).filter(Boolean).slice(0, 12),
    createdRound: Math.trunc(num(raw.createdRound, 0)),
  };
}

function dedupe<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** 任意值 → 合法账本。绝不抛错、绝不返回 undefined */
export function normalizeLedger(raw: unknown): NarrativeLedger {
  if (!isObj(raw)) return emptyLedger();
  const storylines = dedupe(
    arr(raw.storylines).map(normalizeStoryline).filter((x): x is SagaStoryline => !!x),
    (x) => x.id,
  )
    .sort((a, b) => a.order - b.order)
    .slice(-NARRATIVE_CAPS.storylines);
  const commitments = dedupe(
    arr(raw.commitments).map(normalizeCommitment).filter((x): x is SagaCommitment => !!x),
    (x) => x.id,
  )
    // 超上限时优先留未收束的（它们还要兑现），其次留较新的
    .sort((a, b) =>
      Number(a.status === "fulfilled" || a.status === "voided") -
      Number(b.status === "fulfilled" || b.status === "voided") ||
      a.plantedRound - b.plantedRound,
    )
    .slice(-NARRATIVE_CAPS.commitments)
    .sort((a, b) => a.plantedRound - b.plantedRound);
  const worldCards = dedupe(
    arr(raw.worldCards).map(normalizeWorldCard).filter((x): x is SagaWorldCard => !!x),
    (x) => x.id,
  ).slice(-NARRATIVE_CAPS.worldCards);
  const chronicle = dedupe(
    arr(raw.chronicle).map(normalizeChronicle).filter((x): x is SagaChronicleEntry => !!x),
    (x) => x.id,
  )
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .slice(-NARRATIVE_CAPS.chronicle);
  return {
    version: 1,
    storylines,
    commitments,
    worldCards,
    chronicle,
    updatedRound: Math.trunc(num(raw.updatedRound, 0)),
    ...(str(raw.stageKey, 30) ? { stageKey: str(raw.stageKey, 30) } : {}),
  };
}

/** 把数据库列里任意值解析成对象形态（用于读信封） */
function toObject(raw: unknown): Record<string, unknown> | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  return isObj(v) ? v : null;
}

/**
 * 从 `saga.causality` 任意形态读出因果种子。
 * 与 `causalityOnly()` 口径一致：裸数组直接返回，对象取 `causality` 键。
 */
export function envelopeSeeds(raw: unknown): unknown[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (Array.isArray(v)) return v;
  if (isObj(v)) return arr(v.causality);
  return [];
}

/** 从 `saga.causality` 任意形态读出叙事账本（老存档 → 空账本） */
export function readNarrative(raw: unknown): NarrativeLedger {
  const obj = toObject(raw);
  if (!obj) return emptyLedger();
  return normalizeLedger(obj.narrative);
}

/**
 * 生成要写回 `saga.causality` 的信封。
 * 保留旧信封里的其它键（declaredFacts / goals 等），只替换 causality 与 narrative。
 *  NOTE：调用方必须先 `findUnique` 读回旧值再传进来，否则会冲掉上一次的账本。
 */
export function writeEnvelope(
  previousRaw: unknown,
  seeds: unknown[],
  ledger: NarrativeLedger,
): SagaNarrativeEnvelope {
  const prev = toObject(previousRaw) || {};
  return {
    ...prev,
    causality: Array.isArray(seeds) ? seeds : [],
    narrative: normalizeLedger(ledger),
  };
}

/** 信封是否含有效账本（给 API / 测试做断言用） */
export function hasNarrative(raw: unknown): boolean {
  const obj = toObject(raw);
  return !!obj && isObj(obj.narrative);
}
