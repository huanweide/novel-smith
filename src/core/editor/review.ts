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
  buildLocatePrompt,
  parseLocateJson,
  type LocatePatch,
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

/**
 * 定位「要改的那一小段原文」——为局部替换提供锚点。
 *
 * 不重写全文，只让模型指出 anchor（正文逐字片段）+ replacement（替换文本），
 * 交由 applyPatches 做精确子串替换。失败（模型没给出可用锚点）返回空数组，
 * 由调用方决定是否回退整章改写。
 */
export async function runEditorLocate(opts: {
  content: string;
  suggestions: Array<{ location?: string; issue?: string; suggestion?: string; rewriteHint?: string }>;
  temperature?: number;
}): Promise<LocatePatch[]> {
  const user = buildLocatePrompt(opts.content, opts.suggestions);
  // 长文 + 多建议时，返回的 patches JSON 可能较长；预算随正文长度动态放大，避免被截断后整体回退整章重写
  const maxTokens = Math.min(6000, Math.max(3000, Math.ceil((opts.content.length || 1000) * 0.6)));
  const raw = await completeText(
    "你是精准改写执行编辑：只定位需要改动的那一小段原文并给出替换文本，严禁重写全文、严禁输出正文之外的任何内容。",
    user,
    {
      json: true,
      role: "editor-locate",
      temperature: opts.temperature ?? 0.3,
      maxTokens,
    },
  );
  return parseLocateJson(raw);
}

export type { ReviewChapterInput, ReviewResult, ReviewSuggestion };
