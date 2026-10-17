"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import { confirmDialog, toastError, toastSuccess, toastInfo } from "@/components/ui/toast";
import { describeHttpError } from "@/lib/stream-error";
import { useConfirmDelete } from "@/components/workspace/useConfirmDelete";
import { EmptyState, Loading } from "@/components/ui/States";
import { NovelImportLauncher } from "@/components/import/NovelImportLauncher";

interface TaskBrief {
  id: string;
  taskName: string;
  bookName: string;
  bookAuthor: string;
  depth: string;
  status: string;
  progress: number;
  totalChapters: number;
  completedChapters: number;
  convertedToProjectId?: string;
  error?: string;
  createdAt: string;
}

export default function DissectPage() {
  const [tasks, setTasks] = useState<TaskBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadHint, setLoadHint] = useState<string | null>(null);
  // v3.1.149：拆书页内置「导入小说」入口——拆书是逆向学习别人的写法，
  // 导入是把自己已有的稿子落成作品，两者常被混淆，页面上直接说清并给第二条路。
  const [novelImportOpen, setNovelImportOpen] = useState(false);

  useEffect(() => {
    loadTasks();
    // 每3秒刷新（可能有正在运行的任务）；出错后暂停轮询，避免反复报错
    const interval = setInterval(() => {
      if (!loadError) loadTasks();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadError]);

  async function loadTasks() {
    try {
      const res = await fetch("/api/dissect/list");
      const data = (await res.json().catch(() => ({}))) as { tasks?: TaskBrief[]; error?: string; hint?: string };
      if (!res.ok) {
        setLoadError(data.error || `加载失败（${res.status}）`);
        setLoadHint(data.hint || "");
        return;
      }
      setTasks(data.tasks || []);
      setLoadError(null);
      setLoadHint(null);
    } catch {
      setLoadError("网络错误，无法加载拆书任务");
      setLoadHint("请检查本地 3001 服务是否仍在运行。");
    } finally {
      setLoading(false);
    }
  }

  const { deletingId, remove: deleteTask } = useConfirmDelete({
    title: "删除拆书任务",
    description: "确定删除这个拆书任务？此操作不可恢复。",
    deleteFn: async (id) => {
      const res = await fetch(`/api/dissect/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const failure = describeHttpError(res.status, d);
        throw new Error(failure.description);
      }
    },
    onSuccess: (id) => setTasks((prev) => prev.filter((t) => t.id !== id)),
    errorPrefix: "删除失败",
  });

  const depthLabel: Record<string, string> = {
    quick: "快速",
    standard: "标准",
    deep: "精细",
  };

  const statusBadge = (task: TaskBrief) => {
    if (task.status === "completed")
      return (
        <span className="rounded-full bg-[var(--nv-success-soft)] px-2 py-0.5 text-xs text-[var(--nv-success)]">
          完成
        </span>
      );
    if (task.status === "failed")
      return (
        <span className="rounded-full bg-[var(--nv-danger-soft)] px-2 py-0.5 text-xs text-[var(--nv-danger)]">
          失败
        </span>
      );
    return (
      <span className="rounded-full bg-[var(--nv-primary-soft)] px-2 py-0.5 text-xs text-[var(--nv-primary)]">
        进行中 {Math.round(task.progress)}%
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--nv-void)] text-[var(--nv-text-secondary)]">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-[var(--nv-border-2)] bg-[var(--nv-abyss)] px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nv-text-tertiary)] transition-colors hover:bg-[var(--nv-surface-2)] hover:text-[var(--nv-text-primary)]" aria-label="返回">
              <Icon name="arrowLeft" size={18} />
            </Link>
            <h1 className="flex items-center gap-2 text-lg font-bold text-[var(--nv-text-primary)]">
              <Icon name="book" size={18} className="text-[var(--nv-creative)]" />
              拆书导航
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNovelImportOpen(true)}
              className="btn-ghost flex items-center gap-1.5 rounded-lg border border-[var(--nv-accent)]/45 px-4 py-2 text-sm text-[var(--nv-accent)] transition-colors hover:bg-[var(--nv-accent-soft)]"
            >
              <Icon name="upload" size={14} /> 导入小说
            </button>
            <Link
              href="/dissect/new"
              className="btn-primary flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Icon name="plus" size={14} /> 新建拆书
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {loadError ? (
          <div className="surface-elevated rounded-2xl py-16 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--nv-danger-soft)] border border-[var(--nv-danger)]/20">
              <Icon name="alert" size={28} className="text-[var(--nv-danger)]" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-[var(--nv-text-primary)]">拆书任务加载失败</h2>
            <p className="mb-2 text-sm text-[var(--nv-text-secondary)]">{loadError}</p>
            {loadHint && <p className="mx-auto mb-6 max-w-md text-xs text-[var(--nv-text-tertiary)]">{loadHint}</p>}
            <button
              onClick={() => {
                setLoadError(null);
                setLoadHint(null);
                loadTasks();
              }}
              className="btn-primary inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold"
            >
              <Icon name="loader" size={14} className="animate-spin" /> 重试
            </button>
          </div>
        ) : loading ? (
          <div className="surface-elevated rounded-2xl py-16">
            <Loading label="正在加载拆书任务…" />
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="book"
            title="还没有拆书任务"
            description="上传一本小说原文，AI 将自动拆解为世界观、角色、情节脉络等维度"
            action={
              <div className="flex flex-col items-center gap-4">
                <Link
                  href="/dissect/new"
                  className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-6 py-3 text-sm font-medium"
                >
                  <Icon name="plus" size={16} /> 开始第一次拆书
                </Link>
                <div className="max-w-md rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-4 text-left">
                  <p className="text-sm text-[var(--nv-text-secondary)]">
                    拆书是<b className="text-[var(--nv-text-primary)]">逆向学习别人的写法</b>，不产生正文。
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--nv-text-tertiary)]">
                    如果你已经有自己的稿子（txt / epub / docx），想让 AI 接着往下写，应该用「导入小说」——导入后直接落进「我的作品」，并自动提炼角色、世界观和伏笔。
                  </p>
                  <button
                    onClick={() => setNovelImportOpen(true)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--nv-accent)]/45 px-4 py-2 text-sm text-[var(--nv-accent)] transition-colors hover:bg-[var(--nv-accent-soft)]"
                  >
                    <Icon name="upload" size={14} /> 导入小说，导入即成作品
                  </button>
                </div>
              </div>
            }
            className="surface-elevated border-solid border-[var(--nv-border-2)]"
          />
        ) : (
          <div className="grid gap-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="surface-elevated rounded-xl p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--nv-border-3)] hover:shadow-[var(--shadow-glass-rest)]"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <Link
                        href={`/dissect/${task.id}`}
                        className="truncate text-base font-semibold text-[var(--nv-text-primary)] transition-colors hover:text-[var(--nv-primary)]"
                      >
                        {task.bookName}
                      </Link>
                      {statusBadge(task)}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--nv-text-tertiary)]">
                      <span>任务：{task.taskName}</span>
                      {task.bookAuthor && <span>作者：{task.bookAuthor}</span>}
                      <span>深度：{depthLabel[task.depth] || task.depth}</span>
                      <span>{task.totalChapters}章</span>
                      {task.convertedToProjectId && (
                        <a
                          href={`/workspace/${task.convertedToProjectId}`}
                          className="text-[var(--nv-primary)] transition-colors hover:text-[var(--nv-creative)]"
                        >
                          查看项目 →
                        </a>
                      )}
                    </div>
                    {task.error && (
                      <p className="mt-1 truncate text-xs text-[var(--nv-danger)]">{task.error}</p>
                    )}
                  </div>

                  <div className="ml-4 flex items-center gap-2">
                    {task.status === "completed" && (
                      <Link
                        href={`/dissect/${task.id}`}
                        className="btn-ghost rounded-lg px-3 py-1.5 text-xs"
                      >
                        查看结果
                      </Link>
                    )}
                    <button
                      onClick={() => deleteTask(task.id)}
                      disabled={deletingId === task.id}
                      className="btn-ghost rounded-lg px-3 py-1.5 text-xs text-[var(--nv-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId === task.id ? "删除中…" : "删除"}
                    </button>
                  </div>
                </div>

                {/* 进度条（进行中的任务） */}
                {task.status !== "completed" && task.status !== "failed" && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--nv-surface-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--nv-primary)] transition-all duration-1000"
                      style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 导入小说弹窗：导入后由组件内部 router.push 跳进新作品 */}
      {novelImportOpen && (
        <NovelImportLauncher open onClose={() => setNovelImportOpen(false)} />
      )}
    </div>
  );
}
