/**
 * 玩家声明事实（R9 自由度扩展）—— 纯函数，零运行时依赖
 *
 * 设计意图（对标 FATE Core 的 "declare a story detail" 共享叙事权威）：
 *   跑团里玩家可花命运点直接向共享虚构添加新事实；普通游戏里玩家只能"尝试行动"，
 *   永远没有作者权。这里让玩家直接确立一条世界事实，引擎将其视为既定真相注入后续所有提示词，
 *   使 AI 不可违背——这是"自由度高于跑团"的核心论证之一。
 *
 * 纯函数：校验 / 增 / 删 / 渲染提示词，全部无副作用、可单测。
 */

import type { DeclaredFact } from "./types";

export const DECLARE_MAX_LEN = 200;

export interface DeclareValidation {
  ok: boolean;
  reason?: string;
  clean?: string;
}

/** 校验玩家声明内容：非空、长度合理、不含输出标记（防注入破坏解析） */
export function validateDeclaredFact(text: string): DeclareValidation {
  if (!text || typeof text !== "string") {
    return { ok: false, reason: "声明内容不能为空" };
  }
  const clean = text.trim();
  if (clean.length < 2) {
    return { ok: false, reason: "声明内容太短，至少 2 个字" };
  }
  if (clean.length > DECLARE_MAX_LEN) {
    return {
      ok: false,
      reason: `声明内容过长，请控制在 ${DECLARE_MAX_LEN} 字内`,
    };
  }
  // 禁止夹带 AI 输出标记，避免玩家借声明污染解析流程
  if (/={3,}|NE\s*\|/i.test(clean)) {
    return { ok: false, reason: "声明不能包含输出标记（如 === / NE|）" };
  }
  return { ok: true, clean };
}

/** 新增一条声明（校验通过才加，返回新数组，不改入参） */
export function addDeclaredFact(
  facts: DeclaredFact[],
  text: string,
  round: number
): { facts: DeclaredFact[]; error?: string } {
  const v = validateDeclaredFact(text);
  if (!v.ok || !v.clean) {
    return { facts: facts || [], error: v.reason };
  }
  const newFact: DeclaredFact = {
    id: `df_${round}_${Date.now().toString(36)}`,
    text: v.clean,
    declaredRound: round,
  };
  return { facts: [...(facts || []), newFact] };
}

/** 删除一条声明（按 id） */
export function removeDeclaredFact(
  facts: DeclaredFact[],
  id: string
): DeclaredFact[] {
  if (!Array.isArray(facts)) return [];
  return facts.filter((f) => f.id !== id);
}

/**
 * 渲染"玩家确立的世界事实"提示词块。
 * 关键措辞：必须视为既定真相、不可违背——赋予玩家作者权。
 */
export function buildDeclaredFactsContext(facts: DeclaredFact[]): string {
  if (!facts || facts.length === 0) return "";
  const lines: string[] = [
    "## 玩家确立的世界事实（必须视为既定真相，不可违背）",
  ];
  for (const f of facts) {
    lines.push(`- ${f.text}`);
  }
  lines.push(
    "（以上由玩家声明，具有叙事权威性；任何新生成内容都必须与之一致，不得质疑或推翻。）"
  );
  return lines.join("\n");
}
