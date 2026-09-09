/**
 * 游戏模式页面：类型定义（原 game/[nodeId]/page.tsx 顶部段）
 */

import type { GameOption, GameEntity, GameItem } from "@/core/game/types";

export interface GameState {
  sessionId: string | null;
  status: "loading" | "ready" | "playing" | "generating" | "ending" | "ended";
  currentRound: number;
  totalWords: number;
  plotProgress: number;
  narrative: string;           // 全部累积正文
  lastNarrative: string;       // 最后一轮叙事（流式）
  options: GameOption[];
  entities: GameEntity[];
  items: GameItem[];
  bookName: string;
  chapterTitle: string;
  error: string | null;
  exportStatus: string | null;   // 导出轻确认结果（v0.46.94+）：confirmed / drafting
  exportQuality: number | null;  // 导出时质量分（确认看板可见）
}

export interface TurnRecord {
  round: number;
  playerAction: string;
  narrative: string;
  actionType?: string; // 操作类型徽标（开始/观察/对话/战斗/探索/使用物品/休息/选项/自定义）
}
