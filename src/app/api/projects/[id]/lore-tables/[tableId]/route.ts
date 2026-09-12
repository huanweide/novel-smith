import { jsonError } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// PUT /api/projects/[id]/lore-tables/[tableId] —— 更新表格（含行编辑）
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; tableId: string }> },
) {
  try {
    const { tableId } = await params;
    const body = await request.json();
    // 白名单写入：只接受表自身可编辑字段。
    // 此前 `data: { ...body } as any` 会把 projectId / id / createdAt 等系统字段一并写库，
    // 客户端可借请求体把表格挪到别的项目或篡改主键；这里显式收窄并去掉 `as any` 恢复类型检查。
    const lt = await prisma.loreTable.update({
      where: { id: tableId },
      data: {
        name: body.name,
        key: body.key,
        note: body.note,
        category: body.category,
        marker: body.marker,
        columns: body.columns,
        rows: body.rows,
      },
    });
    return NextResponse.json(lt);
  } catch (e) {
    return jsonError(e);
  }
}

// DELETE /api/projects/[id]/lore-tables/[tableId]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; tableId: string }> },
) {
  try {
    const { tableId } = await params;
    await prisma.loreTable.delete({ where: { id: tableId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
