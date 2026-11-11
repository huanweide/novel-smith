import { describe, it, expect } from "vitest";
import {
  auditContextQuality,
  isCorruptedText,
  hasPromptResidue,
  type ContextAuditInput,
} from "./context-audit";
import type { MemoryInjectionDiagnostics } from "@/lib/memory-injector";

const mem = (over: Partial<MemoryInjectionDiagnostics> = {}): MemoryInjectionDiagnostics => ({
  injectedText: "",
  injectedCount: 0,
  dropped: [],
  byTier: { S: { total: 0, injected: 0 }, A: { total: 0, injected: 0 }, B: { total: 0, injected: 0 } },
  usedTokens: 0,
  budgetTokens: 800,
  ...over,
});

const base = (over: Partial<ContextAuditInput> = {}): ContextAuditInput => ({
  summaries: [{ chapterTitle: "第1章 雨夜", summary: "李富贵在雨夜收下账册，离开青龙镇。", keyEvents: ["收下账册"] }],
  facts: [{ subject: "李富贵", attribute: "身份", value: "账房先生", source: "manual" }],
  droppedFactCount: 0,
  memory: mem(),
  chaptersWithContent: 1,
  triggeredLoreCount: 1,
  totalLoreCount: 3,
  ...over,
});

describe("文本污染检测", () => {
  it("识别替换字符与控制字符", () => {
    expect(isCorruptedText("李\ufffd富贵")).toBe(true);
    expect(isCorruptedText("正常文本")).toBe(false);
  });
  it("识别提示词/围栏残留", () => {
    expect(hasPromptResidue("```json\n{...}")).toBe(true);
    expect(hasPromptResidue("以下是摘要：李富贵离开")).toBe(true);
    expect(hasPromptResidue("李富贵在雨夜收下账册")).toBe(false);
  });
});

describe("① 清理冗余信息", () => {
  it("报告已自动剔除的重复事实与去重记忆，并给出 token 估算", () => {
    const r = auditContextQuality(base({
      droppedFactCount: 3,
      memory: mem({
        dropped: [
          { tier: "A", content: "李富贵在雨夜收下账册", chapterNumber: 1, importance: "high", reason: "dedup_dropped" },
        ],
      }),
    }));
    const kinds = r.cleanup.map((c) => c.kind);
    expect(kinds).toContain("summarized_fact");
    expect(kinds).toContain("duplicate_memory");
    expect(r.cleanup.every((c) => c.autoApplied)).toBe(true);
    expect(r.cleanup.reduce((n, c) => n + c.savedTokens, 0)).toBeGreaterThan(0);
  });

  it("空值/乱码事实只标记建议，不冒充已自动清理", () => {
    const r = auditContextQuality(base({
      facts: [
        { subject: "李富贵", attribute: "", value: "", source: "manual" },
        { subject: "王五", attribute: "身份", value: "李\ufffd贵", source: "auto" },
      ],
    }));
    expect(r.cleanup.some((c) => c.kind === "empty_fact")).toBe(true);
    expect(r.cleanup.some((c) => c.kind === "corrupted_fact")).toBe(true);
    expect(r.cleanup.filter((c) => !c.autoApplied).every((c) => c.severity === "warn")).toBe(true);
  });
});

describe("② 优化总结内容", () => {
  it("空 / 过短 / 乱码 / 提示词残留 分别归因，并指向重新摘要", () => {
    const r = auditContextQuality(base({
      summaries: [
        { chapterTitle: "A", summary: "" },
        { chapterTitle: "B", summary: "太短" },
        { chapterTitle: "C", summary: "李\ufffd富贵在雨夜收下了那本账册" },
        { chapterTitle: "D", summary: "```json\n{\"summary\":\"...\"}" },
      ],
      chaptersWithContent: 4,
    }));
    const kinds = r.summaryIssues.map((i) => i.kind);
    expect(kinds).toContain("empty");
    expect(kinds).toContain("too_short");
    expect(kinds).toContain("corrupted");
    expect(kinds).toContain("prompt_residue");
    expect(r.summaryIssues.every((i) => i.action.includes("重新摘要") || i.action.includes("摘要"))).toBe(true);
  });

  it("缺 keyEvents 只报 info，不制造噪音", () => {
    const r = auditContextQuality(base({
      summaries: [{ chapterTitle: "A", summary: "李富贵在雨夜收下账册并离开了青龙镇。", keyEvents: [] }],
    }));
    expect(r.summaryIssues.every((i) => i.severity === "info")).toBe(true);
  });
});

