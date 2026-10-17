// ============================================================
// 混合召回打分 —— 关键词分 + 语义分的合并（纯函数，零依赖）
// ============================================================
//
// 为什么需要这个文件：
//   recall.ts 原本的召回**门槛**是「必须有关键词真实命中」，一个词不中就continue，
//   根本进不了候选列表。这带来一类召不出来的情况：
//     正文写「那个背叛主角的将军」，世界书写「曾率部倒戈的北境守将」
//     —— 关键词一个都对不上，于是这条设定永远注入不到 prompt。
//   纯排序层加语义分**解决不了**这个问题，因为候选根本没进列表。
//
// 所以这里提供两件事，都保持「无向量时行为与改动前完全一致」：
//   1. cosineSimilarity —— 余弦相似度（维度不匹配/空向量一律返0，即「不匹配」）
//   2. mixScore         —— 混合打分：α×关键词分 + (1-α)×语义分
//
// 边界（明确不做）：
//   - 不做 rerank 交叉编码器（延迟与成本双高，收益不匹配本地优先的定位）
//   - 不做向量数据库（百级记忆量全量余弦足够，HNSW 属于过度设计）
//   - 不改recall.ts 的对外签名，语义召回以「可选增强项」的形式传入
//
// 「未向量化」与「语义不匹配」是两种状态，本文件用 null / 0 区分开：
//   null = 这条记忆还没生成向量（不可比，不代表不相关）
//   0= 向量可比但确实不像
// 把两者混成同一个值，是这类实现最常见的错。

/** 余弦相似度。任一为空/维度不一致 → 0（语义不匹配），不抛错。 */
export function cosineSimilarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    // 非有限数（NaN/Infinity）视为脏数据，整条判为不可比
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;

  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  // 浮点误差可能让理论上的 1 变成 1.0000000000000002
  if (sim > 1) return 1;
  if (sim < -1) return -1;
  return sim;
}

/** 混合打分默认权重：关键词 0.4 / 语义 0.6。 */
export const DEFAULT_MIX_ALPHA = 0.4;

/**
 * 把关键词分与语义分合并成最终排序分。
 *
 * @param keywordScore 现有关键词特异性分（recall.ts 里scoreKeyword 的值）
 * @param semantic     余弦相似度；null/undefined 表示「未向量化，不可比」
 * @param alpha        关键词权重，取值 0~1。缺省 DEFAULT_MIX_ALPHA
 *
 * 未向量化时退化为纯关键词分——这是向后兼容的关键：
 * 没配 embedding key 的项目，行为与本次改动前**逐位一致**。
 */
export function mixScore(
  keywordScore: number,
  semantic: number | null | undefined,
  alpha: number = DEFAULT_MIX_ALPHA,
): number {
  const kw = Number.isFinite(keywordScore) ? keywordScore : 0;
  const a = clamp01(alpha);

  // 未向量化：只有关键词分，权重不缩放，避免无向量时分数被压低导致排序整体变化
  if (semantic == null || !Number.isFinite(semantic)) return kw;

  const sim = Math.max(0, Math.min(1, semantic));
  // 归一化到与关键词分同一量纲：关键词分是「命中词长度」，语义分是 0~1。
  // 不归一化的话α 失去意义——乘一个几十分的值再加 1 以下的语义分，等于关键词永远压过语义。
  return a * kw + (1 - a) * sim;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MIX_ALPHA;
  return Math.max(0, Math.min(1, n));
}

/**
 * 语义召回的候选来源。召回函数用它给出「关键词没命中但语义像」的条目。
 * 与 recallContext 返回的 RecallItem 同形，便于直接合并排序。
 */
export interface SemanticCandidate {
  source: "lorebook" | "table";
  title: string;
  content: string;
  /** 0~1 */
  similarity: number;
}

/**
 * 阈值过滤：只有相似度够高才认为「召得到」。
 * 默认 0.62 —— 低于这个值的语义相近多半是「同一个通用词」的噪声，
 * 高于它通常确实在讲同一件事。宁可漏召回也不要注入无关设定污染上下文。
 */
export const DEFAULT_SEMANTIC_THRESHOLD = 0.62;

/** 语义候选 → 达标则返回统一形态的候选；不达标返回 null。 */
export function acceptSemanticCandidate(
  cand: SemanticCandidate,
  threshold: number = DEFAULT_SEMANTIC_THRESHOLD,
): { source: "lorebook" | "table"; title: string; content: string; score: number; similarity: number } | null {
  const t = Number.isFinite(threshold) ? threshold : DEFAULT_SEMANTIC_THRESHOLD;
  if (!Number.isFinite(cand.similarity) || cand.similarity < t) return null;
  // 语义召回的分数直接用相似度（乘100 与关键词分同量级，便于同一列表排序观察）
  return {
    source: cand.source,
    title: cand.title,
    content: cand.content,
    score: mixScore(0, cand.similarity),
    // v3.1.138：把原始相似度带出来，供 UI 标注「这条是语义召回的，像在哪、多像」。
    // 没有它，用户看到设定被注入也分不清是关键词命中的还是语义捞回来的——
    // 而「字面不重合却被召回」正是这个功能最该被看见的时刻。
    similarity: cand.similarity,
  };
}