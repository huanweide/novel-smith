import { NextResponse } from "next/server";
import { listSnapshots } from "@/lib/db-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/snapshots —— 列出全部快照
export async function GET() {
  try {
    const snapshots = listSnapshots();
    return NextResponse.json({ snapshots });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
