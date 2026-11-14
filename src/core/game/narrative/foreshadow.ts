/**
 * 伏笔机 · 五状态 + 确定性回收判定
 *
 * 抄 `src/core/foreshadowing.ts` 的判定规则（:281-290），抽掉 prisma 改成纯函数：
 *   · 闭环条件命中 > 0，或中文短语种子命中 ≥ 2 → fulfilled / ratio 1.0
 *   · 短语命中 1 且当前 pending/detected → partially_fulfilled / ratio 0.5
 *   · 未命中 → 维持原状，**绝不把已 fulfilled 降级**
 *   · 只扫埋设轮之后的正文，排除埋设轮自身（防自埋自收假阳性）
 *
 * 抄 `PendingCommitment.statusHistory` 审计链：每次流转都记「从哪到哪、因为什么、第几轮」。
 *
 * 协同点：因果种子（saga.causality）种下时自动登记为 pending 伏笔；
 *        种子兑现时反查 linkedSeedId 销账，并喂一条 MILESTONE 进故事线。
 *
 * 纯函数，零 LLM —— 不靠模型猜「这条伏笔收了没」，只认确定性字符串命中。
 */

import type { CausalitySeed } from "../types";
import type { SagaCommitment, SagaCommitmentStatus, NarrativeLedger, SagaStatusHistoryEntry } from "./types";

/** 从描述里抽「中文短语种子」：连续 3 字以上中文，去重。抄 foreshadowing.ts:139-165 */
export function extractPhraseSeeds(description: string): string[] {
  const m = (description || "").match(/[\u4e00-\u9fa5]{3,}/g) || [];
  return Array.from(new Set(m.map((s) => s.trim()).filter(Boolean))).slice(0, 12);
}

