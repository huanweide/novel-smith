import { NextRequest, NextResponse } from "next/server";
import { createSnapshot, pruneSnapshots } from "@/lib/db-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/snapshots/create —— 手动创建一份快照
// body: { label?: string }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { label?: string };
    const label = typeof body.label === "string" ? body.label.slice(0, 40) : undefined;
    const snap = await createSnapshot(label);
    pruneSnapshots(10);
    return NextResponse.json({ ok: true, snapshot: snap });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
