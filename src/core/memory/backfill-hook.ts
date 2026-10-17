// ============================================================
// 回填调度 —— 让「老设定补味道清单」这件事真正跑起来
// ============================================================
//
// 【对用户有什么用】
//   backfill.ts 提供了回填能力，但没有它永远不会自己跑——等于前面几批白做一半：
//   语义召回只对你以后新录的设定有效，以前录的那几百条照样唤不出来。
//   本文件负责在合适时机把它触发起来。
//
// 【触发时机的取舍（为什么不挂在别处）】
//   - 不挂在每次 AI 生成前：会拖慢每一次生成，用户能感知到卡顿
//   - 不挂在每次召回里：召回是热路径，每次都跑等于每次都付网络成本
//   - 不挂在应用启动：启动时还没 projectId，且多数项目这辈子都不会用语义召回
//   → 选「首次真正用到召回时惰性触发 + 节流」：
//     用户打开项目开始写，第一次召回顺手把老设定补齐，之后很长一段时间不再触发。
//
// 【节流为什么用内存 Map 而不是存数据库】
//   这是「别把同一件事重复做一遍」的优化，不是业务状态。
//   进程重启后重新计时完全可接受——最坏情况只是多跑一次回填，无正确性影响。
//   存库反而要加列、要清理、要处理并发，收益不匹配。
//
// 【失败静默】
//   回填是增强项。任何失败都只是「这次没补上」，下次触发会再试，
//   绝不影响正常的关键词召回，绝不让作者写不了字。

import { backfillLorebookEmbeddings } from "./backfill";

/** 同一项目两次回填之间的最小间隔。默认 10 分钟。 */
export const BACKFILL_THROTTLE_MS = 10 * 60 * 1000;

/** projectId → 上次触发时间戳。进程内节流，重启即失效（可接受）。 */
const lastRunAt = new Map<string, number>();
/** 正在执行中的 projectId，避免并发重复触发。 */
const inFlight = new Set<string>();

export function shouldRunBackfill(projectId: string, now: number = Date.now()): boolean {
  if (!projectId) return false;
  if (inFlight.has(projectId)) return false;

  const last = lastRunAt.get(projectId);
  if (last != null && now - last < BACKFILL_THROTTLE_MS) return false;

  return true;
}

/**
 * 触发一次回填（不等待结果）。
 *
 * 调用方应当 `void scheduleBackfill(id)` —— 不要 await，
 * 否则会把这次网络往返的耗时加到用户的请求链路上。
 */
export function scheduleBackfill(projectId: string, now: number = Date.now()): boolean {
  if (!shouldRunBackfill(projectId, now)) return false;

  lastRunAt.set(projectId, now);
  inFlight.add(projectId);

  void (async () => {
    try {
      await backfillLorebookEmbeddings(projectId);
    } catch {
      // 静默：回填失败不影响任何正常功能，下次触发会再试
    } finally {
      inFlight.delete(projectId);
    }
  })();

  return true;
}

/** 仅供测试：清空节流状态。 */
export function resetBackfillThrottle(): void {
  lastRunAt.clear();
  inFlight.clear();
}