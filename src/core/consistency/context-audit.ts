/**
 * 上下文质量维护（阶段2-②）——纯函数审计器
 *
 * 宗旨：写后几章时，留意「系统被注入的上下文」，对没有意义 / 已被总结过 / 错误的信息
 * 进行清理、修复和优质化。三件事对应三个输出段：
 *   ① 清理冗余信息 cleanup   —— 已被总结的事实不重复注入；乱码/空值事实标记剔除
 *   ② 优化总结内容 summaryIssues —— 空/过短/乱码/缺关键事件/残留提示词 的摘要检测
 *   ③ 补充缺失信息 missing   —— 逐条归因「为什么没被注入」并给可操作建议
 *
 * 设计纪律（重要）：
 *  - 本模块是**只读诊断**，不改生成链路、不跑 LLM、不写库。真正的自动清理动作已在
 *    getConsistencyBaselineText（剔除摘要内已含事实）与 memory-injector（去重/压缩）里发生。
 *  - 每生成一章就偷偷跑一次 LLM 改写上下文会拖慢写作、引入幻觉、破坏可复现性、烧钱。
 *    所以「优化总结」只检测到问题 + 给出动作，由作者点已有的「重新摘要」按钮确认落库。
 *  - 所有检测为确定性规则，可单测、可复现，不把猜测写成结论。
 */

import type { MemoryInjectionDiagnostics, MemoryDropItem } from "@/lib/memory-injector";

// ─── 输入 ───

export interface AuditSummary {
  chapterId?: string | null;
  chapterTitle?: string | null;
  summary?: string | null;
  keyEvents?: unknown;
}

export interface AuditFact {
  subject: string;
  attribute: string;
  value: string;
  source?: string | null;
}

export interface ContextAuditInput {
  /** 已归档章节摘要 */
  summaries: AuditSummary[];
  /** 一致性事实基线（getConsistencyFacts 的原始产出） */
  facts: AuditFact[];
  /** 基线注入时因「来源命中摘要标题」被剔除的条数（阶段2-① 的真实清理结果） */
  droppedFactCount: number;
  /** 记忆注入归因（analyzeMemoryInjection 的产出） */
  memory: MemoryInjectionDiagnostics | null;
  /** 有正文的章节总数（用于检测「有正文却没有摘要」） */
  chaptersWithContent: number;
  /** 世界书/设定词条触发情况 */
  triggeredLoreCount?: number;
  totalLoreCount?: number;
}

// ─── 输出 ───

export type IssueSeverity = "info" | "warn" | "error";

export interface CleanupItem {
  kind: "summarized_fact" | "duplicate_memory" | "corrupted_fact" | "empty_fact";
  severity: IssueSeverity;
  label: string;
  detail: string;
  /** 估算省下的 token（粗估：中文 1 字≈1 token 的一半，保守取整） */
  savedTokens: number;
  /** 是否为系统已自动完成的清理（true）还是建议人工处理（false） */
  autoApplied: boolean;
}

export interface SummaryIssue {
  kind: "empty" | "too_short" | "corrupted" | "missing_key_events" | "prompt_residue" | "no_summary_for_content";
  severity: IssueSeverity;
  chapterTitle: string;
  detail: string;
  action: string;
}

export interface MissingItem {
  reason:
    | "budget_truncated"
    | "dedup_dropped"
    | "no_summary"
    | "baseline_empty"
    | "lore_not_triggered";
  severity: IssueSeverity;
  label: string;
  why: string;
  action: string;
}

export interface ContextQualityReport {
  /** 0~100，仅作趋势参考；按问题严重度扣分的确定性计算，不是模型评分 */
  score: number;
  counts: { cleanup: number; summaryIssues: number; missing: number };
  cleanup: CleanupItem[];
  summaryIssues: SummaryIssue[];
  missing: MissingItem[];
  /** 汇总的一句话动作建议（可直接展示） */
  actions: string[];
}

// ─── 确定性检测工具 ───

