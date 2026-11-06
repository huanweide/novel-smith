/**
 * POST /api/generate/refine 的意图判定（纯函数，可单测）。
 *
 * 落库模式三选一，优先级从高到低：
 *  1. 局部替换（hasSelectedText）——用户选中了文字，改它或在它之后接续，锚点来自真实选区。
 *  2. 增量续写（isContinuationIntent）——没选中、指令是纯续写类，模型只吐增量，路由层拼回原正文末尾。
 *  3. 全文重输出——其余情况。
 *
 * 历史缺陷（2026-11-06 真机实锤）：旧判定让 isContinuationIntent 排在 hasSelectedText 之前，
 * 悬浮工具条「续写」按钮的预设指令含「续写」二字 → 落到增量追加分支 →
 * 模型输出里复述了选中段，整段被拼到章末，落库出现「选中段重复 + 新内容位置错乱」。
 * 核心不变量：**只要锚点来自用户真实选区，就绝不落到增量追加。**
 */
const CONTINUATION_RE =
  /(继续写|续写|接着写|往下写|补\s*\d*\s*字|加\s*\d*\s*字|延长|展开|后续|推进剧情|往下)/;

export interface RefineIntent {
  isTargetedFix: boolean;
  hasSelectedText: boolean;
  isContinuationIntent: boolean;
}

export function resolveRefineIntent(params: {
  hasContent: boolean;
  instruction: string;
  selectedText?: string | null;
}): RefineIntent {
  const isTargetedFix = params.hasContent && params.instruction.includes("精准修复");
  const hasSelectedText = !!(params.selectedText && params.selectedText.trim());
  // 选中即改优先：有选区时不认「续写」意图，避免增量追加把内容拼到全文末尾。
  const isContinuationIntent =
    params.hasContent &&
    !isTargetedFix &&
    !hasSelectedText &&
    CONTINUATION_RE.test(params.instruction);

  return { isTargetedFix, hasSelectedText, isContinuationIntent };
}
