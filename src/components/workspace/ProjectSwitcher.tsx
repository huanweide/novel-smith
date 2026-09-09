"use client";

/**
 * 多项目快捷切换（ROADMAP P1 #4）
 *
 * 原先切换项目必须「回首页再选」，打断写作流。
 * 这里在写作页顶部工具栏放一个下拉：一键跳到别的项目，或直接回项目列表。
 */

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icons";

interface ProjectItem {
  id: string;
  name: string;
  _count?: { storyNodes?: number };
}

export function ProjectSwitcher({
  currentId,
  currentName,
}: {
  currentId: string;
  currentName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 展开时才拉列表，避免每次进写作页都多一个请求；已拉过则不再重复拉
  useEffect(() => {
    if (!open || list.length > 0) return;
    let alive = true;
    setLoading(true);
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: unknown) => {
        if (!alive) return;
        setList(Array.isArray(d) ? (d as ProjectItem[]) : []);
        setError(null);
      })
      .catch(() => {
        if (alive) setError("项目列表加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, list.length]);

  // 点面板外 / 按 Esc 关闭
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

  const go = (id: string) => {
    setOpen(false);
    if (id !== currentId) router.push(`/workspace/${id}`);
  };

  const others = list.filter((p) => p.id !== currentId);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="切换项目"
        className="text-xs btn-ghost max-w-[190px] px-3 py-1.5 rounded-xl flex items-center gap-1.5"
        title="切换项目（一键跳转到别的项目）"
      >
        <Icon name="book" size={13} />
        <span className="truncate">{currentName || "当前项目"}</span>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="项目列表"
          className="absolute left-0 top-full z-50 mt-1 w-64 max-h-72 overflow-auto rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-1 shadow-lg"
        >
          {loading && (
            <div className="px-3 py-2 text-xs text-[var(--nv-text-tertiary)]">加载中…</div>
          )}
          {error && <div className="px-3 py-2 text-xs text-[var(--nv-danger)]">{error}</div>}

          {!loading && !error && (
            <>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  setOpen(false);
                  router.push("/");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-2)]"
              >
                <Icon name="grid" size={12} />
                全部项目
              </button>

              {others.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--nv-text-tertiary)]">暂无其他项目</div>
              ) : (
                others.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => go(p.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-2)]"
                  >
                    <span className="truncate">{p.name}</span>
                    {typeof p._count?.storyNodes === "number" && (
                      <span className="shrink-0 text-[10px] text-[var(--nv-text-tertiary)]">
                        {p._count.storyNodes} 章
                      </span>
                    )}
                  </button>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