const CORRUPT_RE = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]|(?:问号){2,}|\?{4,}/;
const PROMPT_RESIDUE_RE = /```|【请输出|请输出\s*JSON|作为\s*AI|以下是(?:摘要|总结)|^\s*\{[\s\S]*"summary"/;

/** 乱码/控制字符/提示词残留检测（错误信息清理的判据）。 */
export function isCorruptedText(text: string): boolean {
  return CORRUPT_RE.test(text);
}

export function hasPromptResidue(text: string): boolean {
  return PROMPT_RESIDUE_RE.test(text);
}

// 中文 12 字已能说清一件事（谁+做了什么），20 字阈值会把正常摘要误判为「过短」。
const SUMMARY_MIN_CHARS = 12;

function estimateTokens(text: string): number {
  // 中文约 1.5 字符/token，保守按 2 字符/token 估，宁可少报不夸大
  return Math.ceil(text.length / 2);
}

// ─── 主入口 ───

export function auditContextQuality(input: ContextAuditInput): ContextQualityReport {
  const cleanup: CleanupItem[] = [];
  const summaryIssues: SummaryIssue[] = [];
  const missing: MissingItem[] = [];

  const summaries = input.summaries || [];
  const facts = input.facts || [];
  const mem = input.memory;

  // ── ① 清理冗余信息 ──

  // 1a. 阶段2-① 已自动剔除：来源命中摘要标题的重复事实（已随摘要注入，不再重复占 token）
  if (input.droppedFactCount > 0) {
    cleanup.push({
      kind: "summarized_fact",
      severity: "info",
      label: `已剔除 ${input.droppedFactCount} 条摘要内已含的重复事实`,
      detail: "这些事实已随章节摘要进入上下文，一致性基线里不再重复注入，避免同一信息占两份 token。",
      savedTokens: input.droppedFactCount * 12,
      autoApplied: true,
    });
  }

  // 1b. 记忆注入策略3 的增量去重：与最近上下文重复的事件被跳过
  const dedupDrops = (mem?.dropped || []).filter((d) => d.reason === "dedup_dropped");
  if (dedupDrops.length > 0) {
    cleanup.push({
      kind: "duplicate_memory",
      severity: "info",
      label: `已去重 ${dedupDrops.length} 条与最近上下文重复的记忆`,
      detail: "事件内容已出现在最近章摘要/正文里，S/A/B 分级注入时跳过，不重复占预算。",
      savedTokens: dedupDrops.reduce((n, d) => n + estimateTokens(d.content), 0),
      autoApplied: true,
    });
  }

  // 1c. 错误/空值事实：确定性检测，标记建议清理（不擅自删作者手填数据）
  for (const f of facts) {
    const s = String(f.subject ?? "");
    const a = String(f.attribute ?? "");
    const v = String(f.value ?? "");
    if (!s.trim() || !a.trim() || !v.trim()) {
      cleanup.push({
        kind: "empty_fact", severity: "warn", label: `空值事实：${s || "?"} / ${a || "?"}`,
        detail: "主体、属性或取值为空，注入后不携带任何有效信息，建议在一致性面板里删除或补全。",
        savedTokens: 0, autoApplied: false,
      });
    } else if (isCorruptedText(s + a + v) || hasPromptResidue(v)) {
      cleanup.push({
        kind: "corrupted_fact", severity: "warn", label: `疑似错误事实：${s} 的${a}`,
        detail: "取值含乱码控制字符或提示词残留，属于抽取污染，建议在一致性面板里修正。",
        savedTokens: 0, autoApplied: false,
      });
    }
  }

  // ── ② 优化总结内容 ──

  for (const s of summaries) {
    const title = String(s.chapterTitle || "未命名章节");
    const text = String(s.summary ?? "");
    const events = Array.isArray(s.keyEvents) ? s.keyEvents.filter(Boolean) : [];

    if (!text.trim()) {
      summaryIssues.push({
        kind: "empty", severity: "error", chapterTitle: title,
        detail: "摘要为空。该章信息完全不会进入中期记忆，写后续章节时 AI 会「失忆」。",
        action: "打开上下文预览，点「重新摘要」生成并确认保存。",
      });
    } else if (text.trim().length < SUMMARY_MIN_CHARS) {
      summaryIssues.push({
        kind: "too_short", severity: "warn", chapterTitle: title,
        detail: `摘要仅 ${text.trim().length} 字，信息量可能不足以支撑后续章节连贯。`,
        action: "点「重新摘要」重生成，或在确认弹窗里手动补全。",
      });
    } else if (isCorruptedText(text)) {
      summaryIssues.push({
        kind: "corrupted", severity: "error", chapterTitle: title,
        detail: "摘要含乱码/控制字符，属编码或抽取错误，注入后会污染上下文。",
        action: "点「重新摘要」覆盖，或手动编辑后确认保存。",
      });
    } else if (hasPromptResidue(text)) {
      summaryIssues.push({
        kind: "prompt_residue", severity: "warn", chapterTitle: title,
        detail: "摘要疑似混入提示词残留（代码围栏/「请输出」/JSON 片段），不是干净的正文摘要。",
        action: "点「重新摘要」覆盖。",
      });
    }

    if (events.length === 0 && text.trim()) {
      summaryIssues.push({
        kind: "missing_key_events", severity: "info", chapterTitle: title,
        detail: "该章摘要没有关键事件列表，物品转移/人物状态变化可能丢失，冲突审计原料不足。",
        action: "可点「重新摘要」补生成；不需要精确轨迹时可忽略。",
      });
    }
  }

  // 有正文却没有摘要：这是「该带的没带到」的主因之一
  if (input.chaptersWithContent > summaries.length) {
    const gap = input.chaptersWithContent - summaries.length;
    missing.push({
      reason: "no_summary", severity: "error",
      label: `${gap} 章有正文但缺少章节摘要`,
      why: "摘要未生成（章节未确认定稿，或摘要生成失败被跳过），中期记忆里没有这些章的信息。",
      action: "确认这些章节已定稿；在上下文预览里对缺摘要章节点「重新摘要」。",
    });
  }

  // ── ③ 补充缺失信息：逐条归因「为什么没注入」 ──

  const truncated = (mem?.dropped || []).filter(
    (d: MemoryDropItem) => d.reason === "budget_truncated",
  );
  if (truncated.length > 0) {
    const critical = truncated.filter((d) => d.importance === "critical");
    missing.push({
      reason: "budget_truncated",
      severity: critical.length > 0 ? "error" : "warn",
      label: `${truncated.length} 条记忆因预算截断未注入${critical.length ? `（含 ${critical.length} 条 critical）` : ""}`,
      why: `S/A/B 分级记忆注入预算 ${mem?.budgetTokens ?? 800} token，实际用 ${mem?.usedTokens ?? 0} token；超预算时按 S→A→B 优先级静默丢弃尾部条目，此前无任何提示。`,
      action: critical.length > 0
        ? "有高优记忆被丢：给相关条目提优先级 / 压缩低优事件，或在项目设置里调高记忆预算。"
        : "属正常分层裁剪；若后续章节确实忘了某条线，可点开明细确认被丢的是哪几章。",
    });
  }

  // 被去重丢掉的 critical 记忆：可能是「最近上下文过宽」导致误判重复
  const criticalDedup = dedupDrops.filter((d) => d.importance === "critical");
  if (criticalDedup.length > 0) {
    missing.push({
      reason: "dedup_dropped", severity: "warn",
      label: `${criticalDedup.length} 条高优记忆被判为「与最近上下文重复」而未注入`,
      why: "增量去重按 30 字符窗口比对当前大纲+最近3章摘要+最近2章正文，命中即跳过。若这些文本正好复述了该事件，关键记忆会被一并跳过。",
      action: "点开明细核对；确属误判时，可在大纲里避免原句复述，或把该事件标为强制常驻。",
    });
  }

  // 一致性事实基线为空但已有归档章节：确认流程没跑或抽取失败
  if (facts.length === 0 && summaries.length > 0) {
    missing.push({
      reason: "baseline_empty", severity: "warn",
      label: "一致性事实基线为空",
      why: "已有章节摘要，但没有任何 ConsistencyFact。通常是章节未确认定稿（抽取挂在确认路径），或抽取返回空被 skipped 守卫保留旧值。",
      action: "确认章节已定稿；或在一致性面板点「重新抽取」手动触发。",
    });
  }

  // 世界书词条未触发：只作 info，多数是正常的关键词未命中（depth>=3 走触发路径）
  if (
    typeof input.totalLoreCount === "number" &&
    typeof input.triggeredLoreCount === "number" &&
    input.totalLoreCount > 0 &&
    input.triggeredLoreCount === 0
  ) {
    missing.push({
      reason: "lore_not_triggered", severity: "info",
      label: `${input.totalLoreCount} 条世界书设定本轮全部未触发`,
      why: "depth>=3 的词条靠关键词命中最近3章正文与本章大纲；没命中就不注入，是设计内的省 token 行为。",
      action: "若本章确实需要某设定，把条目 depth 调到 <=2（强制常驻），或在大纲/正文里写出触发词。",
    });
  }

  // ── 汇总 ──

  const actions: string[] = [];
  const errors = [...cleanup, ...summaryIssues, ...missing].filter((x) => x.severity === "error").length;
  const warns = [...cleanup, ...summaryIssues, ...missing].filter((x) => x.severity === "warn").length;

  const savedTokens = cleanup.reduce((n, c) => n + c.savedTokens, 0);
  if (savedTokens > 0) actions.push(`已自动省下约 ${savedTokens} token 的重复信息`);
  if (summaryIssues.some((i) => i.severity !== "info")) actions.push("有摘要需要修复：用上下文预览里的「重新摘要」");
  if (missing.some((m) => m.reason === "no_summary")) actions.push("有正文缺摘要：补摘要才能让后续章节读到");
  if (truncated.length > 0) actions.push("「为什么没注入」已逐条归因，展开明细查看");
  if (actions.length === 0) actions.push("上下文质量正常，未发现冗余、错误或缺失");

  // 确定性评分：error -18、warn -5、info 不扣；下限 0。
  // error 权重高，是因为「空摘要 / 有正文无摘要 / 高优记忆被截断」任一出现都会直接让后续章节失忆，
  // 三个 error 即跌破 50，避免一堆致命问题被一堆 info 稀释成「看起来还行」。
  const score = Math.max(0, 100 - errors * 18 - warns * 5);

  return {
    score,
    counts: { cleanup: cleanup.length, summaryIssues: summaryIssues.length, missing: missing.length },
    cleanup,
    summaryIssues,
    missing,
    actions,
  };
}
