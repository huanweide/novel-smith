/**
 * 模拟编辑审稿 —— 调 LLM 的执行层
 *
 * 纯逻辑层（prompts.ts）只负责拼装与解析，本文件负责真正发起 LLM 调用：
 * - runEditorReview：调 completeText(json) 拿结构化一审意见
 * - runEditorApply：调 completeText 按意见改写单章正文
 *
 * 两个函数都走 @/core/llm/client 的 completeText，自动读取用户在设置页配置的模型/Key，
 * 不硬编码任何供应商信息。
 */

import { completeText } from "@/core/llm/client";
import {
  buildReviewUserPrompt,
  parseReviewJson,
  buildPromptForTune,
  buildApplySystem,
  buildApplyUserPrompt,
  type ReviewChapterInput,
  type ReviewResult,
  type ReviewSuggestion,
} from "./prompts";

export async function runEditorReview(opts: {
  chapters: ReviewChapterInput[];
  roleId: string;
  systemPrompt: string;
  temperature?: number;
}): Promise<ReviewResult> {
  if (!opts.chapters.length) {
    throw new Error("没有可审的章节（请先确保项目里有带正文的内容）");
  }
  const userPrompt = buildReviewUserPrompt(opts.chapters);
  const raw = await completeText(opts.systemPrompt, userPrompt, {
    json: true,
    role: "editor-review",
    temperature: opts.temperature ?? 0.4,
    maxTokens: 5000,
  });
  const parsed = parseReviewJson(raw, opts.chapters);
  const promptForTune = buildPromptForTune(parsed.suggestions);
  return { ...parsed, promptForTune };
}

export async function runEditorApply(opts: {
  content: string;
  suggestions: Array<{ location?: string; issue?: string; suggestion?: string; rewriteHint?: string }>;
  systemPrompt?: string;
  temperature?: number;
}): Promise<string> {
  const system = opts.systemPrompt || buildApplySystem();
  const user = buildApplyUserPrompt(opts.content, opts.suggestions);
  const maxTokens = Math.min(8000, Math.max(2000, Math.ceil((opts.content.length || 1000) * 1.6)));
  const raw = await completeText(system, user, {
    role: "editor-apply",
    temperature: opts.temperature ?? 0.6,
    maxTokens,
  });
  return raw.trim();
}

export type { ReviewChapterInput, ReviewResult, ReviewSuggestion };
