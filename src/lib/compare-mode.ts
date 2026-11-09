/**
 * 对比模式（Compare Mode）—— 生成结果「二选一保留」的统一判定与统计
 *
 * 背景：任何生成操作（正文生成 / 精修 / 续写 / 游戏模式导出）如果目标章节**已有内容**，
 * 直接落库覆盖会让作者无从察觉、丢掉原稿。
 *
 * 统一规则（全站唯一判据，避免各处各写一套）：
 *   - 原有内容**非空** 且 新内容**非空** → 进入左右对比界面，由作者选择保留哪一边；
 *   - 原有内容为空（首次生成）→ 直接采用新内容，不做对比（无对照物）。
 *
 * 本模块纯函数、零依赖，可被客户端组件与服务端安全引用。
 */

export type CompareSide = "original" | "new";

export interface ContentStats {
  /** 字符数（含空白） */
  chars: number;
  /** 非空段落数 */
  paragraphs: number;
}

function norm(text: string | null | undefined): string {
  return (text ?? "").trim();
}

/**
 * 统一判定：这次生成是否需要进入「左右对比模式」。
 *
 * @param originalContent 生成前该章节的原有内容
 * @param newContent      本次生成产出的新内容
 */
export function shouldEnterCompare(
  originalContent: string | null | undefined,
  newContent: string | null | undefined
): boolean {
  return norm(originalContent).length > 0 && norm(newContent).length > 0;
}

/** 统计正文字数与段落数（用于对比界面两侧的元信息） */
export function contentStats(text: string | null | undefined): ContentStats {
  const raw = text ?? "";
  const trimmed = raw.trim();
  return {
    chars: raw.length,
    paragraphs: trimmed ? trimmed.split(/\n+/).filter((p) => p.trim().length > 0).length : 0,
  };
}

/**
 * 描述「原有 → 新」的字数变化，如「字数 +866（+70%）」「字数不变」。
 * 百分比基于原有字数；原有为 0 时只给绝对增量。
 */
export function describeDelta(
  original: string | null | undefined,
  next: string | null | undefined
): string {
  const a = (original ?? "").length;
  const b = (next ?? "").length;
  const d = b - a;
  if (d === 0) return "字数不变";
  const sign = d > 0 ? "+" : "−";
  const abs = Math.abs(d);
  if (a === 0) return `字数 ${sign}${abs}`;
  const pct = Math.round((d / a) * 100);
  return `字数 ${sign}${abs}（${sign}${Math.abs(pct)}%）`;
}

/** 展示用标签 */
export const COMPARE_SIDE_LABEL: Record<CompareSide, string> = {
  original: "原有内容",
  new: "新生成内容",
};

/** 生成模式 → 对比界面标题标签 */
export const COMPARE_MODE_LABEL: Record<string, string> = {
  write: "正文生成",
  refine: "精修",
  continue: "续写",
  game: "游戏模式导出",
  outline: "章纲生成",
};

/** 取模式标签，未知模式兜底为「正文生成」 */
export function compareModeLabel(mode: string | null | undefined): string {
  return COMPARE_MODE_LABEL[(mode ?? "").toLowerCase()] || "正文生成";
}
