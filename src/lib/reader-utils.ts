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
