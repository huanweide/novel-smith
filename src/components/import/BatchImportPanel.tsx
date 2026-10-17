"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { describeStreamError } from "@/lib/stream-error";

/**
 * 批量导入（Import Novel · M4）
 *
 * 一口气导入多本小说：每本各建一个项目，逐本串行执行并汇总结果。
 *
 * ## 为什么串行而不是并发
 * 每本导入都是「几百个节点的写事务」，并发跑三本就是三倍解析 CPU +
 * 三倍 SQLite 写锁争抢，而 SQLite 写是全库串行的——并发只会更慢，
 * 还会让失败原因难以归因。串行 + 逐本进度，用户看得到每本的结果。
 *
 * ## 编码/正则记忆
 * M1 的编码嗅探对国产 txt 够用，但总有嗅不准的（生僻字极多的书）。
 * 用户手动指定过一次就记住，下一批直接复用——这是**记忆选项**不是
 * **记忆结果**，用户仍可逐本改。
 */

interface ProjectRow {
  id: string;
  name: string;
}

type RowStatus = "pending" | "running" | "ok" | "dup" | "fail";

interface Row {
  file: File;
  status: RowStatus;
  message: string;
  projectId?: string;
  anchorId?: string | null;
  charsCreated?: number;
  loreCreated?: number;
  commitmentsCreated?: number;
}

const MEMO_KEY = "novel-import-parse-opts";

interface MemoOpts {
  encoding?: string;
  regex?: string;
  extractAssets?: boolean;
}

function readMemo(): MemoOpts {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MEMO_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as MemoOpts;
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

function writeMemo(o: MemoOpts): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEMO_KEY, JSON.stringify(o));
  } catch {
    /* localStorage 不可用（隐私模式）不是阻断性问题 */
  }
}

