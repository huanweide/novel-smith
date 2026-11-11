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

// ─── 阶段3：整章重掷（roll）───

export interface RefineModeDecision {
  /** 整章重掷：按「重写需求」提示词从头重写全章，允许推翻已有正文 */
  isFullRewrite: boolean;
  /** roll 忽略选区（整章操作，不做局部替换） */
  ignoreSelectedText: boolean;
  /** roll 不走增量续写（不是接着写，是重新写） */
  forceNotContinuation: boolean;
  /** roll 允许新正文比原正文短（不受 L5-06 完整性保护约束） */
  allowShorterOutput: boolean;
}

/**
 * 解析改写模式（纯函数）。
 *
 * 为什么用显式 mode 而不用关键词：「重写 / 重新写 / 换一种写法」在微调指令里很常见
 * （例如「重写这段对话」），靠正则猜会把正常的局部润色误判成整章推翻，属于不可逆的正文损失。
 * 前端按钮传 mode:"roll" 才进入整章重掷，语义唯一、可测、可回滚（有版本快照）。
 */
export function resolveRefineMode(mode?: string | null): RefineModeDecision {
  const isFullRewrite = mode === "roll";
  return {
    isFullRewrite,
    ignoreSelectedText: isFullRewrite,
    forceNotContinuation: isFullRewrite,
    allowShorterOutput: isFullRewrite,
  };
}
