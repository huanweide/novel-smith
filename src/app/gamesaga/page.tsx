"use client";

/**
 * 游戏本中枢（F6 跑团化 P0-1a）
 * 游戏模式 = 自足的创作空间：游戏本列表 + 以本书为前传派生 + 从零新建。
 * 支持 ?projectId= 上下文过滤（从小说项目进入时，置顶显示派生入口）。
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/States";
import { toastError, toastSuccess } from "@/components/ui/toast";

interface SagaItem {
  id: string;
  title: string;
  projectId: string | null;
  status: string;
  playAsName: string | null;
  rollMode: string;
  chapterCount: number;
  activeChapterId: string | null;
  updatedAt: string;
}

function SagaListInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");
  const projectName = searchParams.get("projectName");

  const [sagas, setSagas] = useState<SagaItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [showFreshInput, setShowFreshInput] = useState(false);
  const [freshTitle, setFreshTitle] = useState("");
  const [freshWorld, setFreshWorld] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/saga${projectId ? `?projectId=${projectId}` : ""}`);
      const data = await res.json();
      setSagas(data.sagas || []);
    } catch {
      toastError("加载游戏本失败");
      setSagas([]);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const derive = async () => {
    if (!projectId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/game/saga", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "derive", projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "派生失败");
      toastSuccess("游戏本已创建（前传已冻结）");
      router.push(`/gamesaga/${data.saga.id}`);
    } catch (e: any) {
      toastError(e.message || "派生失败");
    } finally {
      setCreating(false);
    }
  };

  const createFresh = async () => {
    const title = freshTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const res = await fetch("/api/game/saga", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "fresh", title, synopsis: freshWorld.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      toastSuccess("游戏本已创建");
      setShowFreshInput(false);
      setFreshTitle("");
      router.push(`/gamesaga/${data.saga.id}`);
    } catch (e: any) {
      toastError(e.message || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (saga: SagaItem) => {
    if (!confirm(`删除游戏本「${saga.title}」？其全部章节与进度将一并删除，不可恢复。`)) return;
    try {
      const res = await fetch(`/api/game/saga/${saga.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toastSuccess("已删除");
      load();
    } catch (e: any) {
      toastError(e.message || "删除失败");
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Icon name="gamepad" size={24} className="text-[var(--nv-creative)]" />
        <div>
          <h1 className="text-xl font-bold text-[var(--nv-text-primary)]">游戏本</h1>
          <p className="text-xs text-[var(--nv-text-tertiary)]">
            跑团式长期扮演 · 一本游戏本就是一条世界线，章节在这里推进，随时可导出回小说
          </p>
        </div>
      </div>

      {/* 派生入口（从小说项目进入时） */}
      {projectId && (
        <div className="mb-6 rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50 p-5">
          <p className="mb-1 text-sm font-medium text-[var(--nv-text-primary)]">
            以{projectName ? `《${projectName}》` : "本书"}为前传，开一本游戏本
          </p>
          <p className="mb-3 text-xs text-[var(--nv-text-tertiary)]">
            书名、总纲、全部章节、角色卡与世界书将冻结为前传快照——小说本体不会被改动；玩出的内容随时可导出回小说
          </p>
          <Button onClick={derive} disabled={creating} className="btn-primary rounded-xl px-5 py-2 text-sm">
            {creating ? <LoadingDots label="冻结前传" /> : <><Icon name="gamepad" size={14} /> 转化为游戏模式</>}
          </Button>
        </div>
      )}

      {/* 从零新建 */}
      <div className="mb-6">
        {showFreshInput ? (
          <div className="space-y-2 rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50 p-4">
            <input
              autoFocus
              value={freshTitle}
              onChange={(e) => setFreshTitle(e.target.value)}
              placeholder="给这本游戏本起个名字…"
              className="input-glass w-full rounded-xl px-4 py-2.5 text-sm"
            />
            <textarea
              value={freshWorld}
              onChange={(e) => setFreshWorld(e.target.value)}
              rows={3}
              placeholder="世界观前置（可空）：一句话或几句话描述这是个什么世界、你是谁——比如「修仙世界，你是入门三年的杂役弟子，刚捡到一枚神秘玉符」"
              className="input-glass w-full rounded-xl px-4 py-2.5 text-sm"
            />
            <p className="text-[10px] text-[var(--nv-text-tertiary)]">这段会作为开场的前置设定喂给 AI；想讨论得更细，可以先回首页用「探讨模式」磨世界观，再回来派生。</p>
            <div className="flex gap-2">
              <Button onClick={createFresh} disabled={creating || !freshTitle.trim()} className="btn-primary rounded-xl px-4 py-2 text-sm">创建并进入</Button>
              <Button onClick={() => setShowFreshInput(false)} className="btn-ghost rounded-xl px-4 py-2 text-sm">取消</Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowFreshInput(true)}
            className="flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--nv-border-3)] px-4 py-2.5 text-sm text-[var(--nv-text-tertiary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)]"
          >
            <Icon name="plus" size={14} /> 从零新建一本游戏本（不依赖任何小说）
          </button>
        )}
      </div>

      {/* 游戏本列表 */}
      {sagas === null ? (
        <div className="flex justify-center py-10"><LoadingDots label="加载游戏本" /></div>
      ) : sagas.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--nv-text-muted)]">
          还没有游戏本——上面挑一种方式开一本
        </p>
      ) : (
        <div className="space-y-3">
          {sagas.map((s) => (
            <div
              key={s.id}
              className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50 px-4 py-3 transition-colors hover:border-[var(--nv-creative-soft)]"
            >
              <button
                onClick={() => router.push(`/gamesaga/${s.id}`)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-[var(--nv-text-primary)]">{s.title}</p>
                <p className="mt-0.5 text-xs text-[var(--nv-text-tertiary)]">
                  {s.chapterCount} 章{s.playAsName ? ` · 扮演 ${s.playAsName}` : ""}
                  {s.rollMode === "tabletop" ? " · 跑团检定" : ""}
                </p>
              </button>
              <Button onClick={() => router.push(`/gamesaga/${s.id}`)} className="btn-ghost h-8 shrink-0 rounded-lg px-3 text-xs">进入</Button>
              <button
                onClick={() => remove(s)}
                title="删除游戏本"
                className="shrink-0 text-[var(--nv-text-muted)] opacity-0 transition-opacity hover:text-[var(--nv-danger)] group-hover:opacity-100"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SagaListPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><LoadingDots label="加载" /></div>}>
      <SagaListInner />
    </Suspense>
  );
}
