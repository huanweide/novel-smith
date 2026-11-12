/**
 * R3 · 后台任务恢复原语（纯函数，零依赖）
 *
 * 背景：`app/api/generation-tasks/route.ts` 用进程内 fire-and-forget 起任务。
 * 进程崩溃 / 重启后，那些 status=running 的任务没人再推进，前端轮询永远看不到终态。
 * 这里只做「识别」，不做自动重跑——重跑可能重复生成正文，属不可逆副作用，
 * 按 L0 铁律必须交给作者决定；恢复动作为标记为 failed 并给出可重排队的原因。
 */

export interface TaskLike {
  id: string;
  status: string;
  updatedAt: Date | string | number;
}

export interface RecoveryDecision {
  taskId: string;
  nextStatus: "failed";
  reason: string;
  staleMs: number;
}

/** 默认 30 分钟无任何进展视为卡死（生成任务最长 5 分钟超时，留足余量） */
export const DEFAULT_STALE_MS = 30 * 60_000;

export function findStaleRunningTasks(
  tasks: TaskLike[],
  opts: { now?: number; staleMs?: number } = {},
): TaskLike[] {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  return (tasks || []).filter((t) => {
    if (String(t.status).toLowerCase() !== "running") return false;
    const ts = t.updatedAt instanceof Date ? t.updatedAt.getTime() : new Date(t.updatedAt).getTime();
    if (!Number.isFinite(ts)) return false;
    return now - ts > staleMs; // 恰好等于阈值不算超时
  });
}

/** 把卡死任务转成可审计的终态决策（不自动重跑） */
export function decideRecovery(tasks: TaskLike[], opts: { now?: number; staleMs?: number } = {}): RecoveryDecision[] {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  return findStaleRunningTasks(tasks, opts).map((t) => ({
    taskId: t.id,
    nextStatus: "failed" as const,
    reason: `任务超过 ${Math.round(staleMs / 60_000)} 分钟无进展（进程可能已重启），标记为失败以便作者重新发起；未自动重跑，避免重复生成。`,
    staleMs,
  }));
}
