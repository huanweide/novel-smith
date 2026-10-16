// ============================================================
// 语义召回增强 —— 把「已经备好的料」真正用起来
// ============================================================
//
// 【对用户有什么用】
//   前面几批把料都备好了：能算相似度、能拿向量、老设定在补清单。
//   但 recallContext 的 SemanticHints 参数一直没人传——碗筷摆好了菜还没下锅。
//   本文件就是下锅那一步：拿当前正文去和每条设定比，把「意思像但字面不像」的捞回来。
//
// 【核心场景】
//   正文：「那个叛变北境的将军，握着十万兵权」
//   设定：「北境守将 · 曾率部倒戈」
//   字面一个字都不重合 → 关键词召回完全失效 → AI 不知道这人是谁 → 把叛徒写成忠臣
//   语义召回：两句话方向接近 → 这条设定被送给 AI
//
// 【为什么单独一个文件】
//   这段要协调四个东西：读库里的向量、给正文算向量、比对、组装候选。
//   塞进路由里会让路由变长且难测；抽出来后每个环节都能单独断言。
//
// 【失败即退回】
//   任一环节拿不到向量（没配 key / 接口挂了 / 该条还没回填），
//   对应的相似度就是 null，recallContext 会跳过它——行为退回纯关键词召回。
//   绝不会因为语义这一层出问题而影响正常写作。

import { prisma } from "@/lib/prisma";
import { embedOne } from "@/core/llm/embedding";
import { getSettings } from "@/lib/llm";
import { isEmbeddingConfigured } from "@/core/llm/embedding";
import { cosineSimilarity } from "./hybrid-score";
import type { SemanticHints } from "@/core/babylore/recall";

/** 单次最多比对多少条。设定库通常几百条，全量足够；上限是防异常膨胀。 */
export const SEMANTIC_CANDIDATE_LIMIT = 500;

/** 把库里的 Json 向量安全地还原成 number[]。脏数据返回 null。 */
export function parseEmbedding(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return null;
  const out: number[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const n = raw[i];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

/**
 * 组装语义召回线索。给不出有效线索时返回 null（调用方据此退回纯关键词）。
 *
 * @param context    当前正文
 * @param projectId  项目 ID
 */
export async function buildSemanticHints(
  context: string,
  projectId: string,
): Promise<SemanticHints | null> {
  const text = typeof context === "string" ? context.trim() : "";
  if (!text || !projectId) return null;

  // 先判有没有调用条件，省掉一次注定失败的网络往返
  const settings = await getSettings();
  if (!isEmbeddingConfigured(settings)) return null;

  // 只取已经回填过向量的条目（没回填的不参与，等回填补上后自然生效）
  const rows = await prisma.lorebookEntry.findMany({
    where: {
      projectId,
      enabled: true,
      reviewStatus: "approved",
      embedding: { not: null } as any,
    },
    select: { id: true, title: true, content: true, embedding: true },
    take: SEMANTIC_CANDIDATE_LIMIT,
  });

  if (rows.length === 0) return null;

  const queryVec = await embedOne(text);
  if (!queryVec || queryVec.length === 0) return null;

  const candidates: SemanticHints["candidates"] = [];
  const similarities: Array<number | null> = [];

  for (const r of rows) {
    const vec = parseEmbedding(r.embedding);
    candidates.push({
      source: "lorebook",
      title: r.title,
      content: r.content,
    });

    // 三种情况都判为「不可比」= null，绝不能填 0：
    //   0 的含义是「可比但确实不像」，与「不可比」是两回事。
    //   混在一起时，将来一旦有人想统计「有多少条还没回填」就会算错。
    let sim: number | null = null;
    if (vec && vec.length === queryVec.length) {
      sim = cosineSimilarity(queryVec, vec);
    }
    similarities.push(sim);
  }

  return { candidates, similarities };
}