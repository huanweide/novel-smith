"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { confirmDialog, toastError, toastInfo, toastSuccess } from "@/components/ui/toast";

interface Snap {
  name: string;
  size: number;
  mtime: number;
  label?: string;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtTime(ms: number): string {
  try {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return "—";
  }
}

export function SnapshotManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/snapshots");
      const data = await res.json();
      setSnaps(Array.isArray(data.snapshots) ? data.snapshots : []);
    } catch {
      toastError("读取快照列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleCreate = async () => {
    setBusy("create");
    try {
      const res = await fetch("/api/snapshots/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        toastSuccess(`已创建快照 ${d.snapshot?.name ?? ""}`);
        setLabel("");
        refresh();
      } else {
        toastError(d.error || "创建快照失败");
      }
    } catch {
      toastError("创建快照失败（网络错误）");
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (name: string) => {
    const ok = await confirmDialog({
      title: "恢复到此快照？",
      description: `将用快照「${name}」覆盖当前数据库。恢复后请重启应用以完全生效（连接会重新加载恢复后的库）。恢复前会自动再打一份安全快照。`,
      confirmText: "恢复",
      danger: true,
    });
    if (!ok) return;
    setBusy(name);
    try {
      const res = await fetch(`/api/snapshots/${encodeURIComponent(name)}`, { method: "POST" });
      const d = await res.json();
      if (res.ok && d.ok) {
        toastInfo("已恢复。请重启应用让改动完全生效");
        refresh();
      } else {
        toastError(d.error || "恢复失败");
      }
    } catch {
      toastError("恢复失败（网络错误）");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (name: string) => {
    const ok = await confirmDialog({
      title: "删除该快照？",
      description: `快照「${name}」删除后不可恢复。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    setBusy(name);
    try {
      const res = await fetch(`/api/snapshots/${encodeURIComponent(name)}`, { method: "DELETE" });
      const d = await res.json();
      if (res.ok && d.ok) {
        toastSuccess("已删除快照");
        refresh();
      } else {
        toastError(d.error || "删除失败");
      }
    } catch {
      toastError("删除失败（网络错误）");
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = (name: string) => {
    const a = document.createElement("a");
    a.href = `/api/snapshots/${encodeURIComponent(name)}`;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Modal open={open} onClose={onClose} bare panelClassName="max-w-lg" closeOnOverlay labelledBy="snap-title">
      <div className="p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 id="snap-title" className="text-lg font-semibold flex items-center gap-2">
            <Icon name="history" size={16} className="text-[var(--nv-primary)]" /> 快照管理
          </h2>
          <button onClick={onClose} className="text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]" aria-label="关闭">
            <Icon name="x" size={16} />
          </button>
        </div>
        <p className="text-xs text-[var(--nv-text-muted)] mb-4">
          整库时间点副本，防丢最后一道防线。误删或误改后可选一份恢复（恢复后重启应用生效）。自动快照已在每次删除前与定时触发时留存。
        </p>

        <div className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <label className="block text-xs text-[var(--nv-text-secondary)] mb-1">快照标签（可选，便于辨识）</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="如：大改前 / 第5章完成后"
              className="input-glass w-full rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={handleCreate} disabled={busy === "create"} className="btn-primary">
            {busy === "create" ? "创建中…" : "创建快照"}
          </Button>
        </div>

        <div className="space-y-2">
          {loading ? (
            <p className="text-xs text-[var(--nv-text-tertiary)] py-6 text-center">读取中…</p>
          ) : snaps.length === 0 ? (
            <p className="text-xs text-[var(--nv-text-tertiary)] py-6 text-center">还没有快照，点上方「创建快照」留存第一个时间点。</p>
          ) : (
            snaps.map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--nv-text-primary)] truncate">{s.name}</span>
                    {s.label && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nv-primary-soft)] text-[var(--nv-primary)]">{s.label}</span>}
                  </div>
                  <div className="text-[10px] text-[var(--nv-text-tertiary)]">{fmtTime(s.mtime)} · {fmtSize(s.size)}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleRestore(s.name)} disabled={busy === s.name} className="text-[11px] px-2 py-1 rounded-lg btn-ghost disabled:opacity-50" title="用该快照覆盖当前库">恢复</button>
                  <button onClick={() => handleDownload(s.name)} className="text-[11px] px-2 py-1 rounded-lg btn-ghost" title="下载该快照文件">下载</button>
                  <button onClick={() => handleDelete(s.name)} disabled={busy === s.name} className="text-[11px] px-2 py-1 rounded-lg btn-ghost text-[var(--nv-danger)] disabled:opacity-50" title="删除该快照">删除</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
