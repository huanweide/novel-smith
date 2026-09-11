"use client";

/**
 * 零门槛「去 AI 味检测」—— /detector
 *
 * 为什么单独开这一页：
 *   analyzeText 是**纯本地规则引擎**（不调 LLM、不联网、不需要 API Key、不需要数据库），
 *   但它的入口原本只藏在工作台的章节面板里——新用户 clone 完不配 Key，就根本走不到那一步，
 *   也就永远感受不到本项目最强的差异化（本地检测、稿件不出本机）。
 *
 *   本页把它前置成「粘贴即出结果」，让用户在配 Key 之前先拿到一次真实的"哇塞时刻"：
 *   价值验证从 30 分钟压缩到 30 秒。
 *
 * 三条硬约束（与 HumanizePanel / humanize/types.ts 一致，前端必须遵守）：
 *   1. 不上传 —— 分析全在浏览器内存里同步跑完，不发一个字节出本机。
 *   2. 给证据 —— 每条命中都展示原文片段 + 原因 + 可执行建议，不做黑箱评分。
 *   3. 说实话 —— 免责声明永远显示，不许藏进「更多」里。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { analyzeText, applyFixes, countFixable } from "@/core/humanize";
import { DISCLAIMER } from "@/core/humanize/types";
import type { AiTraceHit, HumanizeReport, ParagraphReport, Severity } from "@/core/humanize";

// ── 等级配色：分数越高越红，跟直觉一致 ──
const LEVEL_STYLE: Record<
  HumanizeReport["level"],
  { text: string; bg: string; border: string; hint: string }
> = {
  clean: {
    text: "text-[var(--nv-success)]",
    bg: "bg-[var(--nv-success-soft)]",
    border: "border-[var(--nv-success)]/40",
    hint: "机器味很淡，可以直接投。",
  },
  mild: {
    text: "text-[var(--nv-info)]",
    bg: "bg-[var(--nv-info-soft)]",
    border: "border-[var(--nv-info)]/40",
    hint: "有少量痕迹，顺手改几处更稳。",
  },
  noticeable: {
    text: "text-[var(--nv-warning)]",
    bg: "bg-[var(--nv-warning-soft)]",
    border: "border-[var(--nv-warning)]/40",
    hint: "痕迹明显，建议按下面的证据逐条改。",
  },
  heavy: {
    text: "text-[var(--nv-danger)]",
    bg: "bg-[var(--nv-danger-soft)]",
    border: "border-[var(--nv-danger)]/40",
    hint: "机器味重，被判定 AI 写作的风险高。",
  },
};

// bar 单独写死：Tailwind 扫不到运行时拼接的 class 名，必须给完整字面量
const SEVERITY_STYLE: Record<Severity, { text: string; bg: string; bar: string; label: string }> = {
  high: {
    text: "text-[var(--nv-danger)]",
    bg: "bg-[var(--nv-danger-soft)]",
    bar: "bg-[var(--nv-danger)]",
    label: "高",
  },
  medium: {
    text: "text-[var(--nv-warning)]",
    bg: "bg-[var(--nv-warning-soft)]",
    bar: "bg-[var(--nv-warning)]",
    label: "中",
  },
  low: {
    text: "text-[var(--nv-info)]",
    bg: "bg-[var(--nv-info-soft)]",
    bar: "bg-[var(--nv-info)]",
    label: "低",
  },
};

/** 段落强度 → 色条（0-100） */
function heatColor(score: number): string {
  if (score >= 60) return "bg-[var(--nv-danger)]";
  if (score >= 35) return "bg-[var(--nv-warning)]";
  if (score >= 15) return "bg-[var(--nv-info)]";
  return "bg-[var(--nv-success)]";
}

/**
 * 段落内高亮：把命中的原文片段用 <mark> 圈出来。
 * hits 的 start/end 是全文下标，先减去段落起点转成段内下标。
 */
