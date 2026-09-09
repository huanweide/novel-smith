/**
 * 审校响应解析（原 AgentOrchestrator 私有方法 parseReviewResponse / validateIssueType / validateSeverity）
 * 纯函数：不依赖实例状态，可独立测试。
 */

import type { ReviewLog, ReviewIssueType } from "@/core/types";
import { safeParseAIJson } from "@/lib/json-parser";

/**
 * 解析审校 Agent 的返回。
 * JSON 合法 → 结构化 issues；非法/非对象 → 文本兜底，绝不抛错。
 */
export function parseReviewResponse(response: string, nodeOutline: string): ReviewLog {
    try {
      const parsed = safeParseAIJson(response) as Record<string, unknown> | null;
      if (!parsed || Array.isArray(parsed)) throw new Error("AI 审稿返回非对象 JSON");
      const passed = parsed.passed === true;
      const rawIssues = Array.isArray(parsed.issues) ? parsed.issues as Record<string, unknown>[] : [];

      const issues = rawIssues.map((iss) => ({
        type: validateIssueType(String(iss.type || "logic_flaw")),
        severity: validateSeverity(String(iss.severity || "major")),
        description: String(iss.description || ""),
        location: typeof iss.location === "string" ? iss.location : null,
        suggestion: typeof iss.suggestion === "string" ? iss.suggestion : null,
      }));

      return {
        id: "",
        nodeId: "",
        timestamp: new Date(),
        passed,
        issues: issues.length > 0 ? issues : [],
        summary: String(parsed.summary || response.slice(0, 500)),
        suggestion: passed ? null : issues.map(i => `[${i.severity}] ${i.description}`).join("\n"),
      };
    } catch {
      // JSON 解析失败 → 回退到文本判断
    }

    // 文本回退
    const passed = response.includes("审校通过") || response.includes("没有问题") || response.includes("未发现问题") || response.includes('"passed": true');

    const issues = passed
      ? []
      : [{
          type: "logic_flaw" as const,
          severity: "major" as const,
          description: response,
          location: null,
          suggestion: null,
        }];

    return {
      id: "",
      nodeId: "",
      timestamp: new Date(),
      passed,
      issues,
      summary: response.slice(0, 500),
      suggestion: passed ? null : response,
    };
}

// ─── 审校校验辅助 ─────────────────────────────────────────────

export function validateIssueType(t: string): ReviewIssueType {
  const valid: ReviewIssueType[] = [
    "ooc", "logic_flaw", "lore_conflict", "timeline_error",
    "continuity_error", "character_resurrection", "item_teleport",
    "cross_chapter_contradiction",
    "pacing", "dialogue_quality", "description_density", "emotion_consistency",
  ];
  return valid.includes(t as ReviewIssueType) ? (t as ReviewIssueType) : "logic_flaw";
}

export function validateSeverity(s: string): "critical" | "major" | "minor" {
  const valid = ["critical", "major", "minor"];
  return valid.includes(s) ? (s as "critical" | "major" | "minor") : "major";
}
