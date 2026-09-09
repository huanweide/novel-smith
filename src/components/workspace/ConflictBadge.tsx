"use client";

/**
 * 世界书冲突检测可视化（ROADMAP P2 #6）
 *
 * 后端一致性冲突接口（GET /api/projects/[id]/consistency/conflicts）早已存在，
 * 但前端没有任何常驻入口——冲突躺在数据库里没人看得见。
 * 这里在写作页顶部工具栏挂一个常驻指示器：
 *   - 显示待处理（status=open）冲突数
 *   - 点开列出每条冲突（类别 / 说明 / 引发冲突的正文摘录）
 *   - 点某条直接跳到对应章节（用 nodeId 选中该章）
 *   - 可就地标记「已修正 / 忽略」
 */

import { useState, useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icons";

interface ConflictItem {
  id: string;
  nodeId: string;
  category: string;
  description: string;
  excerpt: string;
  status: string;
}

export function ConflictBadge({
  projectId,
  onJumpToNode,
}: {
  projectId: string;
  /** nodeId 用于定位章节，excerpt（正文摘录）会被设为章内查找词，实现跳到那句话并高亮 */
  onJumpToNode: (nodeId: string, excerpt?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ConflictItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/consistency/conflicts?status=open`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { conflicts?: ConflictItem[] };
      setList(Array.isArray(data?.conflicts) ? data.conflicts : []);
      setError(null);
    } catch {
      setError("冲突列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  // 顶部常驻指示器需要知道数量，故进页面即拉一次
  useEffect(() => {
    if (!projectId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const mark = async (id: string, status: "resolved" | "ignored") => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/projects/${projectId}/consistency/conflicts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setList((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError("状态更新失败，请重试");
    } finally {
      setBusyId(null);
    }
  };

  const count = list.length;
  const hasConflict = count > 0;

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasConflict ? `${count} 处待处理冲突` : "无待处理冲突"}
        title={
          hasConflict
            ? `${count} 处待处理冲突（点击展开，可跳到对应章节）`
            : "暂无未处理的设定冲突"
        }
        className={`text-xs btn-ghost px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${
          hasConflict ? "text-[var(--nv-danger)]" : ""
        }`}
      >
        <Icon name="shield" size={13} />
        冲突
        {hasConflict && (
          <span className="rounded-full bg-[var(--nv-danger)]/15 px-1.5 text-[10px] text-[var(--nv-danger)]">
            {count}
          </span>
        )}
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="待处理冲突列表"
          className="absolute left-0 top-full z-50 mt-1 w-80 max-h-96 overflow-auto rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-2 shadow-lg"
        >
          {loading && (
            <div className="px-2 py-2 text-xs text-[var(--nv-text-tertiary)]">加载中…</div>
          )}
          {error && <div className="px-2 py-2 text-xs text-[var(--nv-danger)]">{error}</div>}

          {!loading && !error && count === 0 && (
            <div className="px-2 py-3 text-xs text-[var(--nv-text-tertiary)]">
              暂无未处理的设定冲突——目前新章与已登记的事实基线没有打架。
            </div>
          )}

          {!loading &&
            !error &&
            list.map((c) => (
              <div
                key={c.id}
                className="mb-1 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-2"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  {c.category && (
                    <span className="rounded bg-[var(--nv-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--nv-accent)]">
                      {c.category}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onJumpToNode(c.nodeId, c.excerpt);
                    }}
                    className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--nv-text-secondary)] hover:text-[var(--nv-accent)]"
                    title="跳到引发冲突的章节并高亮该句"
                  >
                    跳到该章 <Icon name="arrowRight" size={11} />
                  </button>
                </div>

                <p className="text-xs leading-relaxed text-[var(--nv-text-primary)]">
                  {c.description}
                </p>

                {c.excerpt && (
                  <p className="mt-1 border-l-2 border-[var(--nv-border-2)] pl-2 text-[11px] italic leading-relaxed text-[var(--nv-text-tertiary)]">
                    “{c.excerpt}”
                  </p>
                )}

                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => mark(c.id, "resolved")}
                    className="rounded px-1.5 py-0.5 text-[10px] text-[var(--nv-success)] hover:bg-[var(--nv-success)]/10 disabled:opacity-50"
                  >
                    已修正
                  </button>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => mark(c.id, "ignored")}
                    className="rounded px-1.5 py-0.5 text-[10px] text-[var(--nv-text-tertiary)] hover:bg-[var(--nv-surface-1)] disabled:opacity-50"
                  >
                    忽略
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
