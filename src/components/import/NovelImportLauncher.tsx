"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/icons";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { describeStreamError } from "@/lib/stream-error";
import { NovelImportDialog } from "./NovelImportDialog";

interface ProjectRow {
  id: string;
  name: string;
}

/**
 * 「导入小说」入口弹窗（Import Novel · M2）
 *
 * 为什么要这一步而不是选完文件直接导：
 * 导入是一次几百个节点的写操作，必须挂在**一个确定的项目**上。
 * 用户可能想导进已有项目（接着之前的世界观写），也可能顺手开一个新项目。
 *
 * 流程：选文件 → 选目标（新建 / 已有）→ 两段式解析预览 → 落库
 */
export function NovelImportLauncher({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [target, setTarget] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [ready, setReady] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [step, setStep] = useState<"pick" | "import">("pick");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open || step !== "pick") return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        const json = await res.json();
        if (!alive) return;
        const list: ProjectRow[] = Array.isArray(json)
          ? json.map((p: { id: string; title?: string; name?: string }) => ({
              id: p.id,
              name: p.title ?? p.name ?? "未命名",
            }))
          : [];
        setProjects(list);
      } catch {
        /* 列表拉不到不阻断：还能新建 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, step]);

  const pickFile = useCallback((f: File | null) => {
    setPendingFile(f);
    if (f) {
      // 默认用文件名（去扩展名）当新项目名，用户可改
      setNewName(f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60));
      setMode("new");
      setReady(null);
    }
  }, []);

  const ensureProject = useCallback(async (): Promise<string | null> => {
    if (mode === "existing") {
      if (!target) {
        setErr("请选择一个项目");
        return null;
      }
      return target;
    }
    const name = newName.trim();
    if (!name) {
      setErr("请给新项目起个名字");
      return null;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok || !json.id) {
        setErr(json.error ?? "创建项目失败");
        return null;
      }
      setProjects((p) => [...p, { id: json.id, name }]);
      return json.id as string;
    } catch (e) {
      const f = describeStreamError(e);
      setErr(f ? `${f.title}：${f.description}` : "网络异常，创建项目失败");
      return null;
    } finally {
      setBusy(false);
    }
  }, [mode, target, newName]);

  const next = useCallback(async () => {
    if (!pendingFile) return;
    const pid = await ensureProject();
    if (!pid) return;
    setReady(pid);
    setStep("import");
  }, [pendingFile, ensureProject]);

  const done = useCallback(
    (anchorId: string | null) => {
      if (!ready) return;
      router.push(anchorId ? `/read/${ready}?node=${anchorId}` : `/read/${ready}`);
    },
    [ready, router],
  );

  if (step === "import" && ready) {
    return (
      <NovelImportDialog
        open
        projectId={ready}
        onClose={() => {
          setStep("pick");
          setPendingFile(null);
          setReady(null);
          onClose();
        }}
        onImported={done}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导入小说"
      description="txt / markdown / epub / docx。导入后可阅读，也可从最后一章继续写。"
      icon="book"
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--nv-border)] px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!pendingFile || busy}
            className="rounded-lg bg-[var(--nv-accent)] px-4 py-2 text-sm font-medium text-[var(--nv-accent-fg)] disabled:opacity-50"
          >
            {busy ? "处理中…" : "下一步：预览分章"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block cursor-pointer rounded-lg border border-dashed border-[var(--nv-border)] p-6 text-center hover:border-[var(--nv-accent)]">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.epub,.docx"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-col items-center gap-2">
            <Icon name="upload" className="h-6 w-6 text-[var(--nv-text-muted)]" />
            <span className="text-sm font-medium">
              {pendingFile ? pendingFile.name : "点击选择小说文件"}
            </span>
            {pendingFile && (
              <span className="text-xs text-[var(--nv-text-muted)]">
                {(pendingFile.size / 1024 / 1024).toFixed(2)} MB
              </span>
            )}
          </div>
        </label>

        <div className="flex gap-2">
          {(
            [
              { k: "new" as const, label: "新建项目" },
              { k: "existing" as const, label: "导入到已有项目" },
            ]
          ).map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => setMode(o.k)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                mode === o.k
                  ? "border-[var(--nv-accent)] bg-[var(--nv-primary-soft)] text-[var(--nv-primary)]"
                  : "border-[var(--nv-border)] text-[var(--nv-text-secondary)]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {mode === "new" ? (
          <label className="block text-xs">
            <span className="mb-1 block text-[var(--nv-text-secondary)]">新项目名称</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="导入后会以这个名称建项目"
              className="w-full rounded-lg border border-[var(--nv-border)] bg-[var(--nv-surface)] px-3 py-2 text-sm"
            />
          </label>
        ) : (
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
            <span className="mt-1 block text-[var(--nv-text-muted)]">
              已导入过的项目：同名字体导入系统会跳过重复，不会产生第二份。
            </span>
          </label>
        )}

        {err && (
          <div className="rounded-lg border border-[var(--nv-danger)]/40 bg-[var(--nv-danger)]/5 p-3 text-sm text-[var(--nv-danger)]">
            {err}
          </div>
        )}
      </div>
    </Modal>
  );
}
