import { NextRequest, NextResponse } from "next/server";
import { removeSnapshot, restoreSnapshot } from "@/lib/db-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/snapshots/[name]  —— 下载快照文件
// POST /api/snapshots/[name]  —— 恢复该快照为当前数据库
// DELETE /api/snapshots/[name] —— 删除该快照
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^novelforge-[\w.-]+\.db$/.test(name)) {
    return NextResponse.json({ error: "非法文件名" }, { status: 400 });
  }
  const { snapshotDir } = await import("@/lib/db-snapshot").then((m) =>
    m.getDbPaths(),
  );
  const p = `${snapshotDir}/${name}`;
  const fs = await import("node:fs");
  if (!fs.existsSync(p)) {
    return NextResponse.json({ error: "快照不存在" }, { status: 404 });
  }
  const buf = fs.readFileSync(p);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^novelforge-[\w.-]+\.db$/.test(name)) {
    return NextResponse.json({ error: "非法文件名" }, { status: 400 });
  }
  try {
    const res = await restoreSnapshot(name);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^novelforge-[\w.-]+\.db$/.test(name)) {
    return NextResponse.json({ error: "非法文件名" }, { status: 400 });
  }
  try {
    const res = removeSnapshot(name);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
