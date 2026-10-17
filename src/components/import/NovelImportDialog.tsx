"use client";

import { useCallback, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/icons";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { describeHttpError, describeStreamError } from "@/lib/stream-error";

/**
 * 导入小说对话框（Import Novel · M2）
 *
 * 交互取两段式：先 preview 给人看分章结果，确认无误再 commit。
 * 理由很实际——导入是"一次几百个节点"的写操作，分章错了要重导或手动删，
 * 让用户先看一眼比事后补救便宜得多。
 *
 * 编码默认自动；只有在自动解码置信度低（满屏乱码）时，用户才需要手动指定。
 */

interface PreviewChapter {
  index: number;
  title: string;
  wordCount: number;
  preview: string;
  kind: "frontmatter" | "volume" | "chapter";
}

interface PreviewResult {
  ok: boolean;
  title: string;
  encoding: string | null;
  health: {
    chapterCount: number;
    totalWords: number;
    avgWords: number;
    suspiciousShort: number[];
    suspiciousLong: number[];
    frontMatter: number[];
    emptyNodes: number[];
    warnings: string[];
  };
  chapters: PreviewChapter[];
  truncated: boolean;
  warnings: string[];
}

const ENCODINGS = [
  { v: "", label: "自动识别（推荐）" },
  { v: "utf-8", label: "UTF-8" },
  { v: "gb18030", label: "GBK / GB18030（国产 txt 常见）" },
  { v: "big5", label: "Big5（繁体）" },
  { v: "utf-16le", label: "UTF-16 LE" },
];

const KIND_LABEL: Record<PreviewChapter["kind"], string> = {
  chapter: "",
  volume: "卷",
  frontmatter: "附录",
};

export function NovelImportDialog({
  open,
  projectId,
  onClose,
  onImported,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  /** 落库成功后回调，参数为可跳转的续写锚点章节 id */
  onImported?: (continueAnchorId: string | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState("");
  const [regex, setRegex] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setPreview(null);
    setErr("");
    setBusy(null);
    setShowAdvanced(false);
    setRegex("");
  }, []);

  const doPreview = useCallback(async () => {
    if (!file) return;
    setBusy("preview");
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);
      fd.append("mode", "preview");
      if (encoding) fd.append("encoding", encoding);
      if (regex.trim()) fd.append("regex", regex.trim());

      const res = await fetch("/api/import/novel", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.hint ? `${json.error}\n${json.hint}` : (json.error ?? "解析失败"));
        setPreview(null);
        return;
      }
      setPreview(json as PreviewResult);
    } catch (e) {
      const f = describeStreamError(e);
      setErr(f ? `${f.title}：${f.description}` : "网络异常，解析失败");
    } finally {
      setBusy(null);
    }
  }, [file, projectId, encoding, regex]);

  const doCommit = useCallback(async () => {
    if (!file) return;
    setBusy("commit");
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);
      fd.append("mode", "commit");
      if (encoding) fd.append("encoding", encoding);
      if (regex.trim()) fd.append("regex", regex.trim());

      const res = await fetch("/api/import/novel", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error ?? "导入失败");
        return;
      }
      if (json.duplicate) {
        toastSuccess(json.message);
      } else {
        toastSuccess(json.message ?? "导入完成");
      }
      onImported?.(json.continueAnchorId ?? null);
      reset();
      onClose();
    } catch (e) {
      const f = describeStreamError(e);
      toastError(f ? `${f.title}：${f.description}` : "网络异常，导入失败");
    } finally {
      setBusy(null);
    }
  }, [file, projectId, encoding, regex, onImported, onClose, reset]);

  const h = preview?.health;
  const needsEncodingHelp =
    !!preview &&
    preview.warnings.some((w) => w.includes("置信度低") || w.includes("手动指定编码"));

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      title="导入小说"
      description="支持 txt / markdown / epub / docx。导入后可阅读，也可从最后一章继续写。"
      icon="book"
      size="3xl"
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={!!busy}
            className="rounded-lg border border-[var(--nv-border)] px-4 py-2 text-sm disabled:opacity-50"
          >
            取消
          </button>
          {!preview ? (
            <button
              type="button"
              onClick={doPreview}
              disabled={!file || busy !== null}
              className="rounded-lg border border-[var(--nv-border)] bg-[var(--nv-surface-2)] px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy === "preview" ? "解析中…" : "解析并预览"}
            </button>
          ) : (
            <button
              type="button"
              onClick={doCommit}
              disabled={busy !== null}
              className="rounded-lg bg-[var(--nv-accent)] px-4 py-2 text-sm font-medium text-[var(--nv-accent-fg)] disabled:opacity-50"
            >
              {busy === "commit"
                ? "导入中…"
                : `确认导入 ${h?.chapterCount ?? 0} 个节点`}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* ─── 选文件 ─── */}
        <label className="block cursor-pointer rounded-lg border border-dashed border-[var(--nv-border)] p-6 text-center hover:border-[var(--nv-accent)]">
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.md,.markdown,.epub,.docx,text/plain,application/epub+zip"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setErr("");
            }}
          />
          <div className="flex flex-col items-center gap-2">
            <Icon name="upload" className="h-6 w-6 text-[var(--nv-text-muted)]" />
            {file ? (
              <>
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-[var(--nv-text-muted)]">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · 点击更换
                </span>
              </>
            ) : (
              <>
                <span className="text-sm">点击选择小说文件</span>
                <span className="text-xs text-[var(--nv-text-muted)]">
                  txt / markdown / epub / docx，单本上限 50MB
                </span>
              </>
            )}
          </div>
        </label>

        {/* ─── 高级选项 ─── */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-[var(--nv-text-muted)] underline underline-offset-2"
          >
            {showAdvanced ? "收起" : "解析异常？手动指定编码 / 章节正则"}
          </button>
          {showAdvanced && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="mb-1 block text-[var(--nv-text-secondary)]">文本编码</span>
                <select
                  value={encoding}
                  onChange={(e) => {
                    setEncoding(e.target.value);
                    setPreview(null);
                  }}
                  className="w-full rounded-lg border border-[var(--nv-border)] bg-[var(--nv-surface)] px-2 py-1.5 text-sm"
                >
                  {ENCODINGS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-[var(--nv-text-secondary)]">章节标题正则</span>
                <input
                  value={regex}
                  onChange={(e) => setRegex(e.target.value)}
                  placeholder="如 ^第\\s*[0-9零一二三四五六七八九十]+\\s*章"
                  className="w-full rounded-lg border border-[var(--nv-border)] bg-[var(--nv-surface)] px-2 py-1.5 font-mono text-sm"
                />
              </label>
            </div>
          )}
        </div>

        {needsEncodingHelp && (
          <div className="rounded-lg border border-[var(--nv-warn)]/40 bg-[var(--nv-warn)]/5 p-3 text-xs text-[var(--nv-text-secondary)]">
            正文看着像乱码？在上面「解析异常」里手动指定编码（国产 txt 通常选 GBK / GB18030），然后重新解析。
          </div>
        )}

        {err && (
          <div className="whitespace-pre-line rounded-lg border border-[var(--nv-danger)]/40 bg-[var(--nv-danger)]/5 p-3 text-sm text-[var(--nv-danger)]">
            {err}
          </div>
        )}

        {/* ─── 预览报告 ─── */}
        {preview && h && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="章节数" value={String(h.chapterCount)} />
              <Stat label="总字数" value={h.totalWords.toLocaleString()} />
              <Stat label="平均每章" value={h.avgWords.toLocaleString()} />
              <Stat label="编码" value={preview.encoding ?? "—"} />
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-lg border border-[var(--nv-warn)]/40 bg-[var(--nv-warn)]/5 p-3 text-xs">
                <div className="mb-1 font-medium">解析提示</div>
                <ul className="list-disc space-y-0.5 pl-4 text-[var(--nv-text-secondary)]">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-[var(--nv-border)]">
              <div className="max-h-72 overflow-y-auto text-sm">
                <table className="w-full">
                  <tbody>
                    {preview.chapters.map((c) => (
                      <tr key={c.index} className="border-b border-[var(--nv-border-2)] last:border-0">
                        <td className="w-12 py-1.5 pl-3 align-top text-xs text-[var(--nv-text-muted)]">
                          {c.index}
                        </td>
                        <td className="py-1.5 pr-2 align-top">
                          <span className="font-medium">{c.title}</span>
                          {KIND_LABEL[c.kind] && (
                            <span className="ml-2 rounded border border-[var(--nv-border)] px-1 text-[10px] text-[var(--nv-text-muted)]">
                              {KIND_LABEL[c.kind]}
                            </span>
                          )}
                          <div className="mt-0.5 truncate text-xs text-[var(--nv-text-muted)]">
                            {c.preview}
                          </div>
                        </td>
                        <td className="w-20 py-1.5 pr-3 text-right align-top text-xs text-[var(--nv-text-muted)]">
                          {h.suspiciousShort.includes(c.index)
                            ? "⚠偏短"
                            : h.suspiciousLong.includes(c.index)
                              ? "⚠偏长"
                              : `${c.wordCount} 字`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.truncated && (
                <div className="border-t border-[var(--nv-border-2)] px-3 py-1.5 text-xs text-[var(--nv-text-muted)]">
                  仅预览前 100 章，全部 {h.chapterCount} 个节点都会导入
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--nv-border)] px-3 py-2">
      <div className="text-xs text-[var(--nv-text-muted)]">{label}</div>
      <div className="mt-0.5 text-base font-medium tabular-nums">{value}</div>
    </div>
  );
}
