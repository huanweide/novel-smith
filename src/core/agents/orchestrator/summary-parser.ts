/**
 * 章节摘要响应解析（原 AgentOrchestrator 私有方法 parseSummaryResponse）
 * 纯函数：不依赖实例状态，可独立测试。
 */

import { safeParseAIJson } from "@/lib/json-parser";

export interface ChapterSummaryParseResult {
  summary: string;
  keyEvents: string[];
  characterStates: string;
  closingSnapshot: string;
  characterImpulses: Array<{ name: string; impulse: string }>;
  threadProgress: Array<{ storylineId: string; stage: string; progressNote: string }>;
  unresolvedQuestions: string[];
  impactScore: number;
  chapterTitle: string;
}

/**
 * 解析章节摘要 Agent 的返回（正则 + 末尾 json 代码块双通道）。
 */
export function parseSummaryResponse(response: string): ChapterSummaryParseResult {
    const summaryMatch = response.match(/摘要[：:]\s*(.+)/);
    const eventsMatch = response.match(/关键事件[：:]\s*\n([\s\S]*?)(?=\n角色状态|$)/);
    const statesMatch = response.match(/角色状态[：:]\s*(.+)/);
    const moodMatch = response.match(/章末氛围[：:]\s*(.+)/);
    const impulsesMatch = response.match(/角色脉搏[：:]\s*\n([\s\S]*?)$/);

    const keyEvents = eventsMatch
      ? eventsMatch[1]
          .split("\n")
          .map((l) => l.replace(/^[-\s]*/, "").trim())
          .filter(Boolean)
      : [];

    // 解析角色脉搏：每行 "- 角色名：冲动描述"
    const characterImpulses: Array<{ name: string; impulse: string }> = [];
    if (impulsesMatch) {
      const lines = impulsesMatch[1].split("\n");
      for (const line of lines) {
        const m = line.match(/^-\s*([^：:]+)[：:]\s*(.+)/);
        if (m) {
          characterImpulses.push({ name: m[1].trim(), impulse: m[2].trim() });
        }
      }
    }

    const closingSnapshot = moodMatch?.[1]?.trim() || "";

    // 解析附加 JSON 字段（threadProgress / unresolvedQuestions / impactScore）
    let threadProgress: Array<{ storylineId: string; stage: string; progressNote: string }> = [];
    let unresolvedQuestions: string[] = [];
    let impactScore = 5;
    let chapterTitle = ""; // v2.43.0：解析 LLM 摘要里的专用短章名

    // 1) 优先匹配末尾的 ```json 代码块
    const jsonBlockRegex = /```json\s*([\s\S]*?)```/g;
    let jsonMatch: RegExpExecArray | null;
    let lastJsonStr = "";
    while ((jsonMatch = jsonBlockRegex.exec(response)) !== null) {
      lastJsonStr = jsonMatch[1].trim();
    }
    if (lastJsonStr) {
      const parsed = safeParseAIJson(lastJsonStr) as any;
      if (parsed && !Array.isArray(parsed)) {
        if (Array.isArray(parsed.threadProgress)) threadProgress = parsed.threadProgress;
        if (Array.isArray(parsed.unresolvedQuestions)) unresolvedQuestions = parsed.unresolvedQuestions;
        if (typeof parsed.impactScore === "number") impactScore = parsed.impactScore;
        if (typeof parsed.chapterTitle === "string") chapterTitle = parsed.chapterTitle;
      }
    } else {
      // 2) 回退：尝试从响应整体提取 JSON 对象
      const fallback = safeParseAIJson(response) as any;
      if (fallback && !Array.isArray(fallback)) {
        if (Array.isArray(fallback.threadProgress)) threadProgress = fallback.threadProgress;
        if (Array.isArray(fallback.unresolvedQuestions)) unresolvedQuestions = fallback.unresolvedQuestions;
        if (typeof fallback.impactScore === "number") impactScore = fallback.impactScore;
        if (typeof fallback.chapterTitle === "string") chapterTitle = fallback.chapterTitle;
      }
    }

    return {
      summary: summaryMatch?.[1]?.trim() || response.slice(0, 200),
      keyEvents,
      characterStates: statesMatch?.[1]?.trim() || "",
      closingSnapshot,
      characterImpulses,
      threadProgress,
      unresolvedQuestions,
      impactScore,
      chapterTitle: chapterTitle.trim(),
    };
}
