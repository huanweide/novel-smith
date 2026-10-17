// ============================================================
// 历史设定的向量回填 —— 给「没味道清单」的老条目补上清单
// ============================================================
//
// 【这个功能对用户有什么用】
//   语义召回只对「已经生成过向量」的条目生效。
//   你在改这次功能之前录的那 300 条设定，一条向量都没有——对新录的条目有效，
//   对老条目照样失效。本模块负责把它们补齐。
//
// 【用户需要操作吗】
//   不需要。调用方在合适的时机（如项目加载后）触发一次即可；
//   没配 embedding key 时本模块会直接返回 0 条处理结果，不做任何网络请求。
//
// 【为什么单独一个文件】
//   回填是**会写数据库、会发网络请求**的副作用操作，
//   而 hybrid-score.ts（比对的尺子）与 embedding.ts（拿向量）都是纯能力层。
//   三者分开：出问题时能分清是「比对错了」「拿不到向量」还是「没写进库」。
//
// 【不做的事】
//   - 不做 UI 进度条：用户不需要盯着它，静默补齐即可
//   - 不做失败重试队列：失败的条目下次触发时自然会再试一次
//   - 不做定时调度：由调用方决定何时跑

import { prisma } from "@/lib/prisma";
import { embedBatch } from "@/core/llm/embedding";
import { isEmbeddingConfigured } from "@/core/llm/embedding";
import { getSettings } from "@/lib/llm";

/** 单次回填上限。防止超大项目一次跑太久阻塞调用方。 */
export const BACKFILL_LIMIT = 200;

export interface BackfillResult {
  /** 本次尝试处理的数量（已剔除空内容） */
  total: number;
  /** 成功写入向量的数量 */
  written: number;
  /** 因接口不可用/失败而未写入的数量（下次会再试） */
  failed: number;
  /** 未配置 embedding（没配 key），本次跳过 */
  skipped: boolean;
}

/** 把一条设定转成用于向量化的文本。标题与正文都算，关键词也带上。 */
export function buildEmbeddingText(input: {
  title?: string;
  content?: string;
  keys?: unknown;
}): string {
  // 每段单独裁剪再拼接：只裁整体会留下 "标题␣␣␣␣正文" 这种中间多余空格，
  // 白白占用 token 且对语义无贡献。
  const parts: string[] = [];
  // 只收字符串。数字/布尔等被 String() 转出来后对语义毫无贡献，
  // 反而占 token——数据库 Json 字段里混进非字符串是常见的脏数据形态。
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s) parts.push(s);
  };

  // title / content 允许非字符串形态（旧数据里存过数字），统一转字符串再走 push
  push(input.title == null ? undefined : String(input.title));
  push(input.content == null ? undefined : String(input.content));

  // keys 在库里是 Json（字符串数组），需防御式解析
  const keys = input.keys;
  if (Array.isArray(keys)) {
    for (const k of keys) push(k);
  } else if (typeof keys === "string") {
    push(keys);
  }

  return parts.join(" ").trim();
}

/**
 * 为尚未向量化的设定条目批量生成并写入向量。
 *
 * **任何失败都不抛异常**，只体现在 result.failed 上——回填是后台增强，
 * 绝不能因为补清单失败而让作者用不了软件。
 */
export async function backfillLorebookEmbeddings(
  projectId?: string,
  limit: number = BACKFILL_LIMIT,
): Promise<BackfillResult> {
  const empty: BackfillResult = { total: 0, written: 0, failed: 0, skipped: true };

  // 先判定有没有调用条件，避免为了 0 条候选白白查一次库、发一次注定失败的请求
  const settings = await getSettings();
  if (!isEmbeddingConfigured(settings)) return empty;

  // 只取 embedding 为空的条目。Prisma 的 Json 字段用 equals: null 判空
  const rows = await prisma.lorebookEntry.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      enabled: true,
      embedding: { equals: null } as any,
    },
    select: { id: true, title: true, content: true, keys: true },
    take: limit,
  });

  if (rows.length === 0) return { total: 0, written: 0, failed: 0, skipped: false };

  const texts = rows.map((r) => buildEmbeddingText(r));
  // 空文本无法向量化，剔除并记录为失败（下次不会再被选中，属正常收敛）
  const validIdx: number[] = [];
  for (let i = 0; i < texts.length; i++) if (texts[i].length > 0) validIdx.push(i);

  if (validIdx.length === 0) {
    return { total: rows.length, written: 0, failed: rows.length, skipped: false };
  }

  const vectors = await embedBatch(validIdx.map((i) => texts[i]));

  let written = 0;
  let failed = rows.length - validIdx.length;

  for (let k = 0; k < validIdx.length; k++) {
    const vec = vectors[k];
    if (!vec || vec.length === 0) {
      failed++;
      continue;
    }
    try {
      await prisma.lorebookEntry.update({
        where: { id: rows[validIdx[k]].id },
        data: { embedding: vec as any },
      });
      written++;
    } catch {
      // 单条写库失败不影响其余条目
      failed++;
    }
  }

  return { total: rows.length, written, failed, skipped: false };
}