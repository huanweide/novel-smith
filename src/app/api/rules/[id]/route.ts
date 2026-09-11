import { jsonError } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// GET /api/rules/[id] —— 获取单条规则
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rule = await prisma.rule.findUnique({ where: { id } });
    if (!rule) {
      return NextResponse.json({ error: "规则不存在" }, { status: 404 });
    }
    return NextResponse.json(rule);
  } catch (err) {
    return jsonError(err);
  }
}

// PUT /api/rules/[id] —— 更新规则
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    // 白名单写入：只接受规则自身可编辑字段。
    // 此前 `data: body` 会把 projectId / id / createdAt 等系统字段一并写库，
    // 客户端可借请求体把规则挪到别的项目；这里显式收窄（与 POST 的 readValidatedBody 一致），并去掉 `as any`。
    const rule = await prisma.rule.update({
      where: { id },
      data: {
        name: body.name,
        content: body.content,
        category: body.category,
        enabled: body.enabled,
        priority: body.priority,
        scope: body.scope,
        scopeType: body.scopeType,
        specificityScore: body.specificityScore,
        scopeConfig: body.scopeConfig,
      },
    });
    return NextResponse.json(rule);
  } catch (err) {
    return jsonError(err);
  }
}

// DELETE /api/rules/[id] —— 删除规则
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.rule.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return jsonError(err);
  }
}
