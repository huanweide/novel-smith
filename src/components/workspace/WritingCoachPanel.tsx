"use client";

/**
 * 实时写作教练面板（v3.1.130 新开创功能）。
 *
 * 作者写作时，本面板对「当前节点正文」做 100% 本地的六维 craft 分析（复用
 * src/core/quality/coach 的 buildCoachReport，纯规则、零 Token、零外泄），
 * 边打字边给出：总分/评级、各维分数条、具体问题、可落手的中文改法建议。
 *
 * 与「自动确认打分」的区别：那是生成后事后评分；这是作者写作过程中实时可见、
 * 可点到的教练体验（类「中文网文版 Grammarly」），且不依赖任何云端。
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { buildCoachReport, scoreColor, type CoachReport } from "@/core/quality/coach";

interface WritingCoachPanelProps {
  /** 当前节点正文（随作者输入实时变化） */
  content: string;
  /** 已知角色名（供 PoV / 主语检测） */
  characterNames?: string[];
}

// 同项目字符名可能在父组件引用稳定，但为安全每次计算前做一次去重
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = (n || "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function WritingCoachPanel({ content, characterNames = [] }: WritingCoachPanelProps) {
  const [report, setReport] = useState<CoachReport | null>(null);
  const [computing, setComputing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const text = content ?? "";
    // 空正文：立即清报告，不做无谓计算
    if (text.trim().length === 0) {
      setReport(null);
      setComputing(false);
      return;
    }
    setComputing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const names = dedupeNames(characterNames);
      const r = buildCoachReport(text, names);
      setReport(r);
      setComputing(false);
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content, characterNames]);

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Icon name="sparkles" size={28} className="text-[var(--nv-text-tertiary)]" />
        <div className="text-xs text-[var(--nv-text-tertiary)]">
          {content && content.trim().length > 0 ? "分析中…" : "开始写作后，这里会实时给出六维 craft 反馈"}
        </div>
        <div className="text-[10px] text-[var(--nv-text-muted)]">
          本地实时分析 · 零外泄 · 不耗 Token
        </div>
      </div>
    );
  }

  const { overallScore, grade, dimensions, flaggedCount } = report;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部：总分 + 零外泄标识 */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nv-border-2)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
            style={{ color: scoreColor(overallScore), background: "color-mix(in oklch, currentColor 14%, transparent)" }}
            aria-label={`综合质量分 ${overallScore} 分，评级 ${grade}`}
          >
            {overallScore}
          </span>
          <div className="leading-tight">
            <div className="text-xs text-[var(--nv-text-secondary)]">
              综合质量 <span className="font-medium text-[var(--nv-text-primary)]">{grade} 级</span>
            </div>
            <div className="text-[10px] text-[var(--nv-text-muted)]">
              {computing ? "分析中…" : flaggedCount > 0 ? `${flaggedCount} 个维度待优化` : "六维全部达标 ✓"}
            </div>
          </div>
        </div>
        <span
          className="rounded bg-[var(--nv-surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--nv-text-muted)]"
          title="全部在浏览器本地计算，文本不出本机"
        >
          本地实时 · 零外泄
        </span>
      </div>

      {/* 六维明细 */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {dimensions.map((d) => {
          const low = d.score < 70;
          return (
            <div
              key={d.key}
              className={`rounded-lg border p-2 ${
                low ? "border-[var(--nv-danger)]/40 bg-[var(--nv-danger)]/5" : "border-[var(--nv-border-2)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--nv-text-secondary)]">{d.name}</span>
                <span className="text-xs font-medium" style={{ color: scoreColor(d.score) }} aria-label={`${d.name} ${d.score} 分`}>
                  {d.score}
                </span>
              </div>
              {/* 分数条 */}
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--nv-surface-3)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(2, d.score)}%`, background: scoreColor(d.score) }}
                />
              </div>
              {/* 具体问题 */}
              {d.issues.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[10px] text-[var(--nv-text-tertiary)]">
                  {d.issues.slice(0, 4).map((iss, i) => (
                    <li key={i}>{iss}</li>
                  ))}
                </ul>
              )}
              {/* 教练建议 */}
              <div className="mt-1.5 rounded bg-[var(--nv-surface-2)] p-1.5 text-[10px] leading-relaxed text-[var(--nv-text-muted)]">
                <div><span className="text-[var(--nv-text-secondary)]">在测：</span>{d.advice.tip}</div>
                <div className="mt-0.5"><span className="text-[var(--nv-text-secondary)]">改法：</span>{d.advice.fix}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
