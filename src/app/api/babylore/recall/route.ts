import { jsonError } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";
import { getApprovedCharacters, getApprovedLore } from "@/lib/approved-cards";
import { NextResponse } from "next/server";
import { recallContext } from "@/core/babylore/recall";
import { scheduleBackfill } from "@/core/memory/backfill-hook";
import { buildSemanticHints } from "@/core/memory/semantic-recall";

// POST /api/babylore/recall  { projectId, context }
// 剧情推进=记忆召回：根据上下文匹配世界书(绿灯)与结构化表格行，返回应注入的记忆。
export async function POST(request: Request) {
  try {
    const { projectId, context } = (await request.json()) as any;
    if (!projectId || !context) {
      return NextResponse.json({ error: "缺少 projectId 或 context" }, { status: 400 });
    }

    // 惰性触发历史设定的向量回填（不 await）。
    // 语义召回只对「已生成过向量」的条目生效，改功能之前录的老设定一条向量都没有。
    // 挂在真实用到召回的时机，内部有节流——不会每次请求都跑。
    // 没配 embedding key 时它会直接跳过，零成本。
    try {
      scheduleBackfill(projectId);
    } catch {
      // 兜底：调度本身绝不能影响正常召回
    }

    const [lore, tables, semantic] = await Promise.all([
      getApprovedLore(prisma, projectId),
      prisma.loreTable.findMany({ where: { projectId } }),
      // 语义线索单独兜底：拿不到就退回纯关键词召回，绝不影响正常写作。
      // 与上面两个查询并行，不额外增加串行等待。
      buildSemanticHints(context, projectId).catch(() => null),
    ]);

    // 第四参数不传 = 纯关键词召回，行为与语义功能上线前完全一致
    const items = recallContext(context, lore as any, tables as any, semantic ?? undefined);
    return NextResponse.json({ items, count: items.length });
  } catch (e) {
    return jsonError(e);
  }
}
