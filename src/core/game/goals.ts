/**
 * 玩家自定义目标（R9 自由度扩展）—— 纯函数，零运行时依赖
 *
 * 设计意图（对标《鬼谷八荒》"无固定主线·玩家自定义成长路径"）：
 *   原游戏模式只有一个 plotProgress 百分比，玩家没有"我要成为 X"的方向驱动。
 *   这里让玩家自由设定目标（成为剑圣 / 找到失踪的妹妹 / 查清身世），
 *   引擎注入提示词作为"非强制"方向参考——AI 可朝目标推进，也可随玩家行动自由偏移，
 *   目标是否完成由玩家判定。打破"唯一主线"的轨道化。
 *
 * 纯函数：增 / 删 / 切换完成 / 渲染提示词，全部无副作用、可单测。
 */

import type { PlayerGoal } from "./types";

export const GOAL_MAX_LEN = 200;

/** 新增一个目标（去重、限长；返回新数组与可能的错误） */
export function addGoal(
  goals: PlayerGoal[],
  text: string,
  round: number
): { goals: PlayerGoal[]; error?: string } {
  const clean = (text || "").trim();
  if (!clean) return { goals: goals || [], error: "目标内容不能为空" };
  if (clean.length > GOAL_MAX_LEN) {
    return {
      goals: goals || [],
      error: `目标过长，请控制在 ${GOAL_MAX_LEN} 字内`,
    };
  }
  const exists = (goals || []).find((g) => g.text === clean);
  if (exists) return { goals: goals || [], error: "该目标已存在" };
  const newGoal: PlayerGoal = {
    id: `g_${round}_${Date.now().toString(36)}`,
    text: clean,
    createdRound: round,
    done: false,
  };
  return { goals: [...(goals || []), newGoal] };
}

/** 删除一个目标（按 id） */
export function removeGoal(goals: PlayerGoal[], id: string): PlayerGoal[] {
  if (!Array.isArray(goals)) return [];
  return goals.filter((g) => g.id !== id);
}

/** 切换/设定目标完成状态（done 不传则取反） */
export function toggleGoalDone(
  goals: PlayerGoal[],
  id: string,
  done?: boolean
): PlayerGoal[] {
  if (!Array.isArray(goals)) return [];
  return goals.map((g) =>
    g.id === id ? { ...g, done: done === undefined ? !g.done : done } : g
  );
}

/**
 * 渲染"玩家自定义目标"提示词块。
 * 措辞要点：非强制主线、AI 可自然推进也可自由偏移、完成由玩家判定。
 */
export function buildGoalsContext(goals: PlayerGoal[]): string {
  if (!goals || goals.length === 0) return "";
  const lines: string[] = [
    "## 玩家的自由目标（非强制主线，仅供参考方向）",
  ];
  for (const g of goals) {
    lines.push(`- [${g.done ? "x" : " "}] ${g.text}`);
  }
  lines.push(
    "（玩家没有强制主线。你可以朝这些目标自然推进，也可以随玩家行动自由偏移；目标是否完成由玩家自己判定。）"
  );
  return lines.join("\n");
}
