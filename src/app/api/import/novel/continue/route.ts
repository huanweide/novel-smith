/**
 * POST /api/import/novel/continue
 *
 * 「从此继续写」：在导入内容之后接一个新章节节点（Import Novel · M2）
 *
 * 为什么单独一条路由而不是复用 POST /api/story/nodes：
 * 续写要带「承接自哪一章」的线索（notes 里），还要保证 order 排在所有导入节点之后。
 * 这些是导入场景特有的语义，塞进通用建节点接口会把它变脏。
 */

import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-error";
import { readValidatedBody, asStr, asStrOrNull, badRequest } from "@/lib/validators";
import { continueAfterImport } from "@/lib/import/commit";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await readValidatedBody(request, (raw) => ({
      projectId: asStr(raw.projectId, "projectId", { required: true }),
      afterNodeId: asStrOrNull(raw.afterNodeId, "afterNodeId"),
      title: asStrOrNull(raw.title, "title"),
      contextDigest: asStrOrNull(raw.contextDigest, "contextDigest", 4000),
    }));
    if (body instanceof NextResponse) return body;

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true },
    });
    if (!project) return badRequest(`项目不存在：${body.projectId}`, "projectId");

    const node = await continueAfterImport({
      projectId: body.projectId,
      afterNodeId: body.afterNodeId,
      title: body.title ?? undefined,
      contextDigest: body.contextDigest ?? undefined,
    });
    if (!node) return badRequest("创建续写节点失败", "projectId");

    return NextResponse.json({ ok: true, node });
  } catch (err) {
    return jsonError(err);
  }
}
