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
    // M4 列级填表禁用：只接受「真实存在的列 key」且「不含身份列」的黑名单。
    // 身份列（name/title/…，与 fill.ts getIdentityCol 同源逻辑）是行匹配的锚点，
    // 禁掉它会让 insert/update 无法按名复用（飞书/Airtable 的字段权限同样保护索引列）。
    let disabledColumns: string[] | undefined;
    if (Array.isArray(body.disabledColumns)) {
      const lt = await prisma.loreTable.findUnique({ where: { id: tableId } });
      const cols = Array.isArray(lt?.columns) ? (lt!.columns as Array<{ key?: string }>) : [];
      const validKeys = new Set(cols.map((c) => String(c.key ?? "")));
      const priority = ["name", "title", "place", "live", "key", "building"];
      const keys = cols.map((c) => String(c.key ?? ""));
      const idCol = priority.find((p) => keys.includes(p)) ?? keys[0] ?? "name";
      const incoming = body.disabledColumns.map((k: unknown) => String(k ?? ""));
      const invalid = incoming.filter((k: string) => !validKeys.has(k));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `禁用列不存在：${invalid.join("、")}（请使用表格定义中的列 key）` },
          { status: 422 },
        );
      }
      if (incoming.includes(idCol)) {
        return NextResponse.json(
          { error: `身份列「${idCol}」不可禁用：AI 按它匹配既有行，禁掉会导致行无法复用与去重` },
          { status: 422 },
        );
      }
      disabledColumns = Array.from(new Set(incoming));
    }
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
        fillEnabled: typeof body.fillEnabled === "boolean" ? body.fillEnabled : undefined,
        disabledColumns,
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
