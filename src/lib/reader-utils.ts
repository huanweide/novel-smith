// 阅读模式纯逻辑：字号钳制、阅读进度计算、序号/上一章下一章推导。
// 抽成无副作用模块，便于单测，UI 层只负责调。

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 24;
export const DEFAULT_FONT_SIZE = 18;

/** 字号钳制到 [MIN, MAX]，非数字回退默认 */
export function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(px)));
}

/** 阅读进度：滚动位置 / 可滚动距离，落在 [0, 1]；分母为 0（无滚动）返回 0 */
export function computeReadingProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const denom = scrollHeight - clientHeight;
  if (!Number.isFinite(denom) || denom <= 0) return 0;
  const p = (scrollTop || 0) / denom;
  if (!Number.isFinite(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

/** 在有序章节列表里，根据当前 id 算出上/下一章索引（越界返回 -1） */
export function neighborIndices(
  ids: string[],
  currentId: string | null,
): { prev: number; next: number } {
  const idx = ids.findIndex((x) => x === currentId);
  if (idx < 0) return { prev: -1, next: -1 };
  return {
    prev: idx > 0 ? idx - 1 : -1,
    next: idx < ids.length - 1 ? idx + 1 : -1,
  };
}

/** 阅读主题循环顺序 */
export const READER_THEMES = ["default", "night", "sepia"] as const;
export type ReaderTheme = (typeof READER_THEMES)[number];

/** 恢复上次阅读章节：记住的那章还在书里就用它，否则退回第一章 */
export function pickInitialChapterId(
  ids: string[],
  rememberedId: string | null,
): string | null {
  if (!ids.length) return null;
  if (rememberedId && ids.includes(rememberedId)) return rememberedId;
  return ids[0];
}

/** 主题按顺序循环（不在列表里则回到默认），用于「切换阅读主题」按钮 */
export function cycleTheme(current: string): ReaderTheme {
  const idx = READER_THEMES.indexOf(current as ReaderTheme);
  return READER_THEMES[(idx + 1) % READER_THEMES.length];
}

/** 阅读主题 → 展示名 */
export const READER_THEME_LABEL: Record<ReaderTheme, string> = {
  default: "跟随主题",
  night: "夜间",
  sepia: "纸感",
};