function HighlightedParagraph({ p }: { p: ParagraphReport }) {
  const parts = useMemo(() => {
    const sorted = [...p.hits].sort((a, b) => a.start - b.start);
    const out: Array<{ text: string; hit: boolean; severity: Severity }> = [];
    let cursor = 0;
    for (const h of sorted) {
      const s = Math.max(0, h.start - p.start);
      const e = Math.min(p.text.length, h.end - p.start);
      if (e <= s || s < cursor) continue;
      if (s > cursor) out.push({ text: p.text.slice(cursor, s), hit: false, severity: "low" });
      out.push({ text: p.text.slice(s, e), hit: true, severity: h.severity });
      cursor = e;
    }
    if (cursor < p.text.length) out.push({ text: p.text.slice(cursor), hit: false, severity: "low" });
    return out;
  }, [p]);

  return (
    <p className="text-xs leading-relaxed text-[var(--nv-text-primary)] whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        part.hit ? (
          <mark
            key={i}
            className={`rounded px-0.5 ${SEVERITY_STYLE[part.severity].bg} ${SEVERITY_STYLE[part.severity].text}`}
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </p>
  );
}

/** 一段典型的 AI 腔文本，点「载入示例」即可立刻看到效果 */
const SAMPLE_TEXT = `夜幕降临，城市的霓虹灯渐渐亮起。他站在窗前，静静地望着远方。这不仅是一扇窗，更是一道光——那道光指引着他前行。空气中的味道很复杂，有咖啡的香气，也有雨后的清新。他深深地吸了一口气，心中涌起一种难以言喻的情感。或许，这就是命运给予他的馈赠；又或许，这只是一场注定要醒来的梦。无论前路如何，他都将坚定地走下去，因为他知道，唯有坚持才能抵达成功的彼岸，才能在漫长的岁月中找到属于自己的那份答案。`;

/** 低于这个字数不出评分——太短的文本评分没有意义，不给误导读数 */
const MIN_CHARS = 50;

