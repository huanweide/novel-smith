"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import JSZip from "jszip";
import { Icon, type IconName } from "@/components/ui/icons";
import {
  EDITOR_ROLES,
  getRoleSystem,
  type ReviewResult,
  type ReviewSuggestion,
} from "@/core/editor/prompts";

type PlatformId = "fanqie" | "qidian" | "jjwxc" | "wechat" | "general";

interface PlatformOption {
  id: PlatformId;
  label: string;
}
const PLATFORMS: PlatformOption[] = [
  { id: "fanqie", label: "番茄小说" },
  { id: "qidian", label: "起点中文网" },
  { id: "jjwxc", label: "晋江文学城" },
  { id: "wechat", label: "微信公众号" },
  { id: "general", label: "通用（不套平台规矩）" },
];

const PLATFORM_LABEL: Record<string, string> = {
  fanqie: "番茄",
  qidian: "起点",
  jjwxc: "晋江",
  wechat: "公众号",
  general: "通用",
};

const ROLE_OPTIONS = EDITOR_ROLES;

const SCOPE_OPTIONS: { id: string; label: string; count?: number }[] = [
  { id: "recent5", label: "最近 5 章", count: 5 },
  { id: "recent3", label: "最近 3 章", count: 3 },
  { id: "recent10", label: "最近 10 章", count: 10 },
  { id: "all", label: "全部章节（按预算自动裁剪）" },
];

const CUSTOM_PROMPT_KEY = "ns-editor-custom-prompt";

const sevClass: Record<string, string> = {
  high: "border-[var(--nv-danger)] bg-[var(--nv-danger)]/5 text-[var(--nv-danger)]",
  medium: "border-[#d99300] bg-[#d99300]/10 text-[#d99300]",
  low: "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] text-[var(--nv-text-secondary)]",
};

const VERDICT_CLASS: Record<string, string> = {
  "签约潜力高": "bg-[var(--nv-primary)] text-white",
  "可投但需打磨": "bg-[#d99300] text-white",
  "暂不建议投": "bg-[var(--nv-danger)] text-white",
};

function SectionTitle({ icon, children, hint }: { icon: IconName; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-medium text-[var(--nv-text-secondary)]">
      <Icon name={icon} size={13} />
      <span>{children}</span>
      {hint && <span className="ml-auto text-[10px] text-[var(--nv-text-tertiary)]">{hint}</span>}
    </div>
  );
}

