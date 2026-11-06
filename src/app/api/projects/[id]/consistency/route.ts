import { NextRequest, NextResponse } from "next/server";
import {
  extractConsistencyFacts,
  getConsistencyFacts,
} from "@/core/consistency/extractFacts";
import { jsonError } from "@/lib/api";
import { classifyError } from "@/lib/api-error";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const facts = await getConsistencyFacts(id);
    return NextResponse.json({ facts });
  } catch (e) {
    const info = classifyError(e);
    return jsonError(info.error, info.status, info.code);
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await extractConsistencyFacts(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // 原来 catch 里硬编码 jsonError(msg, 500)，把「LLM API Key 未配/非法」这类
    // 用户可操作的配置错误伪装成服务器故障。改用统一分类：CONFIG → 400 + 可读文案，
    // Prisma 异常 → 503 等。保留 not found 的 404 语义。
    const msg = (e as Error).message;
    if (msg.includes("not found")) return jsonError(msg, 404);
    const info = classifyError(e);
    return jsonError(info.error, info.status, info.code);
  }
}
