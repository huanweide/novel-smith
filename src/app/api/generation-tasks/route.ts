/**
 * POST /api/generation-tasks  —— 创建真后台生成任务（立即返回 taskId，不阻塞）
 * GET  /api/generation-tasks?projectId=xxx —— 列出该项目最近任务（供前端恢复/展示）
 *
 * v1.8.6 (#174)：把「AI 生成故事线」从同步等待改为真后台——
 * 创建 pending 任务后用进程内 fire-and-forget 启动执行器，前端拿到 taskId 后轮询拿结果。
 */
export const maxDuration = 120;

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-error";
import { runStorylineGenerationTask } from "@/core/storyline/execute-task";
import { decideRecovery } from "@/core/pipeline/task-recovery";

export async function POST(request: Request) {
  try {
    const body: Record<string, unknown> = await request.json();
    const projectId = body.projectId as string | undefined;
    const targetType = (body.targetType as string) || "storyline";
    const prompt = (body.prompt as string) || "";
    if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });

    const task = await prisma.generationTask.create({
      data: { projectId, targetType, prompt, status: "pending", progress: 0 },
    });

    // 进程内 fire-and-forget：不 await，立即返回 taskId；任务在服务端继续跑。
    void runStorylineGenerationTask(task.id);

    return NextResponse.json({ taskId: task.id, status: "pending" });
  } catch (err) {
    return jsonError(err);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });

    const tasks = await prisma.generationTask.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // R3：进程崩溃后 status=running 的任务会永远悬着。读取列表时顺手把超时任务
    // 标记为 failed 并给出原因（不自动重跑——重跑会重复生成正文，属不可逆副作用，交给作者决定）。
    const recovered: string[] = [];
    for (const d of decideRecovery(tasks)) {
      const upd = await prisma.generationTask.updateMany({
        where: { id: d.taskId, status: "running" },
        data: { status: d.nextStatus, error: d.reason },
      });
      if (upd.count > 0) recovered.push(d.taskId);
    }
    const view = recovered.length > 0
      ? tasks.map((t) => recovered.includes(t.id) ? { ...t, status: "failed" as string } : t)
      : tasks;
    return NextResponse.json({ tasks: view, recovered });
  } catch (err) {
    return jsonError(err);
  }
}