function RiskBadge({ level, label }: { level: string; label: string }) {
  const cls =
    level === "high"
      ? "bg-[var(--nv-danger)] text-white"
      : level === "medium"
        ? "bg-[#d99300] text-white"
        : "bg-[var(--nv-primary)] text-white";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

export function PublishCheckPanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<"export" | "review">("export");

  // ── 共享：目标平台 ──
  const [platform, setPlatform] = useState<PlatformId>("fanqie");
  const [includeAttribution, setIncludeAttribution] = useState(true);

  // ── 导出态 ──
  const [format, setFormat] = useState<"txt" | "html">("txt");
  const [exportData, setExportData] = useState<any>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPreCheck, setShowPreCheck] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipError, setZipError] = useState("");

  // ── 审稿态 ──
  const [role, setRole] = useState<string>("fanqie");
  const [scope, setScope] = useState<string>("recent5");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [promptTouched, setPromptTouched] = useState(false);
  const [customSaved, setCustomSaved] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: number; failed: number; details: string[] } | null>(null);
  const [tuneCopied, setTuneCopied] = useState(false);

  const platformLabel = PLATFORM_LABEL[platform] ?? platform;

  // 角色/平台变化时，若用户没手改过提示词，自动套用该角色的默认提示词
  useEffect(() => {
    if (promptTouched) return;
    if (role === "custom") {
      const saved = typeof window !== "undefined" ? localStorage.getItem(CUSTOM_PROMPT_KEY) || "" : "";
      setSystemPrompt(saved);
    } else {
      setSystemPrompt(getRoleSystem(role, platform));
    }
  }, [role, platform, promptTouched]);

  // ── 整书导出（沿用原有逻辑）──
  const run = async () => {
    if (exportLoading) return;
    setExportLoading(true);
    setExportError("");
    setExportData(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `请求失败（${res.status}）`);
      setExportData(json);
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExportLoading(false);
    }
  };

  const getExportBody = () => {
    if (!exportData?.export) return "";
    let raw = format === "html" ? exportData.export.html : exportData.export.text;
    if (!raw) return "";
    if (!includeAttribution) {
      raw = raw
        .replace(/\n\n---\n\n本书由 novel-smith[\s\S]*$/, "")
        .replace(/<!-- novel-smith 署名页 -->[\s\S]*?<\/section>/, "")
        .trim();
    }
    return raw;
  };

  const download = () => {
    const body = getExportBody();
    if (!body) return;
    const blob = new Blob([body], {
      type: format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `导出稿-${PLATFORM_LABEL[platform]}-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    const body = getExportBody();
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 静默失败 */
    }
  };

  // ── 分章打包 ZIP 导出 ──
  const exportZip = async () => {
    if (zipLoading) return;
    setZipLoading(true);
    setZipError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/export-chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, includeAttribution }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `请求失败（${res.status}）`);
      const chapters: Array<{ filename: string; content: string }> = json.chapters || [];
      if (!chapters.length) throw new Error("没有带正文的章节可导出");

      const zip = new JSZip();
      for (const c of chapters) zip.file(c.filename, c.content);
      if (json.readme) zip.file("00-说明.txt", json.readme);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `分章导出-${PLATFORM_LABEL[platform]}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setZipError(String(e));
    } finally {
      setZipLoading(false);
    }
  };

  // ── 模拟编辑审稿 ──
  const runReview = async () => {
    if (reviewLoading) return;
    setReviewLoading(true);
    setReviewError("");
    setReview(null);
    setSelected(new Set());
    setApplyResult(null);
    const scopeOpt = SCOPE_OPTIONS.find((s) => s.id === scope) ?? SCOPE_OPTIONS[0];
    try {
      const res = await fetch(`/api/projects/${projectId}/editor-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          role,
          systemPrompt,
          scope: { mode: scopeOpt.id === "all" ? "all" : "recent", count: scopeOpt.count },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `请求失败（${res.status}）`);
      setReview(json as ReviewResult);
    } catch (e) {
      setReviewError(String(e));
    } finally {
      setReviewLoading(false);
    }
  };

  const saveCustom = () => {
    if (typeof window !== "undefined") localStorage.setItem(CUSTOM_PROMPT_KEY, systemPrompt);
    setRole("custom");
    setPromptTouched(false);
    setCustomSaved(true);
    setTimeout(() => setCustomSaved(false), 1500);
  };

  const copyTune = async () => {
    if (!review?.promptForTune) return;
    try {
      await navigator.clipboard.writeText(review.promptForTune);
      setTuneCopied(true);
      setTimeout(() => setTuneCopied(false), 1500);
    } catch {
      /* 静默失败 */
    }
  };

  const toggleSelect = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const applySelected = async () => {
    if (!review || applyLoading) return;
    const picked = review.suggestions.filter((_, i) => selected.has(i)).filter((s) => s.nodeId);
    if (!picked.length) {
      setReviewError("请先勾选要应用的修改建议");
      return;
    }
    setApplyLoading(true);
    setApplyResult(null);
    try {
      const byNode = new Map<string, ReviewSuggestion[]>();
      for (const s of picked) {
        const arr = byNode.get(s.nodeId!) ?? [];
        arr.push(s);
        byNode.set(s.nodeId!, arr);
      }
      const items = [...byNode.entries()].map(([nodeId, sugs]) => ({
        nodeId,
        suggestions: sugs.map((s) => ({
          location: s.location,
          issue: s.issue,
          suggestion: s.suggestion,
          rewriteHint: s.rewriteHint,
        })),
      }));
      const res = await fetch(`/api/projects/${projectId}/editor-apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `请求失败（${res.status}）`);
      const details = (json.applied || []).map(
        (a: any) => `${a.ok ? "✓" : "✗"} ${a.nodeId}${a.error ? "：" + a.error : ""}`,
      );
      setApplyResult({ ok: json.summary?.ok ?? 0, failed: json.summary?.failed ?? 0, details });
    } catch (e) {
      setReviewError(String(e));
    } finally {
      setApplyLoading(false);
    }
  };

  const publish = exportData?.publish;
  const risk = exportData?.risk;
  const consistency = exportData?.consistency;
  const meta = exportData?.meta;
  const chapters = publish?.chapters || [];

  return (
    <div className="flex flex-col h-full">
      {/* 标签页 */}
      <div className="flex border-b border-[var(--nv-border-2)]">
        <button
          onClick={() => setTab("export")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium ${
            tab === "export"
              ? "border-b-2 border-[var(--nv-primary)] text-[var(--nv-primary)]"
              : "text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-secondary)]"
          }`}
        >
          <Icon name="download" size={13} /> 导出
        </button>
        <button
          onClick={() => setTab("review")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium ${
            tab === "review"
              ? "border-b-2 border-[var(--nv-primary)] text-[var(--nv-primary)]"
              : "text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-secondary)]"
          }`}
        >
          <Icon name="sparkles" size={13} /> 模拟审稿
        </button>
      </div>

      {/* 共享控制条 */}
      <div className="px-3 py-2 border-b border-[var(--nv-border-2)] space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--nv-text-tertiary)] shrink-0">目标平台</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as PlatformId)}
            className="flex-1 rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] px-1.5 py-1 text-xs text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-primary)]"
          >
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-[10px] text-[var(--nv-text-secondary)]">
          <input
            type="checkbox"
            checked={includeAttribution}
            onChange={(e) => setIncludeAttribution(e.target.checked)}
            className="rounded border-[var(--nv-border-2)]"
          />
          导出时附带 novel-smith 署名页（作品即媒体，传播留痕）
        </label>
      </div>

      {/* 结果区 */}
      <div className="flex-1 overflow-y-auto">
        {tab === "export" ? (
          <ExportTab
            format={format}
            setFormat={setFormat}
            exportData={exportData}
            exportLoading={exportLoading}
            exportError={exportError}
            run={run}
            download={download}
            copy={copy}
            copied={copied}
            zipLoading={zipLoading}
            zipError={zipError}
            exportZip={exportZip}
            showPreCheck={showPreCheck}
            setShowPreCheck={setShowPreCheck}
            platformLabel={platformLabel}
            meta={meta}
            publish={publish}
            risk={risk}
            consistency={consistency}
            chapters={chapters}
          />
        ) : (
          <ReviewTab
            role={role}
            setRole={(v: string) => {
              setPromptTouched(false);
              setRole(v);
            }}
            scope={scope}
            setScope={setScope}
            systemPrompt={systemPrompt}
            setSystemPrompt={(v: string) => {
              setPromptTouched(true);
              setSystemPrompt(v);
            }}
            customSaved={customSaved}
            saveCustom={saveCustom}
            reviewLoading={reviewLoading}
            reviewError={reviewError}
            runReview={runReview}
            review={review}
            selected={selected}
            toggleSelect={toggleSelect}
            copyTune={copyTune}
            tuneCopied={tuneCopied}
            applyLoading={applyLoading}
            applySelected={applySelected}
            applyResult={applyResult}
            projectId={projectId}
          />
        )}
      </div>
    </div>
  );
}

