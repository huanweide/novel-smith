/**
 * 番茄小说发布 · 任务队列
 *
 * GET  /api/publish/fanqie/tasks?status=&limit=
 * POST { action: "enqueue" | "batch" }
 *   enqueue：单章入队（held=待确认 / immediately / scheduled）
 *   batch  ：从项目章节批量入队并生成排期（自动按番茄排版）
 * PATCH { id, action: "cancel" | "retry" | "release" | "publishNow" }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeJson } from "@/lib/api-body";
import { preflightChapter } from "@/core/publish/fanqie/preflight";
import { planSchedule } from "@/core/publish/fanqie/schedule";
import { formatForPlatform, formatChapterTitle, countWords } from "@/core/publish/pipeline";
import { FANQIE_DAILY_HARD_CAP } from "@/core/publish/fanqie/types";

async function ensureAccountId(): Promise<string> {
  const existing = await prisma.publishAccount.findFirst({ where: { platform: "fanqie" } });
  if (existing) return existing.id;
  const created = await prisma.publishAccount.create({ data: { platform: "fanqie" } });
  return created.id;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 60)));
    const tasks = await prisma.publishTask.findMany({
      where: status && status !== "all" ? { status } : undefined,
      orderBy: [{ status: "asc" }, { scheduledAt: "asc" }, { createdAt: "desc" }],
      take: limit,
    });
    const counts = await prisma.publishTask.groupBy({ by: ["status"], _count: { _all: true } });
    return NextResponse.json({
      ok: true,
      tasks: tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        nodeId: t.nodeId,
        chapterOrder: t.chapterOrder,
        chapterTitle: t.chapterTitle,
        wordCount: t.wordCount,
        status: t.status,
        scheduledAt: t.scheduledAt,
        publishedAt: t.publishedAt,
        attempts: t.attempts,
        lastError: t.lastError,
        channel: t.channel,
        preflight: (() => {
          try {
            return t.preflight ? JSON.parse(t.preflight) : null;
          } catch {
            return null;
          }
        })(),
        createdAt: t.createdAt,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "读取任务失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const parsed = await safeJson(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as any;
  try {
    const accountId = await ensureAccountId();
    const action = String(body.action || "");

    if (action === "enqueue") {
      const rawContent = String(body.content || "");
      const order = Math.max(1, Math.floor(Number(body.chapterOrder) || 1));
      const title = formatChapterTitle(String(body.chapterTitle || ""), order - 1, "fanqie");
      const content = formatForPlatform(rawContent, "fanqie");
      const pre = preflightChapter({ title, content, chapterOrder: order });

      // 幂等：同一个 node 已经在队列里（非取消态）就不再建一条，
      // 否则连点两次按钮会把同一章发两遍——这是最容易发生的重复发布事故。
      const nodeId = body.nodeId ? String(body.nodeId) : null;
      if (nodeId) {
        const existing = await prisma.publishTask.findFirst({
          where: { accountId, nodeId, status: { not: "canceled" } },
        });
        if (existing) {
          return NextResponse.json({
            ok: true,
            task: existing,
            preflight: pre,
            deduped: true,
            message: "这一章已经在队列里，没有重复入队",
          });
        }
      }

      const task = await prisma.publishTask.create({
        data: {
          accountId,
          projectId: body.projectId ? String(body.projectId) : null,
          nodeId: body.nodeId ? String(body.nodeId) : null,
          chapterOrder: order,
          chapterTitle: title,
          content,
          wordCount: countWords(content),
          status: body.scheduleMode === "immediately" ? "scheduled" : body.scheduleMode === "scheduled" ? "scheduled" : "held",
          scheduledAt: body.scheduleMode === "immediately" ? new Date() : body.scheduledAt ? new Date(body.scheduledAt) : null,
          preflight: JSON.stringify(pre),
        },
      });
      return NextResponse.json({ ok: true, task, preflight: pre });
    }

    if (action === "batch") {
      const projectId = String(body.projectId || "");
      if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
      const nodeIds: string[] = Array.isArray(body.nodeIds) ? body.nodeIds.map(String) : [];
      // 全书章节（用于算真实章节号：只入队第 5 章时它仍是「第5章」，不能变「第1章」）
      const allNodes = await prisma.storyNode.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
        select: { id: true, title: true, content: true, order: true },
      });
      const allWithContent = allNodes.filter((n) => (n.content || "").trim().length > 0);
      const posMap = new Map(allWithContent.map((n, i) => [n.id, i + 1]));

      const candidates = (
        nodeIds.length > 0 ? allWithContent.filter((n) => nodeIds.includes(n.id)) : allWithContent
      ).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (candidates.length === 0) {
        return NextResponse.json({ error: "该项目还没有可发的正文（章节内容为空）" }, { status: 400 });
      }

      const account = await prisma.publishAccount.findUnique({ where: { id: accountId } });
      const perDay = Math.max(1, Math.floor(Number(body.perDay) || account?.dailyLimit || 1));
      const startDate = String(body.startDate || "").trim() || new Date().toISOString().slice(0, 10);

      const created: Array<{ id: string; chapterOrder: number; chapterTitle: string; at: string | null; pass: boolean; score: number }> = [];
      // 已在队列里的 node 跳过：重复入队 = 同一章会发两遍
      const existingNodes = new Set(
        (
          await prisma.publishTask.findMany({
            where: { accountId, status: { not: "canceled" }, nodeId: { not: null } },
            select: { nodeId: true },
          })
        ).map((t) => t.nodeId!),
      );
      const fresh = candidates.filter((n) => !existingNodes.has(n.id));
      const skippedCount = candidates.length - fresh.length;

      // 排期只按真正要发的章数算，避免给已入队的章白占槽位
      const plan = planSchedule({
        startDate,
        count: fresh.length,
        perDay,
        dailyLimit: account?.dailyLimit || 1,
        windowStartMin: account?.windowStartMin ?? 480,
        windowEndMin: account?.windowEndMin ?? 540,
      });

      for (let i = 0; i < fresh.length; i++) {
        const node = fresh[i];
        const order = posMap.get(node.id) ?? i + 1;
        const title = formatChapterTitle(node.title, order - 1, "fanqie");
        const content = formatForPlatform(node.content || "", "fanqie");
        const pre = preflightChapter({ title, content, chapterOrder: order });
        const slot = plan.slots[i]?.at ?? null;
        const task = await prisma.publishTask.create({
          data: {
            accountId,
            projectId,
            nodeId: node.id,
            chapterOrder: order,
            chapterTitle: title,
            content,
            wordCount: countWords(content),
            // 待确认模式下统一进 held，等人在发布台逐章/批量确认
            status: (account?.autoMode || "confirm") === "auto" && slot ? "scheduled" : "held",
            scheduledAt: slot,
            preflight: JSON.stringify(pre),
          },
        });
        created.push({ id: task.id, chapterOrder: order, chapterTitle: title, at: slot?.toISOString() ?? null, pass: pre.pass, score: pre.score });
      }

      return NextResponse.json({
        ok: true,
        created,
        skipped: skippedCount,
        warnings: plan.warnings,
        dailyCap: FANQIE_DAILY_HARD_CAP,
      });
    }

    return NextResponse.json({ error: `未知 action：${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "入队失败" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const parsed = await safeJson(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as any;
  try {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "缺少任务 id" }, { status: 400 });
    const action = String(body.action || "");
    const task = await prisma.publishTask.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    if (action === "cancel") {
      const updated = await prisma.publishTask.update({ where: { id }, data: { status: "canceled" } });
      return NextResponse.json({ ok: true, task: updated });
    }
    if (action === "retry") {
      const updated = await prisma.publishTask.update({
        where: { id },
        data: { status: "scheduled", scheduledAt: new Date(), lastError: null },
      });
      return NextResponse.json({ ok: true, task: updated });
    }
    // 待确认 → 放行（到点即发）：scheduledAt 设为现在，等下一轮 tick 执行
    if (action === "release" || action === "publishNow") {
      const updated = await prisma.publishTask.update({
        where: { id },
        data: { status: "scheduled", scheduledAt: new Date(), lastError: null },
      });
      return NextResponse.json({ ok: true, task: updated });
    }
    return NextResponse.json({ error: `未知 action：${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "操作失败" }, { status: 500 });
  }
}

/**
 * DELETE /api/publish/fanqie/tasks?id=xxx   删单条
 * DELETE /api/publish/fanqie/tasks?clear=1  清空「非已发布」的任务（保留发布记录，便于对账）
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      await prisma.publishTask.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }
    if (url.searchParams.get("clear")) {
      const r = await prisma.publishTask.deleteMany({ where: { status: { not: "published" } } });
      return NextResponse.json({ ok: true, deleted: r.count });
    }
    return NextResponse.json({ error: "缺少 id 或 clear=1" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "删除失败" }, { status: 500 });
  }
}
