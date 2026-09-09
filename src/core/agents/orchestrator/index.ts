/**
 * orchestrator 模块出口。
 * 原单文件 orchestrator.ts（1591 行）已拆分为：
 *   - prompts.ts        提示词模板
 *   - review-parser.ts  审校响应解析
 *   - summary-parser.ts 章节摘要解析
 *   - prompt-context.ts PromptContext 装配（最大块 ~970 行）
 *   - agent.ts          调度器主类
 * 对外导出符号与行为完全不变。
 */

export { SYSTEM_PROMPTS } from "./prompts";
export { parseReviewResponse, validateIssueType, validateSeverity } from "./review-parser";
export { parseSummaryResponse } from "./summary-parser";
export type { ChapterSummaryParseResult } from "./summary-parser";
export { buildPromptContext } from "./prompt-context";
export { AgentOrchestrator } from "./agent";