// ─── 导出标签页 ───────────────────────────────────────────────
function ExportTab({
  format,
  setFormat,
  exportData,
  exportLoading,
  exportError,
  run,
  download,
  copy,
  copied,
  zipLoading,
  zipError,
  exportZip,
  showPreCheck,
  setShowPreCheck,
  platformLabel,
  meta,
  publish,
  risk,
  consistency,
  chapters,
}: any) {
  return (
    <div className="space-y-2">
      {!exportData && !exportLoading && (
        <div className="p-4 text-[11px] text-[var(--nv-text-tertiary)] leading-relaxed">
          选好目标平台后点「加载并导出整书」，一键拿到按平台规矩排版好的全本导出稿；
          或直接点「分章打包 ZIP 导出」，每章一个独立 .txt，方便批量上传平台后台。
          <br />
          稿件全程在你自己电脑上处理，不上传。
        </div>
      )}

      <div className="px-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--nv-text-tertiary)] shrink-0">导出格式</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="flex-1 rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] px-1.5 py-1 text-xs text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-primary)]"
          >
            <option value="txt">TXT（纯文本，直接丢后台）</option>
            <option value="html">HTML（带排版，浏览器可读）</option>
          </select>
        </div>

        <button
          onClick={run}
          disabled={exportLoading}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[var(--nv-primary)] py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <Icon name="rocket" size={13} className={exportLoading ? "animate-spin" : ""} />
          {exportLoading ? "正在排版整书…" : "加载并导出整书"}
        </button>

        <button
          onClick={exportZip}
          disabled={zipLoading}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-[var(--nv-primary)] bg-[var(--nv-primary)]/10 py-1.5 text-xs font-medium text-[var(--nv-primary)] hover:bg-[var(--nv-primary)]/20 disabled:opacity-50"
        >
          <Icon name="package" size={13} className={zipLoading ? "animate-spin" : ""} />
          {zipLoading ? "正在分章打包…" : "分章打包 ZIP 导出（每章一个 .txt）"}
        </button>

        {exportError && <div className="text-[11px] text-[var(--nv-danger)]">导出失败：{exportError}</div>}
        {zipError && <div className="text-[11px] text-[var(--nv-danger)]">打包失败：{zipError}</div>}

        {meta && (
          <div className="text-[10px] text-[var(--nv-text-muted)] leading-relaxed">
            预检口径：{PLATFORM_LABEL[meta.riskPlatform] ?? meta.riskPlatform} · 排版口径：
            {PLATFORM_LABEL[meta.publishPlatform] ?? meta.publishPlatform}
            {meta.truncated ? ` · 已扫描 ${meta.scannedChars} 字（超长截断）` : ""}
          </div>
        )}
      </div>

      {publish && (
        <div className="border-t border-[var(--nv-border-2)] pb-2">
          <SectionTitle icon="upload" hint={`共 ${publish.summary?.totalWords?.toLocaleString() ?? 0} 字`}>
            导出结果
          </SectionTitle>
          <div className="px-3 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={download}
                className="flex-1 rounded border border-[var(--nv-primary)] bg-[var(--nv-primary)]/10 py-1.5 text-[11px] font-medium text-[var(--nv-primary)] hover:bg-[var(--nv-primary)]/20"
              >
                下载 {format.toUpperCase()}
              </button>
              <button
                onClick={copy}
                className="flex-1 rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] py-1.5 text-[11px] font-medium text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-3)]"
              >
                {copied ? "已复制" : "复制全文"}
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1 text-center">
              <div className="rounded bg-[var(--nv-surface-2)] py-1">
                <div className="text-sm font-bold text-[var(--nv-text-primary)]">{publish.summary?.total ?? 0}</div>
                <div className="text-[9px] text-[var(--nv-text-tertiary)]">章</div>
              </div>
              <div className="rounded bg-[var(--nv-primary)]/10 py-1">
                <div className="text-sm font-bold text-[var(--nv-primary)]">{publish.summary?.ok ?? 0}</div>
                <div className="text-[9px] text-[var(--nv-text-tertiary)]">达标</div>
              </div>
              <div className="rounded bg-[#d99300]/10 py-1">
                <div className="text-sm font-bold text-[#d99300]">{publish.summary?.short ?? 0}</div>
                <div className="text-[9px] text-[var(--nv-text-tertiary)]">偏短</div>
              </div>
              <div className="rounded bg-[#3b82f6]/10 py-1">
                <div className="text-sm font-bold text-[#3b82f6]">{publish.summary?.long ?? 0}</div>
                <div className="text-[9px] text-[var(--nv-text-tertiary)]">偏长</div>
              </div>
            </div>

            <div className="space-y-1 max-h-56 overflow-y-auto">
              {chapters.map((c: any) => {
                const dot =
                  c.status === "ok" ? "var(--nv-primary)" : c.status === "short" ? "#d99300" : "#3b82f6";
                return (
                  <div
                    key={c.nodeId}
                    className="flex items-start gap-1.5 rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-1.5"
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] text-[var(--nv-text-primary)]">{c.title}</span>
                        <span className="shrink-0 text-[9px] text-[var(--nv-text-tertiary)]">{c.words} 字</span>
                      </div>
                      <div className="text-[9px] text-[var(--nv-text-muted)] leading-snug">{c.advice}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 可选预检（默认折叠，避免机械感） */}
      {exportData && (
        <div className="border-t border-[var(--nv-border-2)]">
          <button
            onClick={() => setShowPreCheck((v: boolean) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-2)]"
          >
            <span className="flex items-center gap-1.5">
              <Icon name="shield" size={13} />
              过审预检与一致性巡检（可选）
            </span>
            <span>{showPreCheck ? "收起" : "展开"}</span>
          </button>

          {showPreCheck && (
            <div className="pb-2">
              {risk && (
                <section className="border-t border-[var(--nv-border-2)]">
                  <SectionTitle icon="shield" hint={`风险 ${risk.riskScore ?? 0} · ${risk.platformLabel}`}>
                    过审预检
                  </SectionTitle>
                  <div className="px-3 pb-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <RiskBadge level={risk.riskLevel} label={risk.riskLevelLabel} />
                    </div>
                    <p className="text-[10px] text-[var(--nv-text-muted)] leading-relaxed">{risk.platformNote}</p>
                    <div className="space-y-1.5">
                      {(risk.dimensions || []).map((d: any) => {
                        const score = d.score ?? 0;
                        const c = score >= 60 ? "var(--nv-primary)" : score >= 35 ? "#d99300" : "var(--nv-danger)";
                        return (
                          <div key={d.key}>
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-[var(--nv-text-secondary)]">{d.label}</span>
                              <span className="text-[var(--nv-text-tertiary)]">{score}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[var(--nv-surface-3)] overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${score}%`, background: c }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {(risk.findings || []).length > 0 && (
                      <div className="space-y-1">
                        {(risk.findings || []).map((f: any, i: number) => (
                          <div
                            key={i}
                            className="rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-1.5"
                          >
                            <div className="text-[10px] font-medium text-[var(--nv-text-primary)]">{f.ruleName}</div>
                            <div className="mt-0.5 text-[10px] text-[var(--nv-text-tertiary)] line-clamp-2">
                              「{f.excerpt}」
                            </div>
                            <div className="mt-0.5 text-[10px] text-[var(--nv-text-muted)]">建议：{f.suggestion}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {consistency && (
                <section className="border-t border-[var(--nv-border-2)]">
                  <SectionTitle icon="bookmarked" hint={`M3 · ${(consistency.issues || []).length} 项`}>
                    长篇一致性巡检
                  </SectionTitle>
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      <span className="rounded bg-[var(--nv-surface-2)] px-1.5 py-0.5 text-[var(--nv-text-tertiary)]">
                        全书 {consistency.stats?.chapters ?? 0} 章
                      </span>
                      <span className="rounded bg-[var(--nv-surface-2)] px-1.5 py-0.5 text-[var(--nv-text-tertiary)]">
                        角色 {consistency.stats?.characters ?? 0}
                      </span>
                      <span className="rounded bg-[var(--nv-surface-2)] px-1.5 py-0.5 text-[var(--nv-text-tertiary)]">
                        {consistency.stats?.chars ?? 0} 字
                      </span>
                    </div>
                    {(consistency.issues || []).length === 0 ? (
                      <div className="rounded border border-[var(--nv-primary)]/30 bg-[var(--nv-primary)]/5 px-2 py-1.5 text-[10px] text-[var(--nv-primary)]">
                        未发现明显一致性问题 ✓
                      </div>
                    ) : (
                      (consistency.issues || []).map((iss: any, i: number) => (
                        <div
                          key={i}
                          className={`rounded border p-1.5 ${sevClass[iss.severity] || sevClass.low}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[10px] font-medium">{iss.title}</span>
                            <span className="shrink-0 rounded bg-black/10 px-1 text-[9px]">
                              {iss.severity === "high" ? "高" : iss.severity === "medium" ? "中" : "低"}
                            </span>
                          </div>
                          {iss.chapterTitle && (
                            <div className="text-[9px] text-[var(--nv-text-tertiary)]">{iss.chapterTitle}</div>
                          )}
                          {iss.excerpt && (
                            <div className="mt-0.5 text-[10px] text-[var(--nv-text-tertiary)] line-clamp-2">
                              「{iss.excerpt}」
                            </div>
                          )}
                          <div className="mt-0.5 text-[10px] text-[var(--nv-text-muted)]">建议：{iss.suggestion}</div>
                        </div>
                      ))
                    )}
                    <p className="text-[9px] text-[var(--nv-text-muted)] leading-snug">{consistency.disclaimer}</p>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 模拟审稿标签页 ─────────────────────────────────────────
function ReviewTab({
  role,
  setRole,
  scope,
  setScope,
  systemPrompt,
  setSystemPrompt,
  customSaved,
  saveCustom,
  reviewLoading,
  reviewError,
  runReview,
  review,
  selected,
  toggleSelect,
  copyTune,
  tuneCopied,
  applyLoading,
  applySelected,
  applyResult,
  projectId,
}: any) {
  const selectedCount = review ? review.suggestions.filter((_: any, i: number) => selected.has(i)).length : 0;

  return (
    <div className="space-y-2">
      {!review && !reviewLoading && (
        <div className="p-4 text-[11px] text-[var(--nv-text-tertiary)] leading-relaxed">
          让本地 LLM 扮演番茄/起点/晋江编辑或爽文读者给你做一审：能否签约、开头钩子、爽点密度……
          <br />
          提示词可见可改，默认系统预设，也能点「存为我的预设」保存自定义；审稿意见可直接复制给微调 AI，或一键「应用修改」落库。
        </div>
      )}

      <div className="px-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--nv-text-tertiary)] shrink-0">审稿角色</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="flex-1 rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] px-1.5 py-1 text-xs text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-primary)]"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--nv-text-tertiary)] shrink-0">审稿范围</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="flex-1 rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] px-1.5 py-1 text-xs text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-primary)]"
          >
            {SCOPE_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--nv-text-tertiary)]">提示词（可编辑）</span>
            <button
              onClick={saveCustom}
              className="flex items-center gap-1 text-[10px] text-[var(--nv-primary)] hover:underline"
            >
              <Icon name="save" size={11} /> {customSaved ? "已保存" : "存为我的预设"}
            </button>
          </div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            className="w-full rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] px-2 py-1.5 text-[10px] leading-snug text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-primary)] font-mono resize-y"
            placeholder="选择角色后自动填入默认提示词，可随意修改"
          />
        </div>

        <button
          onClick={runReview}
          disabled={reviewLoading}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[var(--nv-primary)] py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <Icon name="sparkles" size={13} className={reviewLoading ? "animate-spin" : ""} />
          {reviewLoading ? "编辑正在审稿…" : "开始模拟审稿"}
        </button>

        {reviewError && <div className="text-[11px] text-[var(--nv-danger)]">审稿失败：{reviewError}</div>}
      </div>

      {review && (
        <div className="border-t border-[var(--nv-border-2)] pb-3">
          {/* 总体结论 */}
          <div className="px-3 pt-2 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {review.verdict && (
                <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${VERDICT_CLASS[review.verdict] || "bg-[var(--nv-surface-2)] text-[var(--nv-text-secondary)]"}`}>
                  {review.verdict}
                </span>
              )}
              <span className="text-[10px] text-[var(--nv-text-tertiary)]">共 {review.suggestions?.length ?? 0} 条建议</span>
            </div>
            {review.overall && (
              <p className="text-[11px] text-[var(--nv-text-secondary)] leading-relaxed bg-[var(--nv-surface-2)] rounded p-2">
                {review.overall}
              </p>
            )}

            {/* 维度评分 */}
            {review.dimensions?.length > 0 && (
              <div className="space-y-1.5">
                {review.dimensions.map((d: any, i: number) => {
                  const score = d.score ?? 0;
                  const c = score >= 60 ? "var(--nv-primary)" : score >= 35 ? "#d99300" : "var(--nv-danger)";
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[var(--nv-text-secondary)]">{d.label}</span>
                        <span className="text-[var(--nv-text-tertiary)]">{score}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--nv-surface-3)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${score}%`, background: c }} />
                      </div>
                      {d.comment && <div className="text-[9px] text-[var(--nv-text-muted)] mt-0.5 leading-snug">{d.comment}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 操作条 */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={copyTune}
                disabled={!review.promptForTune}
                className="flex-1 rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] py-1.5 text-[11px] font-medium text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-3)] disabled:opacity-40"
              >
                {tuneCopied ? "已复制指令" : "复制给微调 AI"}
              </button>
              <button
                onClick={applySelected}
                disabled={applyLoading || selectedCount === 0}
                className="flex-1 rounded border border-[var(--nv-primary)] bg-[var(--nv-primary)]/10 py-1.5 text-[11px] font-medium text-[var(--nv-primary)] hover:bg-[var(--nv-primary)]/20 disabled:opacity-40"
              >
                {applyLoading ? "正在应用…" : `应用所选修改 (${selectedCount})`}
              </button>
            </div>

            {applyResult && (
              <div
                className={`rounded border p-2 text-[10px] leading-snug ${
                  applyResult.failed === 0
                    ? "border-[var(--nv-primary)]/30 bg-[var(--nv-primary)]/5 text-[var(--nv-primary)]"
                    : "border-[#d99300]/40 bg-[#d99300]/10 text-[#d99300]"
                }`}
              >
                已应用 {applyResult.ok} 章，失败 {applyResult.failed} 章。
                {applyResult.details.map((d: string, i: number) => (
                  <div key={i} className="mt-0.5 break-all">
                    {d}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 修改建议列表 */}
          <SectionTitle icon="message" hint="勾选后可一键应用">
            具体修改建议
          </SectionTitle>
          <div className="px-3 space-y-1.5">
            {review.suggestions?.length === 0 && (
              <div className="rounded border border-[var(--nv-primary)]/30 bg-[var(--nv-primary)]/5 px-2 py-1.5 text-[10px] text-[var(--nv-primary)]">
                编辑没挑出明显硬伤，这版可以投 ✓
              </div>
            )}
            {review.suggestions?.map((s: ReviewSuggestion, i: number) => (
              <div key={i} className="rounded border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-1.5">
                <label className="flex items-start gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggleSelect(i)}
                    className="mt-0.5 rounded border-[var(--nv-border-2)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] font-medium text-[var(--nv-text-primary)]">
                        {s.chapterTitle || s.chapterRef}
                      </span>
                      <span className={`shrink-0 rounded border px-1 text-[9px] ${sevClass[s.severity] || sevClass.low}`}>
                        {s.severity === "high" ? "高" : s.severity === "medium" ? "中" : "低"}
                      </span>
                    </div>
                    {s.location && <div className="text-[9px] text-[var(--nv-text-tertiary)]">位置：{s.location}</div>}
                    {s.issue && <div className="text-[10px] text-[var(--nv-text-secondary)] mt-0.5">问题：{s.issue}</div>}
                    {s.suggestion && <div className="text-[10px] text-[var(--nv-text-muted)] mt-0.5">改法：{s.suggestion}</div>}
                    {s.nodeId && (
                      <Link
                        href={`/workspace/${projectId}?node=${s.nodeId}`}
                        className="inline-flex items-center gap-1 mt-1 text-[10px] text-[var(--nv-primary)] hover:underline"
                      >
                        <Icon name="pencil" size={11} /> 微调入口
                      </Link>
                    )}
                  </div>
                </label>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