/** 闭环条件归一：支持字符串数组 / 含 text 字段的对象数组 / 纯字符串（抄 extractSeeds） */
export function normalizeClosureConditions(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((c) => {
      if (typeof c === "string") return c.trim();
      if (c && typeof c === "object") {
        const o = c as Record<string, unknown>;
        return String(o.text ?? o.value ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 12);
}

function hist(
  from: SagaStatusHistoryEntry["from"],
  to: SagaCommitmentStatus,
  trigger: string,
  round: number,
  details: string,
): SagaStatusHistoryEntry {
  return { from, to, trigger, round, details };
}

/** 一条伏笔在给定文本里的命中结果（导出便于单测逐条断言） */
export interface PayoffMatch {
  matchedClosure: number;
  matchedPhrase: number;
  matchedTerms: string[];
}

export function matchPayoff(c: SagaCommitment, text: string): PayoffMatch {
  const body = text || "";
  const closure = (c.closureConditions || []).filter((s) => s && body.includes(s));
  const seeds = extractPhraseSeeds(c.description);
  const phrase = seeds.filter((s) => body.includes(s));
  return {
    matchedClosure: closure.length,
    matchedPhrase: phrase.length,
    matchedTerms: Array.from(new Set([...closure, ...phrase])),
  };
}

/**
 * 本轮正文对所有未收束伏笔做回收判定。
 * 返回新数组（不改入参）与「本轮刚收的」清单（供浮体与故事线用）。
 */
export function detectPayoffs(
  commitments: SagaCommitment[],
  text: string,
  round: number,
): { commitments: SagaCommitment[]; recovered: SagaCommitment[] } {
  const recovered: SagaCommitment[] = [];
  const next = (commitments || []).map((c) => {
    if (c.status === "fulfilled" || c.status === "voided") return c;
    // 埋设轮自身不参与检测（防自埋自收）
    if (round <= c.plantedRound) return c;
    const m = matchPayoff(c, text);
    let status: SagaCommitmentStatus = c.status;
    let ratio = c.ratio;
    if (m.matchedClosure > 0 || m.matchedPhrase >= 2) {
      status = "fulfilled";
      ratio = 1;
    } else if (m.matchedPhrase === 1 && (c.status === "pending" || c.status === "detected")) {
      status = "partially_fulfilled";
      ratio = 0.5;
    }
    if (status === c.status && ratio === c.ratio) return c;
    const updated: SagaCommitment = {
      ...c,
      status,
      ratio,
      statusHistory: [
        ...(c.statusHistory || []),
        hist(c.status, status, "text_match", round, `命中：${m.matchedTerms.join("、") || "—"}`),
      ],
      ...(status === "fulfilled"
        ? { fulfilledRound: round, snippet: (text || "").slice(0, 160) }
        : {}),
      ...(status === "partially_fulfilled" && c.detectedRound === undefined
        ? { detectedRound: round }
        : {}),
    };
    if (status === "fulfilled") recovered.push(updated);
    return updated;
  });
  return { commitments: next, recovered };
}

/** 从一颗因果种子登记一条伏笔（协同：因果页签与伏笔机同源） */
export function commitmentFromSeed(seed: CausalitySeed, round: number): SagaCommitment {
  const desc = `${seed.type}：关于「${seed.subject}」，${seed.description}`;
  return {
    id: `cm_seed_${seed.id}`,
    description: desc.slice(0, 300),
    source: "causality",
    priority: seed.type === "仇怨" || seed.type === "誓言" ? "high" : "medium",
    status: "pending",
    ratio: 0,
    closureConditions: [seed.subject, ...extractPhraseSeeds(seed.description).slice(0, 2)],
    entityIds: seed.subject ? [seed.subject] : [],
    statusHistory: [hist("none", "pending", "causality_seed", round, `因果种子种下：${seed.type}`)],
    plantedRound: round,
    linkedSeedId: seed.id,
  };
}

/** 把新种下的因果种子并进伏笔账（按 linkedSeedId 去重，不重复登记） */
export function plantFromSeeds(
  commitments: SagaCommitment[],
  seeds: CausalitySeed[],
  round: number,
): { commitments: SagaCommitment[]; added: SagaCommitment[] } {
  const existing = new Set((commitments || []).map((c) => c.linkedSeedId).filter(Boolean));
  const added: SagaCommitment[] = [];
  for (const s of seeds || []) {
    if (!s?.id || existing.has(s.id)) continue;
    const c = commitmentFromSeed(s, round);
    added.push(c);
    existing.add(s.id);
  }
  return { commitments: [...(commitments || []), ...added], added };
}

/** 因果种子被显式兑现 → 对应伏笔销账（协同） */
export function fulfillBySeeds(
  commitments: SagaCommitment[],
  seedIds: string[],
  round: number,
  snippet?: string,
): { commitments: SagaCommitment[]; recovered: SagaCommitment[] } {
  const ids = new Set(seedIds || []);
  if (ids.size === 0) return { commitments, recovered: [] };
  const recovered: SagaCommitment[] = [];
  const next = (commitments || []).map((c) => {
    if (!c.linkedSeedId || !ids.has(c.linkedSeedId)) return c;
    if (c.status === "fulfilled" || c.status === "voided") return c;
    const updated: SagaCommitment = {
      ...c,
      status: "fulfilled",
      ratio: 1,
      fulfilledRound: round,
      ...(snippet ? { snippet: snippet.slice(0, 160) } : {}),
      statusHistory: [
        ...(c.statusHistory || []),
        hist(c.status, "fulfilled", "causality_done", round, "关联因果种子已兑现"),
      ],
    };
    recovered.push(updated);
    return updated;
  });
  return { commitments: next, recovered };
}

/** 玩家/API 手动改状态（带白名单 + 审计链） */
export function setCommitmentStatus(
  commitments: SagaCommitment[],
  id: string,
  status: SagaCommitmentStatus,
  round: number,
  reason?: string,
): SagaCommitment[] {
  return (commitments || []).map((c) => {
    if (c.id !== id || c.status === status) return c;
    return {
      ...c,
      status,
      ratio: status === "fulfilled" ? 1 : status === "partially_fulfilled" ? 0.5 : 0,
      ...(status === "fulfilled" ? { fulfilledRound: round } : {}),
      ...(status === "voided" ? { voidedRound: round, ...(reason ? { voidReason: reason.slice(0, 200) } : {}) } : {}),
      statusHistory: [
        ...(c.statusHistory || []),
        hist(c.status, status, "manual", round, reason || "玩家手动调整"),
      ],
    };
  });
}

/** 收束率：抄 foreshadowing.ts 的公式 (fulfilled + 0.5*partial) / active */
export interface PayoffStats {
  total: number;
  active: number;
  pending: number;
  partial: number;
  fulfilled: number;
  voided: number;
  payoffRate: number;
  avgRatio: number;
}

export function computePayoffStats(commitments: SagaCommitment[]): PayoffStats {
  const list = commitments || [];
  const fulfilled = list.filter((c) => c.status === "fulfilled").length;
  const partial = list.filter((c) => c.status === "partially_fulfilled").length;
  const voided = list.filter((c) => c.status === "voided").length;
  const pending = list.filter((c) => c.status === "pending" || c.status === "detected").length;
  const active = list.filter((c) => c.status !== "voided").length;
  return {
    total: list.length,
    active,
    pending,
    partial,
    fulfilled,
    voided,
    payoffRate: active > 0 ? (fulfilled + 0.5 * partial) / active : 0,
    avgRatio: active > 0 ? list.reduce((s, c) => s + (c.status === "voided" ? 0 : c.ratio), 0) / active : 0,
  };
}

/**
 * 玩家手动埋一条伏笔（填表系统：不是只有引擎能自动登记）。
 * 与 commitmentFromSeed 的区别：source=player、闭环条件由玩家自己写。
 * id 按描述确定性生成，重复点同一句不会埋两条。
 */
export function createCommitment(
  commitments: SagaCommitment[],
  input: {
    description: string;
    priority?: "high" | "medium" | "low";
    closureConditions?: string[];
    round: number;
  },
): { commitments: SagaCommitment[]; added: SagaCommitment | null } {
  const description = (input.description || "").trim().slice(0, 300);
  if (description.length < 2) return { commitments: commitments || [], added: null };
  let h = 0;
  for (let i = 0; i < description.length; i++) h = (h * 31 + description.charCodeAt(i)) | 0;
  const id = `cm_player_${(h >>> 0).toString(36)}`;
  if ((commitments || []).some((c) => c.id === id)) return { commitments, added: null };
  const c: SagaCommitment = {
    id,
    description,
    source: "player",
    priority: input.priority === "high" || input.priority === "low" ? input.priority : "medium",
    status: "pending",
    ratio: 0,
    closureConditions: normalizeClosureConditions(input.closureConditions || []),
    entityIds: [],
    statusHistory: [hist("none", "pending", "manual", input.round, "玩家手动埋下")],
    plantedRound: input.round,
  };
  return { commitments: [...(commitments || []), c], added: c };
}

/** 从账本里取待收伏笔（给提示词用，按优先级排序） */
export function activeCommitments(ledger: NarrativeLedger): SagaCommitment[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return (ledger.commitments || [])
    .filter((c) => c.status !== "fulfilled" && c.status !== "voided")
    .sort((a, b) => rank[a.priority] - rank[b.priority] || a.plantedRound - b.plantedRound);
}