describe("③ 补充缺失信息（为什么没注入）", () => {
  it("预算截断：明确写出预算/实际用量与静默丢弃", () => {
    const r = auditContextQuality(base({
      memory: mem({
        usedTokens: 800,
        dropped: [
          { tier: "B", content: "第9章 赵六交出钥匙", chapterNumber: 9, importance: "medium", reason: "budget_truncated" },
        ],
      }),
    }));
    const item = r.missing.find((m) => m.reason === "budget_truncated");
    expect(item).toBeTruthy();
    expect(item!.why).toContain("800");
    expect(item!.why).toContain("静默丢弃");
  });

  it("critical 被截断 → 升为 error 并给提优先级建议", () => {
    const r = auditContextQuality(base({
      memory: mem({
        dropped: [
          { tier: "S", content: "第9章 主角真实身份揭露", chapterNumber: 9, importance: "critical", reason: "budget_truncated" },
        ],
      }),
    }));
    expect(r.missing.find((m) => m.reason === "budget_truncated")?.severity).toBe("error");
  });

  it("有正文却缺摘要 → 指出中期记忆缺口", () => {
    const r = auditContextQuality(base({ chaptersWithContent: 5 }));
    const item = r.missing.find((m) => m.reason === "no_summary");
    expect(item?.label).toContain("4 章");
    expect(item?.why).toContain("未生成");
  });

  it("critical 被去重 → 提示可能是最近上下文过宽导致误判", () => {
    const r = auditContextQuality(base({
      memory: mem({
        dropped: [
          { tier: "S", content: "第9章 主角真实身份揭露", chapterNumber: 9, importance: "critical", reason: "dedup_dropped" },
        ],
      }),
    }));
    expect(r.missing.some((m) => m.reason === "dedup_dropped" && m.why.includes("30 字符"))).toBe(true);
  });

  it("基线为空但有摘要 → 归因到确认/抽取流程", () => {
    const r = auditContextQuality(base({ facts: [] }));
    expect(r.missing.some((m) => m.reason === "baseline_empty")).toBe(true);
  });

  it("世界书全未触发只作 info，不误报为错误", () => {
    const r = auditContextQuality(base({ triggeredLoreCount: 0, totalLoreCount: 5 }));
    expect(r.missing.find((m) => m.reason === "lore_not_triggered")?.severity).toBe("info");
  });
});

describe("评分与汇总", () => {
  it("健康上下文满分且给正向结论", () => {
    const r = auditContextQuality(base());
    expect(r.score).toBe(100);
    expect(r.actions.join("")).toContain("正常");
  });

  it("问题越多分越低，且下限不为负", () => {
    const r = auditContextQuality(base({
      summaries: [{ chapterTitle: "A", summary: "" }],
      facts: [],
      chaptersWithContent: 20,
      memory: mem({ dropped: [
        { tier: "S", content: "x", importance: "critical", reason: "budget_truncated" },
        { tier: "S", content: "y", importance: "critical", reason: "budget_truncated" },
      ] }),
    }));
    expect(r.score).toBeLessThan(50);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.counts.summaryIssues).toBeGreaterThan(0);
    expect(r.counts.missing).toBeGreaterThan(0);
  });
});

describe("阶段 C1 · 同键旧事实合并的可见性", () => {
  it("supersededFactCount > 0 → 出现 superseded_fact 清理项且标为已自动生效", () => {
    const r = auditContextQuality(base({ supersededFactCount: 2 }));
    const item = r.cleanup.find((c) => c.kind === "superseded_fact");
    expect(item).toBeTruthy();
    expect(item?.autoApplied).toBe(true);
    expect(item?.label).toContain("2");
  });

  it("未传该字段时零行为变化（旧调用方不受影响）", () => {
    const r = auditContextQuality(base());
    expect(r.cleanup.some((c) => c.kind === "superseded_fact")).toBe(false);
  });
});
