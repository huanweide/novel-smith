/**
 * 游戏会话扩展态（R9 自由度扩展）—— 纯函数，零运行时依赖
 *
 * 为什么单独一层：
 *   `GameSession.extensions` 是一个 Json 列，里面装着三样跨轮持久的东西——
 *   因果种子（未了的因）、玩家声明事实（作者权）、玩家目标（无强制主线）。
 *   它由数据库读回，可能是 null、可能是旧版本写的、也可能被手工改坏。
 *   若直接在引擎里 `JSON.parse(session.extensions as string)`，
 *   一条脏数据就能让整局游戏打不开——这是"存档能开"的底线问题。
 *
 * 所以这里做三件事，全部可单测：
 *   1. 容错解析：任何形态的输入都返回结构合法的三数组，绝不抛错；
 *   2. 逐条校验：缺字段/类型不对的条目丢弃，不污染提示词；
 *   3. 体量封顶：提示词是有限预算，因果种子最多 40 条、事实 30 条、目标 20 条，
 *      超出时保留"未兑现/较早"的部分（新的因更可能被兑现，旧事实更该被记住）。
 */

import type { CausalitySeed, CausalityType, DeclaredFact, PlayerGoal } from "./types";
import { CAUSALITY_TYPES } from "./causality-ledger";

/** 扩展态三件套（与 schema.prisma 里 GameSession.extensions 的注释一一对应） */
export interface GameExtensions {
  /** 未了因果种子库（鬼谷八荒式：种下的因，后面结果） */
  causality: CausalitySeed[];
  /** 玩家声明事实（FATE Core 式共享叙事权威） */
  declaredFacts: DeclaredFact[];
  /** 玩家自定义目标（无强制主线） */
  goals: PlayerGoal[];
}

/** 上限：提示词预算，不是数据库限制 */
export const EXT_CAPS = {
  causality: 40,
  declaredFacts: 30,
  goals: 20,
} as const;

export const EMPTY_EXTENSIONS: GameExtensions = {
  causality: [],
  declaredFacts: [],
  goals: [],
};

/** 空扩展态（每次返回新对象，避免调用方改到共享常量） */
export function emptyExtensions(): GameExtensions {
  return { causality: [], declaredFacts: [], goals: [] };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** 单条因果种子校验（对外导出，便于测试逐条断言） */
export function normalizeSeed(raw: unknown): CausalitySeed | null {
  if (!isObj(raw)) return null;
  const subject = toStr(raw.subject, 120);
  const description = toStr(raw.description, 300);
  if (!subject || !description) return null;
  const type = (CAUSALITY_TYPES as string[]).includes(String(raw.type))
    ? (raw.type as CausalityType)
    : "因果";
  const id = toStr(raw.id, 80) || `cs_${toInt(raw.plantedRound, 0)}_${subject}`;
  return {
    id,
    type,
    subject,
    description,
    plantedRound: toInt(raw.plantedRound, 0),
    triggered: raw.triggered === true,
    ...(raw.triggered === true ? { triggeredRound: toInt(raw.triggeredRound, 0) } : {}),
  };
}

/** 单条声明事实校验 */
export function normalizeFact(raw: unknown): DeclaredFact | null {
  if (!isObj(raw)) return null;
  const text = toStr(raw.text, 200);
  if (text.length < 2) return null;
  return {
    id: toStr(raw.id, 80) || `df_${toInt(raw.declaredRound, 0)}_${text.slice(0, 12)}`,
    text,
    declaredRound: toInt(raw.declaredRound, 0),
  };
}

/** 单条玩家目标校验 */
export function normalizeGoal(raw: unknown): PlayerGoal | null {
  if (!isObj(raw)) return null;
  const text = toStr(raw.text, 200);
  if (!text) return null;
  return {
    id: toStr(raw.id, 80) || `g_${toInt(raw.createdRound, 0)}_${text.slice(0, 12)}`,
    text,
    createdRound: toInt(raw.createdRound, 0),
    ...(raw.done === true ? { done: true } : {}),
  };
}

function dedupeBy<T>(items: T[], key: (x: T) => string): T[] {
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

/**
 * 把数据库里的任意值解析成扩展态。
 * 入参可为：null / JSON 字符串 / 已解析对象 / 坏 JSON / 数组。
 * 任何情况下都返回结构合法的对象，绝不抛错。
 */
export function parseExtensions(raw: unknown): GameExtensions {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return emptyExtensions();
    }
  }
  if (!isObj(obj)) return emptyExtensions();

  const causality = dedupeBy(
    asArray((obj as any).causality).map(normalizeSeed).filter((s): s is CausalitySeed => !!s),
    (s) => s.id
  )
    // 超上限时优先保留未兑现的（它们还要在后续兑现），其次保留较新的
    .sort((a, b) => Number(a.triggered) - Number(b.triggered) || b.plantedRound - a.plantedRound)
    .slice(0, EXT_CAPS.causality)
    // 落库顺序按种下轮次升序，读起来像一条时间线
    .sort((a, b) => a.plantedRound - b.plantedRound);

  const declaredFacts = dedupeBy(
    asArray((obj as any).declaredFacts).map(normalizeFact).filter((f): f is DeclaredFact => !!f),
    (f) => f.id
  )
    .sort((a, b) => a.declaredRound - b.declaredRound)
    .slice(-EXT_CAPS.declaredFacts);

  const goals = dedupeBy(
    asArray((obj as any).goals).map(normalizeGoal).filter((g): g is PlayerGoal => !!g),
    (g) => g.id
  )
    .sort((a, b) => a.createdRound - b.createdRound)
    .slice(-EXT_CAPS.goals);

  return { causality, declaredFacts, goals };
}

/** 序列化回数据库列（只存三件套，不夹带其它键） */
export function serializeExtensions(ext: GameExtensions): GameExtensions {
  return {
    causality: ext.causality || [],
    declaredFacts: ext.declaredFacts || [],
    goals: ext.goals || [],
  };
}

/**
 * 只取因果种子（给 loadGameContext 合并 saga 跨章种子用）。
 * 注意：`GameSaga.causality` 存的是**裸数组**，而 `GameSession.extensions` 存的是三件套对象，
 * 两种形态都要认——只认一种就会让跨章因果悄悄丢失（而且不会报错，最难查）。
 */
export function causalityOnly(raw: unknown): CausalitySeed[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (Array.isArray(v)) return parseExtensions({ causality: v }).causality;
  return parseExtensions(v).causality;
}