export function DetectorPanel() {
  const [text, setText] = useState("");
  const [onlySerious, setOnlySerious] = useState(false);
  /**
   * 套用历史：机器每次改动之前把原文压栈，作者点「撤销」就能回到上一版。
   * 敢让机器动稿子的前提就是随时能退回去——不能退的功能没人敢用。
   */
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  const report = useMemo(() => analyzeText(text), [text]);
  const chars = report.stats.chars;
  const ready = chars >= MIN_CHARS;

  /** 这批命中里机器有多少把握的下手机会 */
  const fixableCount = countFixable(report.hits);

  /** 手动改过字之后旧的撤销点就不作数了，清掉以免回滚时覆盖掉作者的手动编辑 */
  const changeText = (v: string) => {
    setUndoStack([]);
    setNotice("");
    setText(v);
  };

  /** 单条套用：只改作者点下的那一处，旁边的内容一个字都不碰 */
  const applyOne = (hit: AiTraceHit) => {
    const r = applyFixes(text, [hit]);
    if (r.applied === 0) return;
    setUndoStack((s) => [...s, text]);
    setNotice(`已套用 1 处：${hit.fix?.label ?? "修改"}`);
    setText(r.text);
  };

  /** 全部套用：一次把机器有把握的都改掉 */
  const applyAll = () => {
    const r = applyFixes(text, report.hits);
    if (r.applied === 0) return;
    setUndoStack((s) => [...s, text]);
    setNotice(
      r.skipped > 0
        ? `已套用 ${r.applied} 处${r.skipped} 处因范围重叠跳过，可手动处理`
        : `已套用 ${r.applied} 处，分数变化见上方。机器拿不准的都不在其中，仍需你自己改写`
    );
    setText(r.text);
  };

  const undo = () => {
    setUndoStack((s) => {
      const last = s[s.length - 1];
      if (last === undefined) return s;
      setText(last);
      setNotice("已撤销上一次套用");
      return s.slice(0, -1);
    });
  };

  const shownParagraphs = useMemo(() => {
    if (!onlySerious) return report.paragraphs;
    return report.paragraphs.filter((p) =>
      p.hits.some((h) => h.severity === "high" || h.severity === "medium")
    );
  }, [report, onlySerious]);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    for (const h of report.hits) c[h.severity] += 1;
    return c;
  }, [report]);

  const style = LEVEL_STYLE[report.level];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      {/* ── 头部 ── */}
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--nv-text-primary)] mb-2">去 AI 味检测</h1>
        <p className="text-sm text-[var(--nv-text-secondary)]">
          纯本地 · 不联网 · <span className="font-medium">不需要 API Key</span> —— 粘贴一段文字，
          立刻看它有多像 AI 写的。
        </p>
      </header>

      {/* ── 输入区 ── */}
      <section className="surface-elevated rounded-2xl p-4 mb-6">
        <textarea
          value={text}
          onChange={(e) => changeText(e.target.value)}
          placeholder="把你写的（或 AI 生成的）段落粘贴到这里……"
          aria-label="待检测文本"
          className="w-full h-44 resize-y rounded-xl bg-transparent text-sm leading-relaxed text-[var(--nv-text-primary)] placeholder:text-[var(--nv-text-muted)] outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--nv-text-tertiary)]">已输入 {chars} 字</span>
          <button
            onClick={() => changeText(SAMPLE_TEXT)}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--nv-border-1)] text-[var(--nv-text-secondary)] hover:text-[var(--nv-text-primary)] transition-colors"
          >
            载入示例
          </button>
          <button
            onClick={() => changeText("")}
            disabled={!text}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--nv-border-1)] text-[var(--nv-text-secondary)] hover:text-[var(--nv-text-primary)] transition-colors disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </section>

      {/* ── 结果区 ── */}
      {!ready ? (
        <section className="text-center py-12">
          <p className="text-sm text-[var(--nv-text-tertiary)]">
            再输入 {Math.max(1, MIN_CHARS - chars)} 字即可出结果
          </p>
          <p className="mt-2 text-xs text-[var(--nv-text-muted)]">
            太短的文本评分没有意义，所以这里不给你一个会误导人的数字。
          </p>
        </section>
      ) : (
        <section className="space-y-5">
          {/* ── 一键套用：把机器有把握的改动一次性做掉 ──
              放在最显眼的位置是因为这才是本页最有价值的一步：
              看完分数只是知道自己有问题，套用才是真的把稿子变干净。 */}
          {fixableCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--nv-primary)]/30 bg-[var(--nv-primary-soft)] px-4 py-3">
              <p className="text-[11px] leading-relaxed text-[var(--nv-text-secondary)] min-w-0 flex-1">
                其中 <span className="font-semibold text-[var(--nv-primary)]">{fixableCount}</span>{" "}
                处是机器有把握直接改的（删掉纯套话、破折号换逗号、删多余括号）。
                <span className="text-[var(--nv-text-tertiary)]">
                  机器拿不准的结构性问题不在其中，仍然要你自己动笔。
                </span>
              </p>
              <button
                onClick={applyAll}
                className="shrink-0 text-xs px-3.5 py-2 rounded-lg border border-[var(--nv-primary)]/50 text-[var(--nv-primary)] bg-[var(--nv-surface-1)] hover:bg-[var(--nv-primary)]/15 transition-colors font-medium"
              >
                一键套用 {fixableCount} 处
              </button>
            </div>
          )}

          {/* ── 套用结果 + 撤销 ──
              必须给撤销：敢让机器动稿子的前提，是随时能一键退回去。 */}
          {notice && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--nv-border-1)] bg-[var(--nv-surface-2)] px-4 py-2.5">
              <p className="text-[11px] text-[var(--nv-text-secondary)] flex items-start gap-1.5 min-w-0 flex-1">
                <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-[var(--nv-success)]" />
                <span className="min-w-0">{notice}</span>
              </p>
              <div className="flex items-center gap-2 shrink-0">
                {undoStack.length > 0 && (
                  <button
                    onClick={undo}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[var(--nv-border-1)] text-[var(--nv-text-secondary)] hover:text-[var(--nv-text-primary)] transition-colors"
                  >
                    撤销
                  </button>
                )}
                <button
                  onClick={() => setNotice("")}
                  aria-label="关闭提示"
                  className="text-xs px-2 py-1 rounded-lg text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)] transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* 总分 */}
          <div className={`rounded-2xl border ${style.border} ${style.bg} p-5 flex items-center gap-5`}>
            <div className="shrink-0">
              <div className={`text-4xl font-bold ${style.text}`}>{report.score}</div>
              <div className="text-[11px] text-[var(--nv-text-tertiary)] mt-0.5">AI 痕迹指数</div>
            </div>
            <div className="min-w-0">
              <div className={`text-base font-semibold ${style.text}`}>{report.levelLabel}</div>
              <p className="text-xs text-[var(--nv-text-secondary)] mt-1">{style.hint}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className={SEVERITY_STYLE.high.text}>高 {counts.high}</span>
                <span className={SEVERITY_STYLE.medium.text}>中 {counts.medium}</span>
                <span className={SEVERITY_STYLE.low.text}>低 {counts.low}</span>
              </div>
            </div>
          </div>

          {/* 六项可解释统计 */}
          <div className="surface-elevated rounded-2xl p-4">
            <h2 className="text-xs font-semibold tracking-wide text-[var(--nv-text-secondary)] mb-3">
              原始统计（都是可解释的数字，不是玄学分数）
            </h2>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <Stat label="总字数" value={`${report.stats.chars}`} />
              <Stat label="破折号 / 千字" value={report.stats.dashPerK.toFixed(1)} />
              <Stat label="平均句长" value={`${report.stats.avgSentenceLen.toFixed(1)} 字`} />
              <Stat label="句长波动" value={report.stats.sentenceLenStd.toFixed(1)} />
              <Stat label="短句占比" value={`${(report.stats.shortSentenceRatio * 100).toFixed(0)}%`} />
              <Stat label="AI 词 / 千字" value={report.stats.aiWordPerK.toFixed(1)} />
            </dl>
          </div>

          {/* 段落级证据 */}
          <div className="surface-elevated rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold tracking-wide text-[var(--nv-text-secondary)]">
                逐段证据（{shownParagraphs.length} / {report.paragraphs.length} 段）
              </h2>
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--nv-text-tertiary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlySerious}
                  onChange={(e) => setOnlySerious(e.target.checked)}
                  className="accent-[var(--nv-warning)]"
                />
                只看中 / 高严重度
              </label>
            </div>

            {shownParagraphs.length === 0 ? (
              <p className="text-xs text-[var(--nv-text-tertiary)]">这一段筛选下没有命中的段落。</p>
            ) : (
              <ul className="space-y-3">
                {shownParagraphs.map((p) => (
                  <li key={p.index} className="rounded-xl border border-[var(--nv-border-1)] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] text-[var(--nv-text-muted)]">第 {p.index + 1} 段</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--nv-surface-2)] overflow-hidden">
                        <div
                          className={`h-full ${heatColor(p.score)}`}
                          style={{ width: `${Math.min(100, Math.max(2, p.score))}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-[var(--nv-text-tertiary)]">{p.score}</span>
                    </div>

                    <HighlightedParagraph p={p} />

                    {p.hits.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {p.hits.map((h, i) => (
                          <li key={`${h.ruleId}-${i}`} className="text-[11px] leading-relaxed">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded mr-1.5 ${SEVERITY_STYLE[h.severity].bg} ${SEVERITY_STYLE[h.severity].text}`}
                            >
                              {SEVERITY_STYLE[h.severity].label}
                            </span>
                            <span className="text-[var(--nv-text-secondary)]">{h.reason}</span>
                            <span className="text-[var(--nv-text-tertiary)]"> → {h.suggestion}</span>
                            {/* 只有机器确有把握的命中才给按钮：
                                需要作者拿主意的结构性改写（留哪一半、重写成什么）不显示，
                                避免给人「机器替我改了文章」的错觉。 */}
                            {h.fix && (
                              <button
                                onClick={() => applyOne(h)}
                                aria-label={`套用修改：${h.fix?.label ?? ""}`}
                                title={`点一下即把这段改成机器建议的样子（${h.fix?.label ?? ""}），可随时撤销`}
                                className="ml-1.5 px-1.5 py-0.5 rounded border border-[var(--nv-border-1)] text-[10px] text-[var(--nv-text-tertiary)] hover:text-[var(--nv-primary)] hover:border-[var(--nv-primary)]/50 hover:bg-[var(--nv-primary-soft)] transition-colors align-middle"
                              >
                                {h.fix?.label}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ── 免责声明：永远可见，不许折叠 ── */}
      <p className="mt-6 text-[11px] leading-relaxed text-[var(--nv-text-muted)]">{DISCLAIMER}</p>

      {/* ── 下一步引导 ── */}
      <footer className="mt-6 pt-4 border-t border-[var(--nv-border-1)] text-xs text-[var(--nv-text-tertiary)]">
        想边写边检测？{" "}
        <Link href="/settings" className="underline underline-offset-2 hover:text-[var(--nv-text-primary)]">
          去设置页配好 Key
        </Link>{" "}
        后，工作台每一章都能一键过审自检。 ·{" "}
        <Link href="/" className="underline underline-offset-2 hover:text-[var(--nv-text-primary)]">
          回首页
        </Link>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--nv-surface-2)] px-3 py-2">
      <dt className="text-[10px] text-[var(--nv-text-muted)]">{label}</dt>
      <dd className="text-sm font-semibold text-[var(--nv-text-primary)] mt-0.5">{value}</dd>
    </div>
  );
}
