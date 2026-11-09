import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditBaselineConflicts } from "@/core/consistency/detectConflicts";
import { jsonError } from "@/lib/api";
import { classifyError } from "@/lib/api-error";

/**
 * POST /api/projects/[id]/consistency/audit —— 全书基线互审（P1 一致性深水区）
 *
 * 单章检测（detectConsistencyConflicts）只比「新章正文 vs 当时基线」，抓不到跨章累积矛盾
 * （物品位置跨章跳变、时间线断裂——每次单章检测时基线本身已过时）。
 * 本路由把全部基线事实交给 LLM 互审，产出「事实 vs 事实」的矛盾清单，
 * 落库 ConsistencyConflict（nodeId="audit"），与单章冲突同一处理界面。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) return jsonError("项目不存在", 404);
    const result = await auditBaselineConflicts(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const info = classifyError(e as Error);
    return jsonError(info.error, info.status, info.code);
  }
}