export function BatchImportPanel({
  open,
  files,
  projects,
  onClose,
}: {
  open: boolean;
  files: File[];
  projects: ProjectRow[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [target, setTarget] = useState("");
  const [encoding, setEncoding] = useState("");
  const [regex, setRegex] = useState("");
  const [wantExtract, setWantExtract] = useState(true);
  const [showAdv, setShowAdv] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");

  // 初始化行 + 读回记忆
  useEffect(() => {
    setRows(files.map((f) => ({ file: f, status: "pending", message: "" })));
    const memo = readMemo();
    setEncoding(memo.encoding ?? "");
    setRegex(memo.regex ?? "");
    setWantExtract(memo.extractAssets !== false);
    // 自定义正则用过才展开高级区，否则别一上来就是一屏技术选项
    if (memo.regex) setShowAdv(true);
  }, [files]);

  const patch = useCallback((i: number, p: Partial<Row>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setProgress("准备中…");
    writeMemo({ encoding, regex, extractAssets: wantExtract });

    let okCount = 0;
    let dupCount = 0;
    let failCount = 0;
    let charTotal = 0;
    let loreTotal = 0;
    let commitTotal = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      setProgress(`(${i + 1}/${files.length}) ${f.name}`);
      patch(i, { status: "running", message: "解析中…" });

      // ① 落目标项目
      let pid = "";
      let title = f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60);
      if (targetMode === "existing") {
        if (!target) {
          patch(i, { status: "fail", message: "未选择目标项目" });
          failCount++;
          continue;
        }
        pid = target;
      } else {
        try {
          const r = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: title }),
          });
          const j = await r.json();
          if (!r.ok || !j.id) {
            patch(i, { status: "fail", message: j.error ?? "创建项目失败" });
            failCount++;
            continue;
          }
          pid = j.id as string;
        } catch (e) {
          const fe = describeStreamError(e);
          patch(i, { status: "fail", message: fe ? fe.description : "创建项目异常" });
          failCount++;
          continue;
        }
      }

      // ② preview：先看清再落库（与单本流程一致，批量不该降低质量）
      try {
        const fdP = new FormData();
        fdP.append("file", f);
        fdP.append("projectId", pid);
        fdP.append("mode", "preview");
        if (encoding) fdP.append("encoding", encoding);
        if (regex.trim()) fdP.append("regex", regex.trim());
        const rp = await fetch("/api/import/novel", { method: "POST", body: fdP });
        const jp = await rp.json();
        if (!rp.ok || jp.ok === false) {
          patch(i, { status: "fail", message: jp.error ?? "解析失败" });
          failCount++;
          continue;
        }
        patch(i, { message: `预览 ${jp.health?.chapterCount ?? 0} 章，提交中…` });

        // ③ commit
        const fdC = new FormData();
        fdC.append("file", f);
        fdC.append("projectId", pid);
        fdC.append("mode", "commit");
        if (encoding) fdC.append("encoding", encoding);
        if (regex.trim()) fdC.append("regex", regex.trim());
        if (wantExtract) fdC.append("extractAssets", "1");
        const rc = await fetch("/api/import/novel", { method: "POST", body: fdC });
        const jc = await rc.json();
        if (!rc.ok || jc.ok === false) {
          patch(i, { status: "fail", message: jc.error ?? "导入失败" });
          failCount++;
          continue;
        }
        if (jc.duplicate) {
          patch(i, {
            status: "dup",
            message: "此前已导入过，已跳过",
            projectId: pid,
          });
          dupCount++;
          continue;
        }
        const cc = jc.assets?.charactersCreated ?? 0;
        const lc = jc.assets?.loreCreated ?? 0;
        const pc = jc.assets?.commitmentsCreated ?? 0;
        charTotal += cc;
        loreTotal += lc;
        commitTotal += pc;
        okCount++;
        patch(i, {
          status: "ok",
          message:
            `${jc.created?.chapter ?? 0} 章 / ${jc.health?.totalWords?.toLocaleString?.() ?? 0} 字` +
            (wantExtract && cc + lc > 0 ? `，提炼 ${cc} 角色 / ${lc} 设定 / ${pc} 伏笔` : ""),
          projectId: pid,
          anchorId: jc.continueAnchorId ?? null,
        });
      } catch (e) {
        const fe = describeStreamError(e);
        patch(i, { status: "fail", message: fe ? fe.description : "网络异常" });
        failCount++;
      }
    }

    setRunning(false);
    setProgress("");
    const parts = [`成功 ${okCount} 本`];
    if (dupCount) parts.push(`跳过重复 ${dupCount} 本`);
    if (failCount) parts.push(`失败 ${failCount} 本`);
    if (wantExtract && charTotal + loreTotal + commitTotal > 0) {
      parts.push(`共提炼 ${charTotal} 角色 / ${loreTotal} 设定 / ${commitTotal} 伏笔（待审）`);
    }
    toastSuccess(parts.join("，"));
  }, [running, files, targetMode, target, encoding, regex, wantExtract, patch]);

  const done = rows.length > 0 && rows.every((r) => r.status !== "pending" && r.status !== "running");
  const okRows = rows.filter((r) => r.status === "ok");

  const ENCODINGS = [
    { v: "", label: "自动识别（推荐）" },
    { v: "utf-8", label: "UTF-8" },
    { v: "gb18030", label: "GBK / GB18030（国产 txt 常见）" },
    { v: "big5", label: "Big5（繁体）" },
  ];

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!running) onClose();
      }}
      title={`批量导入 ${files.length} 本`}
      description="每本各建一个项目，逐本串行执行。同一本重复导入会自动跳过。"
      icon="book"
      size="3xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded-lg border border-[var(--nv-border)] px-4 py-2 text-sm disabled:opacity-50"
          >
            {done ? "完成" : "取消"}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-lg bg-[var(--nv-accent)] px-4 py-2 text-sm font-medium text-[var(--nv-accent-fg)] disabled:opacity-50"
          >
            {running ? progress || "导入中…" : `开始导入 ${files.length} 本`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {([
            { k: "new" as const, label: "每本新建项目" },
            { k: "existing" as const, label: `全部导入到同一项目（${projects.length}）` },
          ]).map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => setTargetMode(o.k)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                targetMode === o.k
                  ? "border-[var(--nv-accent)] bg-[var(--nv-primary-soft)] text-[var(--nv-primary)]"
                  : "border-[var(--nv-border)] text-[var(--nv-text-secondary)]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {targetMode === "existing" && (
          <label className="block text-xs">
            <span className="mb-1 block text-[var(--nv-text-secondary)]">目标项目</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded-lg border border-[var(--nv-border)] bg-[var(--nv-surface)] px-3 py-2 text-sm"
            >
              <option value="">请选择…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex items-start gap-2 rounded-lg border border-[var(--nv-border)] p-3 text-xs">
          <input
            type="checkbox"
            checked={wantExtract}
            onChange={(e) => setWantExtract(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">顺带提炼前史资产（推荐）</span>
            <div className="mt-0.5 text-[var(--nv-text-muted)]">
              生成角色卡 / 世界书草稿与时间线摘要，全部待审。
            </div>
          </span>
        </label>

        <div>
          <button
            type="button"
            onClick={() => setShowAdv((v) => !v)}
            className="text-xs text-[var(--nv-text-muted)] underline underline-offset-2"
          >
            {showAdv ? "收起" : "编码 / 章节正则（会记住你的选择）"}
          </button>
          {showAdv && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="mb-1 block text-[var(--nv-text-secondary)]">文本编码</span>
                <select
                  value={encoding}
                  onChange={(e) => setEncoding(e.target.value)}
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

        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--nv-border)] text-sm">
          <table className="w-full">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-[var(--nv-border-2)] last:border-0">
                  <td className="w-6 py-1.5 pl-3 align-top text-xs">
                    {r.status === "ok" ? "✅" : r.status === "dup" ? "⏭" : r.status === "fail" ? "❌" : "·"}
                  </td>
                  <td className="py-1.5 pr-2 align-top">
                    <div className="truncate font-medium">{r.file.name}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--nv-text-muted)]">
                      {r.message || "待处理"}
                    </div>
                  </td>
                  <td className="w-24 py-1.5 pr-3 text-right align-top text-xs text-[var(--nv-text-muted)]">
                    {(r.file.size / 1024 / 1024).toFixed(1)} MB
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {done && (
          <div className="rounded-lg border border-[var(--nv-border)] p-3 text-xs">
            <div className="font-medium">导入完成</div>
            <div className="mt-1 space-y-0.5 text-[var(--nv-text-secondary)]">
              {okRows.map((r, i) => (
                <div key={i}>
                  {r.file.name} → 项目已建，{r.message}
                  <span className="text-[var(--nv-text-muted)]">
                    （草稿请到角色卡 / 世界书页的「待审」筛选里处理）
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
