// 宝宝流召回服务（剧情推进 = 记忆召回）
//
// 原理：根据当前正文/上下文，AI 筛总结 + 世界书「绿灯(关键词)机制」+ 用户输入 → 发正文 AI。
// 文档原话：默认不提供真正的剧情规划功能——它管"该注入哪段设定"，不替作者写走向。
//
// 本文件实现"召回"：从世界书(LorebookEntry.keys=绿灯关键词)与结构化表格(LoreTable 行)中，
// 匹配当前上下文命中的条目，返回应注入正文 AI 的记忆片段。
//
// v0.46.63 升级：改用词边界匹配（src/core/text/match），灭掉「林」误命中「森林」这类瞎匹配；
// 并对同一词条/行的命中关键词做「最长匹配优先」去重。

import { asArray } from "@/lib/utils";
import { dedupSubstring, scoreKeyword, matchNameStrict } from "@/core/text/match";
import { acceptSemanticCandidate } from "@/core/memory/hybrid-score";

export interface RecallItem {
  source: "lorebook" | "table";
  title: string;
  content: string;
  /** 命中关键词的特异性打分（关键词长度），用于按价值排序截断 */
  score: number;
}

// 表格行的"关键列"——这些列的值出现在上下文里即视为命中召回
const TABLE_KEY_COLS = ["name", "title", "key", "live", "place", "building", "type", "status"];

/**
 * 语义召回的可选增强项。
 *
 * 为什么设计成「调用方先算好相似度再传进来」，而不是传一个 async 函数：
 *   recallContext 是**同步纯函数**，150+ 条既有测试依赖这个性质。
 *   若在此处 await 一次 embedding，整条调用链（recall 路由 / 大纲生成 / babylore loop）
 *   都要改成 async，属于破坏性变更，收益不匹配。
 *
 * 于是责任划分：调用方负责 await 拿到相似度（并决定要不要付这次网络成本），
 * 本函数只负责「把达标的语义候选并入结果」，仍是同步的。
 *
 * 不传 = 纯关键词召回，行为与本次改动前完全一致。
 */
export interface SemanticHints {
  /** 与 candidates 等长、同序。null = 该条未向量化（不可比，不代表不相关） */
  similarities: Array<number | null>;
  /** 未命中关键词的候选条目 */
  candidates: Array<{ source: "lorebook" | "table"; title: string; content: string }>;
}

export function recallContext(
  contextText: string,
  lorebook: Array<{ title: string; content: string; keys: string[]; enabled?: boolean }>,
  tables: Array<{ name: string; columns: any[]; rows: any[] }>,
  semantic?: SemanticHints,
): RecallItem[] {
  const text = contextText || "";
  const items: RecallItem[] = [];

  // Round6 P0-1：候选实体名集合（已知更长名优先吞并短名），供 matchNameStrict 最长匹配使用。
  const knownNames: string[] = [];
  for (const e of lorebook) {
    if (e.enabled === false) continue;
    for (const k of asArray<string>(e.keys)) if (k) knownNames.push(k);
  }
  for (const t of tables) {
    const rows: any[] = t.rows || [];
    const cols: any[] = t.columns || [];
    const keyCols = cols.length ? cols.map((c) => c.key) : TABLE_KEY_COLS;
    for (const r of rows) {
      for (const kc of keyCols) {
        const v = r[kc];
        if (v && typeof v === "string" && v.length >= 2) knownNames.push(v);
      }
    }
  }

  // 1) 世界书：绿灯机制——enabled 且任一关键词「真实命中」上下文
  for (const e of lorebook) {
    if (e.enabled === false) continue;
    const keys: string[] = e.keys || [];
    const hitKeys = keys.filter((k) => k && matchNameStrict(text, k, { knownNames }));
    if (hitKeys.length === 0) continue;
    // 最长匹配优先：被更长命中关键词包含的短词剔除（如「青龙」被「青龙镇」包含）
    const kept = dedupSubstring(hitKeys);
    const score = kept.reduce((m, k) => Math.max(m, scoreKeyword(k)), 0);
    items.push({ source: "lorebook", title: e.title, content: e.content, score });
  }

  // 2) 结构化表格：行的关键列值「真实命中」上下文即召回
  for (const t of tables) {
    const rows: any[] = t.rows || [];
    const cols: any[] = t.columns || [];
    const keyCols = cols.length ? cols.map((c) => c.key) : TABLE_KEY_COLS;
    for (const r of rows) {
      const hitKeys: string[] = [];
      for (const kc of keyCols) {
        const v = r[kc];
        if (v && typeof v === "string" && v.length >= 2 && matchNameStrict(text, v, { knownNames })) {
          hitKeys.push(v);
        }
      }
      if (hitKeys.length === 0) continue;
      // 最长匹配优先
      const kept = dedupSubstring(hitKeys);
      const score = kept.reduce((m, k) => Math.max(m, scoreKeyword(k)), 0);
      const vals = (cols.length ? cols : []).map((c) => `${c.label}:${r[c.key] ?? ""}`).join("，");
      items.push({
        source: "table",
        title: t.name,
        content: vals || JSON.stringify(r),
        score,
      });
    }
  }

  // 3) 语义兜底：关键词一个都没命中、但意思确实像的条目也补进来。
  //    只补未命中关键词的——已命中的走上面的关键词分，不重复计分。
  //    任何脏数据（长度不一致 / null / 非数）都跳过，绝不影响前两步的结果。
  if (
    semantic &&
    Array.isArray(semantic.candidates) &&
    Array.isArray(semantic.similarities) &&
    semantic.candidates.length === semantic.similarities.length
  ) {
    const hitTitles = new Set(items.map((i) => i.title));
    for (let i = 0; i < semantic.candidates.length; i++) {
      const cand = semantic.candidates[i];
      if (!cand) continue;
      if (hitTitles.has(cand.title)) continue; // 已在关键词召回里，不重复

      const sim = semantic.similarities[i];
      if (sim == null || !Number.isFinite(sim)) continue; // 未向量化，不是不相关

      const accepted = acceptSemanticCandidate({
        source: cand.source,
        title: cand.title,
        content: cand.content,
        similarity: sim,
      });
      if (accepted) items.push(accepted);
    }
  }

  return items;
}
