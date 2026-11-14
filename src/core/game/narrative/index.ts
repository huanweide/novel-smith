/**
 * 游戏本叙事系统（移植自小说模式，2026-11-14）
 * 决策表见 docs/internal/游戏本叙事系统移植-决策表.md
 *
 * 五套系统共用一次演算：syncRound → 伏笔 / 故事线 / 世界卡 / 世界线 / 6 阶段。
 */

export * from "./types";
export * from "./ledger";
export * from "./foreshadow";
export * from "./worldcard";
export * from "./storyline";
export * from "./worldline";
export * from "./sync";
export * from "./context";
